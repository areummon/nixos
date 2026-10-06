import { TextDecoder, TextEncoder } from "node:util";
import { resolve } from "node:path";

const enc = new TextEncoder();

export const byteLen = (s: string) => enc.encode(s).length;
export const pow2 = (l: number) => 2 ** l;
export const startOf = (p: { l: number; i: number }) => p.i * pow2(p.l);
export const countOf = (p: { l: number; i: number }) => pow2(p.l);
export const idOf = (p: { l: number; i: number }) => startOf(p);
export const localDay = (d = new Date()) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
export const flatten = (s: string) => s.replace(/\s+/g, " ").trim();

export const safeJson = (v: unknown) => {
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
};

export const textContent = (content: unknown): string => {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((b: any) => {
        if (!b) return "";
        if (b.type === "text") return b.text ?? "";
        if (b.type === "thinking") return ""; // never log hidden/raw reasoning
        if (b.type === "toolCall") return `tool ${b.name} ${safeJson(b.arguments ?? {})}`;
        if (b.type === "image") return "[image]";
        return "";
      })
      .filter(Boolean)
      .join("\n");
  }
  return content == null ? "" : String(content);
};

// What the agent said, for `talk`: its text only. Tool calls are logged as
// `tool` on their own, and thoughts are never logged (§2).
export const replyText = (content: unknown): string =>
  Array.isArray(content) ? content.filter((b: any) => b?.type === "text").map((b: any) => b.text ?? "").join("\n") : textContent(content);

export const cap = (s: string, max: number) => {
  if (s.length <= max) return s;
  const half = Math.floor((max - 120) / 2);
  return `${s.slice(0, half)}\n\n[... optchat-memory cut ${s.length - half * 2} chars ...]\n\n${s.slice(-half)}`;
};

export const cutBytes = (s: string, max: number) => {
  const bytes = enc.encode(s);
  if (bytes.length <= max) return s;
  return new TextDecoder().decode(bytes.slice(0, max)).replace(/\uFFFD$/u, "");
};

export function heuristicSummary(source: string, bytes: number) {
  const s = flatten(source)
    .replace(/\b(stdout|stderr|output):\s*/gi, "")
    .replace(/\s+/g, " ");
  return cutBytes(s, Math.max(64, bytes));
}

// SCALE (§4.2): a realistic, dense, multi-item summary line, tagged like a
// real one, of exactly `bytes` bytes. Models can't count bytes; an example can.
const SCALE = "user: wants the release build reproducible before Friday; says pin nixpkgs, not flake update, and keep CI on the self-hosted runner; talk: proposed pinning via flake.lock and caching the toolchain; tool: ran nix build .#release twice, read flake.nix and ci/release.yml; echo: second build hash differed in libfoo (timestamp in a generated header), ci file holds the runner labels; work: [m4k2] traced the header to gen-version.sh; open: strip the timestamp or set SOURCE_DATE_EPOCH (user to decide, asked today).";

export function exactScaleLine(bytes: number): string {
  if (byteLen(SCALE) >= bytes) return cutBytes(SCALE, bytes);
  // Larger NODE settings: repeat the line's items until the size is reached.
  let out = SCALE;
  while (byteLen(out) < bytes) out = `${out} ${SCALE}`;
  return cutBytes(out, bytes);
}

export function assertSafeImportPath(path: string) {
  const p = resolve(path);
  const home = process.env.HOME ? resolve(process.env.HOME) : "";
  const forbiddenNames = [/^\.env(?:\.|$)/, /^credentials\.json$/, /\.pem$/, /\.key$/, /^id_rsa/];
  for (const part of p.split("/")) {
    if (forbiddenNames.some((re) => re.test(part))) throw new Error(`refusing to import sensitive path: ${path}`);
  }
  const forbiddenDirs = [".secrets", ".ssh", ".gnupg"];
  if (p.split("/").some((part) => forbiddenDirs.includes(part))) throw new Error(`refusing to import sensitive path: ${path}`);
  if (home && ["Documents", "Pictures", "Downloads", "Desktop/me"].some((d) => p.startsWith(resolve(home, d)))) {
    throw new Error(`refusing to import personal document path without explicit manual review: ${path}`);
  }
}
