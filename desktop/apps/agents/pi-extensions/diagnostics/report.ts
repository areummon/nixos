import { posix } from "node:path";

// The model sees the VM's cwd as guestRoot, so it may name a file by its guest
// path, its host path, or relative to the workspace. Anything outside is not ours.
export function workspaceRelPath(inputPath: string, hostRoot: string, guestRoot: string): string | undefined {
  const p = inputPath.startsWith("@") ? inputPath.slice(1) : inputPath;
  const root = p === guestRoot || p.startsWith(`${guestRoot}/`) ? guestRoot : hostRoot;
  const rel = posix.relative(root, posix.resolve(root, p));
  if (rel === "" || rel === ".." || rel.startsWith("../")) return undefined;
  return rel;
}

export type Outcome = { exitCode: number | null; output: string; timedOut: boolean };

export function cap(text: string, maxChars: number): string {
  return text.length > maxChars ? `${text.slice(0, maxChars)}\n[... ${text.length - maxChars} chars cut]` : text;
}

// undefined means the file is clean as far as this checker can tell.
export function report(id: string, path: string, outcome: Outcome, maxChars: number, timeoutMs: number): string | undefined {
  if (outcome.timedOut) return `Diagnostics (${id}) for ${path}: timed out after ${timeoutMs}ms.`;
  if (outcome.exitCode === 0) return undefined;
  const output = outcome.output.trim();
  if (output === "") return undefined;
  return `Diagnostics (${id}) for ${path}:\n${cap(output, maxChars)}`;
}
