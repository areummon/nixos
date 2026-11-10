import path from "node:path";

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { withFileMutationQueue } from "@earendil-works/pi-coding-agent";

import type { Workspace } from "../gondolin/workspace.ts";
import {
  applyEdits,
  parseEdits,
  renderChanged,
  stripAnchorPrefixes,
  tagReadOutput,
} from "./hashline.ts";

const WORKSPACE_EVENT = "gondolin:workspace";
const RESULT_CONTEXT = 2;

type TextContent = { type: "text"; text: string };
type EditPair = { oldText: string; newText: string };

const isPair = (e: unknown): e is EditPair =>
  typeof (e as EditPair)?.oldText === "string" && typeof (e as EditPair)?.newText === "string";

function stripPair(e: EditPair): void {
  const stripped = stripAnchorPrefixes(e.oldText, e.newText);
  if (stripped) Object.assign(e, stripped);
}

export default function (pi: ExtensionAPI) {
  let workspace: Workspace | undefined;
  pi.events.on(WORKSPACE_EVENT, (ws) => {
    workspace = ws as Workspace;
  });

  pi.on("tool_result", async (event) => {
    if (event.toolName !== "read" || event.parentToolCallId || event.isError) return;
    const details = event.details as { truncation?: { firstLineExceedsLimit?: boolean } } | undefined;
    if (details?.truncation?.firstLineExceedsLimit) return;
    if (event.content.length !== 1 || event.content[0].type !== "text") return;
    const offset = Number((event.input as { offset?: unknown }).offset) || 0;
    const text = tagReadOutput((event.content[0] as TextContent).text, Math.max(1, offset));
    return { content: [{ type: "text", text }] };
  });

  pi.on("tool_call", async (event) => {
    if (event.toolName !== "edit") return;
    const input = event.input as { edits?: unknown; oldText?: unknown; newText?: unknown };
    if (Array.isArray(input.edits)) for (const e of input.edits) if (isPair(e)) stripPair(e);
    if (isPair(input)) stripPair(input);
  });

  pi.registerTool({
    name: "hashedit",
    label: "hashedit",
    description: [
      "Edit a file by the N#hhh line anchors that read prints before each line (N = line number, hhh = content hash).",
      "Each edit names op and start; replace and delete may name an end anchor for an inclusive range.",
      "insert_before and insert_after take only start. text is the new lines without anchors; a trailing newline is ignored.",
      "All anchors refer to the file as last read. If any anchor is stale nothing is written, and the result shows the current anchored lines around it.",
      "On success the result shows fresh anchors around each change, so further hashedit calls can use them directly.",
    ].join(" "),
    promptSnippet: "Edit a file by the N#hhh line anchors from read output; rejects stale anchors",
    promptGuidelines: [
      "The N#hhh| prefix on each line of read output is a line anchor added by the harness, not file content: never write it into a file or into edit or hashedit text.",
      "Use hashedit for multi-line, repeated, or whitespace-sensitive changes by copying anchors from the latest read or hashedit result; use edit for a small unique replacement.",
      "When hashedit reports a stale anchor, retry hashedit with the fresh anchors it returned instead of reading the file again.",
    ],
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "Path of the file to edit" },
        edits: {
          type: "array",
          minItems: 1,
          items: {
            type: "object",
            properties: {
              op: { type: "string", enum: ["replace", "insert_before", "insert_after", "delete"] },
              start: { type: "string", description: "Anchor of the first line, like 12#a3f" },
              end: { type: "string", description: "Anchor of the last line for replace or delete; defaults to start" },
              text: { type: "string", description: "New lines for replace and inserts, without anchors" },
            },
            required: ["op", "start"],
          },
        },
      },
      required: ["path", "edits"],
    } as any,
    async execute(_toolCallId: string, params: { path: string; edits: unknown }) {
      const ws = workspace;
      if (!ws) throw new Error("hashedit needs the gondolin workspace");
      const parsed = parseEdits(params.edits);
      if (!parsed.ok) throw new Error(`hashedit: ${parsed.error}`);
      const target = path.resolve(ws.hostRoot, params.path.replace(/^@/, ""));

      return withFileMutationQueue(target, async () => {
        const result = applyEdits((await ws.readFile(target)).toString("utf-8"), parsed.edits);
        if (!result.ok) {
          const stale = result.stale.map((s) => `${s.anchor} is stale. Current lines:\n${s.fresh.join("\n")}`);
          const reason = result.error ?? `${result.stale.length} stale anchor(s)`;
          throw new Error(`hashedit rejected, nothing written to ${params.path}: ${reason}\n\n${stale.join("\n\n")}`.trimEnd());
        }
        await ws.writeFile(target, result.content);
        const n = parsed.edits.length;
        const text = `Applied ${n} edit(s) to ${params.path}\n\n${renderChanged(result.content, result.changed, RESULT_CONTEXT)}`;
        return { content: [{ type: "text", text }], details: undefined };
      });
    },
  });
}
