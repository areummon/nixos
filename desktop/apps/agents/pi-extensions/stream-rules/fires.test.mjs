import test from "node:test";
import assert from "node:assert/strict";
import { FIRED_ENTRY, FireCap, firedRules } from "./fires.ts";
import { parseConfig } from "./rules.ts";

const [a, b] = parseConfig({ rules: [{ id: "a", pattern: "a", reminder: "ra" }, { id: "b", pattern: "b", reminder: "rb" }] }).config.rules;

test("a rule is off once it reaches the cap, until reset", () => {
  const cap = new FireCap(2);
  assert.equal(cap.record(a), false);
  assert.ok(cap.isOn(a));
  assert.equal(cap.record(a), true);
  assert.equal(cap.isOn(a), false);
  assert.ok(cap.isOn(b));
  cap.reset();
  assert.ok(cap.isOn(a));
});

test("fired rules come from branch custom entries, deduped, in first-fire order", () => {
  const branch = [
    { type: "message" },
    { type: "custom", customType: FIRED_ENTRY, data: { id: "b" } },
    { type: "compaction" },
    { type: "custom", customType: "other", data: { id: "a" } },
    { type: "custom", customType: FIRED_ENTRY, data: { id: "a" } },
    { type: "custom", customType: FIRED_ENTRY, data: { id: "b" } },
    { type: "custom", customType: FIRED_ENTRY, data: { id: "gone" } },
  ];
  assert.deepEqual(firedRules(branch, [a, b]).map((r) => r.id), ["b", "a"]);
});
