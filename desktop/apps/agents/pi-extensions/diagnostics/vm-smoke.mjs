// Drives the real tool_result hook against a real gondolin VM over a fixture
// project, so each checker's argv and output filtering are proven in the guest.
//
//   node --experimental-strip-types vm-smoke.mjs [typescript-package-dir]
//
// With a typescript package dir (an unpacked npm tarball), the tsc checker is
// exercised too; without one, .ts files take the syntax-only fallback.
import assert from "node:assert/strict";
import { cpSync, mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

const gondolin = process.env.GONDOLIN_MODULE ?? `${process.env.HOME}/.pi/agent/npm/node_modules/@earendil-works/gondolin/dist/src/index.js`;
const { VM, RealFSProvider } = await import(gondolin);
process.env.PI_DIAGNOSTICS_CONFIG = "/nonexistent/diagnostics.json";
const { default: extension } = await import("./index.ts");

const typescript = process.argv[2];
const root = mkdtempSync(join(tmpdir(), "diag-smoke-"));
const files = {
  "bad.js": "function (\n",
  "ok.mjs": "export const a = 1;\n",
  "bad.json": '{"a": 1,}\n',
  "tsconfig.json": typescript ? '{ /* jsonc */ "compilerOptions": { "strict": true, "noEmit": true, "types": [] }, "include": ["src"] }\n' : "{ /* jsonc */ }\n",
  "bad.py": "def f(:\n    pass\n",
  "ok.py": "def f():\n    pass\n",
  "bad.sh": "if then; fi\n",
  "plain/syntax.ts": "const a: number = ;\n",
  "plain/enum.ts": "enum E { A }\nexport {};\n",
  "src/bad.ts": 'const x: number = "s";\nexport {};\n',
  "src/other.ts": 'const z: string = 3;\nexport {};\n',
};
for (const [p, text] of Object.entries(files)) {
  mkdirSync(dirname(join(root, p)), { recursive: true });
  writeFileSync(join(root, p), text);
}
if (typescript) {
  cpSync(typescript, join(root, "node_modules/typescript"), { recursive: true });
  mkdirSync(join(root, "node_modules/.bin"));
  symlinkSync("../typescript/bin/tsc", join(root, "node_modules/.bin/tsc"));
}

const vm = await VM.create({ vfs: { mounts: { "/workspace": new RealFSProvider(root) } } });
const guest = (p) => (p === "" ? "/workspace" : `/workspace/${p}`);
const workspace = {
  hostRoot: root,
  guestRoot: "/workspace",
  toGuestPath: guest,
  readFile: (p) => vm.fs.readFile(guest(p)),
  writeFile: (p, c) => vm.fs.writeFile(guest(p), c),
  async exec(argv, { cwd, timeoutMs, signal }) {
    const ac = new AbortController();
    signal?.addEventListener("abort", () => ac.abort(), { once: true });
    let timedOut = false;
    const timer = setTimeout(() => ((timedOut = true), ac.abort()), timeoutMs);
    try {
      const r = await vm.exec(argv, { cwd: cwd ? guest(cwd) : "/workspace", signal: ac.signal });
      return { exitCode: r.exitCode, stdout: r.stdout, stderr: r.stderr, timedOut };
    } catch (err) {
      if (timedOut) return { exitCode: null, stdout: "", stderr: "", timedOut };
      throw err;
    } finally {
      clearTimeout(timer);
    }
  },
};

let hook;
extension({ on: (name, fn) => name === "tool_result" && (hook = fn), events: { on: (_n, fn) => fn(workspace) } });
const check = async (path) => {
  const patch = await hook({ toolName: "write", toolCallId: "t", input: { path }, content: [], isError: false }, {});
  return patch?.content.at(-1).text;
};

const expectations = [
  ["bad.js", /^Diagnostics \(node-check\) for bad\.js:\n\/workspace\/bad\.js:1\nfunction \(\n.*\n\nSyntaxError: Function statements require a function name$/],
  ["ok.mjs", undefined],
  ["bad.json", /^Diagnostics \(json\) for bad\.json:\nExpected double-quoted property name in JSON at position 8/],
  ["tsconfig.json", undefined],
  ["bad.py", /^Diagnostics \(python-ast\) for bad\.py:\nFile "\/workspace\/bad\.py", line 1\n.*\n.*\nSyntaxError: invalid syntax$/],
  ["ok.py", undefined],
  ["bad.sh", /^Diagnostics \(bash-n\) for bad\.sh:\n\/workspace\/bad\.sh: line 1: syntax error near unexpected token `then'/],
  ["plain/syntax.ts", typescript ? undefined : /^Diagnostics \(ts-syntax\) for plain\/syntax\.ts:\n\/workspace\/plain\/syntax\.ts:1\n.*\n.*\n\nSyntaxError \[ERR_INVALID_TYPESCRIPT_SYNTAX\]: Expression expected$/],
  ["plain/enum.ts", undefined],
  ["src/bad.ts", typescript
    ? /^Diagnostics \(tsc\) for src\/bad\.ts:\nsrc\/bad\.ts\(1,7\): error TS2322: Type 'string' is not assignable to type 'number'\.$/
    : undefined],
  ["/workspace/src/other.ts", typescript ? /^Diagnostics \(tsc\) for \/workspace\/src\/other\.ts:\nsrc\/other\.ts\(1,7\)/ : undefined],
];

let failed = 0;
try {
  for (const [path, want] of expectations) {
    const got = await check(path);
    try {
      if (want === undefined) assert.equal(got, undefined);
      else assert.match(got ?? "<nothing>", want);
      console.log(`ok   ${path}${got ? `\n${got.replace(/^/gm, "     | ")}` : " (clean)"}`);
    } catch {
      failed++;
      console.log(`FAIL ${path}\n${(got ?? "<nothing>").replace(/^/gm, "     | ")}`);
    }
  }
} finally {
  await vm.close();
}
process.exit(failed ? 1 : 0);
