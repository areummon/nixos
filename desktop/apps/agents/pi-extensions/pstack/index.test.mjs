import test from "node:test";
import assert from "node:assert/strict";
import pstack from "./index.ts";

function harness(branch = []) {
  const events = new Map();
  const commands = new Map();
  const sent = [];
  const notices = [];
  const ctx = {
    sessionManager: { getBranch: () => branch },
    ui: { setStatus() {}, notify: (...args) => notices.push(args) },
  };
  pstack({
    on: (event, handler) => events.set(event, handler),
    registerCommand: (name, command) => commands.set(name, command),
    appendEntry: (customType, data) => branch.push({ type: "custom", customType, data }),
    sendUserMessage: (...args) => sent.push(args),
  });
  return { events, commands, sent, notices, ctx, branch };
}

test("registers every skill and status without loop", () => {
  const h = harness();
  assert.equal(h.commands.size, 52);
  for (const name of ["poteto-mode", "setup-pstack", "swarm", "architect", "how", "recall", "pstack"]) {
    assert.ok(h.commands.has(name));
  }
  assert.ok(!h.commands.has("loop"));
});

test("mode enables without a model call; off clears it; task preserves arguments", async () => {
  const h = harness();
  const command = h.commands.get("poteto-mode");
  await command.handler("", h.ctx);
  assert.equal(h.sent.length, 0);
  assert.equal(h.branch.at(-1).data.mode, "poteto-mode");
  const event = { messages: [{ role: "system", content: "Base system" }] };
  const result = await h.events.get("context_with_system")(event);
  assert.match(result.messages[0].content, /Active mode poteto-mode/);
  assert.equal(event.messages[0].content, "Base system");
  assert.equal(await h.events.get("context_with_system")({ messages: result.messages }), undefined);
  await command.handler("fix filenames with spaces", h.ctx);
  assert.match(h.sent[0][0], /fix filenames with spaces/);
  assert.equal(h.sent[0][1].deliverAs, "followUp");
  await command.handler("off", h.ctx);
  const disabled = await h.events.get("context_with_system")(event);
  assert.doesNotMatch(disabled.messages[0].content, /Active mode poteto-mode/);
});

test("restores branch state, including off, and handles structured system messages", async () => {
  const h = harness([{ type: "custom", customType: "pstack-mode", data: { mode: "poteto-mode" } }]);
  await h.events.get("session_start")({}, h.ctx);
  const event = { messages: [{ role: "system", content: [{ type: "text", text: "base" }] }] };
  const result = await h.events.get("context_with_system")(event);
  assert.equal(result.messages[0].content.length, 2);
  assert.match(result.messages[0].content[1].text, /Active mode poteto-mode/);
  h.branch.push({ type: "custom", customType: "pstack-mode", data: { mode: null } });
  await h.events.get("session_tree")({}, h.ctx);
  const off = await h.events.get("context_with_system")(event);
  assert.doesNotMatch(off.messages[0].content[1].text, /Active mode poteto-mode/);
});

test("one-shot workflows send only a request, not delegated tools or persistent state", async () => {
  const h = harness();
  await h.commands.get("swarm").handler("review three modules", h.ctx);
  assert.match(h.sent[0][0], /skills\/swarm\/SKILL.md/);
  assert.match(h.sent[0][0], /review three modules/);
  assert.equal(h.branch.length, 0);
});
