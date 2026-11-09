import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { OptMem } from "./memory.ts";

const cfg = (memoryDir, viewBytes = 16000) => ({
  memoryDir, nodeBytes: 512, viewBytes, jobs: 8, tries: 5, retryMs: 10, capChars: 30000,
  replaceContext: true, disableModelCompactor: false, compactorMaxTokens: 1000,
});

// A compactor model that records each request and answers with reply(step).
function fakeCtx(reply) {
  const steps = [];
  const ctx = {
    model: { id: "fake" },
    ui: { setStatus() {}, notify() {} },
    modelRegistry: {
      streamSimple(_model, { messages }) {
        const step = messages[1].content.at(-1).text;
        steps.push(step);
        return { result: async () => ({ stopReason: "stop", content: [{ type: "text", text: reply(step) }] }) };
      },
    },
  };
  return { ctx, steps };
}

async function settle(mem) {
  const deadline = Date.now() + 10_000;
  while (!mem.settled() || mem.busy.size) {
    assert.ok(Date.now() < deadline, "compaction never settled");
    await new Promise(r => setTimeout(r, 5));
  }
}

test("the compaction request shows an N-dash ruler and no sample summary", async () => {
  const dir = mkdtempSync(join(tmpdir(), "optmem-compactor-"));
  const { ctx, steps } = fakeCtx(() => "x".repeat(300));
  const mem = new OptMem(cfg(dir));
  await mem.start(ctx);
  try {
    for (let k = 0; k < 2; k++) await mem.log("user", `long message ${k} ` + "lorem ipsum ".repeat(100));
    await settle(mem);
    const leaf = steps.find(s => s.includes("Compress this message"));
    const merge = steps.find(s => s.includes("Merge these two lines"));
    assert.ok(leaf && merge, "both a leaf and a merge went to the model");
    for (const step of [leaf, merge]) {
      const rulers = step.split("\n").filter(line => /^-+$/.test(line));
      assert.deepEqual(rulers.map(r => r.length), [512]);
      for (const leaked of ["libfoo", "SOURCE_DATE_EPOCH", "release build", "For scale"]) assert.ok(!step.includes(leaked), leaked);
    }
  } finally {
    mem.shutdown();
    rmSync(dir, { recursive: true, force: true });
  }
});

// Eight long messages under a small view, so the oldest view line is an
// ancestor of the line rebuilt. Every reply names its generation.
async function builtTree(dir, gen) {
  const { ctx } = fakeCtx(step => `gen${gen.n} ${step.split("\n", 1)[0]}`.padEnd(300, "."));
  const mem = new OptMem(cfg(dir, 1000));
  await mem.start(ctx);
  for (let k = 0; k < 8; k++) {
    await mem.log(k % 2 ? "talk" : "user", `message ${k} ` + "pad ".repeat(200));
    await settle(mem);
  }
  return { mem, ctx };
}

const texts = (mem) => new Map([...mem.nodes].map(([k, n]) => [k, n.text]));

test("rebuild replaces the line, its subtree and its ancestors, and survives a reload", async () => {
  const dir = mkdtempSync(join(tmpdir(), "optmem-rebuild-"));
  const gen = { n: 1 };
  let { mem, ctx } = await builtTree(dir, gen);
  try {
    assert.ok(mem.built(3, 0), "the tree grew to the top");
    assert.ok(mem.view[0].l >= 2, "the oldest view line covers the rebuilt one");
    const before = texts(mem);
    gen.n = 2;
    assert.match(mem.rebuild(2, 2), /^Rebuilding 2\+2: 5 lines dropped/);
    await settle(mem);
    const after = texts(mem);
    const rebuilt = new Set(["0:2", "0:3", "1:1", "2:0", "3:0"]);
    assert.deepEqual([...after.keys()].sort(), [...before.keys()].sort());
    for (const [k, text] of after) {
      if (rebuilt.has(k)) assert.match(text, /^gen2 /, k);
      else assert.equal(text, before.get(k), k);
    }
    mem.shutdown();
    mem = new OptMem(cfg(dir, 1000));
    await mem.start(ctx);
    assert.deepEqual(texts(mem), after);
  } finally {
    mem.shutdown();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("rebuild refuses a bad line, a running compaction and a paused memory", async () => {
  const dir = mkdtempSync(join(tmpdir(), "optmem-rebuild-"));
  const { mem } = await builtTree(dir, { n: 1 });
  try {
    assert.equal(mem.rebuild(1, 2), "No line 1+2.");
    assert.equal(mem.rebuild(8, 1), "No line 8+1.");
    mem.busy.add("0:0");
    assert.match(mem.rebuild(0, 1), /retry shortly/);
    mem.busy.clear();
    mem.paused = true;
    assert.match(mem.rebuild(0, 1), /paused/);
    assert.ok(mem.built(0, 0), "a refused rebuild drops nothing");
  } finally {
    mem.shutdown();
    rmSync(dir, { recursive: true, force: true });
  }
});
