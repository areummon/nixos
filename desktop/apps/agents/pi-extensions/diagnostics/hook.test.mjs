import test from "node:test";
import assert from "node:assert/strict";

process.env.PI_DIAGNOSTICS_CONFIG = "/nonexistent/diagnostics.json";
const { default: extension } = await import("./index.ts");

function load({ workspace = true, exec } = {}) {
  const handlers = {};
  const listeners = {};
  extension({ on: (name, fn) => (handlers[name] = fn), events: { on: (name, fn) => (listeners[name] = fn) } });
  const calls = [];
  if (workspace) {
    listeners["gondolin:workspace"]({
      hostRoot: "/home/u/proj",
      guestRoot: "/workspace",
      toGuestPath: (p) => `/workspace/${p}`,
      readFile: async () => { throw new Error("ENOENT"); },
      exec: async (argv, options) => (calls.push({ argv, options }), exec(argv, options)),
    });
  }
  return { fire: (event, ctx = {}) => handlers.tool_result(event, ctx), calls };
}

const result = (over = {}) => ({
  toolName: "write",
  toolCallId: "t1",
  input: { path: "bad.py", content: "def f(:\n" },
  content: [{ type: "text", text: "Wrote bad.py" }],
  structuredContent: { bytes: 8 },
  isError: false,
  ...over,
});
const failing = async () => ({ exitCode: 1, stdout: "", stderr: "SyntaxError: invalid syntax\n", timedOut: false });

test("a failed check is appended to the write's result, which stays a success", async () => {
  const { fire, calls } = load({ exec: failing });
  const signal = new AbortController().signal;
  const patch = await fire(result(), { signal });
  assert.deepEqual(patch, {
    content: [
      { type: "text", text: "Wrote bad.py" },
      { type: "text", text: "Diagnostics (python-ast) for bad.py:\nSyntaxError: invalid syntax" },
    ],
    structuredContent: { bytes: 8 },
  });
  assert.equal(calls[0].argv[0], "python3");
  assert.equal(calls[0].argv.at(-1), "/workspace/bad.py");
  assert.equal(calls[0].options.timeoutMs, 15000);
  assert.equal(calls[0].options.signal, signal);
});

test("edit and hashedit are checked too, other tools are not", async () => {
  const { fire, calls } = load({ exec: failing });
  assert.ok(await fire(result({ toolName: "edit" })));
  assert.ok(await fire(result({ toolName: "hashedit" })));
  assert.equal(await fire(result({ toolName: "read" })), undefined);
  assert.equal(calls.length, 2);
});

test("a clean check leaves the result alone", async () => {
  const { fire } = load({ exec: async () => ({ exitCode: 0, stdout: "", stderr: "", timedOut: false }) });
  assert.equal(await fire(result()), undefined);
});

test("a timeout appends one line", async () => {
  const { fire } = load({ exec: async () => ({ exitCode: null, stdout: "", stderr: "", timedOut: true }) });
  const patch = await fire(result());
  assert.equal(patch.content.at(-1).text, "Diagnostics (python-ast) for bad.py: timed out after 15000ms.");
});

test("failed writes, nested calls, unknown file types and outside paths run nothing", async () => {
  const { fire, calls } = load({ exec: failing });
  assert.equal(await fire(result({ isError: true })), undefined);
  assert.equal(await fire(result({ parentToolCallId: "p1" })), undefined);
  assert.equal(await fire(result({ input: { path: "flake.nix" } })), undefined);
  assert.equal(await fire(result({ input: { path: "/etc/x.py" } })), undefined);
  assert.equal(calls.length, 0);
});

test("without a gondolin workspace nothing runs", async () => {
  const { fire } = load({ workspace: false, exec: failing });
  assert.equal(await fire(result()), undefined);
});

test("an abort mid-check drops the diagnostic instead of failing the hook", async () => {
  const ac = new AbortController();
  const { fire } = load({ exec: async () => { ac.abort(); throw new Error("aborted"); } });
  assert.equal(await fire(result(), { signal: ac.signal }), undefined);
});
