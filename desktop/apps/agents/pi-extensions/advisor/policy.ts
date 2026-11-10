import type { Level } from "./verdict.ts";

export const READ_ONLY_TOOLS = new Set([
  "read", "grep", "find", "ls",
  "zoom", "date", "memory_find", "memory_status",
  "global_zoom", "global_date", "global_find",
]);

export type TurnFacts = {
  enabled: boolean;
  outcome: string;
  aborted: boolean;
  toolNames: string[];
  finalText: string;
};

export function skipReason(t: TurnFacts): string | undefined {
  if (!t.enabled) return "off";
  if (t.outcome !== "completed") return t.outcome;
  if (t.aborted) return "aborted";
  if (t.toolNames.length === 0) return t.finalText ? undefined : "empty";
  return t.toolNames.every((n) => READ_ONLY_TOOLS.has(n)) ? "read-only" : undefined;
}

// A blocker on a final answer would otherwise go unheard until the user's next
// prompt, so it earns one extra model call per run.
export const shouldContinue = (level: Level, finalAnswer: boolean, continuedThisRun: boolean) =>
  level === "blocker" && finalAnswer && !continuedThisRun;

const words = (text: string) => new Set(text.toLowerCase().replace(/^\[advisor \w+\]\s*/, "").match(/[a-z0-9_.]+/g) ?? []);

// The prompt asks for no repeats, but cheap models repeat anyway; a note that
// mostly shares its words with an earlier one this run is dropped.
export function isRepeat(note: string, earlier: string[]): boolean {
  const a = words(note);
  return earlier.some((e) => {
    const b = words(e);
    const shared = [...a].filter((w) => b.has(w)).length;
    return shared / Math.max(1, new Set([...a, ...b]).size) >= 0.5;
  });
}

export type AdvisorState = { enabled: boolean; model: string };

export type Usage = { input: number; output: number; cacheRead: number; cacheWrite: number; totalTokens: number; cost: { total: number } };
export type CallRecord = { model: string; ms: number; level: Level; usage?: Usage; error?: string };

export const STATE_ENTRY = "advisor-state";
export const CALL_ENTRY = "advisor-call";

type Entry = { type: string; customType?: string; data?: unknown };

const custom = <T>(branch: Entry[], customType: string): T[] =>
  branch.filter((e) => e.type === "custom" && e.customType === customType).map((e) => e.data as T);

export const latestState = (branch: Entry[]): AdvisorState | undefined => custom<AdvisorState>(branch, STATE_ENTRY).at(-1);

export function tally(branch: Entry[]) {
  const records = custom<CallRecord>(branch, CALL_ENTRY);
  return {
    calls: records.length,
    nonNone: records.filter((r) => r.level !== "none").length,
    failures: records.filter((r) => r.error).length,
    tokens: records.reduce((n, r) => n + (r.usage?.totalTokens ?? 0), 0),
    cost: records.reduce((n, r) => n + (r.usage?.cost.total ?? 0), 0),
  };
}

export type Command =
  | { kind: "toggle" }
  | { kind: "on" }
  | { kind: "off" }
  | { kind: "status" }
  | { kind: "model"; model: string }
  | { kind: "usage" };

export function parseCommand(args: string): Command {
  const [verb = "", ...rest] = args.trim().split(/\s+/).filter(Boolean);
  if (verb === "") return { kind: "toggle" };
  if (verb === "on" || verb === "off" || verb === "status") return { kind: verb };
  if (verb === "model" && rest.length === 1 && rest[0].indexOf("/") > 0) return { kind: "model", model: rest[0] };
  return { kind: "usage" };
}
