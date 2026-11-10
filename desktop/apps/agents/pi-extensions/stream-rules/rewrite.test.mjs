import test from "node:test";
import assert from "node:assert/strict";
import { QUOTE_CHARS, keptText, reminderText, sectionText, truncate } from "./rewrite.ts";
import { parseConfig } from "./rules.ts";

const [rule] = parseConfig({ rules: [{ id: "seven", pattern: "seven", reminder: "Write 7, not seven." }] }).config.rules;
const msg = (content, extra = {}) => ({ role: "assistant", content, stopReason: "aborted", errorMessage: "Request was aborted", usage: { input: 1 }, ...extra });

test("a text fire keeps earlier text blocks and the lines before the matching one", () => {
  const m = msg([
    { type: "thinking", thinking: "hmm", thinkingSignature: "{}" },
    { type: "text", text: "Intro.", textSignature: "sig" },
    { type: "text", text: "five\nsix\nand seven\neight" },
  ]);
  const kept = keptText(m, { rule, kind: "text", contentIndex: 2, matchIndex: 13 });
  assert.deepEqual(kept, ["Intro.", "five\nsix\n"]);
  const out = truncate(m, kept);
  assert.equal(out.stopReason, "stop");
  assert.equal("errorMessage" in out, false);
  assert.deepEqual(out.content, [{ type: "text", text: "Intro." }, { type: "text", text: "five\nsix\n" }]);
  assert.deepEqual(out.usage, { input: 1 });
});

test("a match on the first line keeps nothing of that block", () => {
  const kept = keptText(msg([{ type: "text", text: "seven" }]), { rule, kind: "text", contentIndex: 0, matchIndex: 0 });
  assert.deepEqual(kept, []);
});

test("a tool fire drops the call and every block from it on", () => {
  const m = msg([
    { type: "text", text: "Writing it." },
    { type: "toolCall", id: "c1", name: "write", arguments: { path: "a.js", content: "var a" } },
    { type: "text", text: "after" },
  ], { stopReason: "toolUse" });
  const kept = keptText(m, { rule, kind: "tool", contentIndex: 1, tool: "write", path: "a.js" });
  assert.deepEqual(truncate(m, kept).content, [{ type: "text", text: "Writing it." }]);
});

test("nothing kept stays aborted with empty content, so requests skip it", () => {
  const m = msg([{ type: "toolCall", id: "c1", name: "write", arguments: {} }], { stopReason: "toolUse" });
  const out = truncate(m, keptText(m, { rule, kind: "tool", contentIndex: 0, tool: "write" }));
  assert.equal(out.stopReason, "aborted");
  assert.deepEqual(out.content, []);
});

test("the text reminder quotes the tail of the kept prefix", () => {
  const long = "x".repeat(QUOTE_CHARS + 50) + "END";
  const r = reminderText({ rule, kind: "text", contentIndex: 0, matchIndex: 0 }, [long]);
  assert.match(r, /Write 7, not seven\./);
  assert.match(r, /<kept>\n….*END\n<\/kept>/s);
  assert.ok(!r.includes("x".repeat(QUOTE_CHARS + 1)));
});

test("the tool reminder says the call was discarded before it ran", () => {
  const r = reminderText({ rule, kind: "tool", contentIndex: 0, tool: "write", path: "a.js" }, []);
  assert.match(r, /write call for a\.js was discarded before it ran/);
});

test("the section lists fired rules and is absent until one fires", () => {
  assert.equal(sectionText([]), undefined);
  assert.match(sectionText([rule]), /- seven: Write 7, not seven\./);
});
