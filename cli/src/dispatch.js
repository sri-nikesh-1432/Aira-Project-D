'use strict';

/**
 * dispatch.js — sending work to AIRA and reading her replies.
 *
 * Reuses the harness's OWN messaging fabric, no second AI system and no new
 * server: a request is one HiveMessage JSON written into
 * `<hive>/agents/<godId>/inbox/<id>.json` — byte-for-byte the protocol the main
 * process uses in `hive.send()` — and replies arrive in the CLI's own mailbox
 * `<hive>/agents/cli/inbox/`. If AIRA Desktop isn't running the message simply
 * sits in the inbox until she next boots (the harness's durable semantics).
 */

const fs = require('node:fs');
const path = require('node:path');

const {
  EXIT,
  exists,
  makeMsgId,
  makeConvId,
  godIdFrom,
  readJsonSafe,
  readTextSafe,
  redactSecrets
} = require('./sys.js');

const SENDER = 'cli';
const CLIENT_INBOX_REL = path.join('agents', SENDER, 'inbox');

function clientInboxDir(hiveRoot) {
  return path.join(hiveRoot, CLIENT_INBOX_REL);
}

function ensureClientMailbox(hiveRoot) {
  if (!exists(hiveRoot)) return false;
  const inbox = clientInboxDir(hiveRoot);
  try {
    fs.mkdirSync(inbox, { recursive: true });
    fs.mkdirSync(path.join(inbox, '.done'), { recursive: true });
    return true;
  } catch {
    return false;
  }
}

/** Compose a full HiveMessage matching the harness message schema. */
function composeMessage({ to = 'god', act = 'request', subject, body, from = SENDER }) {
  return {
    id: makeMsgId(),
    conversation: makeConvId(),
    in_reply_to: null,
    from,
    to,
    act,
    subject: subject ?? '',
    body: body ?? '',
    hops: 0,
    requires_reply: ['request', 'query', 'propose', 'ask'].includes(act),
    needs_human: false,
    created_at: new Date().toISOString()
  };
}

/**
 * Hand a request to AIRA through her inbox. Returns
 * `{ ok, queued, message, godId, inboxPath, error? }`.
 * `queued` is true when the core is not running (mail waits for next boot).
 */
function dispatchToGod(hiveRoot, { body, subject, routing }, coreRunning) {
  if (!exists(hiveRoot)) {
    return {
      ok: false,
      error: 'no hive found — is AIRA Desktop running? run `aira open` first'
    };
  }
  const godId = godIdFrom(hiveRoot);
  const godInbox = path.join(hiveRoot, 'agents', godId, 'inbox');
  if (!exists(godInbox)) {
    return {
      ok: false,
      error: `AIRA's inbox (${godInbox}) does not exist — the hive may be incomplete`
    };
  }
  ensureClientMailbox(hiveRoot);

  const body2 = routing
    ? `${body}\n\n(CLI operator request — the operator asked for this to be routed to the "${routing}" planet. Either route it to that planet or, if that is clearly the wrong owner, use the planet whose role fits best.)`
    : body;

  const message = composeMessage({ to: 'god', act: 'request', subject, body: body2 });
  const file = path.join(godInbox, `${message.id}.json`);

  // tmp + rename so the app never observes a half-written message.
  const tmp = `${file}.tmp-${process.pid}`;
  try {
    fs.writeFileSync(tmp, JSON.stringify(message, null, 2), 'utf8');
    fs.renameSync(tmp, file);
  } catch (e) {
    return { ok: false, error: `could not write message: ${e && e.message ? e.message : e}` };
  }
  return { ok: true, queued: !coreRunning, message, godId, inboxPath: file };
}

/** Every reply a running god has sent back to the CLI, oldest first. */
function collectReplies(hiveRoot, conversation, godId) {
  const inbox = clientInboxDir(hiveRoot);
  if (!exists(inbox)) return [];
  const out = [];
  for (const f of fs.readdirSync(inbox)) {
    if (!f.endsWith('.json')) continue;
    const full = path.join(inbox, f);
    const msg = readJsonSafe(full, null);
    if (!msg) continue;
    if (conversation && msg.conversation !== conversation) continue;
    out.push(msg);
  }
  out.sort((a, b) => String(a.created_at ?? '').localeCompare(String(b.created_at ?? '')));
  return out;
}

/** Archive a processed reply into inbox/.done, matching agent convention. */
function archiveReply(hiveRoot, msgId) {
  try {
    fs.renameSync(
      path.join(clientInboxDir(hiveRoot), `${msgId}.json`),
      path.join(clientInboxDir(hiveRoot), '.done', `${msgId}.json`)
    );
  } catch {
    /* already gone */
  }
}

function preview(text, n = 800) {
  return typeof text === 'string' && text.length > n ? `${text.slice(0, n)}\n\u2026 (truncated)` : text;
}

/**
 * Poll for AIRA's reply. Every tick the caller also sees live fleet state to
 * render progress (spec §12) — real fields from fleet.json, never invented.
 */
async function awaitReply({ hiveRoot, godId, conversation, timeoutMs, onTick }) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const replies = collectReplies(hiveRoot, conversation, godId);
    if (replies.length) return { reply: replies[replies.length - 1], replies };
    if (onTick) {
      const fleet = readJsonSafe(path.join(hiveRoot, 'fleet.json'), null);
      onTick(fleet);
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
  return { reply: null, replies: [] };
}

module.exports = {
  SENDER,
  ensureClientMailbox,
  composeMessage,
  dispatchToGod,
  collectReplies,
  archiveReply,
  awaitReply,
  preview,
  EXIT
};