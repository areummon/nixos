import test from "node:test";
import assert from "node:assert/strict";
import { parseVerdict } from "./verdict.ts";

const none = { level: "none", note: "" };

test("takes the first JSON object, even inside prose or a fence", () => {
  assert.deepEqual(parseVerdict('{"level":"concern","note":"is_even returns odd"}'), { level: "concern", note: "is_even returns odd" });
  assert.deepEqual(
    parseVerdict('Sure.\n```json\n{"level": "blocker", "note": " rm -rf / ran "}\n```\n{"level":"none","note":""}'),
    { level: "blocker", note: "rm -rf / ran" },
  );
});

test("braces inside strings do not end the object", () => {
  assert.deepEqual(parseVerdict('{"level":"aside","note":"use {} not \\"}\\" here"} trailing'), { level: "aside", note: 'use {} not "}" here' });
});

test("anything invalid is none", () => {
  for (const text of [
    "",
    "no json here",
    "{not json}",
    '{"level":"urgent","note":"x"}',
    '{"level":"concern"}',
    '{"level":"concern","note":"   "}',
    '{"level":"concern","note":42}',
    '{"level":"none","note":"ignored"}',
    "null",
  ]) assert.deepEqual(parseVerdict(text), none, text);
});
