// §10 browsing: the whole memory as one HTML page — the current view, ROOT
// (every message) and each level of the tree, each entry with its range,
// time span and size. Lines link down to the nodes they were made from.
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { OptChatMemory } from "./memory.ts";
import type { Part } from "./types.ts";
import { byteLen, countOf, idOf, pow2 } from "./util.ts";

const esc = (s: string) => s.replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

export function writeHtml(mem: OptChatMemory, path: string): string {
  const T = mem.root.length;
  const day = (i: number) => mem.root[i]?.date?.replace("T", " ").slice(0, 16) ?? "?";
  const span = (p: Part) => {
    const a = idOf(p), b = Math.min(a + countOf(p), T) - 1;
    return a === b ? day(a) : `${day(a)} → ${day(b)}`;
  };
  const anchor = (p: Part) => (p.l === 0 ? `m${p.i}` : `n${p.l}-${p.i}`);
  const line = (p: Part, text: string, size: number) => {
    const kids = p.l > 0
      ? ` <span class="kids">→ <a href="#${anchor({ l: p.l - 1, i: p.i * 2 })}">left</a> <a href="#${anchor({ l: p.l - 1, i: p.i * 2 + 1 })}">right</a></span>`
      : ` <span class="kids">→ <a href="#msg${p.i}">message</a></span>`;
    return `<div class="entry" id="${anchor(p)}"><div class="meta"><b>${idOf(p)}+${countOf(p)}</b> · ${esc(span(p))} · ${size} B${kids}</div><div class="text">${esc(text)}</div></div>`;
  };

  const view = mem.view.map(p => {
    const text = mem.partText(p);
    return line(p, text, byteLen(text));
  }).join("\n");

  let maxL = 0;
  for (const n of mem.nodes.values()) maxL = Math.max(maxL, n.l);
  const levels: string[] = [];
  for (let l = maxL; l >= 0; l--) {
    const entries: string[] = [];
    for (let i = 0; (i + 1) * pow2(l) <= T; i++) {
      const n = mem.node(l, i);
      if (n) entries.push(line({ l, i }, n.text, n.size));
    }
    if (entries.length) {
      levels.push(`<details${l >= maxL - 1 ? " open" : ""}><summary>Level ${l} · ${pow2(l)} message(s) per line · ${entries.length} line(s)</summary>\n${entries.join("\n")}\n</details>`);
    }
  }

  const root = mem.root.map(m =>
    `<div class="entry" id="msg${m.i}"><div class="meta"><b>${m.i}</b> · ${esc(m.kind)} · ${esc(day(m.i))} · ${m.size} B</div><pre>${esc(m.text)}</pre></div>`,
  ).join("\n");

  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>OptChat memory</title>
<style>
:root { --bg: #fff; --fg: #1d1d1f; --muted: #6b6b70; --line: #e4e4e7; --accent: #2557d6; --code: #f5f5f7; }
@media (prefers-color-scheme: dark) { :root { --bg: #151517; --fg: #e8e8ea; --muted: #9a9aa0; --line: #2c2c30; --accent: #7aa2ff; --code: #1e1e21; } }
body { background: var(--bg); color: var(--fg); font: 14px/1.45 system-ui, sans-serif; margin: 0 auto; max-width: 980px; padding: 16px; }
h1 { font-size: 20px; } h2 { font-size: 16px; margin-top: 32px; border-bottom: 1px solid var(--line); padding-bottom: 4px; }
a { color: var(--accent); } .meta { color: var(--muted); font-size: 12px; } .kids { margin-left: 6px; }
.entry { border-bottom: 1px solid var(--line); padding: 6px 0; } .entry:target { background: var(--code); }
.text { overflow-wrap: anywhere; }
pre { background: var(--code); margin: 4px 0 0; padding: 8px; white-space: pre-wrap; overflow-wrap: anywhere; font-size: 12px; }
summary { cursor: pointer; font-weight: 600; margin: 10px 0; }
nav a { margin-right: 12px; }
</style></head><body>
<h1>OptChat memory</h1>
<p class="meta">${T} messages · ${mem.nodes.size} tree nodes · view ${mem.viewBytes()} / ${mem.cfg.viewBytes} B in ${mem.view.length} lines · written ${esc(new Date().toISOString())}</p>
<nav><a href="#view">View</a><a href="#tree">Tree</a><a href="#root">Messages</a></nav>
<h2 id="view">View</h2>
${view}
<h2 id="tree">Tree</h2>
${levels.join("\n")}
<h2 id="root">Messages</h2>
${root}
</body></html>
`;
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, html);
  return `wrote ${path} (${T} messages, ${mem.nodes.size} nodes)`;
}
