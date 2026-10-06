import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { isPstackChild, publishSnapshot, readSnapshot, registerPstackMemory, SNAPSHOT_ENV } from './pstack-memory.ts';

const fixture = dir => ({ cfg: { memoryDir: dir }, root: [
  { i: 0, kind: 'user', text: 'Lighthouse codename: Driftwood', date: '2026-10-04T22:00:00Z' },
  { i: 1, kind: 'talk', text: 'Acknowledged', date: '2026-10-04T22:01:00Z' },
], nodes: new Map([['0:0', { l: 0, i: 0, text: 'user: Driftwood' }], ['0:1', { l: 0, i: 1, text: 'talk: Acknowledged' }]]), renderView: () => '<chat>0+2|Lighthouse: Driftwood</chat>' });

test('identifies only positive-depth Pstack subprocesses', () => {
  assert.equal(isPstackChild(['pi']), false);
  assert.equal(isPstackChild(['pi', '--pstack-depth', '0']), false);
  assert.equal(isPstackChild(['pi', '--pstack-depth', '1']), true);
  assert.equal(isPstackChild(['pi', '--pstack-depth=2']), true);
});

test('private snapshot supplies original messages, summaries, dates and freezes data', () => {
  const dir = mkdtempSync(join(tmpdir(), 'optchat-bridge-test-'));
  const previous = process.env[SNAPSHOT_ENV];
  try {
    const mem = fixture(dir);
    const path = publishSnapshot(mem);
    assert.equal(statSync(path).mode & 0o777, 0o600);
    const snapshot = readSnapshot(path);
    assert.match(snapshot.zoom(0, 1), /Lighthouse codename: Driftwood/);
    assert.equal(snapshot.zoom(0, 2), '0+1|user: Driftwood\n1+1|talk: Acknowledged');
    assert.equal(snapshot.zoom(-1, 1), 'No line -1+1.');
    assert.equal(snapshot.zoom(1, 2), 'No line 1+2.');
    assert.match(snapshot.date(0), /2026/);
    mem.root[0].text = 'Changed';
    publishSnapshot(mem);
    assert.match(snapshot.zoom(0, 1), /Driftwood/);
    assert.match(readSnapshot(path).zoom(0, 1), /Changed/);
  } finally {
    if (previous === undefined) delete process.env[SNAPSHOT_ENV]; else process.env[SNAPSHOT_ENV] = previous;
    rmSync(dir, { recursive: true, force: true });
  }
});

test('child exposes only read-only memory tools and no archive logging hooks', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'optchat-bridge-test-'));
  const previous = process.env[SNAPSHOT_ENV];
  try {
    const tools = [], hooks = new Map();
    registerPstackMemory({ registerTool: t => tools.push(t), on: (event, fn) => hooks.set(event, fn) }, publishSnapshot(fixture(dir)));
    assert.deepEqual(tools.map(t => t.name), ['zoom', 'date']);
    assert.deepEqual([...hooks.keys()], ['before_agent_start', 'session_start']);
    assert.ok(tools.every(t => t.annotations.readOnlyHint));
    assert.match((await tools[0].execute('', { id: 0, n: 1 })).content[0].text, /Driftwood/);
    assert.match((await hooks.get('before_agent_start')({ systemPrompt: 'Task rules' })).systemPrompt, /<chat>/);
  } finally {
    if (previous === undefined) delete process.env[SNAPSHOT_ENV]; else process.env[SNAPSHOT_ENV] = previous;
    rmSync(dir, { recursive: true, force: true });
  }
});

test('missing snapshot never falls back to the live archive', async () => {
  const tools = [];
  registerPstackMemory({ registerTool: t => tools.push(t), on: () => {} });
  await assert.rejects(() => tools[0].execute('', { id: 0, n: 1 }), /No parent OptChat snapshot/);
});
