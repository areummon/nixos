import test from "node:test";
import assert from "node:assert/strict";
import { markViewBreakpoints } from "./cache.ts";
import { viewBlocks } from "./prompt.ts";

const blocks = (n) => Array.from({ length: n }, (_, k) => `b${k}`);
const mk = (pieces) => ({
  system: [{ type: "text", text: "s0", cache_control: { type: "ephemeral" } }, { type: "text", text: "s1", cache_control: { type: "ephemeral" } }],
  tools: [{ name: "a" }, { name: "b", cache_control: { type: "ephemeral" } }],
  messages: [
    { role: "user", content: pieces.map(text => ({ type: "text", text })) },
    { role: "user", content: [{ type: "text", text: "task", cache_control: { type: "ephemeral" } }] },
  ],
});
const marked = (p) => p.messages[0].content.flatMap((b, k) => (b.cache_control ? [k] : []));
const count = (p) => JSON.stringify(p).split("cache_control").length - 1;

test("marks the last whole block and keeps the last system mark and the request end", () => {
  const p = markViewBreakpoints(mk(blocks(6)), blocks(6));
  assert.deepEqual(marked(p), [4]);
  assert.equal(p.system[0].cache_control, undefined);
  assert.deepEqual(p.system[1].cache_control, { type: "ephemeral" });
  assert.equal(p.tools[1].cache_control, undefined);
  assert.deepEqual(p.messages[1].content[0].cache_control, { type: "ephemeral" });
});

test("a long view gets a second mark 19 blocks back, and at most 4 marks in all", () => {
  const p = markViewBreakpoints(mk(blocks(40)), blocks(40));
  assert.deepEqual(marked(p), [19, 38]);
  assert.equal(count(p), 4);
});

test("leaves non-matching or single-piece requests unchanged", () => {
  assert.equal(markViewBreakpoints(mk(blocks(3)), ["x", "b1", "b2"]), undefined);
  assert.equal(markViewBreakpoints(mk(blocks(1)), ["b0"]), undefined);
  assert.equal(markViewBreakpoints({ input: [] }, ["a", "b"]), undefined);
});

test("finds blocks inside the compactor's one multi-block user message", () => {
  const p = markViewBreakpoints({ messages: [{ role: "user", content: [
    { type: "text", text: "c1" }, { type: "text", text: "c2" }, { type: "text", text: "step" } ] }] }, ["c1", "c2"]);
  assert.deepEqual(p.messages[0].content[0].cache_control, { type: "ephemeral" });
  assert.equal(p.messages[0].content[1].cache_control, undefined);
});

test("view blocks join back to the view, and a grown view keeps every whole block", () => {
  const view = (n) => `<chat>\n${Array.from({ length: n }, (_, k) => `${k}+1|line ${k}`).join("\n")}\n</chat>`;
  const a = viewBlocks(view(10)), b = viewBlocks(view(13));
  assert.equal(a.join(""), view(10));
  assert.ok(a.every(s => s.trim()));
  assert.deepEqual(b.slice(0, a.length - 1), a.slice(0, -1));
  assert.ok(a.slice(0, -1).every(s => s.split("\n").length === 5 && !s.includes("</chat>")));
});
