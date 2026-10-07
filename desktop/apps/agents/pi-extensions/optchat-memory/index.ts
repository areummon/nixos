import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { join } from "node:path";
import { config } from "./config.ts";
import { OptChatMemory } from "./memory.ts";
import { markViewBreakpoints } from "./cache.ts";
import { AGENT_GUIDE, MASTER_PROMPT, MEMORY_GUIDE, VIEW_DOC, splitAtMarks } from "./prompt.ts";
import { writeHtml } from "./html.ts";
import { cap, replyText, safeJson, textContent } from "./util.ts";
import { isPstackChild, publishSnapshot, registerPstackMemory, removePublishedSnapshot, SNAPSHOT_ENV } from "./pstack-memory.ts";

export default function (pi: ExtensionAPI) {
  // Pstack subprocesses must never acquire the parent's writer lock or log
  // their private conversation into its archive. Descendants inherit the
  // same snapshot, and each process freezes it when this extension loads.
  if (isPstackChild()) {
    registerPstackMemory(pi, process.env[SNAPSHOT_ENV]);
    return;
  }
  const mem = new OptChatMemory(config());

  const memoryTools = [
    {
      name: "zoom",
      label: "Zoom Memory",
      description: "Open the line id+n of the memory view into the two lines of n/2 under it; n = 1 gives the message whole.",
      parameters: { type: "object", properties: { id: { type: "number" }, n: { type: "number" } }, required: ["id", "n"] } as any,
      async execute(_toolCallId: string, params: any) {
        return { content: [{ type: "text", text: mem.zoom(params.id, params.n) }], details: undefined };
      },
    },
    {
      name: "date",
      label: "Memory Date",
      description: "The date and time of message id.",
      parameters: { type: "object", properties: { id: { type: "number" } }, required: ["id"] } as any,
      async execute(_toolCallId: string, params: any) {
        return { content: [{ type: "text", text: mem.date(params.id) }], details: undefined };
      },
    },
  ];
  // Log index of a pstack report that starts a new turn: that turn's view ends
  // before it (§7: the view is rendered before the new message is logged).
  let reportFrom: number | undefined;

  // User-wide notes shared by every project, in its own log under its own lock.
  // Only one session can hold that lock; the others run with project memory only.
  let globalMem: OptChatMemory | undefined;

  pi.on("session_start", async (_event, ctx) => {
    await mem.start(ctx as ExtensionContext);
    publishSnapshot(mem);
    const cfg = mem.cfg;
    if (!cfg.globalMemoryDir) return;
    globalMem = new OptChatMemory({ ...cfg, memoryDir: cfg.globalMemoryDir, viewBytes: Math.floor(cfg.viewBytes / 4) });
    if (!(await globalMem.start(ctx as ExtensionContext, { soft: true }))) {
      globalMem = undefined;
      ctx.ui.notify(`optchat-memory: another session holds the global memory in ${cfg.globalMemoryDir}; running with project memory only`, "warning");
    }
    ctx.ui.setStatus("optchat", `mem ${mem.root.length} msgs`);
  });
  pi.on("session_shutdown", async () => {
    await mem.commit();
    mem.shutdown();
    removePublishedSnapshot(mem);
    await globalMem?.commit();
    globalMem?.shutdown();
  });

  pi.on("message_end", async (event: any) => {
    const m = event.message;
    if (!m) return;
    if (m.role === "user") await mem.log("user", textContent(m.content), "message_end");
    else if (m.role === "assistant") await mem.log("talk", replyText(m.content), "message_end");
    else if (m.role === "custom" && m.customType === "pstack-agent") {
      // §9: a report is a user message starting "[id] "; the compactor tags it work:.
      const i = await mem.log("user", `[${m.details?.agentId ?? "agent"}] ${textContent(m.content)}`, "pstack-agent");
      // An idle report starts a run without before_agent_start; its view ends before it.
      if (!turn && i !== undefined) reportFrom ??= i;
    }
  });

  pi.on("tool_call", async (event: any, ctx: ExtensionContext) => {
    if (event.parentToolCallId) return;
    await mem.log("tool", `${event.toolName} ${safeJson(event.input ?? {})}`, "tool_call");
    // Refresh before launch/resume. PiChild inherits this path via spawn's
    // environment; no upstream patch or changes to agent routing needed.
    if (event.toolName === "agent" || event.toolName === "send_message") {
      await mem.settle(ctx.signal);
      publishSnapshot(mem);
    }
  });

  pi.on("tool_result", async (event: any) => {
    if (event.parentToolCallId) return;
    const body = textContent(event.content);
    const capped = cap(body, mem.cfg.capChars);
    // Only tool results are capped (§7); other kinds are logged whole.
    await mem.log("echo", `${event.toolName}${event.isError ? " ERROR" : ""}: ${capped}`, "tool_result");
    if (capped === body) return;
    const images = (event.content ?? []).filter((b: any) => b?.type === "image");
    return { content: [{ type: "text", text: capped }, ...images] };
  });

  // One turn = one agent run (§7). Its view covers the messages before upTo,
  // the turn's own message excluded, and is reused byte-identical on every
  // step so the cached prefix holds; the turn's steps follow it verbatim.
  type Turn = { upTo: number; view?: any[]; first?: any };
  let turn: Turn | undefined;

  // No call sees an unsummarized line (§6): wait for the compactor however
  // long, inside the run so Esc aborts it and leaves the message unanswered.
  const freeze = async (t: Turn, ctx: ExtensionContext): Promise<any[] | undefined> => {
    if (!mem.settled(t.upTo)) ctx.ui.setStatus("optchat", "mem: waiting for compactor (Esc cancels)");
    const settled = await mem.settle(ctx.signal, Infinity, t.upTo);
    ctx.ui.setStatus("optchat", `mem ${mem.root.length} msgs`);
    if (!settled) return undefined;
    let view = mem.renderView(t.upTo);
    if (globalMem) {
      if (!(await globalMem.settle(ctx.signal))) return undefined;
      view = `${globalMem.renderView(Infinity, "global-memory")}\n${view}`;
    }
    return splitAtMarks(view).map(content => ({ role: "user", content }));
  };

  // Where the turn's messages begin: the message(s) that started the run,
  // i.e. the last run of user/custom entries the first step sees.
  const isInput = (m: any) => m?.role === "user" || m?.role === "custom";
  const turnStart = (messages: any[], t: Turn): number => {
    if (t.first) {
      const same = messages.indexOf(t.first);
      if (same >= 0) return same;
      for (let i = messages.length - 1; i >= 0; i--) {
        if (messages[i].role === t.first.role && messages[i].timestamp === t.first.timestamp) return i;
      }
    }
    let i = messages.length - 1;
    while (i >= 0 && !isInput(messages[i])) i--;
    while (i > 0 && isInput(messages[i - 1])) i--;
    t.first = messages[Math.max(i, 0)];
    return Math.max(i, 0);
  };

  pi.on("before_agent_start", async (event: any, ctx: ExtensionContext) => {
    reportFrom = undefined;
    turn = { upTo: mem.root.length };
    const guide = mem.cfg.replaceContext ? MASTER_PROMPT : MEMORY_GUIDE;
    return { systemPrompt: `${event.systemPrompt ?? ""}\n\n${guide}\n\n${AGENT_GUIDE}\n\n${VIEW_DOC}` };
  });

  // §8: cache breakpoints on the view pieces (Anthropic); other APIs pass through.
  pi.on("before_provider_request", (event: any) => {
    if (!turn?.view || !mem.cfg.replaceContext) return;
    return markViewBreakpoints(event.payload, turn.view.map((m: any) => m.content));
  });

  pi.on("agent_settled", async () => {
    turn = undefined;
    void mem.commit();
    void globalMem?.commit();
  });

  pi.on("context_with_system", async (event: any, ctx: ExtensionContext) => {
    // A run started without prompt() (a pstack report arriving while idle)
    // skips before_agent_start: its view ends before its report.
    if (!turn) {
      turn = { upTo: reportFrom ?? mem.root.length };
      reportFrom = undefined;
    }
    turn.view ??= await freeze(turn, ctx);
    if (!turn.view) return;
    const messages = event.messages ?? [];
    // Pi requires its system message to stay first: [system] [view] [...].
    let head = 0;
    while (messages[head]?.role === "system") head++;
    const system = messages.slice(0, head);
    const rest = messages.slice(head);
    if (!mem.cfg.replaceContext) return { messages: [...system, ...turn.view, ...rest] };
    // Fresh call per turn: the view, then only this turn's messages and steps.
    return { messages: [...system, ...turn.view, ...rest.slice(turnStart(rest, turn))] };
  });

  const needGlobal = (): OptChatMemory => {
    if (!globalMem) throw new Error("global memory is not active (globalMemoryDir unset, or another session holds it)");
    return globalMem;
  };

  const globalMemoryTools = [
    {
      name: "global_zoom",
      label: "Global Memory Zoom",
      description: "Open a <global-memory> line id+n into the two lines of n/2 under it; n=1 gives the note whole.",
      parameters: { type: "object", properties: { id: { type: "number" }, n: { type: "number" } }, required: ["id", "n"] } as any,
      async execute(_toolCallId: string, params: any) {
        return { content: [{ type: "text", text: needGlobal().zoom(params.id, params.n) }], details: undefined };
      },
    },
    {
      name: "global_date",
      label: "Global Memory Date",
      description: "The date and time of a <global-memory> message id.",
      parameters: { type: "object", properties: { id: { type: "number" } }, required: ["id"] } as any,
      async execute(_toolCallId: string, params: any) {
        return { content: [{ type: "text", text: needGlobal().date(params.id) }], details: undefined };
      },
    },
  ];

  for (const tool of memoryTools) pi.registerTool(tool as any);
  for (const tool of globalMemoryTools) pi.registerTool(tool as any);

  // Notes are user-wide, so they also go to the global log when it is open.
  const importNotes = async (path: string) => {
    const text = await mem.importNotes(path);
    return globalMem ? `${text}\nglobal: ${await globalMem.importNotes(path)}` : text;
  };

  pi.registerTool({
    name: "memory_status",
    label: "Memory Status",
    description: "Show OptChat memory status, including message count, view size, and compactor state.",
    parameters: { type: "object", properties: {}, required: [] } as any,
    async execute() {
      const text = globalMem ? `${mem.status()}\n--- global memory ---\n${globalMem.status()}` : mem.status();
      return { content: [{ type: "text", text }], details: undefined };
    },
  } as any);

  pi.registerTool({
    name: "memory_note_global",
    label: "Global Memory Note",
    description: "Save a note to the user-wide global memory, shown in <global-memory> in every project.",
    parameters: { type: "object", properties: { text: { type: "string" } }, required: ["text"] } as any,
    async execute(_toolCallId: string, params: any) {
      const i = await needGlobal().log("note", String(params.text), "memory_note_global");
      return { content: [{ type: "text", text: `saved global note ${i}` }], details: undefined };
    },
  } as any);

  pi.registerTool({
    name: "memory_verify",
    label: "Memory Verify",
    description: "Verify OptChat memory log/tree/view consistency.",
    parameters: { type: "object", properties: {}, required: [] } as any,
    async execute() {
      return { content: [{ type: "text", text: mem.verify() }], details: undefined };
    },
  } as any);

  pi.registerTool({
    name: "memory_control",
    label: "Memory Control",
    description: "Control OptChat memory: pause, resume, rebuild-tree, export, import-notes, or html (write a browsable page). global-export, global-import-notes and global-html act on the global memory.",
    parameters: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["pause", "resume", "rebuild-tree", "export", "import-notes", "html", "global-export", "global-import-notes", "global-html"] },
        path: { type: "string" },
      },
      required: ["action"],
    } as any,
    async execute(_toolCallId: string, params: any) {
      let text: string;
      if (params.action === "pause") {
        mem.paused = true;
        text = "paused";
      } else if (params.action === "resume") {
        mem.paused = false;
        mem.pump();
        text = "resumed";
      } else if (params.action === "rebuild-tree") text = mem.rebuildTree();
      else if (params.action === "export") text = mem.exportSnapshot(params.path || join(mem.cfg.memoryDir, `export-${Date.now()}.json`));
      else if (params.action === "import-notes") text = await importNotes(params.path);
      else if (params.action === "html") text = writeHtml(mem, params.path || join(mem.cfg.memoryDir, "memory.html"));
      else if (params.action === "global-export") text = needGlobal().exportSnapshot(params.path || join(needGlobal().cfg.memoryDir, `export-${Date.now()}.json`));
      else if (params.action === "global-import-notes") text = await needGlobal().importNotes(params.path);
      else if (params.action === "global-html") text = writeHtml(needGlobal(), params.path || join(needGlobal().cfg.memoryDir, "memory.html"));
      else text = `unknown action: ${params.action}`;
      return { content: [{ type: "text", text }], details: undefined };
    },
  } as any);

  pi.registerCommand("memory", {
    description: "OptChat memory: status | verify | zoom <id> <n> | date <id> | pause | resume | rebuild-tree | export [path] | import-notes <path> | html [path]",
    handler: async (args: string, ctx: ExtensionContext) => {
      const [cmd, a, b] = String(args ?? "").trim().split(/\s+/);
      try {
        if (!cmd || cmd === "status") ctx.ui.notify(mem.status(), "info");
        else if (cmd === "verify") ctx.ui.notify(mem.verify(), "info");
        else if (cmd === "zoom") ctx.ui.notify(mem.zoom(Number(a), Number(b)), "info");
        else if (cmd === "date") ctx.ui.notify(mem.date(Number(a)), "info");
        else if (cmd === "pause") {
          mem.paused = true;
          ctx.ui.notify("optchat-memory paused", "info");
        } else if (cmd === "resume") {
          mem.paused = false;
          mem.pump();
          ctx.ui.notify("optchat-memory resumed", "info");
        } else if (cmd === "rebuild-tree") ctx.ui.notify(mem.rebuildTree(), "info");
        else if (cmd === "export") ctx.ui.notify(mem.exportSnapshot(a || join(mem.cfg.memoryDir, `export-${Date.now()}.json`)), "info");
        else if (cmd === "import-notes") ctx.ui.notify(await importNotes(a), "info");
        else if (cmd === "html") ctx.ui.notify(writeHtml(mem, a || join(mem.cfg.memoryDir, "memory.html")), "info");
        else ctx.ui.notify("Usage: /memory status | verify | zoom <id> <n> | date <id> | pause | resume | rebuild-tree | export [path] | import-notes <path> | html [path]", "warning");
      } catch (err) {
        ctx.ui.notify(`optchat-memory error: ${err instanceof Error ? err.message : String(err)}`, "error");
      }
    },
  });
}
