export type DigestCall = { name: string; args: string; result: string; isError: boolean };
export type Digest = { request: string; assistantText: string; calls: DigestCall[]; diff: string };

// Structural slices of Pi's messages, so this module imports nothing from Pi.
type Block = { type: string; text?: string; id?: string; name?: string; arguments?: Record<string, unknown> };
export type ToolCall = { id: string; name: string; arguments: Record<string, unknown> };
export type TurnInput = {
  contextMessages: Array<{ role: string; content?: unknown }>;
  message: { content: unknown };
  toolResults: Array<{ toolCallId: string; content: unknown; isError: boolean }>;
};

// Shares sum below 1 to leave room for the tags renderDigest adds.
const SHARE = { request: 0.15, assistantText: 0.15, calls: 0.3, diff: 0.35 };
const ARG_STRING_CHARS = 160;

const blocks = (content: unknown): Block[] =>
  typeof content === "string" ? [{ type: "text", text: content }] : Array.isArray(content) ? content : [];

export const textOf = (content: unknown): string =>
  blocks(content)
    .filter((b) => b.type === "text")
    .map((b) => b.text ?? "")
    .join("\n")
    .trim();

export const toolCallsOf = (content: unknown): ToolCall[] =>
  blocks(content)
    .filter((b) => b.type === "toolCall")
    .map((b) => ({ id: b.id ?? "", name: b.name ?? "", arguments: b.arguments ?? {} }));

// Keeps the tail too: errors and test summaries usually end the output.
export function clip(text: string, max: number, keepTail = true): string {
  if (text.length <= max) return text;
  const marker = `…[${text.length - max} cut]…`;
  const room = Math.max(0, max - marker.length);
  const head = keepTail ? Math.ceil(room * 2 / 3) : room;
  return text.slice(0, head) + marker + (keepTail ? text.slice(text.length - (room - head)) : "");
}

const str = (v: unknown) => (typeof v === "string" ? v : v === undefined ? "" : JSON.stringify(v));
const lines = (prefix: string, text: string) => text.split("\n").map((l) => prefix + l).join("\n");

type EditPair = { oldText?: unknown; newText?: unknown };

// The calls whose args are a file change. Their bulky fields go to the diff
// section only, so compactArgs keeps just the path for them.
const DIFFS: Record<string, (args: Record<string, unknown>, budget: number) => string> = {
  edit: (a, budget) => {
    const legacy = a.oldText !== undefined ? [{ oldText: a.oldText, newText: a.newText }] : [];
    const edits = [...(Array.isArray(a.edits) ? (a.edits as EditPair[]) : []), ...legacy];
    const body = edits.map((e) => `${lines("-", str(e.oldText))}\n${lines("+", str(e.newText))}`).join("\n");
    return `--- ${str(a.path)} (edit)\n${clip(body, budget)}`;
  },
  write: (a, budget) => `+++ ${str(a.path)} (write)\n${lines("+", clip(str(a.content), budget, false))}`,
  hashedit: (a, budget) => {
    const edits = Array.isArray(a.edits) ? a.edits.map(str).join("\n") : str(a.edits);
    return `@@ ${str(a.path)} (hashedit)\n${clip(edits, budget)}`;
  },
};

function compactArgs(call: ToolCall): string {
  if (DIFFS[call.name]) return JSON.stringify({ path: call.arguments.path });
  return JSON.stringify(call.arguments, (_k, v) => (typeof v === "string" ? clip(v, ARG_STRING_CHARS) : v));
}

export function buildDigest(turn: TurnInput, maxChars: number): Digest {
  const budget = (share: number) => Math.floor(maxChars * share);
  const user = turn.contextMessages.findLast((m) => m.role === "user");
  const calls = toolCallsOf(turn.message.content);
  const results = new Map(turn.toolResults.map((r) => [r.toolCallId, r]));
  const perCall = Math.floor(budget(SHARE.calls) / Math.max(1, calls.length));
  const changed = calls.filter((c) => DIFFS[c.name] && results.get(c.id)?.isError === false);
  const perDiff = Math.floor(budget(SHARE.diff) / Math.max(1, changed.length));
  return {
    request: clip(textOf(user?.content), budget(SHARE.request)),
    assistantText: clip(textOf(turn.message.content), budget(SHARE.assistantText)),
    calls: calls.map((c) => {
      const result = results.get(c.id);
      return {
        name: c.name,
        args: clip(compactArgs(c), Math.floor(perCall * 0.4)),
        result: result ? clip(textOf(result.content), Math.floor(perCall * 0.6)) : "(no result)",
        isError: result?.isError ?? false,
      };
    }),
    diff: changed.map((c) => DIFFS[c.name](c.arguments, perDiff)).join("\n"),
  };
}

export function renderDigest(d: Digest, maxChars: number): string {
  const calls = d.calls.map((c) => `<call name="${c.name}"${c.isError ? " error" : ""}>\nargs: ${c.args}\nresult: ${c.result}\n</call>`);
  const parts = [
    `<request>\n${d.request}\n</request>`,
    d.assistantText && `<assistant>\n${d.assistantText}\n</assistant>`,
    ...calls,
    d.diff && `<diff>\n${d.diff}\n</diff>`,
    calls.length === 0 && "(no tool calls: this is the agent's final answer)",
  ].filter(Boolean);
  return clip(parts.join("\n"), maxChars);
}
