import test from "node:test";
import assert from "node:assert/strict";
import { applyPolicy } from "./pi-npm-policy.mjs";

test("pins patched SDK and denies native build while preserving Pi packages", () => {
  const original = { private: true, dependencies: { "pi-web-access": "0.35.0", "pi-sandbox": "0.7.0" }, overrides: { other: "2.0.0" }, allowScripts: { other: true, "tree-sitter-bash": true } };
  const updated = applyPolicy(original);
  assert.equal(updated.overrides["@modelcontextprotocol/sdk"], "1.32.1");
  assert.equal(updated.allowScripts["tree-sitter-bash"], false);
  assert.equal(updated.allowScripts.ssh2, false);
  assert.equal(updated.allowScripts["cpu-features"], false);
  assert.deepEqual(updated.dependencies, { "pi-web-access": "0.35.0", "@earendil-works/gondolin": "^0.13.0" });
  assert.equal(original.dependencies["pi-sandbox"], "0.7.0");
  assert.equal(updated.overrides.other, "2.0.0");
  assert.equal(updated.allowScripts.other, true);
  assert.equal(original.allowScripts["tree-sitter-bash"], true);
  assert.deepEqual(applyPolicy(updated), updated);
});
