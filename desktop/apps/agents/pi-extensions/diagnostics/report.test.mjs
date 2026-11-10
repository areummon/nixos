import test from "node:test";
import assert from "node:assert/strict";
import { report, workspaceRelPath } from "./report.ts";
import { DEFAULTS, parseConfig } from "./config.ts";

const ok = { exitCode: 0, output: "", timedOut: false };

test("tool paths resolve to workspace-relative paths, or none outside it", () => {
  const rel = (p) => workspaceRelPath(p, "/home/u/proj", "/workspace");
  assert.equal(rel("src/a.py"), "src/a.py");
  assert.equal(rel("./src/../a.py"), "a.py");
  assert.equal(rel("@a.py"), "a.py");
  assert.equal(rel("/home/u/proj/a.py"), "a.py");
  assert.equal(rel("/workspace/src/a.py"), "src/a.py");
  assert.equal(rel("/workspace"), undefined);
  assert.equal(rel("../other/a.py"), undefined);
  assert.equal(rel("/etc/passwd"), undefined);
  assert.equal(rel("/workspacefoo/a.py"), undefined);
});

test("a clean run reports nothing", () => {
  assert.equal(report("bash-n", "a.sh", ok, 4000, 15000), undefined);
  assert.equal(report("tsc", "a.ts", { exitCode: 2, output: "  \n", timedOut: false }, 4000, 15000), undefined);
});

test("a failing run names the checker and path above its output", () => {
  const text = report("python-ast", "a.py", { exitCode: 1, output: "SyntaxError: invalid syntax\n", timedOut: false }, 4000, 15000);
  assert.equal(text, "Diagnostics (python-ast) for a.py:\nSyntaxError: invalid syntax");
});

test("long output keeps its first maxChars and says how much was cut", () => {
  const text = report("tsc", "a.ts", { exitCode: 2, output: "x".repeat(50), timedOut: false }, 10, 15000);
  assert.equal(text, `Diagnostics (tsc) for a.ts:\n${"x".repeat(10)}\n[... 40 chars cut]`);
});

test("a timeout is one line, even with partial output", () => {
  const text = report("tsc", "a.ts", { exitCode: null, output: "partial", timedOut: true }, 4000, 15000);
  assert.equal(text, "Diagnostics (tsc) for a.ts: timed out after 15000ms.");
});

test("config fills defaults and rejects bad values and unknown checker ids", () => {
  const ids = ["tsc", "json"];
  assert.deepEqual(parseConfig({}, ids, "f"), DEFAULTS);
  assert.deepEqual(parseConfig({ timeoutMs: 500, disabled: ["tsc"] }, ids, "f"), { timeoutMs: 500, maxChars: 4000, disabled: ["tsc"] });
  assert.throws(() => parseConfig({ timeoutMs: "5" }, ids, "f"), /timeoutMs/);
  assert.throws(() => parseConfig({ maxChars: 0 }, ids, "f"), /maxChars/);
  assert.throws(() => parseConfig({ disabled: ["ruff"] }, ids, "f"), /disabled/);
  assert.throws(() => parseConfig([], ids, "f"), /object/);
});
