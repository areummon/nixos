import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { OptChatMemory, mostDue } from "./memory.ts";

const ctx = { ui: { setStatus() {}, notify() {} } };
const cfg = (memoryDir, viewBytes = 16000) => ({
  memoryDir, nodeBytes: 512, viewBytes, jobs: 8, tries: 5, retryMs: 10, capChars: 30000,
  replaceContext: true, disableModelCompactor: true, compactorMaxTokens: 1000,
});

let seed = 7;
const rand = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
const message = (i) => `message ${i} ` + "lorem ipsum dolor sit amet ".repeat(2 + Math.floor(rand() * 40));

async function settle(mem) {
  while (!mem.settled()) await new Promise(r => setImmediate(r));
}

// The view without its closing tag: what a later turn must start with to read it from the cache.
const body = (mem) => mem.renderView().replace(/<\/chat>$/, "");
const common = (a, b) => { let k = 0; while (k < a.length && a[k] === b[k]) k++; return k; };

test("turns read nearly all of the previous view from the cache, across a restart", async () => {
  const dir = mkdtempSync(join(tmpdir(), "optchat-view-"));
  let mem = new OptChatMemory(cfg(dir, 48000));
  await mem.start(ctx);
  let prev = "", rewritten = 0, total = 0, i = 0;
  for (let turn = 0; turn < 600; turn++) {
    for (let k = 0; k < 4; k++) await mem.log(k ? "talk" : "user", message(i++));
    await settle(mem);
    if (turn === 300) {
      mem.shutdown();
      mem = new OptChatMemory(cfg(dir, 48000));
      await mem.start(ctx);
      await settle(mem);
    }
    const view = body(mem);
    if (turn >= 150) {
      rewritten += view.length - common(prev, view);
      total += view.length;
    }
    prev = view;
  }
  mem.shutdown();
  rmSync(dir, { recursive: true, force: true });
  const share = rewritten / total;
  assert.ok(share < 0.15, `turns rewrote ${(share * 100).toFixed(1)}% of view bytes`);
});

test("a restart keeps the view byte-identical", async () => {
  const dir = mkdtempSync(join(tmpdir(), "optchat-view-"));
  let mem = new OptChatMemory(cfg(dir));
  await mem.start(ctx);
  for (let i = 0; i < 300; i++) await mem.log("user", message(i));
  await settle(mem);
  const before = mem.renderView();
  mem.shutdown();
  mem = new OptChatMemory(cfg(dir));
  await mem.start(ctx);
  await settle(mem);
  assert.equal(mem.renderView(), before);
  mem.shutdown();
  rmSync(dir, { recursive: true, force: true });
});

// Taelin's rollback push (spec §3.1), newest state first.
function push(state, list) {
  if (list === null) return { keep: 0, state, older: null };
  if (list.keep === 0) return { ...list, keep: 1 };
  return { keep: 0, state, older: push(list.state, list.older) };
}

test("with push's list length as the budget, mostDue makes exactly push's merges", () => {
  let list = null;
  let view = [];
  for (let t = 0; t <= 20000; t++) {
    list = push(t, list);
    const starts = [];
    for (let s = list; s; s = s.older) starts.unshift(s.state);
    const expected = starts.map((s, k) => {
      const n = (starts[k + 1] ?? t + 1) - s;
      return `${s}+${n}`;
    });
    view.push({ l: 0, i: t });
    while (view.length > starts.length) {
      const k = mostDue(view, t + 1, () => true);
      view.splice(k, 2, { l: view[k].l + 1, i: view[k].i / 2 });
    }
    assert.deepEqual(view.map(p => `${p.i * 2 ** p.l}+${2 ** p.l}`), expected, `t=${t}`);
  }
});
