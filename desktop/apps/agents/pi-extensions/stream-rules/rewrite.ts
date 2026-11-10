import type { Fire } from "./match.ts";
import type { Rule } from "./rules.ts";

export type AssistantLike = {
  role: "assistant";
  content: { type: string; text?: string }[];
  stopReason: string;
  errorMessage?: string;
  [key: string]: unknown;
};

export const QUOTE_CHARS = 400;

// Keep only text the rule did not reject: text blocks before the firing block
// and, for a text fire, its lines before the one that matched. Thinking and
// tool calls go. Signatures go too, since they name a provider item this
// message no longer equals.
export function keptText(message: AssistantLike, fire: Fire): string[] {
  const kept: string[] = [];
  message.content.forEach((block, i) => {
    if (block.type !== "text" || typeof block.text !== "string") return;
    if (i < fire.contentIndex) kept.push(block.text);
    else if (i === fire.contentIndex && fire.kind === "text") {
      kept.push(block.text.slice(0, block.text.lastIndexOf("\n", fire.matchIndex - 1) + 1));
    }
  });
  return kept.filter((t) => t.trim() !== "");
}

// A non-empty prefix becomes a finished reply so later requests replay it;
// with nothing left the message stays aborted, which requests skip.
export function truncate(message: AssistantLike, kept: string[]): AssistantLike {
  if (kept.length === 0) return { ...message, content: [], stopReason: "aborted" };
  const { errorMessage: _dropped, ...rest } = message;
  return { ...rest, content: kept.map((text) => ({ type: "text", text })), stopReason: "stop" };
}

export const REQUEST_CHARS = 2000;

// The resumed turn is a new run, and OptMem shows a new run only the memory
// view and its input, so the request travels with the reminder.
const withRequest = (text: string, request: string) =>
  request.trim() === ""
    ? text
    : `${text}\n\nThe user's request you are working on, of which this was one step:\n<request>\n${request.length > REQUEST_CHARS ? `${request.slice(0, REQUEST_CHARS)}…` : request}\n</request>\nFinish every part of it that is not done yet.`;

export function reminderText(fire: Fire, kept: string[], request = ""): string {
  const head = `Stream rule "${fire.rule.id}" stopped your last response. ${fire.rule.reminder}`;
  if (fire.kind === "tool") {
    const target = fire.path ? ` for ${fire.path}` : "";
    return withRequest(`${head}\n\nYour ${fire.tool} call${target} was discarded before it ran. Make the call again, following the rule.`, request);
  }
  const prefix = kept.join("\n\n");
  if (prefix === "") return withRequest(`${head}\n\nNothing of that response was kept. Write it again, following the rule.`, request);
  const tail = prefix.length > QUOTE_CHARS ? `…${prefix.slice(-QUOTE_CHARS)}` : prefix;
  return withRequest(`${head}\n\nYour response was cut where the rule matched. It ended with:\n<kept>\n${tail}\n</kept>\nContinue from exactly that point, following the rule. Do not repeat the kept text.`, request);
}

export function sectionText(rules: readonly Rule[]): string | undefined {
  if (rules.length === 0) return undefined;
  const lines = rules.map((r) => `- ${r.id}: ${r.reminder}`);
  return `These rules stopped earlier responses in this session. Keep following them:\n${lines.join("\n")}`;
}
