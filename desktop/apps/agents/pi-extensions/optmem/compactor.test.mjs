import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { OptMem } from "./memory.ts";

const cfg = (memoryDir) => ({
  memoryDir, nodeBytes: 512, viewBytes: 16000, jobs: 8, tries: 5, retryMs: 10, capChars: 30000,
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
  while (!mem.settled()) await new Promise(r => setTimeout(r, 5));
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
