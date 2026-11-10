import test from "node:test";
import assert from "node:assert/strict";
import { latestState, parseCommand, shouldContinue, skipReason, tally } from "./policy.ts";
import { DEFAULTS, parseConfig } from "./config.ts";

const turn = (over) => ({ enabled: true, outcome: "completed", aborted: false, toolNames: [], finalText: "answer", ...over });

test("skip logic", () => {
  assert.equal(skipReason(turn({})), undefined, "final answer is advised");
  assert.equal(skipReason(turn({ toolNames: ["write"] })), undefined);
  assert.equal(skipReason(turn({ toolNames: ["read", "bash"] })), undefined, "one mutating call is enough");
  assert.equal(skipReason(turn({ toolNames: ["read", "grep", "memory_find", "global_find"] })), "read-only");
  assert.equal(skipReason(turn({ toolNames: ["memory_note_global"] })), undefined, "global writes are not read-only");
  assert.equal(skipReason(turn({ enabled: false, toolNames: ["write"] })), "off");
  assert.equal(skipReason(turn({ outcome: "aborted" })), "aborted");
  assert.equal(skipReason(turn({ outcome: "error" })), "error");
  assert.equal(skipReason(turn({ aborted: true })), "aborted");
  assert.equal(skipReason(turn({ finalText: "" })), "empty");
});

test("only a blocker on a final answer continues, once per run", () => {
  assert.equal(shouldContinue("blocker", true, false), true);
  assert.equal(shouldContinue("blocker", true, true), false);
  assert.equal(shouldContinue("blocker", false, false), false, "tool results already cause the next call");
  assert.equal(shouldContinue("concern", true, false), false);
});

test("state and tally come from the session branch", () => {
  const usage = (total, cost) => ({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: total, cost: { total: cost } });
  const branch = [
    { type: "custom", customType: "advisor-state", data: { enabled: false, model: "a/b" } },
    { type: "message" },
    { type: "custom", customType: "advisor-call", data: { level: "none", usage: usage(100, 0.001) } },
    { type: "custom", customType: "advisor-call", data: { level: "concern", usage: usage(200, 0.002) } },
    { type: "custom", customType: "advisor-call", data: { level: "none", error: "timeout" } },
    { type: "custom", customType: "advisor-state", data: { enabled: true, model: "c/d" } },
  ];
  assert.deepEqual(latestState(branch), { enabled: true, model: "c/d" });
  assert.equal(latestState([]), undefined);
  const t = tally(branch);
  assert.deepEqual({ ...t, cost: Number(t.cost.toFixed(6)) }, { calls: 3, nonNone: 1, failures: 1, tokens: 300, cost: 0.003 });
});

test("command parsing", () => {
  assert.deepEqual(parseCommand(""), { kind: "toggle" });
  assert.deepEqual(parseCommand("  on "), { kind: "on" });
  assert.deepEqual(parseCommand("status"), { kind: "status" });
  assert.deepEqual(parseCommand("model openai-codex/gpt-6-luna"), { kind: "model", model: "openai-codex/gpt-6-luna" });
  assert.deepEqual(parseCommand("model nope"), { kind: "usage" });
  assert.deepEqual(parseCommand("loud"), { kind: "usage" });
});

test("config: missing is defaults, bad fields are named and defaulted", () => {
  assert.deepEqual(parseConfig(undefined), { config: DEFAULTS, problems: [] });
  assert.deepEqual(parseConfig({ model: "openai-codex/gpt-6-luna", thinking: "low", timeoutMs: 5000 }).config, {
    ...DEFAULTS, model: "openai-codex/gpt-6-luna", thinking: "low", timeoutMs: 5000,
  });
  const bad = parseConfig({ enabled: "yes", model: "noslash", maxDigestChars: -1, thinking: "huge" });
  assert.deepEqual(bad.config, { ...DEFAULTS, thinking: undefined });
  assert.deepEqual(bad.problems, ["enabled", "model", "maxDigestChars", "thinking"]);
  assert.deepEqual(parseConfig([1]).problems, ["not an object"]);
});
