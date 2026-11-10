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

export function reminderText(fire: Fire, kept: string[]): string {
  const head = `Stream rule "${fire.rule.id}" stopped your last response. ${fire.rule.reminder}`;
  if (fire.kind === "tool") {
    const target = fire.path ? ` for ${fire.path}` : "";
    return `${head}\n\nYour ${fire.tool} call${target} was discarded before it ran. Make the call again, following the rule.`;
  }
  const prefix = kept.join("\n\n");
  if (prefix === "") return `${head}\n\nNothing of that response was kept. Write it again, following the rule.`;
  const tail = prefix.length > QUOTE_CHARS ? `…${prefix.slice(-QUOTE_CHARS)}` : prefix;
  return `${head}\n\nYour response was cut where the rule matched. It ended with:\n<kept>\n${tail}\n</kept>\nContinue from exactly that point, following the rule. Do not repeat the kept text.`;
}

export function sectionText(rules: readonly Rule[]): string | undefined {
  if (rules.length === 0) return undefined;
  const lines = rules.map((r) => `- ${r.id}: ${r.reminder}`);
  return `These rules stopped earlier responses in this session. Keep following them:\n${lines.join("\n")}`;
}
