import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { join } from "node:path";
import { config } from "./config.ts";
import { OptChatMemory } from "./memory.ts";
import { MASTER_PROMPT, MEMORY_GUIDE, SUBAGENT_GUIDE, VIEW_DOC, splitAtMarks } from "./prompt.ts";
import { Subagents } from "./subagents.ts";
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

  // zoom/date read the one live memory; subagents get the same definitions.
  const memoryTools = () => [
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
  const subagents = new Subagents(pi, mem, memoryTools);

  pi.on("session_start", async (_event, ctx) => {
    await mem.start(ctx as ExtensionContext);
    publishSnapshot(mem);
  });
  pi.on("session_shutdown", async () => {
    await subagents.shutdown();
    mem.shutdown();
    removePublishedSnapshot(mem);
  });

  pi.on("message_end", async (event: any) => {
    const m = event.message;
    if (!m) return;
    if (m.role === "user") await mem.log("user", textContent(m.content), "message_end");
    else if (m.role === "assistant") await mem.log("talk", replyText(m.content), "message_end");
    else if (m.role === "custom" && m.customType === "pstack-agent") {
      await mem.log("work", textContent(m.content), "pstack-agent");
    }
  });

  pi.on("tool_call", async (event: any) => {
    if (event.parentToolCallId) return;
    await mem.log("tool", `${event.toolName} ${safeJson(event.input ?? {})}`, "tool_call");
    // Refresh before launch/resume. PiChild inherits this path via spawn's
    // environment; no upstream patch or changes to agent routing needed.
    if (event.toolName === "agent" || event.toolName === "send_message") {
      await mem.settle(undefined, 30_000);
      publishSnapshot(mem);
    }
  });

  pi.on("tool_result", async (event: any) => {
    if (event.parentToolCallId) return;
    const body = textContent(event.content);
    await mem.log("echo", `${event.toolName}${event.isError ? " ERROR" : ""}: ${body}`, "tool_result");
    // Resent on every later step of the turn: cap it as the log does (§7).
    if (body.length <= mem.cfg.capChars) return;
    const images = (event.content ?? []).filter((b: any) => b?.type === "image");
    return { content: [{ type: "text", text: cap(body, mem.cfg.capChars) }, ...images] };
  });

  // One turn = one agent run (§7). Its view is rendered once, before the
  // turn's own message is logged, and reused byte-identical on every step so
  // the cached prefix holds; the turn's steps follow it verbatim.
  type Turn = { view: any[]; first?: any };
  let turn: Turn | undefined;

  const freeze = async (upTo: number, ctx: ExtensionContext): Promise<Turn> => {
    // No call sees an unsummarized line (§6); the timeout is a fail-safe.
    if (!(await mem.settle(ctx.signal, 30_000, upTo))) {
      ctx.ui.notify("optchat-memory: view did not settle before this turn; continuing with placeholders", "warning");
    }
    const pieces = splitAtMarks(mem.renderView(upTo));
    return { view: pieces.map(content => ({ role: "user", content })) };
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
    subagents.reportFrom = undefined;
    turn = await freeze(mem.root.length, ctx);
    const guide = mem.cfg.replaceContext ? MASTER_PROMPT : MEMORY_GUIDE;
    return { systemPrompt: `${event.systemPrompt ?? ""}\n\n${guide}\n\n${SUBAGENT_GUIDE}\n\n${VIEW_DOC}` };
  });

  pi.on("agent_settled", async () => {
    turn = undefined;
  });

  pi.on("context_with_system", async (event: any, ctx: ExtensionContext) => {
    // A run started without prompt() (a subagent report arriving while idle)
    // skips before_agent_start: freeze its view here, before its report.
    if (!turn) {
      turn = await freeze(subagents.reportFrom ?? mem.root.length, ctx);
      subagents.reportFrom = undefined;
    }
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

  for (const tool of memoryTools()) pi.registerTool(tool as any);

  pi.registerTool({
    name: "spawn",
    label: "Spawn Subagents",
    description: "Start one subagent per task, in parallel, in the background; answers their ids at once. Each subagent sees the memory view and its task, and has zoom and date. All reports of one spawn reach you together as one message of \"[id] report\" lines. Never wait or poll for them.",
    parameters: {
      type: "object",
      properties: { tasks: { type: "array", items: { type: "string" }, minItems: 1 } },
      required: ["tasks"],
    } as any,
    async execute(_toolCallId: string, params: any, _signal: any, _onUpdate: any, ctx: ExtensionContext) {
      const tasks = (params.tasks ?? []).map((t: unknown) => String(t ?? "").trim()).filter(Boolean);
      if (!tasks.length) return { content: [{ type: "text", text: "No tasks given." }], details: undefined };
      const ids = await subagents.spawn(tasks, ctx);
      return { content: [{ type: "text", text: ids.map((id, k) => `[${id}] started: ${tasks[k].replace(/\s+/g, " ").slice(0, 120)}`).join("\n") }], details: undefined };
    },
  } as any);

  pi.registerTool({
    name: "tell",
    label: "Tell Subagent",
    description: "Send a message to running subagent id; it arrives between its tool calls.",
    parameters: { type: "object", properties: { id: { type: "string" }, message: { type: "string" } }, required: ["id", "message"] } as any,
    async execute(_toolCallId: string, params: any) {
      return { content: [{ type: "text", text: await subagents.tell(String(params.id), String(params.message)) }], details: undefined };
    },
  } as any);

  pi.registerCommand("work", {
    description: "List running OptChat subagents",
    handler: async (_args: string, ctx: ExtensionContext) => ctx.ui.notify(subagents.list(), "info"),
  });

  pi.registerTool({
    name: "memory_status",
    label: "Memory Status",
    description: "Show OptChat memory status, including message count, view size, and compactor state.",
    parameters: { type: "object", properties: {}, required: [] } as any,
    async execute() {
      return { content: [{ type: "text", text: mem.status() }], details: undefined };
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
    description: "Control OptChat memory: pause, resume, rebuild-tree, export, import-notes, or html (write a browsable page).",
    parameters: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["pause", "resume", "rebuild-tree", "export", "import-notes", "html"] },
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
      else if (params.action === "import-notes") text = await mem.importNotes(params.path);
      else if (params.action === "html") text = writeHtml(mem, params.path || join(mem.cfg.memoryDir, "memory.html"));
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
        else if (cmd === "import-notes") ctx.ui.notify(await mem.importNotes(a), "info");
        else if (cmd === "html") ctx.ui.notify(writeHtml(mem, a || join(mem.cfg.memoryDir, "memory.html")), "info");
        else ctx.ui.notify("Usage: /memory status | verify | zoom <id> <n> | date <id> | pause | resume | rebuild-tree | export [path] | import-notes <path> | html [path]", "warning");
      } catch (err) {
        ctx.ui.notify(`optchat-memory error: ${err instanceof Error ? err.message : String(err)}`, "error");
      }
    },
  });
}
