export type Anchor = { line: number; hash: string };

export type EditOp = "replace" | "insert_before" | "insert_after" | "delete";

export type HashEdit = { op: EditOp; start: Anchor; end?: Anchor; text?: string };

// 1-based inclusive line range in the edited file; a deletion is the empty range end = start - 1.
export type LineRange = { start: number; end: number };

export type StaleAnchor = { anchor: string; fresh: string[] };

export type ApplyResult =
  | { ok: true; content: string; changed: LineRange[] }
  | { ok: false; stale: StaleAnchor[]; error?: string };

// Every op becomes one splice over the original lines: the half-open index range [from, to) is
// replaced by `lines`. Inserts are zero-width.
type Splice = { from: number; to: number; lines: string[] };

const OPS: readonly EditOp[] = ["replace", "insert_before", "insert_after", "delete"];
const ANCHOR = /^\s*(\d+)#([0-9a-fA-F]{3})(?:\|[\s\S]*)?$/;
const PREFIX = /^(\d+)#([0-9a-f]{3})\|/;
const READ_NOTICE =
  /\n\n\[(?:Showing lines \d+-\d+ of \d+(?: \([^)\n]+ limit\))?|\d+ more lines in file)\. Use offset=\d+ to continue\.\]$/;
const STALE_RADIUS = 3;

const encoder = new TextEncoder();

export function lineHash(line: string): string {
  const bytes = encoder.encode(line.endsWith("\r") ? line.slice(0, -1) : line);
  let h = 0x811c9dc5;
  for (const b of bytes) {
    h ^= b;
    h = Math.imul(h, 0x01000193);
  }
  return (h & 0xfff).toString(16).padStart(3, "0");
}

export const formatAnchor = (a: Anchor): string => `${a.line}#${a.hash}`;

export const tagLine = (line: string, n: number): string => `${n}#${lineHash(line)}|${line}`;

export function parseAnchor(raw: string): Anchor | undefined {
  const m = ANCHOR.exec(raw);
  if (!m) return undefined;
  const line = Number(m[1]);
  return line >= 1 ? { line, hash: m[2].toLowerCase() } : undefined;
}

// Pi's read text is the selected lines joined by "\n", optionally followed by a continuation notice.
export function tagReadOutput(text: string, firstLine: number): string {
  const notice = READ_NOTICE.exec(text);
  const body = notice ? text.slice(0, notice.index) : text;
  const tagged = body
    .split("\n")
    .map((line, i) => tagLine(line, firstLine + i))
    .join("\n");
  return notice ? tagged + notice[0] : tagged;
}

export function parseEdits(raw: unknown): { ok: true; edits: HashEdit[] } | { ok: false; error: string } {
  if (!Array.isArray(raw) || raw.length === 0) return { ok: false, error: "edits must be a non-empty array" };
  const edits: HashEdit[] = [];
  for (const [i, item] of raw.entries()) {
    const e = (item ?? {}) as Record<string, unknown>;
    const where = `edits[${i}]`;
    if (!OPS.includes(e.op as EditOp)) return { ok: false, error: `${where}.op must be one of ${OPS.join(", ")}` };
    const op = e.op as EditOp;
    const start = typeof e.start === "string" ? parseAnchor(e.start) : undefined;
    if (!start) return { ok: false, error: `${where}.start must be an anchor like 12#a3f` };
    let end: Anchor | undefined;
    if (e.end !== undefined) {
      if (op === "insert_before" || op === "insert_after") {
        return { ok: false, error: `${where}: ${op} takes only start, not end` };
      }
      end = typeof e.end === "string" ? parseAnchor(e.end) : undefined;
      if (!end) return { ok: false, error: `${where}.end must be an anchor like 12#a3f` };
    }
    if (op === "delete" && e.text !== undefined) {
      return { ok: false, error: `${where}: delete takes no text; use replace to change lines` };
    }
    if (op !== "delete" && typeof e.text !== "string") return { ok: false, error: `${where}: ${op} needs text` };
    edits.push({ op, start, ...(end ? { end } : {}), ...(op === "delete" ? {} : { text: e.text as string }) });
  }
  return { ok: true, edits };
}

// A pure-CRLF file is edited as bare lines and rejoined with "\r\n"; anything else keeps its bytes as-is.
function isCrlf(content: string): boolean {
  return content.includes("\r\n") && !/(^|[^\r])\n/.test(content);
}

function splitLines(content: string, crlf: boolean): string[] {
  const lines = content.split("\n");
  if (crlf) for (let i = 0; i < lines.length - 1; i++) lines[i] = lines[i].slice(0, -1);
  return lines;
}

// A trailing newline in the model's text terminates its last line rather than adding an empty one.
function textLines(text: string, crlf: boolean): string[] {
  const lines = text.split("\n");
  if (lines.length > 1 && lines[lines.length - 1] === "") lines.pop();
  return crlf ? lines.map((l) => (l.endsWith("\r") ? l.slice(0, -1) : l)) : lines;
}

function toSplice(e: HashEdit, crlf: boolean): Splice {
  const first = e.start.line - 1;
  const last = (e.end ?? e.start).line;
  switch (e.op) {
    case "replace":
      return { from: first, to: last, lines: textLines(e.text ?? "", crlf) };
    case "delete":
      return { from: first, to: last, lines: [] };
    case "insert_before":
      return { from: first, to: first, lines: textLines(e.text ?? "", crlf) };
    case "insert_after":
      return { from: first + 1, to: first + 1, lines: textLines(e.text ?? "", crlf) };
  }
}

function conflicts(a: Splice, b: Splice): boolean {
  const aPoint = a.from === a.to;
  const bPoint = b.from === b.to;
  if (aPoint && bPoint) return a.from === b.from;
  if (aPoint) return b.from < a.from && a.from < b.to;
  if (bPoint) return a.from < b.from && b.from < a.to;
  return Math.max(a.from, b.from) < Math.min(a.to, b.to);
}

export function taggedWindow(lines: string[], from: number, to: number): string[] {
  const out: string[] = [];
  for (let n = Math.max(1, from); n <= Math.min(lines.length, to); n++) out.push(tagLine(lines[n - 1], n));
  return out;
}

function findStale(lines: string[], edits: HashEdit[]): StaleAnchor[] {
  const stale = new Map<string, StaleAnchor>();
  for (const a of edits.flatMap((e) => (e.end ? [e.start, e.end] : [e.start]))) {
    const key = formatAnchor(a);
    if (stale.has(key)) continue;
    if (a.line <= lines.length && lineHash(lines[a.line - 1]) === a.hash) continue;
    const at = Math.min(a.line, lines.length);
    stale.set(key, { anchor: key, fresh: taggedWindow(lines, at - STALE_RADIUS, at + STALE_RADIUS) });
  }
  return [...stale.values()];
}

// All anchors refer to `content` as last read; nothing changes unless every edit is valid.
export function applyEdits(content: string, edits: HashEdit[]): ApplyResult {
  for (const e of edits) {
    if (e.end && e.end.line < e.start.line) {
      return { ok: false, stale: [], error: `end ${formatAnchor(e.end)} is before start ${formatAnchor(e.start)}` };
    }
  }
  const crlf = isCrlf(content);
  const lines = splitLines(content, crlf);
  const stale = findStale(lines, edits);
  if (stale.length > 0) return { ok: false, stale };

  const splices = edits.map((e) => toSplice(e, crlf)).sort((a, b) => a.from - b.from || a.to - b.to);
  for (let i = 0; i < splices.length; i++) {
    for (let j = i + 1; j < splices.length; j++) {
      if (conflicts(splices[i], splices[j])) {
        return { ok: false, stale: [], error: "edits overlap; merge edits that touch the same lines into one" };
      }
    }
  }

  const out: string[] = [];
  const changed: LineRange[] = [];
  let cursor = 0;
  for (const s of splices) {
    out.push(...lines.slice(cursor, s.from));
    changed.push({ start: out.length + 1, end: out.length + s.lines.length });
    out.push(...s.lines);
    cursor = s.to;
  }
  out.push(...lines.slice(cursor));
  return { ok: true, content: out.join(crlf ? "\r\n" : "\n"), changed };
}

// Tagged lines of each changed range plus `radius` lines of context, overlapping windows merged.
export function renderChanged(content: string, changed: LineRange[], radius: number): string {
  const lines = splitLines(content, isCrlf(content));
  const windows = changed
    .map((r) => [Math.max(1, r.start - radius), Math.min(lines.length, r.end + radius)] as const)
    .sort((a, b) => a[0] - b[0]);
  const merged: Array<[number, number]> = [];
  for (const [from, to] of windows) {
    const prev = merged[merged.length - 1];
    if (prev && from <= prev[1] + 1) prev[1] = Math.max(prev[1], to);
    else merged.push([from, to]);
  }
  return merged.map(([from, to]) => taggedWindow(lines, from, to).join("\n")).join("\n...\n");
}

// Models paste read's anchors into edit's oldText. Strip only when every oldText line carries a prefix
// whose hash matches the rest of that line; that proves the paste, so newText lines lose any prefix
// even where the model changed the line after its hash was taken.
export function stripAnchorPrefixes(
  oldText: string,
  newText: string,
): { oldText: string; newText: string } | undefined {
  const strip = (line: string): string | undefined => {
    const m = PREFIX.exec(line);
    if (!m) return undefined;
    const rest = line.slice(m[0].length);
    return lineHash(rest) === m[2] ? rest : undefined;
  };
  const oldLines = oldText.split("\n");
  const body = oldLines[oldLines.length - 1] === "" ? oldLines.slice(0, -1) : oldLines;
  if (body.length === 0) return undefined;
  const strippedOld = body.map(strip);
  if (strippedOld.some((l) => l === undefined)) return undefined;
  const tail = body.length < oldLines.length ? "\n" : "";
  return {
    oldText: strippedOld.join("\n") + tail,
    newText: newText
      .split("\n")
      .map((l) => l.replace(PREFIX, ""))
      .join("\n"),
  };
}
