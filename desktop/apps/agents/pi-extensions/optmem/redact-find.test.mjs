import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { OptMem } from "./memory.ts";
import { redact } from "./redact.ts";
import { rank } from "./search.ts";

// Fake keys built from pieces, so this file does not itself look like it holds a secret.
const KEYS = [
  "sk-" + "ant-api03-" + "aB3dE5fG7hJ9kL1mN3pQ5rS7",
  "sk-" + "proj-" + "Zx9Yw8Vu7Ts6Rq5Po4Nm3Lk2",
  "sk-" + "or-v1-" + "0a1b2c3d4e5f60718293a4b5c6d7e8f9",
  "gh" + "p_" + "A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8",
  "AK" + "IA" + "IOSFODNN7EXAMPLE",
  "xox" + "b-" + "1234567890-abcdefghij",
  "AI" + "za" + "SyA1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q",
  "sk" + "_live_" + "4eC39HqLyjWDarjtT1zdp7dc",
  "gl" + "pat-" + "xYz123AbC456dEf789gHiJ",
  "hf" + "_" + "AbCdEfGhIjKlMnOpQrStUvWxYz012345",
  "ey" + "JhbGciOiJIUzI1NiJ9.ey" + "JzdWIiOiIxMjM0NTY3ODkwIn0.sig_part",
];

const ctx = { ui: { setStatus() {}, notify() {} } };
const cfg = (memoryDir) => ({
  memoryDir, nodeBytes: 512, viewBytes: 16000, jobs: 8, tries: 5, retryMs: 10, capChars: 30000,
  replaceContext: true, disableModelCompactor: true, compactorMaxTokens: 1000,
});

async function withMem(fn) {
  const dir = mkdtempSync(join(tmpdir(), "optmem-redact-"));
  const mem = new OptMem(cfg(dir));
  await mem.start(ctx);
  try { await fn(mem, dir); } finally { await mem.stop?.(); rmSync(dir, { recursive: true, force: true }); }
}

test("each key shape is replaced and the text around it kept", () => {
  for (const key of KEYS) assert.equal(redact(`export TOKEN=${key} # mine`), "export TOKEN=[redacted] # mine", key.slice(0, 8));
});

test("a private key block goes whole, even when cut short", () => {
  const block = "-----BEGIN OPENSSH " + "PRIVATE KEY-----\nb3BlbnNzaC1rZXktdjEA\n-----END OPENSSH " + "PRIVATE KEY-----";
  assert.equal(redact(`key:\n${block}\ndone`), "key:\n[redacted private key]\ndone");
  assert.equal(redact("-----BEGIN RSA " + "PRIVATE KEY-----\nMIIEow"), "[redacted private key]");
});

test("a password in a URL goes, placeholders stay", () => {
  assert.equal(redact("postgres://app:hunter2x@db:5432/x"), "postgres://app:[redacted]@db:5432/x");
  for (const kept of ["postgres://postgres:postgres@localhost/x", "https://u:${PASS}@h", "https://u:xxxx@h",
    "https://u:<password>@h", "https://u:REDACTED@h", "https://u:[redacted]@h"]) assert.equal(redact(kept), kept);
});

test("words that merely look alike are kept", () => {
  for (const text of ["sk-learn-v1-2-notes", "use scikit sk-learn", "ghp_short", "the AKIA prefix", "hf_hub"]) assert.equal(redact(text), text);
});

test("no key reaches the log, and zoom redacts one logged before redaction", async () => {
  await withMem(async (mem, dir) => {
    await mem.log("user", `my key is ${KEYS[0]}`);
    await mem.log("echo", `bash: ${KEYS[3]}`);
    const raw = readdirSync(join(dir, "main")).map(f => readFileSync(join(dir, "main", f), "utf8")).join("");
    assert.ok(!raw.includes(KEYS[0]) && !raw.includes(KEYS[3]));
    assert.equal(raw.split("[redacted]").length - 1, 2);
    mem.root[1] = { ...mem.root[1], text: `old ${KEYS[4]}` };
    assert.equal(mem.zoom(1, 1), "1+0|echo: old [redacted]");
  });
});

test("rank ignores case and accents, matches word forms, exact word first", () => {
  const docs = [[0, "Configuração do Hyprland", "a"], [1, "the memories folder", "b"], [2, "unrelated words here", "c"], [3, "memory is short", "d"]];
  assert.deepEqual(rank(docs, "configuracao", 10), [["a"], 1]);
  assert.deepEqual(rank(docs, "memory", 1), [["d"], 2]);
  assert.deepEqual(rank(docs, "memory", 10)[0], ["d", "b"]);
  const common = [...Array(5)].map((_, i) => [i, "nix build again", String(i)]);
  assert.deepEqual(rank([...common, [9, "nix flake lockfile", "rare"]], "build lockfile", 1)[0], ["rare"]);
  assert.deepEqual(rank([[0, "x", "a"]], "?!", 10), [[], 0]);
});

test("find returns lines newest first, cut and redacted, with a count", async () => {
  await withMem(async (mem) => {
    await mem.log("user", "set up the gondolin vm");
    await mem.log("user", "what about kitty");
    await mem.log("user", "gondolin is slow " + "pad ".repeat(500));
    mem.root[0] = { ...mem.root[0], text: `gondolin key ${KEYS[5]}` };
    const out = mem.find("Gondolin").split("\n");
    assert.match(out[0], /^2\+1\|user: gondolin is slow pad/);
    assert.ok(Buffer.byteLength(out[0]) <= 400 + "2+1|".length);
    assert.ok(out.includes("0+1|user: gondolin key [redacted]"));
    assert.ok(!out.some(l => l.startsWith("1+1|")));
    assert.match(out.at(-1), /^\d+ of \d+ matching lines/);
    assert.equal(mem.find("zzzz"), "No matches.");
    assert.equal(mem.find("gondolin", 1).split("\n").length, 2);
  });
});
