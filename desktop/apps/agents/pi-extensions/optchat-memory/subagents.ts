// OptChat subagents (spec §9): spawn(tasks) runs one in-process child session
// per task, in parallel, in the background. Each child starts from the view at
// spawn time and gets zoom/date (read-only, same memory) but not spawn. Child
// tool calls stay in the child's session; only the batch's reports reach the
// chat, as ONE message of "[id] report" lines logged as kind `user`.
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import * as pi from "@earendil-works/pi-coding-agent";
import { homedir } from "node:os";
import { resolve } from "node:path";
import type { OptChatMemory } from "./memory.ts";
import { SUBAGENT_PROMPT, VIEW_DOC } from "./prompt.ts";
import { ApprovalQueue, childUI, readOnlyBlock } from "./child-safety.ts";

export const WORK_MESSAGE_TYPE = "optchat-work";

// What a spawn needs from the master, captured while its tool call runs: the
// background children outlive that call's context.
type Launch = {
  cwd: string;
  parentSessionId: string;
  model: any;
  thinkingLevel: any;
  modelRegistry: any;
  notify: (text: string) => void;
  ui: ExtensionContext["ui"];
  hasUI: boolean;
};

type Child = {
  id: string;
  task: string;
  session?: any;
  status: "starting" | "running" | "done" | "failed" | "aborted";
  report?: string;
};

const expandHome = (p: string) => (p === "~" || p.startsWith("~/") ? resolve(homedir(), p.slice(2)) : p);

export class Subagents {
  children = new Map<string, Child>();
  seq = 0;
  // Pi's extension loader keeps per-load module state; open children one at a time.
  opening: Promise<unknown> = Promise.resolve();
  runtime: Promise<any> | undefined;
  stopped = false;
  approvals = new ApprovalQueue();
  // Log index of a report that will start a new turn: that turn's view ends
  // before it (§7: the view is rendered before the new message is logged).
  reportFrom: number | undefined;

  constructor(readonly api: ExtensionAPI, readonly mem: OptChatMemory, readonly memoryTools: () => any[]) {}

  newId(): string {
    // Unique across restarts, short enough to cost few bytes in the log.
    return `${Date.now().toString(36)}${(this.seq++).toString(36)}`;
  }

  modelRuntime(launch: Launch): Promise<any> {
    // Share the parent's runtime so children see the same providers and
    // credentials; ModelRegistry wraps it in a private field.
    const shared = launch.modelRegistry?.runtime;
    if (shared) return Promise.resolve(shared);
    this.runtime ??= pi.ModelRuntime.create();
    return this.runtime;
  }

  async spawn(tasks: string[], ctx: ExtensionContext): Promise<string[]> {
    // No call ever sees an unsummarized line (§6).
    if (!(await this.mem.settle(ctx.signal, 120_000))) throw new Error("memory view did not settle; spawn cancelled");
    const view = this.mem.renderView();
    const launch: Launch = {
      cwd: ctx.cwd,
      parentSessionId: ctx.sessionManager.getSessionId(),
      model: ctx.model,
      thinkingLevel: ctx.thinkingLevel,
      modelRegistry: ctx.modelRegistry,
      notify: (text) => this.mem.ctx?.ui.notify(text, "warning"),
      ui: ctx.ui,
      hasUI: ctx.hasUI,
    };
    const batch: Child[] = tasks.map(task => ({ id: this.newId(), task, status: "starting" }));
    for (const c of batch) this.children.set(c.id, c);
    void Promise.all(batch.map(c => this.run(c, view, launch))).then(() => this.deliver(batch));
    return batch.map(c => c.id);
  }

  async run(c: Child, view: string, launch: Launch) {
    let session: any;
    try {
      const opened = this.opening.then(() => this.open(c, launch));
      this.opening = opened.catch(() => undefined);
      session = await opened;
      c.session = session;
      if (this.stopped || c.status === "aborted") throw new Error("aborted");
      c.status = "running";
      await session.prompt(`${view}\n\n${c.task}`);
      const text = session.getLastAssistantText?.()?.trim();
      c.report = text || "(no report)";
      c.status = "done";
    } catch (err) {
      if (c.status !== "aborted") c.status = "failed";
      c.report = `${c.status}: ${err instanceof Error ? err.message : String(err)}`;
    } finally {
      if (session) {
        try { await session.extensionRunner?.emit?.({ type: "session_shutdown", reason: "quit" }); } catch {}
        try { session.dispose(); } catch {}
        this.api.events.emit("subagents:child:disposed", { sessionId: session.sessionId });
      }
      c.session = undefined;
    }
  }

  async open(c: Child, launch: Launch) {
    const cfg = this.mem.cfg;
    const { cwd, parentSessionId } = launch;
    const agentDir = pi.getAgentDir();
    const modelRuntime = await this.modelRuntime(launch);
    const settingsManager = pi.SettingsManager.create(cwd, agentDir);

    // Only the configured extensions: loading the parent's ambient set would
    // start a second OptChat writer (and every other extension) in-process.
    const codemode = typeof (pi as any).createCodemodeExtension === "function"
      ? [{ name: "codemode", factory: (pi as any).createCodemodeExtension(), replaceable: true }]
      : [];
    const failures: string[] = [];
    const bridge = childUI(launch.ui, c.id, this.approvals, message => failures.push(message));
    // Always install the guard, even if settings or another extension exposes
    // additional tools. Nested codemode calls also pass through tool_call.
    const safety = (api: ExtensionAPI) => {
      api.on("tool_call", (event) => {
        const reason = !bridge.ready() || failures.length
          ? "Subagent safety: sandbox unavailable or extension failure"
          : readOnlyBlock(event.toolName);
        if (reason) return { block: true, reason };
      });
      api.on("user_bash", () => ({ result: {
        output: "Read-only subagent: shell commands are disabled", exitCode: 1,
        cancelled: false, truncated: false,
      } }));
    };
    const loader = new pi.DefaultResourceLoader({
      cwd,
      agentDir,
      settingsManager,
      noExtensions: true,
      noPromptTemplates: true,
      additionalExtensionPaths: cfg.subagentExtensions.map(expandHome),
      extensionFactories: [...codemode, { name: "child-safety", factory: safety }] as any,
      appendSystemPromptOverride: (base: string[]) => [...base, `${SUBAGENT_PROMPT}\n\n${VIEW_DOC}\n\nYou are read-only. Use read, zoom and date. Do not run shell commands or modify files. Report suggested changes to the parent.`],
    } as any);
    await loader.reload();
    const loaded = loader.getExtensions();
    if (loaded.errors.length) throw new Error(`Subagent extensions failed to load: ${loaded.errors.map((e: any) => e.error).join("; ")}`);

    let model = launch.model;
    let thinkingLevel = launch.thinkingLevel;
    if (cfg.subagentModel) {
      const resolved = pi.resolveCliModel({ cliModel: cfg.subagentModel, modelRuntime });
      if (resolved.error || !resolved.model) throw new Error(resolved.error ?? `unknown model ${cfg.subagentModel}`);
      model = resolved.model;
      thinkingLevel = resolved.thinkingLevel ?? thinkingLevel;
    }

    const { session } = await pi.createAgentSession({
      cwd,
      agentDir,
      modelRuntime,
      ...(model ? { model } : {}),
      ...(thinkingLevel ? { thinkingLevel } : {}),
      tools: ["read", "zoom", "date", "codemode"],
      customTools: this.memoryTools(),
      resourceLoader: loader,
      sessionManager: pi.SessionManager.inMemory(cwd),
      settingsManager,
      sessionStartEvent: { type: "session_start", reason: "startup" },
    } as any);

    // pi-permission-system's in-process child contract: announce synchronously
    // before binding so the child's permission instance forwards `ask`s to us.
    this.api.events.emit("subagents:child:session-created", { sessionId: session.sessionId, parentSessionId });
    try {
      await session.bindExtensions({
        mode: "print",
        uiContext: bridge.ui,
        onError: (e: any) => {
          failures.push(`${e.extensionPath} (${e.event}): ${e.error}`);
          launch.notify(`subagent ${c.id}: ${failures.at(-1)}`);
        },
      });
      if (failures.length || !bridge.ready()) {
        throw new Error(`Subagent startup blocked: ${failures.join("; ") || "sandbox did not initialize"}`);
      }
    } catch (error) {
      try { await session.extensionRunner?.emit?.({ type: "session_shutdown", reason: "quit" }); } catch {}
      session.dispose();
      this.api.events.emit("subagents:child:disposed", { sessionId: session.sessionId });
      throw error;
    }
    this.api.events.emit("subagents:child:bound", { sessionId: session.sessionId, parentSessionId });
    return session;
  }

  async deliver(batch: Child[]) {
    if (this.stopped) return;
    const content = batch.map(c => `[${c.id}] ${c.report ?? c.status}`).join("\n\n");
    for (const c of batch) this.children.delete(c.id);
    // Log first: the report is part of the chat whether or not a turn takes it.
    const idle = this.mem.ctx?.isIdle();
    const i = await this.mem.log("user", content, "subagents");
    if (idle && i !== undefined) this.reportFrom ??= i;
    // Between the master's tool calls while it works, or a new turn when idle.
    this.api.sendMessage({ customType: WORK_MESSAGE_TYPE, content, display: true }, { triggerTurn: true, deliverAs: "steer" });
  }

  async tell(id: string, message: string): Promise<string> {
    const c = this.children.get(id);
    if (!c) return `No running subagent ${id}.`;
    if (!c.session || c.status !== "running") return `Subagent ${id} is ${c.status}; try again shortly.`;
    if (c.session.isStreaming) await c.session.steer(message);
    else await c.session.followUp(message);
    return `sent to ${id}`;
  }

  list(): string {
    if (!this.children.size) return "no subagents running";
    return [...this.children.values()].map(c => `${c.id} ${c.status}: ${c.task.replace(/\s+/g, " ").slice(0, 120)}`).join("\n");
  }

  async shutdown() {
    this.stopped = true;
    await Promise.all([...this.children.values()].map(async c => {
      c.status = "aborted";
      try { await c.session?.abort(); } catch {}
    }));
  }
}
