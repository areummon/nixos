import test from "node:test";
import assert from "node:assert/strict";
import {
  applyEdits,
  lineHash,
  parseAnchor,
  parseEdits,
  renderChanged,
  stripAnchorPrefixes,
  tagReadOutput,
} from "./hashline.ts";

const anchor = (content, n) => `${n}#${lineHash(content.split("\n")[n - 1])}`;
const edits = (raw) => {
  const r = parseEdits(raw);
  assert.ok(r.ok, r.error);
  return r.edits;
};

test("lineHash is FNV-1a 32 low 12 bits and ignores a trailing CR", () => {
  assert.equal(lineHash(""), "dc5");
  assert.equal(lineHash("a"), "92c");
  assert.equal(lineHash("a\r"), "92c");
  assert.equal(lineHash("héllo"), lineHash("héllo"));
  assert.match(lineHash("const x = 1;"), /^[0-9a-f]{3}$/);
  assert.notEqual(lineHash("a"), lineHash("b"));
});

test("tagReadOutput numbers from the read offset", () => {
  const out = tagReadOutput("alpha\nbeta", 7);
  assert.equal(out, `7#${lineHash("alpha")}|alpha\n8#${lineHash("beta")}|beta`);
});

test("tagReadOutput tags a trailing empty line, as Pi's read shows it", () => {
  assert.equal(tagReadOutput("x\n", 1), `1#${lineHash("x")}|x\n2#dc5|`);
});

for (const notice of [
  "[Showing lines 1-2 of 900. Use offset=3 to continue.]",
  "[Showing lines 1-2 of 900 (50KB limit). Use offset=3 to continue.]",
  "[898 more lines in file. Use offset=3 to continue.]",
]) {
  test(`tagReadOutput keeps the notice verbatim: ${notice}`, () => {
    const out = tagReadOutput(`a\nb\n\n${notice}`, 1);
    assert.equal(out, `1#${lineHash("a")}|a\n2#${lineHash("b")}|b\n\n${notice}`);
  });
}

test("tagReadOutput leaves a notice-like line in the middle of a file as content", () => {
  const text = "a\n\n[3 more lines in file. Use offset=3 to continue.]\nz";
  assert.equal(tagReadOutput(text, 1).split("\n").length, 4);
});

test("parseAnchor accepts N#hhh and a pasted |content tail", () => {
  assert.deepEqual(parseAnchor("12#a3f"), { line: 12, hash: "a3f" });
  assert.deepEqual(parseAnchor(" 3#A3F|  const x = 1;"), { line: 3, hash: "a3f" });
  assert.equal(parseAnchor("0#a3f"), undefined);
  assert.equal(parseAnchor("12#a3"), undefined);
  assert.equal(parseAnchor("12:a3f"), undefined);
});

test("parseEdits rejects malformed edits with the offending index", () => {
  const bad = [
    [[], /non-empty/],
    [[{ op: "move", start: "1#abc" }], /edits\[0\]\.op/],
    [[{ op: "replace", start: "nope", text: "x" }], /edits\[0\]\.start/],
    [[{ op: "replace", start: "1#abc" }], /needs text/],
    [[{ op: "delete", start: "1#abc", text: "x" }], /takes no text/],
    [[{ op: "insert_after", start: "1#abc", end: "2#abc", text: "x" }], /only start/],
  ];
  for (const [raw, error] of bad) {
    const r = parseEdits(raw);
    assert.equal(r.ok, false);
    assert.match(r.error, error);
  }
});

test("replace, insert and delete apply against the file as last read", () => {
  const content = "a\nb\nc\nd\ne";
  const r = applyEdits(
    content,
    edits([
      { op: "replace", start: anchor(content, 2), end: anchor(content, 3), text: "B\nC\nC2" },
      { op: "insert_before", start: anchor(content, 1), text: "top" },
      { op: "insert_after", start: anchor(content, 5), text: "bottom\n" },
      { op: "delete", start: anchor(content, 4) },
    ]),
  );
  assert.ok(r.ok);
  assert.equal(r.content, "top\na\nB\nC\nC2\ne\nbottom");
  assert.deepEqual(r.changed, [
    { start: 1, end: 1 },
    { start: 3, end: 5 },
    { start: 6, end: 5 },
    { start: 7, end: 7 },
  ]);
});

test("edits are applied by original position regardless of call order", () => {
  const content = "1\n2\n3\n4";
  const a = edits([
    { op: "replace", start: anchor(content, 4), text: "four" },
    { op: "replace", start: anchor(content, 1), text: "one\nuno" },
  ]);
  const r = applyEdits(content, a);
  assert.ok(r.ok);
  assert.equal(r.content, "one\nuno\n2\n3\nfour");
});

test("insert_before a replaced line lands before the replacement", () => {
  const content = "a\nb\nc";
  const r = applyEdits(
    content,
    edits([
      { op: "replace", start: anchor(content, 2), text: "B" },
      { op: "insert_before", start: anchor(content, 2), text: "pre" },
      { op: "insert_after", start: anchor(content, 2), text: "post" },
    ]),
  );
  assert.ok(r.ok);
  assert.equal(r.content, "a\npre\nB\npost\nc");
});

test("a stale anchor rejects the whole call and returns fresh lines around it", () => {
  const content = Array.from({ length: 10 }, (_, i) => `line ${i + 1}`).join("\n");
  const r = applyEdits(
    content,
    edits([
      { op: "replace", start: anchor(content, 1), text: "changed" },
      { op: "replace", start: "6#000", text: "x" },
    ]),
  );
  assert.equal(r.ok, false);
  assert.equal(r.stale.length, 1);
  assert.equal(r.stale[0].anchor, "6#000");
  assert.deepEqual(
    r.stale[0].fresh,
    [3, 4, 5, 6, 7, 8, 9].map((n) => `${n}#${lineHash(`line ${n}`)}|line ${n}`),
  );
});

test("an anchor past the end of the file is stale with the last lines as fresh context", () => {
  const content = "a\nb";
  const r = applyEdits(content, edits([{ op: "delete", start: "9#abc" }]));
  assert.equal(r.ok, false);
  assert.deepEqual(r.stale[0].fresh, [`1#${lineHash("a")}|a`, `2#${lineHash("b")}|b`]);
});

test("overlapping edits and reversed ranges are rejected", () => {
  const content = "a\nb\nc\nd";
  const cases = [
    [
      { op: "replace", start: anchor(content, 1), end: anchor(content, 3), text: "x" },
      { op: "delete", start: anchor(content, 3), end: anchor(content, 4) },
    ],
    [
      { op: "replace", start: anchor(content, 1), end: anchor(content, 3), text: "x" },
      { op: "insert_after", start: anchor(content, 2), text: "y" },
    ],
    [
      { op: "insert_after", start: anchor(content, 1), text: "x" },
      { op: "insert_before", start: anchor(content, 2), text: "y" },
    ],
  ];
  for (const raw of cases) {
    const r = applyEdits(content, edits(raw));
    assert.equal(r.ok, false);
    assert.match(r.error, /overlap/);
  }
  const reversed = applyEdits(
    content,
    edits([{ op: "delete", start: anchor(content, 3), end: anchor(content, 2) }]),
  );
  assert.equal(reversed.ok, false);
  assert.match(reversed.error, /before start/);
});

test("a CRLF file stays CRLF, including inserted lines", () => {
  const content = "a\r\nb\r\nc\r\n";
  const r = applyEdits(
    content,
    edits([
      { op: "replace", start: anchor(content, 2), text: "B1\r\nB2" },
      { op: "insert_after", start: anchor(content, 3), text: "d" },
    ]),
  );
  assert.ok(r.ok);
  assert.equal(r.content, "a\r\nB1\r\nB2\r\nc\r\nd\r\n");
});

test("anchors on a CRLF file match the hashes read shows", () => {
  const content = "a\r\nb";
  const tagged = tagReadOutput(content, 1).split("\n");
  const r = applyEdits(content, edits([{ op: "delete", start: tagged[0] }]));
  assert.ok(r.ok);
  assert.equal(r.content, "b");
});

test("a mixed-ending file keeps its existing bytes", () => {
  const content = "a\r\nb\nc";
  const r = applyEdits(content, edits([{ op: "replace", start: anchor(content, 3), text: "C" }]));
  assert.ok(r.ok);
  assert.equal(r.content, "a\r\nb\nC");
});

test("the trailing newline survives and its empty final line is addressable", () => {
  const content = "a\nb\n";
  const kept = applyEdits(content, edits([{ op: "replace", start: anchor(content, 1), text: "A" }]));
  assert.ok(kept.ok);
  assert.equal(kept.content, "A\nb\n");
  const dropped = applyEdits(content, edits([{ op: "delete", start: anchor(content, 3) }]));
  assert.ok(dropped.ok);
  assert.equal(dropped.content, "a\nb");
});

test("renderChanged shows tagged context and merges nearby regions", () => {
  const content = Array.from({ length: 20 }, (_, i) => `l${i + 1}`).join("\n");
  const text = renderChanged(content, [{ start: 3, end: 3 }, { start: 5, end: 5 }, { start: 15, end: 14 }], 2);
  const shown = text.split("\n").map((l) => l.split("|")[1] ?? l);
  assert.deepEqual(shown, ["l1", "l2", "l3", "l4", "l5", "l6", "l7", "...", "l13", "l14", "l15", "l16"]);
  assert.match(text, /^1#[0-9a-f]{3}\|l1/);
});

test("renderChanged output anchors chain into the next applyEdits", () => {
  const content = "a\nb\nc";
  const first = applyEdits(content, edits([{ op: "replace", start: anchor(content, 2), text: "B" }]));
  assert.ok(first.ok);
  const fresh = renderChanged(first.content, first.changed, 2).split("\n");
  const second = applyEdits(first.content, edits([{ op: "replace", start: fresh[1], text: "BB" }]));
  assert.ok(second.ok);
  assert.equal(second.content, "a\nBB\nc");
});

test("stripAnchorPrefixes removes pasted anchors from edit text", () => {
  const read = tagReadOutput("function f() {\n  return 1;\n}", 4).split("\n");
  const r = stripAnchorPrefixes(`${read[1]}\n`, `${read[1].replace("1;", "2;")}\n  // more\n`);
  assert.deepEqual(r, { oldText: "  return 1;\n", newText: "  return 2;\n  // more\n" });
  const both = stripAnchorPrefixes(`${read[0]}\n${read[1]}`, `${read[0]}\n  return 2;`);
  assert.deepEqual(both, { oldText: "function f() {\n  return 1;", newText: "function f() {\n  return 2;" });
});

test("stripAnchorPrefixes leaves text alone unless every oldText line is a valid anchor", () => {
  const read = tagReadOutput("x\ny", 1).split("\n");
  assert.equal(stripAnchorPrefixes(`${read[0]}\ny`, "z"), undefined);
  assert.equal(stripAnchorPrefixes("1#abc|not the hash", "z"), undefined);
  assert.equal(stripAnchorPrefixes("plain", "z"), undefined);
  assert.equal(stripAnchorPrefixes("", "z"), undefined);
});
