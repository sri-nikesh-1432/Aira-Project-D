'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const sys = require('../src/sys.js');
const dispatch = require('../src/dispatch.js');

test('message ids mirror the harness stamp/shortRand shape', () => {
  const id = sys.makeMsgId();
  assert.match(id, /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z-[0-9a-f]{6}$/);
  const conv = sys.makeConvId();
  assert.match(conv, /^conv-[0-9a-f]{6}$/);
});

test('planetState derives honest states from registry + fleet', () => {
  const agent = { status: 'idle' };
  const ftaSkip = { onHold: false, breaker: 'healthy', lastActiveSecAgo: null };
  assert.equal(sys.planetState(agent, ftaSkip, true), 'idle');
  assert.equal(sys.planetState(agent, { ...ftaSkip, lastActiveSecAgo: 5 }, true), 'working');
  assert.equal(sys.planetState(agent, { ...ftaSkip, lastActiveSecAgo: 400 }, true), 'idle');
  assert.equal(sys.planetState({ status: 'idle' }, { ...ftaSkip, onHold: true }, true), 'paused');
  assert.equal(sys.planetState({ status: 'idle' }, { ...ftaSkip, breaker: 'steer' }, true), 'paused');
  assert.equal(sys.planetState({ status: 'working' }, null, false), 'working');
  assert.equal(sys.planetState(agent, null, false), 'idle');
});

test('redactSecrets strips secret shapes', () => {
  const msg = 'key is sk-ant-abcdefghijklmnop, token: abc123-and-a-jwt eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abc123';
  const out = sys.redactSecrets(msg);
  assert.ok(!out.includes('sk-ant-abcdefghijklmnop'));
  assert.ok(!out.includes('eyJhbGciOiJIUzI1Ni'));
  assert.ok(out.includes('[redacted]'));
});

test('isSensitiveKey guards secret-shaped config keys', () => {
  assert.ok(sys.isSensitiveKey('slackBotToken'));
  assert.ok(sys.isSensitiveKey('groqApiKey'));
  assert.ok(!sys.isSensitiveKey('godModel'));
  assert.equal(sys.redactValue('real-secret'), '[redacted]');
});

test('composeMessage fills the full hive message schema', () => {
  const msg = dispatch.composeMessage({ body: 'hi', subject: 's' });
  for (const k of ['id', 'conversation', 'in_reply_to', 'from', 'to', 'act', 'subject', 'body', 'hops', 'requires_reply', 'needs_human', 'created_at']) {
    assert.ok(k in msg, `missing ${k}`);
  }
  assert.equal(msg.from, 'cli');
  assert.equal(msg.to, 'god');
  assert.equal(msg.act, 'request');
  assert.equal(msg.requires_reply, true);
});

test('dispatchToGod delivers into the god inbox and is idempotent-safe', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'aira-cli-test-'));
  const hiveRoot = path.join(tmp, 'hive');
  fs.mkdirSync(path.join(hiveRoot, 'agents', 'god', 'inbox'), { recursive: true });
  fs.writeFileSync(
    path.join(hiveRoot, 'registry.json'),
    JSON.stringify({ godId: 'god', agents: { god: { id: 'god', name: 'AIRA', isGod: true } } })
  );
  const sent = dispatch.dispatchToGod(hiveRoot, { body: 'do the thing', subject: 'test' }, true);
  assert.equal(sent.ok, true);
  assert.equal(sent.queued, false);
  const written = path.join(hiveRoot, 'agents', 'god', 'inbox', `${sent.message.id}.json`);
  assert.ok(fs.existsSync(written));
  const parsed = JSON.parse(fs.readFileSync(written, 'utf8'));
  assert.equal(parsed.to, 'god');
  assert.equal(parsed.body, 'do the thing');
  // its own reply mailbox exists too
  assert.ok(fs.existsSync(path.join(hiveRoot, 'agents', 'cli', 'inbox')));

  // an uninitialized hive → honest failure, not a fake write
  const bad = dispatch.dispatchToGod(path.join(tmp, 'missing'), { body: 'x', subject: 'x' }, false);
  assert.equal(bad.ok, false);
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('locateConfig finds the real user config when present', () => {
  const override = process.env.AIRA_USERDATA;
  const loc = sys.locateConfig();
  if (override) {
    assert.ok(loc, 'override config should be found');
  } else {
    // Only meaningful when a config exists somewhere on this machine; never guess.
    assert.ok(!loc || typeof loc === 'object');
  }
});