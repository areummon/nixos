import test from "node:test";
import assert from "node:assert/strict";
import { findFire } from "./match.ts";
import { parseConfig } from "./rules.ts";

const rules = (list) => parseConfig({ rules: list }).config.rules;
const text = (t) => ({ type: "text", text: t });
const call = (name, args) => ({ type: "toolCall", name, arguments: args });

test("a text rule fires at the match offset in the streamed block", () => {
  const r = rules([{ id: "seven", pattern: "\\bseven\\b", flags: "i", reminder: "Write 7." }]);
  assert.equal(findFire(r, { type: "text_delta", contentIndex: 1 }, text("six\nsev")), undefined);
  const fire = findFire(r, { type: "text_delta", contentIndex: 1 }, text("six\nSeven"));
  assert.deepEqual({ kind: fire.kind, contentIndex: fire.contentIndex, matchIndex: fire.matchIndex }, { kind: "text", contentIndex: 1, matchIndex: 4 });
});

test("thinking deltas never fire, even when their block has text", () => {
  const r = rules([{ id: "a", pattern: "a", reminder: "x" }]);
  assert.equal(findFire(r, { type: "thinking_delta", contentIndex: 0 }, { type: "thinking", thinking: "a" }), undefined);
});

test("a tool-only rule ignores text and a text-only rule ignores tool args", () => {
  const toolOnly = rules([{ id: "t", pattern: "var ", reminder: "x", scope: { in: ["tool"] } }]);
  const textOnly = rules([{ id: "x", pattern: "var ", reminder: "x", scope: { in: ["text"] } }]);
  assert.equal(findFire(toolOnly, { type: "text_delta", contentIndex: 0 }, text("var a")), undefined);
  assert.equal(findFire(textOnly, { type: "toolcall_delta", contentIndex: 0 }, call("write", { path: "a.js", content: "var a" })), undefined);
});

test("tool args are matched in every nested string leaf", () => {
  const r = rules([{ id: "var", pattern: "\\bvar\\s", reminder: "x" }]);
  const fire = findFire(r, { type: "toolcall_delta", contentIndex: 2 }, call("edit", { path: "a.js", edits: [{ oldText: "let a", newText: "var a" }] }));
  assert.deepEqual({ kind: fire.kind, tool: fire.tool, path: fire.path, contentIndex: fire.contentIndex }, { kind: "tool", tool: "edit", path: "a.js", contentIndex: 2 });
});

test("a tools scope limits which calls a rule sees", () => {
  const r = rules([{ id: "var", pattern: "\\bvar\\s", reminder: "x", scope: { tools: ["write"] } }]);
  assert.equal(findFire(r, { type: "toolcall_delta", contentIndex: 0 }, call("bash", { command: "var x" })), undefined);
  assert.ok(findFire(r, { type: "toolcall_delta", contentIndex: 0 }, call("write", { path: "a", content: "var x" })));
});

test("a path scope waits until the path has finished streaming", () => {
  const r = rules([{ id: "var", pattern: "\\bvar\\s", reminder: "x", scope: { paths: ["*.js"] } }]);
  const u = { type: "toolcall_delta", contentIndex: 0 };
  assert.equal(findFire(r, u, call("write", { content: "var x = 1" })), undefined, "no path yet");
  assert.equal(findFire(r, u, call("write", { content: "var x = 1", path: "a.j" })), undefined, "path is the last key, still streaming");
  assert.ok(findFire(r, { type: "toolcall_end", contentIndex: 0 }, call("write", { content: "var x = 1", path: "a.js" })), "call ended");
  assert.ok(findFire(r, u, call("write", { path: "src/a.js", content: "var x" })), "a later key settles the path");
  assert.equal(findFire(r, u, call("write", { path: "a.ts", content: "var x" })), undefined, "path out of scope");
});

test("the first matching rule in config order wins", () => {
  const r = rules([
    { id: "first", pattern: "b", reminder: "x" },
    { id: "second", pattern: "a", reminder: "x" },
  ]);
  assert.equal(findFire(r, { type: "text_delta", contentIndex: 0 }, text("a b")).rule.id, "first");
});
