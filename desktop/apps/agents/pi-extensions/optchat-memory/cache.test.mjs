import test from "node:test";
import assert from "node:assert/strict";
import { markViewBreakpoints } from "./cache.ts";

const mk = () => ({
  system: [{ type: "text", text: "s", cache_control: { type: "ephemeral" } }],
  tools: [{ name: "a" }, { name: "b", cache_control: { type: "ephemeral" } }],
  messages: [
    { role: "user", content: "p1" },
    { role: "user", content: "p2" },
    { role: "user", content: "p3" },
    { role: "user", content: [{ type: "text", text: "task", cache_control: { type: "ephemeral" } }] },
  ],
});

test("marks all view pieces but the last, drops system/tool marks, keeps request end", () => {
  const p = markViewBreakpoints(mk(), ["p1", "p2", "p3"]);
  assert.equal(p.system[0].cache_control, undefined);
  assert.equal(p.tools[1].cache_control, undefined);
  assert.deepEqual(p.messages[0].content[0].cache_control, { type: "ephemeral" });
  assert.deepEqual(p.messages[1].content[0].cache_control, { type: "ephemeral" });
  assert.equal(p.messages[2].content, "p3");
  assert.deepEqual(p.messages[3].content[0].cache_control, { type: "ephemeral" });
});

test("leaves non-matching or single-piece requests unchanged", () => {
  assert.equal(markViewBreakpoints(mk(), ["x", "p2", "p3"]), undefined);
  assert.equal(markViewBreakpoints(mk(), ["p1"]), undefined);
  assert.equal(markViewBreakpoints({ input: [] }, ["a", "b"]), undefined);
});

test("finds pieces inside one multi-block user message (compactor)", () => {
  const p = markViewBreakpoints({ messages: [{ role: "user", content: [
    { type: "text", text: "c1" }, { type: "text", text: "c2" }, { type: "text", text: "step" } ] }] }, ["c1", "c2"]);
  assert.deepEqual(p.messages[0].content[0].cache_control, { type: "ephemeral" });
  assert.equal(p.messages[0].content[1].cache_control, undefined);
});
