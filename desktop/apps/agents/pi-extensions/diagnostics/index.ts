import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { Workspace } from "../gondolin/workspace.ts";
import { CHECKER_IDS, selectRun } from "./checkers.ts";
import { loadConfig } from "./config.ts";
import { report, workspaceRelPath } from "./report.ts";

const WRITE_TOOLS = new Set(["write", "edit", "hashedit"]);

export default function (pi: ExtensionAPI) {
  const config = loadConfig(CHECKER_IDS);
  let ws: Workspace | undefined;
  pi.events.on("gondolin:workspace", (w) => {
    ws = w as Workspace;
  });

  pi.on("tool_result", async (event, ctx) => {
    if (!ws || event.isError || event.parentToolCallId || !WRITE_TOOLS.has(event.toolName)) return;
    const path = (event.input as { path?: unknown }).path;
    if (typeof path !== "string") return;
    const relPath = workspaceRelPath(path, ws.hostRoot, ws.guestRoot);
    if (relPath === undefined) return;

    const workspace = ws;
    const exists = (rel: string) => workspace.readFile(rel).then(() => true, () => false);
    const selected = await selectRun({ relPath, guest: workspace.toGuestPath, exists }, config.disabled);
    if (!selected) return;

    const { id, run } = selected;
    let r;
    try {
      r = await workspace.exec(run.argv, { cwd: run.cwd, timeoutMs: config.timeoutMs, signal: ctx.signal });
    } catch (err) {
      if (ctx.signal?.aborted) return;
      throw err;
    }
    const raw = [r.stdout, r.stderr].filter(Boolean).join("\n");
    const output = run.filter ? run.filter(raw) : raw;
    const text = report(id, path, { exitCode: r.exitCode, output, timedOut: r.timedOut }, config.maxChars, config.timeoutMs);
    if (!text) return;
    return {
      content: [...event.content, { type: "text" as const, text }],
      structuredContent: event.structuredContent,
    };
  });
}
