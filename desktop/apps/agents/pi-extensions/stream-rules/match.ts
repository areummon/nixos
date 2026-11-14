import type { Rule } from "./rules.ts";

export type Fire =
  | { rule: Rule; kind: "text"; contentIndex: number; matchIndex: number }
  | { rule: Rule; kind: "tool"; contentIndex: number; tool: string; path?: string };

// The slice of Pi's message_update a rule can see: the stream event and the
// partial content block it updated.
export type StreamUpdate = { type: string; contentIndex: number };
export type Block =
  | { type: "text"; text: string }
  | { type: "toolCall"; name: string; arguments?: Record<string, unknown> }
  | { type: string };

export function findFire(rules: readonly Rule[], update: StreamUpdate, block: Block | undefined): Fire | undefined {
  if (!block) return undefined;
  const { contentIndex } = update;
  if ((update.type === "text_delta" || update.type === "text_end") && block.type === "text") {
    const text = (block as { text: string }).text;
    for (const rule of rules) {
      if (!rule.in.has("text")) continue;
      const m = rule.regex.exec(text);
      if (m) return { rule, kind: "text", contentIndex, matchIndex: m.index };
    }
    return undefined;
  }
  if ((update.type === "toolcall_delta" || update.type === "toolcall_end") && block.type === "toolCall") {
    const call = block as { name: string; arguments?: Record<string, unknown> };
    const args = call.arguments ?? {};
    const path = settledPath(args, update.type === "toolcall_end");
    const leaves = stringLeaves(args);
    for (const rule of rules) {
      if (!rule.in.has("tool")) continue;
      if (rule.tools && !rule.tools.has(call.name)) continue;
      if (rule.paths) {
        if (path === undefined || !rule.paths.some((p) => p.test(path))) continue;
      }
      if (leaves.some((s) => rule.regex.test(s))) {
        return { rule, kind: "tool", contentIndex, tool: call.name, ...(path !== undefined ? { path } : {}) };
      }
    }
  }
  return undefined;
}

// A streamed path is whole once the call ends or the model has moved on to a
// later key: the partial JSON parser keeps keys in the order they streamed.
function settledPath(args: Record<string, unknown>, ended: boolean): string | undefined {
  if (typeof args.path !== "string") return undefined;
  if (ended) return args.path;
  const keys = Object.keys(args);
  return keys.indexOf("path") < keys.length - 1 ? args.path : undefined;
}

function stringLeaves(value: unknown, out: string[] = []): string[] {
  if (typeof value === "string") out.push(value);
  else if (Array.isArray(value)) for (const v of value) stringLeaves(v, out);
  else if (typeof value === "object" && value !== null) for (const v of Object.values(value)) stringLeaves(v, out);
  return out;
}
