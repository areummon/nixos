import test from "node:test";
import assert from "node:assert/strict";
import { CHECKER_IDS, dropNodeStack, findUp, selectRun, tscLinesFor } from "./checkers.ts";

const tree = (...files) => async (p) => files.includes(p);
const ctx = (relPath, exists = tree()) => ({ relPath, guest: (p) => `/workspace/${p}`, exists });
const pick = async (relPath, exists, disabled = []) => (await selectRun(ctx(relPath, exists), disabled))?.id;

test("each extension maps to its checker, and unknown ones to none", async () => {
  const cases = {
    "a.js": "node-check", "a.mjs": "node-check", "a.cjs": "node-check",
    "a.ts": "ts-syntax", "a.mts": "ts-syntax", "a.cts": "ts-syntax",
    "a.json": "json", "sub/a.py": "python-ast", "a.pyi": "python-ast",
    "a.sh": "bash-n", "a.bash": "bash-n",
    "a.tsx": undefined, "a.nix": undefined, "a.rs": undefined, "a.go": undefined, "Makefile": undefined,
  };
  for (const [path, id] of Object.entries(cases)) assert.equal(await pick(path), id, path);
});

test("JSON-with-comments files are not parsed as JSON", async () => {
  for (const path of ["tsconfig.json", "pkg/tsconfig.build.json", "jsconfig.json", ".vscode/settings.json"]) {
    assert.equal(await pick(path), undefined, path);
  }
  assert.equal(await pick("package.json"), "json");
});

test("tsc runs from the nearest tsconfig with the nearest project tsc", async () => {
  const exists = tree("tsconfig.json", "pkg/tsconfig.json", "node_modules/.bin/tsc");
  const selected = await selectRun(ctx("pkg/src/a.ts", exists), []);
  assert.equal(selected.id, "tsc");
  assert.equal(selected.run.cwd, "pkg");
  assert.deepEqual(selected.run.argv, ["/workspace/node_modules/.bin/tsc", "--noEmit", "-p", ".", "--pretty", "false"]);
  assert.equal(await pick("a.tsx", exists), "tsc");
});

test("without a tsconfig or a project tsc, TypeScript falls back to the syntax check", async () => {
  assert.equal(await pick("a.ts", tree("node_modules/.bin/tsc")), "ts-syntax");
  assert.equal(await pick("a.ts", tree("tsconfig.json")), "ts-syntax");
  assert.equal(await pick("a.tsx", tree("tsconfig.json")), undefined);
});

test("a tsc installed below the tsconfig is not used", async () => {
  assert.equal(await pick("pkg/a.ts", tree("tsconfig.json", "pkg/node_modules/.bin/tsc")), "ts-syntax");
});

test("disabling a checker falls through to the next match", async () => {
  const exists = tree("tsconfig.json", "node_modules/.bin/tsc");
  assert.equal(await pick("a.ts", exists, ["tsc"]), "ts-syntax");
  assert.equal(await pick("a.ts", exists, ["tsc", "ts-syntax"]), undefined);
  assert.equal(await pick("a.py", exists, ["python-ast"]), undefined);
});

test("findUp stops at the workspace root", async () => {
  const seen = [];
  const exists = async (p) => (seen.push(p), false);
  assert.equal(await findUp("a/b", "x", exists), undefined);
  assert.deepEqual(seen, ["a/b/x", "a/x", "x"]);
  assert.equal(await findUp("", "x", tree("x")), "");
  assert.equal(await findUp("a/b", "x", tree("a/x")), "a");
});

test("tsc output keeps the touched file's errors and their continuation lines", () => {
  const output = [
    "src/a.ts(1,7): error TS2322: Type 'string' is not assignable to type 'number'.",
    "src/b.ts(2,1): error TS2304: Cannot find name 'q'.",
    "  Did you mean 'Q'?",
    "src/a.ts(3,1): error TS2345: Argument of type 'X' is not assignable.",
    "  Types of property 'y' are incompatible.",
    "src/a.tsx(1,1): error TS1005: ';' expected.",
  ].join("\n");
  assert.equal(
    tscLinesFor(output, "src/a.ts"),
    [
      "src/a.ts(1,7): error TS2322: Type 'string' is not assignable to type 'number'.",
      "src/a.ts(3,1): error TS2345: Argument of type 'X' is not assignable.",
      "  Types of property 'y' are incompatible.",
    ].join("\n"),
  );
  assert.equal(tscLinesFor(output, "src/c.ts"), "");
});

test("node output loses its stack frames and version banner", () => {
  const output = [
    "/workspace/bad.js:1",
    "function (",
    "^^^^^^^^",
    "",
    "SyntaxError: Function statements require a function name",
    "    at wrapSafe (node:internal/modules/cjs/loader:1804:18)",
    "",
    "Node.js v24.18.1",
  ].join("\n");
  assert.equal(dropNodeStack(output), "/workspace/bad.js:1\nfunction (\n^^^^^^^^\n\nSyntaxError: Function statements require a function name");
});

test("checker ids are unique", () => {
  assert.equal(new Set(CHECKER_IDS).size, CHECKER_IDS.length);
});
