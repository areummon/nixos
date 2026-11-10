import test from "node:test";
import assert from "node:assert/strict";
import { buildDigest, clip, renderDigest } from "./digest.ts";

const user = (text) => ({ role: "user", content: [{ type: "text", text }] });
const call = (id, name, args) => ({ type: "toolCall", id, name, arguments: args });
const result = (toolCallId, text, isError = false) => ({ toolCallId, content: [{ type: "text", text }], isError });

test("request is the latest real user message, not a custom message", () => {
  const d = buildDigest({
    contextMessages: [user("old ask"), { role: "assistant", content: [] }, user("new ask"), { role: "custom", content: "[advisor aside] x" }],
    message: { content: [{ type: "text", text: "done" }] },
    toolResults: [],
  }, 12000);
  assert.equal(d.request, "new ask");
  assert.equal(d.assistantText, "done");
  assert.deepEqual(d.calls, []);
  assert.equal(d.diff, "");
});

test("diff comes from successful edit, write and hashedit args; args keep only the path", () => {
  const d = buildDigest({
    contextMessages: [user("fix it")],
    message: {
      content: [
        call("1", "edit", { path: "a.py", edits: [{ oldText: "x = 1", newText: "x = 2" }] }),
        call("2", "write", { path: "b.py", content: "def f():\n    pass" }),
        call("3", "hashedit", { path: "c.py", edits: ["replace 3#abc: y = 3"] }),
        call("4", "edit", { path: "d.py", oldText: "gone", newText: "here" }),
        call("5", "edit", { path: "e.py", edits: [{ oldText: "nope", newText: "x" }] }),
        call("6", "bash", { command: "pytest" }),
      ],
    },
    toolResults: [result("1", "ok"), result("2", "ok"), result("3", "ok"), result("4", "ok"), result("5", "not found", true), result("6", "1 failed")],
  }, 12000);
  assert.equal(d.diff, [
    "--- a.py (edit)\n-x = 1\n+x = 2",
    "+++ b.py (write)\n+def f():\n+    pass",
    "@@ c.py (hashedit)\nreplace 3#abc: y = 3",
    "--- d.py (edit)\n-gone\n+here",
  ].join("\n"));
  assert.equal(d.calls[0].args, '{"path":"a.py"}');
  assert.equal(d.calls[4].isError, true);
  assert.equal(d.calls[5].args, '{"command":"pytest"}');
  assert.equal(d.calls[5].result, "1 failed");
});

test("a call without a result is marked, not dropped", () => {
  const d = buildDigest({ contextMessages: [user("go")], message: { content: [call("9", "bash", { command: "ls" })] }, toolResults: [] }, 12000);
  assert.equal(d.calls[0].result, "(no result)");
});

test("huge fields stay inside their budgets and the render is hard-capped", () => {
  const big = "x".repeat(200000);
  const max = 12000;
  const d = buildDigest({
    contextMessages: [user(big)],
    message: { content: [{ type: "text", text: big }, call("1", "write", { path: "big.txt", content: big }), call("2", "bash", { command: big })] },
    toolResults: [result("1", big), result("2", big, true)],
  }, max);
  assert.ok(d.request.length <= max * 0.15);
  assert.ok(d.assistantText.length <= max * 0.15);
  for (const c of d.calls) assert.ok(c.args.length + c.result.length <= max * 0.25 / 2);
  assert.ok(d.diff.length <= max * 0.35 + 200, `diff ${d.diff.length}`);
  const text = renderDigest(d, max);
  assert.ok(text.length <= max, `render ${text.length}`);
  assert.match(text, /<call name="bash" error>/);
});

test("clip keeps head and tail by default, head only on request", () => {
  const s = "HEAD" + "-".repeat(1000) + "TAIL";
  assert.equal(clip("short", 10), "short");
  const both = clip(s, 100);
  assert.ok(both.length <= 100 && both.startsWith("HEAD") && both.endsWith("TAIL"), both);
  const head = clip(s, 100, false);
  assert.ok(head.length <= 100 && head.startsWith("HEAD") && !head.endsWith("TAIL"), head);
});

test("a final answer is labelled as such in the render", () => {
  const d = buildDigest({ contextMessages: [user("q")], message: { content: [{ type: "text", text: "a" }] }, toolResults: [] }, 12000);
  assert.match(renderDigest(d, 12000), /final answer/);
});

test("earlier advisor notes come from this run only", () => {
  const note = (text) => ({ role: "custom", customType: "advisor", content: text });
  const d = buildDigest({
    contextMessages: [user("first"), note("[advisor aside] stale"), user("second"), note("[advisor concern] keep the body"), { role: "custom", customType: "other", content: "x" }],
    message: { content: [{ type: "text", text: "ok" }] },
    toolResults: [],
  }, 12000);
  assert.deepEqual(d.earlierNotes, ["[advisor concern] keep the body"]);
  assert.match(renderDigest(d, 12000), /<your-earlier-notes>\n\[advisor concern\] keep the body\n<\/your-earlier-notes>/);
});

test("a final answer sees the calls made earlier in the run, failures flagged", () => {
  const d = buildDigest({
    contextMessages: [
      user("old ask"),
      { role: "assistant", content: [call("0", "bash", { command: "ls" })] },
      user("create n.py"),
      { role: "assistant", content: [call("1", "write", { path: "n.py", content: "print('hi')" }), call("2", "bash", { command: "python3 n.py" })] },
      { role: "toolResult", toolCallId: "1", content: [], isError: false },
      { role: "toolResult", toolCallId: "2", content: [], isError: true },
      { role: "assistant", content: [{ type: "text", text: "done" }] },
    ],
    message: { content: [{ type: "text", text: "done" }] },
    toolResults: [],
  }, 12000);
  assert.deepEqual(d.earlierCalls, ['write {"path":"n.py"}', 'bash {"command":"python3 n.py"} ERROR']);
  assert.match(renderDigest(d, 12000), /<earlier-in-this-run>\nwrite \{"path":"n.py"\}/);
});
