import { posix } from "node:path";

// Paths here are workspace-relative POSIX paths ("src/a.ts"; "" is the root).
// Every checker runs inside the gondolin VM, so all it may assume is the
// Alpine image (node 24, python3, bash) plus files inside the workspace.

export type PlanContext = {
  relPath: string;
  guest(relPath: string): string;
  exists(relPath: string): Promise<boolean>;
};

export type Run = {
  argv: string[];
  // Workspace-relative; the workspace root when omitted.
  cwd?: string;
  // Narrows raw output to what concerns the touched file; "" means nothing does.
  filter?(output: string): string;
};

export type Checker = {
  id: string;
  matches(relPath: string): boolean;
  // undefined when the checker cannot run for this file (no project tsc, say).
  plan(ctx: PlanContext): Promise<Run | undefined>;
};

const hasExt = (...exts: string[]) => (relPath: string) => exts.includes(posix.extname(relPath));

// Walks from dir up to the workspace root and returns the first dir holding name.
export async function findUp(
  dir: string,
  name: string,
  exists: (relPath: string) => Promise<boolean>,
): Promise<string | undefined> {
  const parent = (d: string) => (posix.dirname(d) === "." ? "" : posix.dirname(d));
  let d = dir === "." ? "" : dir;
  while (true) {
    if (await exists(posix.join(d, name))) return d;
    if (d === "") return undefined;
    d = parent(d);
  }
}

// Node prints the source line and a caret above its stack; the frames and the
// trailing "Node.js vX" banner say nothing about the user's file.
export function dropNodeStack(output: string): string {
  const lines = output.split("\n");
  const frame = lines.findIndex((l) => /^ {4}at /.test(l));
  return (frame === -1 ? lines : lines.slice(0, frame)).join("\n").trim();
}

// tsc --pretty false prints `file(line,col): error ...` relative to its cwd,
// with chained message lines indented under the error they belong to.
export function tscLinesFor(output: string, fileFromCwd: string): string {
  const kept: string[] = [];
  let keeping = false;
  for (const line of output.split("\n")) {
    if (/^\s/.test(line) && line.trim() !== "") {
      if (keeping) kept.push(line);
      continue;
    }
    keeping = line.startsWith(`${fileFromCwd}(`);
    if (keeping) kept.push(line);
  }
  return kept.join("\n");
}

const TS_SYNTAX = `require("node:module").stripTypeScriptTypes(require("node:fs").readFileSync(process.argv[1], "utf8"), { mode: "transform", sourceUrl: process.argv[1] })`;
const JSON_PARSE = `try { JSON.parse(require("node:fs").readFileSync(process.argv[1], "utf8")) } catch (e) { console.error(e.message); process.exit(1) }`;
// py_compile would write __pycache__ into the user's tree; ast.parse only reads.
const PY_AST = `import ast, sys, traceback
p = sys.argv[1]
try:
    ast.parse(open(p, "rb").read(), p)
except (SyntaxError, ValueError) as e:
    sys.stderr.write("".join(traceback.format_exception_only(e)))
    sys.exit(1)`;

// tsconfig.json and editor settings are JSON with comments, which JSON.parse rejects.
const isJsonc = (relPath: string) =>
  /^(tsconfig|jsconfig)(\..*)?\.json$/.test(posix.basename(relPath)) || relPath.split("/").includes(".vscode");

// First checker that matches and can plan wins, so a disabled or unavailable
// tsc falls through to the syntax-only TypeScript check.
export const CHECKERS: readonly Checker[] = [
  {
    id: "tsc",
    matches: hasExt(".ts", ".tsx", ".mts", ".cts"),
    async plan({ relPath, guest, exists }) {
      const project = await findUp(posix.dirname(relPath), "tsconfig.json", exists);
      if (project === undefined) return undefined;
      const bin = await findUp(project, "node_modules/.bin/tsc", exists);
      if (bin === undefined) return undefined;
      const fromProject = posix.relative(project, relPath);
      return {
        argv: [guest(posix.join(bin, "node_modules/.bin/tsc")), "--noEmit", "-p", ".", "--pretty", "false"],
        cwd: project,
        filter: (output) => tscLinesFor(output, fromProject),
      };
    },
  },
  {
    id: "ts-syntax",
    matches: hasExt(".ts", ".mts", ".cts"),
    plan: async ({ relPath, guest }) => ({
      argv: ["node", "--no-warnings", "-e", TS_SYNTAX, guest(relPath)],
      filter: dropNodeStack,
    }),
  },
  {
    id: "node-check",
    matches: hasExt(".js", ".mjs", ".cjs"),
    plan: async ({ relPath, guest }) => ({ argv: ["node", "--check", guest(relPath)], filter: dropNodeStack }),
  },
  {
    id: "json",
    matches: (relPath) => posix.extname(relPath) === ".json" && !isJsonc(relPath),
    plan: async ({ relPath, guest }) => ({ argv: ["node", "-e", JSON_PARSE, guest(relPath)] }),
  },
  {
    id: "python-ast",
    matches: hasExt(".py", ".pyi"),
    plan: async ({ relPath, guest }) => ({ argv: ["python3", "-c", PY_AST, guest(relPath)] }),
  },
  {
    id: "bash-n",
    matches: hasExt(".sh", ".bash"),
    plan: async ({ relPath, guest }) => ({ argv: ["bash", "-n", guest(relPath)] }),
  },
];

export const CHECKER_IDS = CHECKERS.map((c) => c.id);

export async function selectRun(
  ctx: PlanContext,
  disabled: readonly string[],
  checkers: readonly Checker[] = CHECKERS,
): Promise<{ id: string; run: Run } | undefined> {
  for (const checker of checkers) {
    if (disabled.includes(checker.id) || !checker.matches(ctx.relPath)) continue;
    const run = await checker.plan(ctx);
    if (run) return { id: checker.id, run };
  }
  return undefined;
}
