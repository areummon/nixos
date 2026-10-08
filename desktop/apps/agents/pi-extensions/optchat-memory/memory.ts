import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { mkdirSync, readdirSync, readFileSync, appendFileSync, existsSync, openSync, closeSync, renameSync, unlinkSync, writeFileSync, writeSync, fsyncSync } from "node:fs";
import { execFile } from "node:child_process";
import { createConnection, createServer, type Server } from "node:net";
import { promisify } from "node:util";
import { join, dirname, basename } from "node:path";
import type { Config, Kind, MessageRecord, NodeRecord, Part } from "./types.ts";
import { markViewBreakpoints } from "./cache.ts";
import { COMPACT_PROMPT, viewBlocks } from "./prompt.ts";
import { assertSafeImportPath, byteLen, countOf, cutBytes, exactScaleLine, flatten, heuristicSummary, idOf, localDay, pow2, safeJson, startOf, textContent } from "./util.ts";

// §3.2: the sibling pair most due to merge, as the index of its left part, or
// -1. due = (T - last) / 2^l, written (T + 1) / 2^l - i; ties go to the oldest.
export function mostDue(view: Part[], T: number, built: (l: number, i: number) => boolean): number {
  let best = -1;
  let bestDue = -Infinity;
  for (let k = 0; k < view.length - 1; k++) {
    const a = view[k], b = view[k + 1];
    if (a.l !== b.l || a.i % 2 !== 0 || b.i !== a.i + 1 || !built(a.l + 1, a.i / 2)) continue;
    const due = (T + 1) / 2 ** a.l - a.i;
    if (due > bestDue) { bestDue = due; best = k; }
  }
  return best;
}

export class OptChatMemory {
  cfg: Config;
  root: MessageRecord[] = [];
  nodes = new Map<string, NodeRecord>();
  view: Part[] = [];
  // §3.2: a batch merges from past viewBytes down to half of it.
  merging = false;
  busy = new Set<string>();
  failedOnce = new Set<string>();
  lock: Server | undefined;
  ctx: ExtensionContext | undefined;
  stopped = false;
  paused = false;
  seq = Promise.resolve();
  commits = Promise.resolve();
  commitFailed = false;

  constructor(cfg: Config) { this.cfg = cfg; }
  key(l: number, i: number) { return `${l}:${i}`; }
  node(l: number, i: number) { return this.nodes.get(this.key(l, i)); }
  built(l: number, i: number) { return this.nodes.has(this.key(l, i)); }

  // soft: return false instead of throwing when another process holds the lock.
  async start(ctx: ExtensionContext, { soft = false }: { soft?: boolean } = {}): Promise<boolean> {
    this.ctx = ctx;
    mkdirSync(join(this.cfg.memoryDir, "main"), { recursive: true });
    mkdirSync(join(this.cfg.memoryDir, "tree"), { recursive: true });
    if (soft) {
      if (!(await this.acquireLockSoft())) return false;
    } else await this.acquireLock();
    this.load();
    this.loadView();
    this.pump();
    ctx.ui.setStatus("optchat", `mem ${this.root.length} msgs`);
    return true;
  }

  shutdown() {
    this.stopped = true;
    // Closing a listening Unix socket also removes its file.
    this.lock?.close();
    this.lock = undefined;
  }

  // One writer (§2): hold a Unix socket for the life of the process. A second
  // process that can connect to it refuses to start; a socket that refuses
  // connections is stale (the OS frees it when its owner dies) and is taken
  // over. No PID files, no timeouts.
  async acquireLock() {
    if (!(await this.acquireLockSoft())) {
      throw new Error(`optchat-memory: another process holds ${join(this.cfg.memoryDir, "lock")}; refusing to start`);
    }
  }

  async acquireLockSoft(): Promise<boolean> {
    const p = join(this.cfg.memoryDir, "lock");
    const listen = () => new Promise<Server>((resolve, reject) => {
      const server = createServer(socket => socket.end());
      server.once("error", reject);
      server.listen(p, () => {
        server.off("error", reject);
        server.unref();
        resolve(server);
      });
    });
    try {
      this.lock = await listen();
      return true;
    } catch (err: any) {
      if (err?.code !== "EADDRINUSE") throw err;
    }
    const live = await new Promise<boolean>(resolve => {
      const socket = createConnection(p);
      socket.once("connect", () => { socket.destroy(); resolve(true); });
      socket.once("error", () => resolve(false));
    });
    if (live) return false;
    unlinkSync(p);
    this.lock = await listen();
    return true;
  }

  load() {
    this.root = [];
    this.nodes.clear();
    let torn = 0;
    const loadDir = (sub: "main" | "tree", fn: (obj: any) => void) => {
      const dir = join(this.cfg.memoryDir, sub);
      if (!existsSync(dir)) return;
      for (const file of readdirSync(dir).filter(f => f.endsWith(".jsonl")).sort()) {
        const path = join(dir, file);
        const raw = readFileSync(path, "utf8");
        if (raw && !raw.endsWith("\n")) appendFileSync(path, "\n");
        for (const line of raw.split("\n")) {
          if (!line.trim()) continue;
          try { fn(JSON.parse(line)); } catch { torn++; }
        }
      }
    };
    loadDir("main", (o) => {
      if (typeof o.i === "number" && typeof o.text === "string" && typeof o.kind === "string") this.root[o.i] = o;
    });
    this.root = this.root.filter(Boolean).sort((a, b) => a.i - b.i);
    loadDir("tree", (o) => {
      if (typeof o.l === "number" && typeof o.i === "number" && typeof o.text === "string") this.nodes.set(this.key(o.l, o.i), o);
    });
    // A crash mid-write leaves a line that is not JSON: report it, skip it (§2).
    if (torn) this.ctx?.ui.notify(`optchat-memory: skipped ${torn} torn line(s) in ${this.cfg.memoryDir}`, "warning");
  }

  appendLine(sub: "main" | "tree", obj: unknown) {
    const path = join(this.cfg.memoryDir, sub, `${localDay()}.jsonl`);
    mkdirSync(dirname(path), { recursive: true });
    const fd = openSync(path, "a");
    try {
      writeSync(fd, JSON.stringify(obj) + "\n", undefined, "utf8");
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
  }

  enqueue<T>(f: () => T | Promise<T>): Promise<T> {
    const next = this.seq.then(f, f);
    this.seq = next.then(() => undefined, () => undefined);
    return next;
  }

  // Resolves to the message's id once it is in the log.
  async log(kind: Kind, text: string, source?: string): Promise<number | undefined> {
    text = String(text ?? "").trim();
    if (!text) return undefined;
    return this.enqueue(async () => {
      const rec: MessageRecord = { i: this.root.length, kind, text, size: byteLen(`${kind}: ${text}`), date: new Date().toISOString(), source };
      this.root.push(rec);
      this.appendLine("main", rec);
      this.grow(rec.i);
      this.saveView();
      this.pump();
      this.ctx?.ui.setStatus("optchat", `mem ${this.root.length} msgs`);
      return rec.i;
    });
  }

  // §10: persist after each turn. Only the append-only log and tree are
  // history; the lock, snapshots, exports and HTML stay out of the repo.
  commit(): Promise<void> {
    const git = (...args: string[]) => promisify(execFile)("git", ["-C", this.cfg.memoryDir, "-c", "user.name=optchat-memory", "-c", "user.email=optchat-memory@localhost", ...args]);
    this.commits = this.commits.then(async () => {
      await git("init", "-q");
      await git("add", "main", "tree");
      if (await git("diff", "--cached", "--quiet").then(() => true, () => false)) return;
      await git("commit", "-q", "-m", `messages 0-${this.root.length - 1}`);
    }).catch((err) => {
      if (this.commitFailed) return;
      this.commitFailed = true;
      this.ctx?.ui.notify(`optchat-memory: git commit of ${this.cfg.memoryDir} failed: ${String(err)}`, "warning");
    });
    return this.commits;
  }

  appendNode(n: NodeRecord) {
    if (this.built(n.l, n.i)) return;
    this.nodes.set(this.key(n.l, n.i), n);
    this.appendLine("tree", n);
  }

  // §3.2: a view rebuilt at a restart differs from the live one and kills every
  // cache entry, so the view is saved and loaded. Messages logged after the last
  // save are appended; only a missing view.json is rebuilt.
  loadView() {
    let pairs: unknown;
    try { pairs = JSON.parse(readFileSync(join(this.cfg.memoryDir, "view.json"), "utf8")); } catch {}
    if (!Array.isArray(pairs)) return this.rebuildView();
    this.view = [];
    let pos = 0;
    for (const [l, i] of pairs) {
      const p = { l, i };
      if (startOf(p) !== pos || pos + countOf(p) > this.root.length) break;
      this.view.push(p);
      pos += countOf(p);
    }
    for (; pos < this.root.length; pos++) this.grow(pos);
    this.saveView();
  }

  rebuildView() {
    this.view = [];
    this.merging = false;
    for (let i = 0; i < this.root.length; i++) this.grow(i);
    this.saveView();
  }

  saveView() {
    const path = join(this.cfg.memoryDir, "view.json");
    writeFileSync(`${path}.tmp`, JSON.stringify(this.view.map(p => [p.l, p.i])));
    renameSync(`${path}.tmp`, path);
  }

  partText(p: Part): string {
    const n = this.node(p.l, p.i);
    if (n) return n.text;
    if (p.l === 0) return `(not summarized yet: zoom it)`;
    return `(missing summary)`;
  }

  viewBytes() { return this.view.reduce((n, p) => n + byteLen(this.partText(p)), 0); }
  settled(upTo = Infinity) { return this.viewBefore(upTo).every(p => this.built(p.l, p.i)); }

  // The view of messages [0, upTo): what a turn sees, rendered before its own
  // message is logged (§7). A part reaching past upTo is opened into its
  // children, which exist because a parent is only built after them.
  viewBefore(upTo: number): Part[] {
    if (upTo >= this.root.length) return this.view;
    const out: Part[] = [];
    const cut = (p: Part) => {
      const start = startOf(p), end = start + countOf(p);
      if (end <= upTo) out.push(p);
      else if (start < upTo && p.l > 0) {
        cut({ l: p.l - 1, i: p.i * 2 });
        cut({ l: p.l - 1, i: p.i * 2 + 1 });
      }
    };
    for (const p of this.view) cut(p);
    return out;
  }

  // §3.2: message i appends its line and nothing else changes, so each turn's
  // view is a prefix of the next. Past viewBytes, one batch merges the most due
  // pairs down to half of it; unbuilt parents defer the rest to later messages.
  grow(i: number) {
    this.view.push({ l: 0, i });
    const low = Math.floor(this.cfg.viewBytes / 2);
    let size = this.viewBytes();
    if (size > this.cfg.viewBytes) this.merging = true;
    while (this.merging && size > low) {
      const k = mostDue(this.view, i + 1, (l, j) => this.built(l, j));
      if (k < 0) return;
      const a = this.view[k];
      this.view.splice(k, 2, { l: a.l + 1, i: a.i / 2 });
      size = this.viewBytes();
    }
    this.merging = false;
  }

  renderView(upTo = Infinity, tag = "chat") {
    const lines = this.viewBefore(upTo).map(p => `${idOf(p)}+${countOf(p)}|${flatten(this.partText(p))}`);
    return `<${tag}>\n${lines.join("\n")}\n</${tag}>`;
  }

  zoom(id: number, n: number): string {
    if (!Number.isInteger(id) || !Number.isInteger(n) || n < 1 || (n & (n - 1)) !== 0 || id % n !== 0 || id + n > this.root.length) {
      return `No line ${id}+${n}.`;
    }
    if (n === 1) {
      const m = this.root[id];
      return m ? `${id}+0|${m.kind}: ${m.text}` : `No line ${id}+1.`;
    }
    const l = Math.log2(n);
    const i = id / n;
    const childL = l - 1;
    const left: Part = { l: childL, i: i * 2 };
    const right: Part = { l: childL, i: i * 2 + 1 };
    return `${idOf(left)}+${countOf(left)}|${flatten(this.partText(left))}\n${idOf(right)}+${countOf(right)}|${flatten(this.partText(right))}`;
  }

  date(id: number): string {
    const m = this.root[id];
    return m ? new Date(m.date).toString() : `No message ${id}.`;
  }

  async settle(signal?: AbortSignal, timeoutMs = Infinity, upTo = Infinity): Promise<boolean> {
    const start = Date.now();
    while (!this.settled(upTo)) {
      if (signal?.aborted || Date.now() - start > timeoutMs) return false;
      this.pump();
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    return true;
  }

  status() {
    return [
      `messages: ${this.root.length}`,
      `built nodes: ${this.nodes.size}`,
      `view bytes: ${this.viewBytes()} / ${this.cfg.viewBytes}`,
      `view parts: ${this.view.length}`,
      `busy compactors: ${this.busy.size}`,
      `settled: ${this.settled()}`,
      `paused: ${this.paused}`,
      `memory dir: ${this.cfg.memoryDir}`,
      `replace context: ${this.cfg.replaceContext}`,
      `model compactor: ${!this.cfg.disableModelCompactor}`,
    ].join("\n");
  }

  verify(): string {
    const problems: string[] = [];
    for (let i = 0; i < this.root.length; i++) {
      if (!this.root[i] || this.root[i].i !== i) problems.push(`missing or out-of-order message ${i}`);
    }
    let pos = 0;
    for (const p of this.view) {
      if (startOf(p) !== pos) problems.push(`view gap/overlap at ${pos}, saw ${idOf(p)}+${countOf(p)}`);
      pos += countOf(p);
      if (!this.built(p.l, p.i)) problems.push(`unbuilt view part ${idOf(p)}+${countOf(p)}`);
    }
    if (pos !== this.root.length) problems.push(`view ends at ${pos}, root length is ${this.root.length}`);
    for (const n of this.nodes.values()) {
      if (n.l > 0 && (!this.built(n.l - 1, n.i * 2) || !this.built(n.l - 1, n.i * 2 + 1))) {
        problems.push(`node ${n.l}:${n.i} is missing one or both children`);
      }
      if (n.size !== byteLen(n.text)) problems.push(`node ${n.l}:${n.i} stored size ${n.size} != actual ${byteLen(n.text)}`);
    }
    return problems.length ? `FAILED\n${problems.slice(0, 200).join("\n")}` : "OK";
  }

  exportSnapshot(path: string): string {
    const out = {
      exportedAt: new Date().toISOString(),
      config: { nodeBytes: this.cfg.nodeBytes, viewBytes: this.cfg.viewBytes },
      messages: this.root,
      nodes: [...this.nodes.values()].sort((a, b) => a.l - b.l || a.i - b.i),
      view: this.view,
    };
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify(out, null, 2));
    return `exported ${this.root.length} messages and ${this.nodes.size} nodes to ${path}`;
  }

  async importNotes(path: string): Promise<string> {
    assertSafeImportPath(path);
    const raw = readFileSync(path, "utf8");
    let count = 0;
    for (const chunk of raw.split(/\n\n+/).map(s => s.trim()).filter(Boolean)) {
      await this.log("note", chunk, `import:${basename(path)}`);
      count++;
    }
    return `imported ${count} notes from ${path}`;
  }

  rebuildTree(): string {
    // Append-only rebuild: old tree lines remain on disk, but later duplicate
    // node ids supersede earlier ones on load. This avoids deleting history.
    this.nodes.clear();
    this.busy.clear();
    this.failedOnce.clear();
    this.rebuildView();
    this.pump();
    return `rebuild scheduled for ${this.root.length} messages`;
  }

  firstUnbuiltStart(): number {
    for (const p of this.view) if (!this.built(p.l, p.i)) return startOf(p);
    return this.root.length;
  }

  ready(l: number, i: number): boolean {
    if (l === 0) return !!this.root[i];
    return this.built(l - 1, i * 2) && this.built(l - 1, i * 2 + 1);
  }

  pump() {
    if (this.stopped || this.paused) return;
    const T = this.root.length;
    const first = this.firstUnbuiltStart();
    for (let l = 0; pow2(l) <= T; l++) {
      for (let i = 0; (i + 1) * pow2(l) <= T; i++) {
        if (this.busy.size >= this.cfg.jobs) return;
        const k = this.key(l, i);
        const end = l === 0 ? i : (i + 1) * pow2(l);
        if (this.built(l, i) || this.busy.has(k) || !this.ready(l, i) || end > first) continue;
        this.busy.add(k);
        this.build(l, i).then(() => {
          this.busy.delete(k);
          this.pump();
        }, (err) => {
          this.busy.delete(k);
          if (!this.failedOnce.has(k)) {
            this.failedOnce.add(k);
            this.ctx?.ui.notify(`optchat-memory compactor failed for ${k}: ${String(err)}`, "warning");
          }
          setTimeout(() => this.pump(), this.cfg.retryMs).unref?.();
        });
      }
    }
  }

  async build(l: number, i: number) {
    if (this.built(l, i)) return;
    let source = "";
    if (l === 0) {
      const m = this.root[i];
      source = `${m.kind}: ${m.text}`;
      if (byteLen(source) <= this.cfg.nodeBytes) return this.appendNode({ l, i, text: source, size: byteLen(source) });
    } else {
      const a = this.node(l - 1, i * 2)!;
      const b = this.node(l - 1, i * 2 + 1)!;
      source = `${flatten(a.text)}\n${flatten(b.text)}`;
      if (byteLen(source) <= this.cfg.nodeBytes) return this.appendNode({ l, i, text: source, size: byteLen(source) });
    }
    const text = await this.compact(l, i, source);
    this.appendNode({ l, i, text, size: byteLen(text) });
  }

  contextBefore(l: number, i: number): string {
    const end = l === 0 ? i : (i + 1) * pow2(l);
    const lines = this.view.filter(p => startOf(p) + countOf(p) <= end).map(p => flatten(this.partText(p)));
    return `<chat>\n${lines.join("\n")}\n</chat>`;
  }

  // The compactor's model: cfg.compactorModel ("provider/id"), else the chat's.
  compactorModel(): any {
    const name = this.cfg.compactorModel;
    if (!name) return this.ctx?.model;
    const slash = name.indexOf("/");
    return slash > 0 ? this.ctx?.modelRegistry.find(name.slice(0, slash), name.slice(slash + 1)) : undefined;
  }

  // One node, one model call with no tools (§4.2), size enforced in the same
  // conversation (§4.3). Any failure throws: pump() retries the node after
  // RETRY, forever. Never store cut text in its place.
  async compact(l: number, i: number, source: string): Promise<string> {
    if (this.cfg.disableModelCompactor) return heuristicSummary(source, this.cfg.nodeBytes); // explicit opt-out only
    const model = this.compactorModel();
    if (!this.ctx || !model) throw new Error(`no compactor model (${this.cfg.compactorModel ?? "chat model unset"})`);
    const N = this.cfg.nodeBytes;
    const step = l === 0
      ? `For scale, this line is exactly ${N} bytes:\n${exactScaleLine(N)}\n\nCompress this message into one line, in at most ${N} bytes:\n${source}`
      : `For scale, this line is exactly ${N} bytes:\n${exactScaleLine(N)}\n\nMerge these two lines into one, in at most ${N} bytes:\n${source}`;
    // Two blocks: the context (first, so calls share a cached prefix), then the step.
    const context = viewBlocks(this.contextBefore(l, i));
    const messages: any[] = [
      { role: "system", content: COMPACT_PROMPT },
      { role: "user", content: [...context.map(text => ({ type: "text", text })), { type: "text", text: step }] },
    ];
    const options: any = {
      maxTokens: this.cfg.compactorMaxTokens,
      sessionId: "optchat-compactor",
      ...(this.cfg.compactorThinking ? { reasoning: this.cfg.compactorThinking } : {}),
      // §3.3: breakpoints on the context blocks; the context is the shared prefix.
      onPayload: (payload: unknown) => markViewBreakpoints(payload, context),
    };
    const tries: string[] = [];
    for (;;) {
      const msg: any = await this.ctx.modelRegistry.streamSimple(model, { messages } as any, options).result();
      if (msg?.stopReason === "error" || msg?.stopReason === "aborted") throw new Error(msg.errorMessage ?? msg.stopReason);
      const line = textContent(msg?.content).trim();
      if (!line) throw new Error("empty reply");
      tries.push(line);
      if (byteLen(line) <= N || tries.length >= this.cfg.tries) break;
      // Keep the model's output verbatim (reasoning included) in the conversation.
      messages.push(msg);
      messages.push({ role: "user", content: `That line is ${byteLen(line)} bytes; the limit is ${N}. It must end where it is cut here:\n${cutBytes(line, N)}| ← LIMIT` });
    }
    return tries.reduce((a, b) => (byteLen(b) < byteLen(a) ? b : a));
  }
}

