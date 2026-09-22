'use strict';

/**
 * sys.js — plumbing for the AIRA CLI.
 *
 * The CLI is a SECOND, isolated interface to the existing AIRA desktop app.
 * desktop harness. It never edits the Electron app: every fact below is read
 * from the same on-disk state the main process itself writes, and the only
 * writes it makes reuse the harness's own file formats (config.json,
 * hive/tasks.json, and the hive message inbox). See README.md for the mapping.
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { randomBytes } = require('node:crypto');

/** Meaningful exit codes (spec §23). */
const EXIT = Object.freeze({
  OK: 0,
  FAIL: 1,
  USAGE: 2,
  UNAVAILABLE: 3,
  AUTH: 4,
  WORKSPACE: 5
});

const USERDATA_APP_NAMES = ['AIRA', 'aira-project-d', 'munder-difflin', 'Munder Difflin'];

// ---------------------------------------------------------------------------
// paths / locating the harness
// ---------------------------------------------------------------------------

function expandHome(p) {
  if (typeof p !== 'string' || !p) return p;
  if (p === '~') return os.homedir();
  if (p.startsWith('~/') || p.startsWith('~\\')) {
    return path.join(os.homedir(), p.slice(2));
  }
  return p;
}

/** Candidate Electron userData folders (dev + packaged name) per platform. */
function candidateUserDataDirs() {
  const home = os.homedir();
  const names = USERDATA_APP_NAMES;
  let base;
  if (process.platform === 'win32') base = process.env.APPDATA;
  else if (process.platform === 'darwin') base = path.join(home, 'Library', 'Application Support');
  else base = process.env.XDG_CONFIG_HOME || path.join(home, '.config');
  if (!base) return [];
  return names.map((name) => path.join(base, name));
}

/** The most recent config.json among the candidates (+ env override). */
function locateConfig() {
  const override = process.env.AIRA_USERDATA;
  const dirs = override ? [override] : candidateUserDataDirs();
  let best = null;
  for (const dir of dirs) {
    const file = path.join(dir, 'config.json');
    let st;
    try {
      st = fs.statSync(file);
    } catch {
      continue;
    }
    if (!st.isFile()) continue;
    if (!best || st.mtimeMs > best.mtimeMs) {
      best = { path: file, dir, mtimeMs: st.mtimeMs };
    }
  }
  return best;
}

function readJsonSafe(file, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

function readTextSafe(file, fallback = '') {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch {
    return fallback;
  }
}

function exists(dir) {
  try {
    return fs.statSync(dir).isDirectory();
  } catch {
    return false;
  }
}

/** Write JSON atomically (tmp + rename), mirroring the harness's writeJson. */
function writeJsonAtomic(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}-${randomBytes(2).toString('hex')}`;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2), 'utf8');
  fs.renameSync(tmp, file);
}

/** Load config.json + derive harnessHome + hiveRoot. Returns null when absent. */
function harness() {
  const loc = locateConfig();
  if (!loc) return null;
  const cfg = readJsonSafe(loc.path, null);
  if (!cfg) return null;
  const harnessHome = cfg.harnessHome ? path.resolve(expandHome(cfg.harnessHome)) : null;
  const hiveRoot = harnessHome ? path.join(harnessHome, 'hive') : null;
  return { configPath: loc.path, userDataDir: loc.dir, config: cfg, harnessHome, hiveRoot };
}

/** Fresh enough to be the live app's heartbeat → "Core: Running". */
function isCoreRunning(hiveRoot) {
  if (!hiveRoot || !exists(hiveRoot)) return false;
  const now = Date.now();
  for (const [rel, ageMs] of [
    ['fleet.json', 25_000],
    ['log.jsonl', 35_000]
  ]) {
    try {
      const st = fs.statSync(path.join(hiveRoot, rel));
      if (now - st.mtimeMs < ageMs) return true;
    } catch {
      /* missing → try the next signal */
    }
  }
  return false;
}

function hiveFacts(hiveRoot) {
  const registry = hiveRoot ? readJsonSafe(path.join(hiveRoot, 'registry.json'), null) : null;
  const fleet = hiveRoot ? readJsonSafe(path.join(hiveRoot, 'fleet.json'), null) : null;
  const tasks = hiveRoot ? readJsonSafe(path.join(hiveRoot, 'tasks.json'), null) : null;
  return {
    hiveRoot,
    registry,
    fleet,
    tasks,
    board: hiveRoot ? readTextSafe(path.join(hiveRoot, 'board.md')) : ''
  };
}

// ---------------------------------------------------------------------------
// message identity (mirrors the harness's stamp()/shortRand() + message schema)
// ---------------------------------------------------------------------------

function stamp() {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

function makeMsgId() {
  return `${stamp()}-${randomBytes(3).toString('hex')}`;
}

function makeConvId() {
  return `conv-${randomBytes(3).toString('hex')}`;
}

/** god id from the registry, mirroring hive.routeMessage's godId resolution. */
function godIdFrom(hiveRoot) {
  const reg = readJsonSafe(path.join(hiveRoot, 'registry.json'), null);
  if (reg && typeof reg.godId === 'string' && reg.godId) return reg.godId;
  if (reg && reg.agents && typeof reg.agents.god === 'object') return 'god';
  return 'god';
}

// ---------------------------------------------------------------------------
// derived planet state (computed from fleet.json / registry.json, never guessed)
// ---------------------------------------------------------------------------

function planetGlyph(id) {
  const glyphs = {
    god: '\u2726',
    mercury: '\u263F',
    venus: '\u2640',
    mars: '\u2642',
    earth: '\u2641',
    jupiter: '\u2643',
    saturn: '\u2644',
    uranus: '\u2645',
    neptune: '\u2646',
    pluto: '\u2647'
  };
  return glyphs[id] || '\u2022';
}

function planetState(agent, fta, coreRunning) {
  if (agent && agent.parked) return 'parked';
  if (!coreRunning) return agent.status ?? 'offline';
  if (!fta) return 'idle';
  if (fta.onHold) return 'paused';
  if (typeof fta.breaker === 'string' && fta.breaker !== 'healthy') return 'paused';
  if (typeof fta.breaker === 'number' && fta.breaker > 0) return 'paused';
  if (fta.lastActiveSecAgo === null || fta.lastActiveSecAgo === undefined) return 'idle';
  return fta.lastActiveSecAgo < 60 ? 'working' : 'idle';
}

// ---------------------------------------------------------------------------
// redaction — never leak keys/tokens/credentials into terminal output
// ---------------------------------------------------------------------------

const SENSITIVE_KEY = /(token|secret|password|passwd|apikey|api_key|credential|signing)/i;

function isSensitiveKey(key) {
  return SENSITIVE_KEY.test(String(key));
}

function redactValue(value) {
  if (value === undefined || value === null || value === '') return value;
  return '[redacted]';
}

/** Conservative secret-shape scrubber for free text (bodies, logs). */
function redactSecrets(text) {
  if (typeof text !== 'string' || !text) return text;
  let s = text;
  s = s.replace(/-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z0-9 ]*PRIVATE KEY-----/g, '[redacted]');
  s = s.replace(/\beyJ[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{6,}/g, '[redacted]');
  s = s.replace(/\b(?:sk|pk|ghp|gho|xox[baprs])-[A-Za-z0-9_-]{8,}\b/g, '[redacted]');
  s = s.replace(/\bBearer\s+[A-Za-z0-9._~+/=-]{12,}\b/gi, 'Bearer [redacted]');
  s = s.replace(/\b(api[_-]?key|secret|token|password)\b[=:]\s*[^\s,;]+/gi, '$1=[redacted]');
  s = s.replace(/https?:\/\/[^@\s/]+:[^@\s/]+@/g, '://[redacted]@');
  return s;
}

// ---------------------------------------------------------------------------
// console output helpers
// ---------------------------------------------------------------------------

function title(str) {
  return `\n${str}\n`;
}

function note(str) {
  return `  ${str}`;
}

function truncate(str, n) {
  if (typeof str !== 'string') return '';
  return str.length > n ? `${str.slice(0, n - 1)}\u2026` : str;
}

module.exports = {
  EXIT,
  expandHome,
  candidateUserDataDirs,
  locateConfig,
  readJsonSafe,
  readTextSafe,
  exists,
  writeJsonAtomic,
  harness,
  isCoreRunning,
  hiveFacts,
  makeMsgId,
  makeConvId,
  stamp,
  godIdFrom,
  planetGlyph,
  planetState,
  isSensitiveKey,
  redactValue,
  redactSecrets,
  title,
  note,
  truncate
};