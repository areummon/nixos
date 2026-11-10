import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { globToRegExp, loadConfig, parseConfig } from "./rules.ts";

test("a missing file means defaults: no rules, two fires per rule", () => {
  const { config, problems } = loadConfig(join(tmpdir(), "no-such-stream-rules.json"));
  assert.deepEqual(problems, []);
  assert.equal(config.maxFiresPerRule, 2);
  assert.equal(config.rules.length, 0);
});

test("unparseable JSON loads no rules and reports the file", () => {
  const dir = mkdtempSync(join(tmpdir(), "stream-rules-"));
  writeFileSync(join(dir, "c.json"), "{ nope");
  const { config, problems } = loadConfig(join(dir, "c.json"));
  assert.equal(config.rules.length, 0);
  assert.match(problems[0], /c\.json/);
});

test("bad rules are skipped with a reason and good ones still load", () => {
  const { config, problems } = parseConfig({
    maxFiresPerRule: 3,
    rules: [
      { id: "ok", pattern: "\\bvar\\s", reminder: "Use let." },
      { id: "badre", pattern: "(", reminder: "x" },
      { id: "noreminder", pattern: "a" },
      { id: "ok", pattern: "b", reminder: "dup" },
      { id: "textonly-tools", pattern: "a", reminder: "x", scope: { in: ["text"], tools: ["write"] } },
      { id: "weird-in", pattern: "a", reminder: "x", scope: { in: ["code"] } },
    ],
  });
  assert.deepEqual(config.rules.map((r) => r.id), ["ok"]);
  assert.equal(config.maxFiresPerRule, 3);
  assert.equal(problems.length, 5);
  assert.match(problems.find((p) => p.includes("badre")), /bad regex/);
  assert.match(problems.find((p) => p.includes("duplicate")), /rule "ok"/);
});

test("scope.in defaults to tool when tools or paths narrow the rule, else to both", () => {
  const { config } = parseConfig({
    rules: [
      { id: "any", pattern: "a", reminder: "x" },
      { id: "js", pattern: "a", reminder: "x", scope: { paths: ["*.js"] } },
    ],
  });
  assert.deepEqual([...config.rules[0].in].sort(), ["text", "tool"]);
  assert.deepEqual([...config.rules[1].in], ["tool"]);
});

test("g and y flags are dropped so repeated scans do not skip matches", () => {
  const { config } = parseConfig({ rules: [{ id: "g", pattern: "x", flags: "gi", reminder: "r" }] });
  const re = config.rules[0].regex;
  assert.equal(re.flags, "i");
  assert.ok(re.test("X") && re.test("X"));
});

test("a bad maxFiresPerRule falls back to 2 with a problem", () => {
  const { config, problems } = parseConfig({ maxFiresPerRule: 0 });
  assert.equal(config.maxFiresPerRule, 2);
  assert.equal(problems.length, 1);
});

test("globs: no slash matches the basename, a slash matches trailing segments", () => {
  const js = globToRegExp("*.js");
  assert.ok(js.test("a.js") && js.test("/workspace/src/a.js"));
  assert.ok(!js.test("a.jsx") && !js.test("a.ts"));
  const src = globToRegExp("src/*.js");
  assert.ok(src.test("src/a.js") && src.test("/w/src/a.js"));
  assert.ok(!src.test("src/lib/a.js") && !src.test("xsrc/a.js"));
  const deep = globToRegExp("src/**/*.ts");
  assert.ok(deep.test("src/a.ts") && deep.test("/w/src/x/y/a.ts"));
  assert.ok(globToRegExp("./a?.md").test("/w/ab.md"));
});
