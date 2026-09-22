'use strict';

/**
 * commands.js — `aira <command>` implementations.
 *
 * Every command reads REAL harness state (config.json, registry.json,
 * fleet.json, tasks.json, board.md) or performs a real action against those
 * same files. Nothing is invented; capabilities that cannot be safely reached
 * from the CLI report that honestly instead of faking a result.
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');

const {
  EXIT,
  expandHome,
  exists,
  harness,
  isCoreRunning,
  hiveFacts,
  godIdFrom,
  isSensitiveKey,
  redactValue,
  redactSecrets,
  truncate,
  title,
  note
} = require('./sys.js');

// ---------------------------------------------------------------------------
// shared helpers
// ---------------------------------------------------------------------------

function fail(code, message) {
  console.error(`[aira] ${message}`);
  return code;
}

/** Resolve + validate the harness; exits 3 when AIRA state is unavailable. */
function harnessOrUnavailable() {
  const h = harness();
  if (!h || !h.harnessHome) return fail(EXIT.UNAVAILABLE, 'could not locate AIRA Desktop state (config.json). Run `aira open` once, then retry.');
  if (!exists(path.join(h.harnessHome, 'hive'))) return fail(EXIT.UNAVAILABLE, 'AIRA hive not found under ' + h.harnessHome + '. Is the desktop app set up?');
  return h;
}

function jsonOr(data, flags) {
  if (flags.json) {
    console.log(JSON.stringify(data, null, 2));
    return EXIT.OK;
  }
  return data;
}

function flagValue(opts, key) {
  const v = opts.options[key];
  return Array.isArray(v) ? v[v.length - 1] : v;
}

// ---------------------------------------------------------------------------
// status
// ---------------------------------------------------------------------------

function cmdStatus(opts) {
  const h = harnessOrUnavailable();
  const running = isCoreRunning(h.hiveRoot);
  const f = hiveFacts(h.hiveRoot);
  const cfg = h.config;

  const planets = [];
  const reg = f.registry;
  if (reg && reg.agents) {
    const fleetById = new Map((f.fleet && Array.isArray(f.fleet.agents) ? f.fleet.agents : []).map((a) => [a.id, a]));
    for (const [id, agent] of Object.entries(reg.agents)) planets.push({
      id,
      name: agent.name || id,
      role: agent.role || '',
      isGod: !!agent.isGod,
      archived: !!agent.archived,
      // Dormant-but-addressable: registered + has a mailbox, but no PTY yet.
      // The lazy-spawn model parks planets between assignments.
      parked: !!agent.parked,
      state: planetStateFor(agent, fleetById.get(id), running),
      provider: agent.provider || null,
      cwd: agent.cwd || null
    });
  }

  if (opts.flags.json) {
    return jsonOr({
      core: { running },
      workspace: { harnessHome: h.harnessHome, hiveRoot: h.hiveRoot },
      provider: {
        provider: cfg.godProvider ?? null,
        model: cfg.godModel ?? null,
        orchestratorMaySpawn: !!cfg.orchestratorMaySpawn
      },
      planets
    }, opts.flags);
  }

  const line = (k, v) => `  ${k.padEnd(12)}${v}`;
  let out = title('AIRA Status');
  out += line('Core:', running ? 'Running' : 'Not running') + '\n';
  out += line('Workspace:', h.harnessHome) + '\n';
  out += line('Provider:', `${cfg.godProvider ?? 'unset'} (configured)`) + '\n';
  out += line('Model:', cfg.godModel ?? 'unset') + '\n';
  out += '\n  Planets:\n';
  for (const p of planets) {
    const marker = p.archived ? ' [archived]' : (p.parked ? ' [parked]' : '');
    const glyph = require('./sys.js').planetGlyph(p.id);
    const state = p.archived ? '-' : p.state;
    out += `  ${glyph} ${p.isGod ? 'AIRA' : p.name}${marker}`.padEnd(30) + `${state}`.padEnd(12) + `${truncate(p.role, 48)}\n`;
  }
  if (!running) out += `\n${note('AIRA Core: Not running')}\n${note('Run `aira open` to launch AIRA Desktop.')}\n`;
  console.log(out);
  return EXIT.OK;
}

function planetStateFor(agent, fta, running) {
  const st = require('./sys.js').planetState(agent, fta, running);
  return st;
}

// ---------------------------------------------------------------------------
// agents
// ---------------------------------------------------------------------------

function cmdAgents(opts) {
  const h = harnessOrUnavailable();
  const f = hiveFacts(h.hiveRoot);
  const running = isCoreRunning(h.hiveRoot);

  const agents = [];
  const reg = f.registry;
  if (reg && reg.agents) {
    const fleetById = new Map((f.fleet && Array.isArray(f.fleet.agents) ? f.fleet.agents : []).map((a) => [a.id, a]));
    for (const [id, agent] of Object.entries(reg.agents)) {
      const fta = fleetById.get(id);
      agents.push({
        id,
        name: agent.name || id,
        role: agent.role || '',
        isGod: !!agent.isGod,
        archived: !!agent.archived,
        parked: !!agent.parked,
        state: planetStateFor(agent, fta, running),
        provider: agent.provider || null,
        cwd: agent.cwd || null,
        tokens: fta ? fta.tokens : null,
        usd: fta ? fta.usd : null,
        lastTool: fta && fta.lastTool ? fta.lastTool : null,
        inboxBacklog: fta ? fta.inboxBacklog : null
      });
    }
  }

  if (opts.flags.json) return jsonOr({ core: { running }, agents }, opts.flags);

  const glyph = require('./sys.js').planetGlyph;
  let out = title('AIRA Agents');
  for (const a of agents) {
    const mark = a.archived ? ' [archived]' : (a.parked ? ' [parked]' : '');
    out += `  ${glyph(a.id)} ${a.isGod ? 'AIRA' : a.name}${a.isGod ? '  Central Orchestrator' : ''}${mark}\n`;
    if (!a.isGod) out += `    ${truncate(a.role || 'planet agent', 60)}\n`;
  }
  if (!running) {
    out += `\n${note('Statuses reflect registry entries; the core is not running, so live fleet state is unavailable.')}\n`;
  }
  console.log(out);
  return EXIT.OK;
}

// ---------------------------------------------------------------------------
// open
// ---------------------------------------------------------------------------

function findRepoRoot() {
  const starts = [process.cwd(), path.resolve(__dirname, '..', '..')];
  for (const start of starts) {
    let dir = start;
    for (let i = 0; i < 6; i++) {
      try {
        const pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
        if (pkg.name === 'munder-difflin' && pkg.main === 'out/main/index.js') return dir;
      } catch {
        /* keep climbing */
      }
      const parent = path.dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
  }
  return null;
}

function packagedCandidates() {
  const list = [];
  if (process.platform === 'win32') {
    const local = process.env.LOCALAPPDATA;
    if (local) {
      list.push(path.join(local, 'Programs', 'AIRA', 'AIRA.exe'));
      list.push(path.join(local, 'Programs', 'aira-project-d', 'AIRA.exe'));
      list.push(path.join(local, 'Programs', 'Munder Difflin', 'Munder Difflin.exe'));
      list.push(path.join(os.homedir(), 'AppData', 'Local', 'AIRA', 'AIRA.exe'));
      list.push(path.join(os.homedir(), 'AppData', 'Local', 'Munder Difflin', 'Munder Difflin.exe'));
    }
    const repo = findRepoRoot();
    if (repo) {
      try {
        for (const f of fs.readdirSync(path.join(repo, 'dist'))) {
          if (/^(AIRA|Munder-Difflin)-.*\.(exe|AppImage)$/.test(f)) list.push(path.join(repo, 'dist', f));
        }
      } catch {
        /* no dist yet */
      }
    }
  } else if (process.platform === 'darwin') {
    list.push('/Applications/AIRA.app');
    list.push('/Applications/Munder Difflin.app');
  } else {
    list.push(path.join(os.homedir(), 'Applications', 'AIRA-x86_64.AppImage'));
    list.push(path.join(os.homedir(), 'Applications', 'Munder-Difflin-x86_64.AppImage'));
  }
  return list.filter((p) => {
    try {
      return fs.existsSync(p);
    } catch {
      return false;
    }
  });
}

function launchDetached(command, args, cwd) {
  const child = spawn(command, args, { cwd, detached: true, stdio: 'ignore', shell: false });
  child.unref();
}

function launchMacApp(appDir) {
  launchDetached('open', [appDir]);
}

function cmdOpen(opts) {
  const override = process.env.AIRA_APP;
  if (override && override.trim()) {
    try {
      launchDetached(process.platform === 'win32' ? 'cmd.exe' : 'sh', process.platform === 'win32'
        ? ['/c', `start "" ${override}`]
        : ['-lc', `${override} >/dev/null 2>&1 &`]);
      console.log('Launching AIRA Desktop (from AIRA_APP).');
      return EXIT.OK;
    } catch (e) {
      return fail(EXIT.FAIL, `could not launch AIRA_APP: ${e && e.message ? e.message : e}`);
    }
  }

  const packaged = packagedCandidates();
  if (packaged.length) {
    const target = packaged[0];
    try {
      if (process.platform === 'darwin') launchMacApp(target);
      else launchDetached(target, []);
      console.log(`Launching AIRA Desktop (${target}).`);
      return EXIT.OK;
    } catch (e) {
      return fail(EXIT.FAIL, `could not launch ${target}: ${e && e.message ? e.message : e}`);
    }
  }

  const repo = findRepoRoot();
  if (repo) {
    const hasDeps = exists(path.join(repo, 'node_modules'));
    if (!hasDeps) {
      console.log(`AIRA Desktop source found at ${repo} but node_modules is missing.`);
      console.log(`  Run \`npm install\` there first, then \`aira open\` again.`);
      return EXIT.FAIL;
    }
    try {
      if (process.platform === 'win32') {
        launchDetached('cmd.exe', ['/d', '/s', '/c', 'npm run dev'], repo);
      } else {
        launchDetached('bash', ['-lc', 'npm run dev >/dev/null 2>&1'], repo);
      }
      console.log('Launching AIRA Desktop from source (`npm run dev`)...');
      console.log(note('First run compiles the renderer — the window opens in a few seconds.'));
      return EXIT.OK;
    } catch (e) {
      return fail(EXIT.FAIL, `could not start dev server: ${e && e.message ? e.message : e}`);
    }
  }

  console.log('No packaged AIRA Desktop installation found, and no source checkout detected.');
  console.log('  Build it with `npm install && npm run dist`, then run `aira open` again.');
  return EXIT.FAIL;
}

// ---------------------------------------------------------------------------
// workspace
// ---------------------------------------------------------------------------

function cmdWorkspace(opts) {
  const sub = opts.args[0] || 'status';
  const h = harness();
  if (!h || !h.harnessHome) {
    return fail(EXIT.UNAVAILABLE, 'no workspace configured — set one up in AIRA Desktop onboarding, then retry.');
  }

  if (sub === 'path') {
    console.log(h.harnessHome);
    return EXIT.OK;
  }

  if (sub === 'list') {
    const repos = h.config.registeredRepos || [];
    const recent = h.config.recentHives || [];
    if (opts.flags.json) return jsonOr({ harnessHome: h.harnessHome, registeredRepos: repos, recentHives: recent }, opts.flags);
    console.log(title('Workspaces'));
    console.log(`  Active:  ${h.harnessHome}`);
    console.log('\n  Registered repos:');
    if (repos.length) for (const r of repos) console.log(note(r));
    else console.log(note('(none)'));
    console.log('\n  Recent hives:');
    if (recent.length) for (const r of recent) console.log(note(r));
    else console.log(note('(none)'));
    return EXIT.OK;
  }

  if (sub === 'use') {
    const target = opts.args[1];
    if (!target) return fail(EXIT.USAGE, 'usage: aira workspace use <path>');
    const running = isCoreRunning(h.hiveRoot);
    if (running) {
      return fail(EXIT.WORKSPACE, 'AIRA Desktop is running — stop it before switching workspaces (the app owns config.json while up).');
    }
    const dir = path.resolve(expandHome(target));
    if (!exists(dir)) return fail(EXIT.WORKSPACE, `not a directory: ${dir}`);
    const cfg = Object.assign({}, h.config);
    cfg.harnessHome = dir;
    const recent = Array.isArray(cfg.recentHives) ? cfg.recentHives.slice() : [];
    recent.unshift(dir);
    cfg.recentHives = Array.from(new Set(recent)).slice(0, 6);
    const { writeJsonAtomic } = require('./sys.js');
    try {
      writeJsonAtomic(h.configPath, cfg);
    } catch (e) {
      return fail(EXIT.WORKSPACE, `could not save config: ${e && e.message ? e.message : e}`);
    }
    console.log(`Workspace set to ${dir}.`);
    if (!exists(path.join(dir, 'hive'))) {
      console.log(note('Note: no hive in that folder yet — it is created the first time AIRA Desktop runs there.'));
    }
    return EXIT.OK;
  }

  // status (default)
  const f = hiveFacts(h.hiveRoot);
  const running = isCoreRunning(h.hiveRoot);
  if (opts.flags.json) {
    return jsonOr({
      core: { running },
      harnessHome: h.harnessHome,
      hiveRoot: h.hiveRoot,
      registeredRepos: h.config.registeredRepos || [],
      recentHives: h.config.recentHives || []
    }, opts.flags);
  }
  const line = (k, v) => `  ${k.padEnd(12)}${v}`;
  let out = title('Workspace Status');
  out += line('Core:', running ? 'Running' : 'Not running') + '\n';
  out += line('Harness:', h.harnessHome) + '\n';
  out += line('Hive:', f.hiveRoot) + '\n';
  out += line('Agents:', f.registry && f.registry.agents ? Object.keys(f.registry.agents).length : 0) + '\n';
  if (!running) out += `\n${note('Run `aira open` to launch AIRA Desktop.')}\n`;
  console.log(out);
  return EXIT.OK;
}

// ---------------------------------------------------------------------------
// provider
// ---------------------------------------------------------------------------

function cmdProvider(opts) {
  const sub = opts.args[0] || 'status';
  const h = harnessOrUnavailable();
  const cfg = h.config;

  if (sub === 'list') {
    let presets;
    try {
      presets = require('./providers.json');
    } catch {
      presets = [];
    }
    if (opts.flags.json) return jsonOr({ presets }, opts.flags);
    console.log(title('Providers'));
    for (const p of presets) {
      const rec = p.recommendedOrchestratorModel ? `  (orchestrator default: ${p.recommendedOrchestratorModel})` : '';
      console.log(`  ${p.id.padEnd(14)}${p.label}${rec}`);
    }
    console.log(`\n${note('Configured engine: ' + (cfg.godProvider ?? 'unset') + ' / ' + (cfg.godModel ?? 'unset'))}`);
    return EXIT.OK;
  }

  if (sub === 'status' || sub === 'current') {
    const detail = {
      provider: cfg.godProvider ?? null,
      model: cfg.godModel ?? null,
      defaultModel: cfg.defaultModel ?? null,
      orchestratorMaySpawn: !!cfg.orchestratorMaySpawn,
      providerBaseUrls: cfg.providerBaseUrls || {}
    };
    if (opts.flags.json) return jsonOr(detail, opts.flags);
    const line = (k, v) => `  ${k.padEnd(16)}${v}`;
    let out = title(sub === 'current' ? 'AIRA Provider' : 'Provider Status');
    out += line('Provider:', detail.provider ?? 'unset') + '\n';
    out += line('Model:', detail.model ?? 'unset') + '\n';
    out += line('Default model:', detail.defaultModel ?? 'unset') + '\n';
    out += line('Auto-spawn:', detail.orchestratorMaySpawn ? 'on' : 'off') + '\n';
    const urls = Object.entries(detail.providerBaseUrls);
    if (urls.length) {
      out += '\n  Custom base URLs:\n';
      for (const [k, v] of urls) out += `    ${k} = ${redactSecrets(String(v))}\n`;
    }
    out += `\n${note('A provider is "configured" here; live connectivity is only verifiable from the running Desktop app.')}\n`;
    console.log(out);
    return EXIT.OK;
  }

  return fail(EXIT.USAGE, `unknown provider subcommand: ${sub} (use list | status | current)`);
}

// ---------------------------------------------------------------------------
// config
// ---------------------------------------------------------------------------

function cmdConfig(opts) {
  const sub = opts.args[0] || 'list';
  const h = harnessOrUnavailable();
  const cfg = h.config;

  if (sub === 'list') {
    const entries = {};
    const keys = Object.keys(cfg).sort();
    for (const key of keys) {
      const value = cfg[key];
      entries[key] = isSensitiveKey(key) ? redactValue(value) : scrub(value);
    }
    if (opts.flags.json) return jsonOr(entries, opts.flags);
    console.log(title('AIRA Config'));
    for (const [key, value] of Object.entries(entries)) {
      console.log(`  ${key} = ${typeof value === 'string' ? value : JSON.stringify(value)}`);
    }
    console.log(`\n${note(`Config file: ${h.configPath}`)}`);
    return EXIT.OK;
  }

  if (sub === 'get') {
    const key = opts.args[1];
    if (!key) return fail(EXIT.USAGE, 'usage: aira config get <key>');
    if (!(key in cfg)) return fail(EXIT.FAIL, `unknown config key: ${key} (try \`aira config list\`)`);
    const value = cfg[key];
    const rendered = isSensitiveKey(key) ? redactValue(value) : scrub(value);
    console.log(typeof rendered === 'string' ? rendered : JSON.stringify(rendered, null, 2));
    return EXIT.OK;
  }

  if (sub === 'set') {
    const key = opts.args[1];
    const value = opts.args[2];
    if (!key || value === undefined) return fail(EXIT.USAGE, 'usage: aira config set <key> <value>');
    if (isSensitiveKey(key)) {
      return fail(EXIT.AUTH, 'refusing to write secrets through the CLI — set authenticated providers in the Desktop app Settings.');
    }
    const running = isCoreRunning(h.hiveRoot);
    if (running) {
      return fail(EXIT.UNAVAILABLE, 'AIRA Desktop is running — it owns config.json. Stop it, set the key, then relaunch.');
    }
    const parsed = parseValue(value, key);
    const next = Object.assign({}, cfg, { [key]: parsed });
    require('./sys.js').writeJsonAtomic(h.configPath, next);
    console.log(`config ${key} set.`);
    return EXIT.OK;
  }

  return fail(EXIT.USAGE, `unknown config subcommand: ${sub} (use list | get | set)`);
}

function scrub(value) {
  if (typeof value !== 'string') return value;
  return redactSecrets(value);
}

function parseValue(raw, key) {
  if (/^(true|false)$/i.test(raw)) return raw.toLowerCase() === 'true';
  if (/^-?\d+(\.\d+)?$/.test(raw)) return Number(raw);
  if (key === 'harnessHome') return path.resolve(expandHome(raw));
  if (raw.startsWith('{') || raw.startsWith('[')) {
    try {
      return JSON.parse(raw);
    } catch {
      /* keep as string */
    }
  }
  return raw;
}

// ---------------------------------------------------------------------------
// task
// ---------------------------------------------------------------------------

function taskLedger(h) {
  const f = hiveFacts(h.hiveRoot);
  const tasks = f.tasks && Array.isArray(f.tasks.tasks) ? f.tasks.tasks : [];
  return tasks;
}

function cmdTask(opts) {
  const sub = opts.args[0] || 'list';
  const h = harnessOrUnavailable();
  const { writeJsonAtomic } = require('./sys.js');
  const ledgerPath = path.join(h.hiveRoot, 'tasks.json');
  const running = isCoreRunning(h.hiveRoot);

  if (sub === 'list') {
    let tasks = taskLedger(h);
    const statusFilter = flagValue(opts, 'status');
    if (statusFilter) tasks = tasks.filter((t) => String(t.status ?? '') === statusFilter);
    if (opts.flags.json) return jsonOr({ core: { running }, tasks }, opts.flags);
    if (!tasks.length) {
      console.log('Task ledger is empty.');
      return EXIT.OK;
    }
    const counts = {};
    for (const t of tasks) counts[t.status || 'todo'] = (counts[t.status || 'todo'] || 0) + 1;
    let out = title('Task Ledger');
    out += `  ${tasks.length} task(s) — ` +
      Object.entries(counts).map(([k, v]) => `${v} ${k}`).join(', ') + '\n\n';
    for (const t of tasks) {
      const id = truncate(String(t.id ?? '-'), 24);
      const status = String(t.status ?? 'todo').padEnd(8);
      const assignee = truncate(t.assignee || '-', 14);
      out += `  ${id.padEnd(26)}${status}${assignee.padEnd(16)}${truncate(t.title ?? '', 52)}\n`;
    }
    if (!running) out += `\n${note('Note: desktop core not running — these are the on-disk cards.')}\n`;
    console.log(out);
    return EXIT.OK;
  }

  if (sub === 'show') {
    const id = opts.args[1];
    if (!id) return fail(EXIT.USAGE, 'usage: aira task show <id>');
    const task = taskLedger(h).find((t) => t.id === id);
    if (!task) return fail(EXIT.FAIL, `no task with id ${id}`);
    if (opts.flags.json) return jsonOr(task, opts.flags);
    console.log(title(`Task ${id}`));
    for (const [k, v] of Object.entries(task)) {
      if (typeof v === 'object' && v !== null) console.log(`  ${k}: ${JSON.stringify(v, null, 4).replace(/\n/g, '\n    ')}`);
      else console.log(`  ${k}: ${redactSecrets(String(v ?? ''))}`);
    }
    return EXIT.OK;
  }

  if (sub === 'create') {
    const theArgs = opts.args.slice(1);
    const titleText = opts.args[1];
    const assignee = flagValue(opts, 'assignee');
    if (!titleText) return fail(EXIT.USAGE, 'usage: aira task create "<title>" [--assignee <planet-id>]');
    const existing = taskLedger(h);
    const card = {
      id: `cli-${require('./sys.js').stamp()}`,
      title: titleText,
      status: 'todo',
      origin: 'aira-cli',
      createdAt: new Date().toISOString()
    };
    if (assignee) card.assignee = assignee;
    const merged = mergeLedger(existing, card);
    writeJsonAtomic(ledgerPath, { tasks: merged });
    console.log(`Created task ${card.id}.`);
    const name = running ? '' : ' (will be picked up next time AIRA Desktop is running)';
    console.log(note('AIRA sees new cards on her next board review' + name + '.'));
    if (assignee && !assigneeInRegistry(h, assignee)) {
      console.log(note(`Note: "${assignee}" is not in the registry — AIRA may re-assign.`));
    }
    return EXIT.OK;
  }

  if (sub === 'cancel') {
    const id = opts.args[1];
    if (!id) return fail(EXIT.USAGE, 'usage: aira task cancel <id>');
    const tasks = taskLedger(h);
    const index = tasks.findIndex((t) => t.id === id);
    if (index < 0) return fail(EXIT.FAIL, `no task with id ${id}`);
    if (tasks[index].status === 'done') return fail(EXIT.FAIL, `task ${id} is already done`);
    const entry = tasks[index];
    const prevNotes = typeof entry.notes === 'string' ? entry.notes : null;
    const cancelNote = `Cancelled via \`aira task cancel\` at ${new Date().toISOString()}`;
    const next = tasks.slice();
    next[index] = Object.assign({}, entry, {
      status: 'blocked',
      notes: prevNotes ? `${prevNotes}\n\n${cancelNote}` : cancelNote
    });
    writeJsonAtomic(ledgerPath, { tasks: next });
    console.log(`Task ${id} marked blocked (cancelled). AIRA will see the note.`);
    return EXIT.OK;
  }

  return fail(EXIT.USAGE, `unknown task subcommand: ${sub} (use list | show | create | cancel)`);
}

/** Append a card preserving every existing card + every field, like
 *  mergeTaskLedger in the harness. Idempotent by id. */
function mergeLedger(existing, card) {
  if (!existing.some((t) => t.id === card.id)) return existing.concat([card]);
  return existing;
}

function assigneeInRegistry(h, id) {
  const f = hiveFacts(h.hiveRoot);
  return !!(f.registry && f.registry.agents && f.registry.agents[id]);
}

// ---------------------------------------------------------------------------
// git
// ---------------------------------------------------------------------------

function runGit(args, cwd, opts) {
  const res = spawnSync('git', args, { cwd, encoding: 'utf8', shell: false, maxBuffer: 16 * 1024 * 1024 });
  if (res.error) return fail(EXIT.FAIL, `git failed to run: ${res.error.message || res.error}`);
  if (res.stdout) process.stdout.write(opts.flags.json && args[0] === 'status' ? '' : res.stdout);
  if (res.stderr) process.stderr.write(res.stderr);
  return typeof res.status === 'number' ? res.status : EXIT.FAIL;
}

function cmdGit(opts) {
  const gitArgs = opts.args.slice();
  let cwd = process.cwd();

  const cwdIdx = gitArgs.indexOf('--cwd');
  if (cwdIdx >= 0) {
    const dir = gitArgs[cwdIdx + 1];
    if (!dir) return fail(EXIT.USAGE, 'usage: aira git --cwd <dir> <subcommand>');
    cwd = path.resolve(dir);
    gitArgs.splice(cwdIdx, 2);
  }

  const sub = gitArgs[0];
  if (!sub) return fail(EXIT.USAGE, 'usage: aira git <status|diff|log|commit|...> [git options]');
  if (!exists(cwd)) return fail(EXIT.WORKSPACE, `not a directory: ${cwd}`);

  if (sub === 'commit') {
    const msgIdx = gitArgs.indexOf('-m');
    const msgLongIdx = gitArgs.indexOf('--message');
    const msgIdx2 = msgIdx >= 0 ? msgIdx : msgLongIdx;
    if (msgIdx2 < 0 || !gitArgs[msgIdx2 + 1]) {
      return fail(EXIT.USAGE, 'usage: aira git commit -m "<message>"');
    }
    console.log('Committing only — nothing is pushed unless you run `aira git push`.');
    return runGit(gitArgs, cwd, opts);
  }

  if (sub === 'status') {
    if (opts.flags.json) {
      const res = spawnSync('git', ['status', '--porcelain=v1', '-b'], { cwd, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 });
      if (res.error) return fail(EXIT.FAIL, `git failed to run: ${res.error.message || res.error}`);
      return jsonOr(parseGitStatus(res.stdout), opts.flags);
    }
    return runGit(gitArgs, cwd, opts);
  }

  return runGit(gitArgs, cwd, opts);
}

function parseGitStatus(porcelain) {
  const out = { branch: null, ahead: 0, behind: 0, changes: [] };
  const head = porcelain
    .split('\n')
    .filter((l) => l.startsWith('## '))
    .map((l) => l.slice(3))
    .find(() => true);
  if (head) {
    const m = head.match(/^([^\s]+)/);
    out.branch = m ? m[1] : head;
    const ab = head.match(/\[ahead (\d+)\]?.*?behind (\d+)/);
    if (ab) {
      out.ahead = Number(ab[1]);
      out.behind = Number(ab[2]);
    }
  }
  for (const line of porcelain.split('\n')) {
    if (!line || line.startsWith('## ')) continue;
    const XY = line.slice(0, 2);
    const file = line.slice(3);
    out.changes.push({ state: XY.trim(), path: file.replace(/^"(.*)"$/, '$1') });
  }
  return out;
}

// ---------------------------------------------------------------------------
// memory
// ---------------------------------------------------------------------------

function mempalaceBin() {
  const cands = [];
  if (process.platform === 'win32') {
    const probe = spawnSync('where', ['mempalace'], { encoding: 'utf8', timeout: 3000, shell: false });
    if (probe.status === 0) {
      const first = String(probe.stdout).trim().split(/\r?\n/)[0];
      if (first) cands.push(first);
    }
    const span = (p) => `${p}\\mempalace.exe`;
    cands.push(span(os.homedir()), span(process.env.LOCALAPPDATA || ''), span(path.join(os.homedir(), '.local', 'bin')));
    cands.push(span(process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, 'Programs', 'Python', 'Scripts') : ''));
  } else {
    const res = spawnSync(process.env.SHELL || '/bin/sh', ['-lc', 'command -v mempalace'], { encoding: 'utf8', timeout: 3000 });
    if (res.status === 0 && String(res.stdout).trim()) cands.push(String(res.stdout).trim());
    cands.push('/opt/homebrew/bin/mempalace', '/usr/local/bin/mempalace', path.join(os.homedir(), '.local', 'bin', 'mempalace'));
  }
  for (const c of cands) {
    if (!c) continue;
    try {
      if (fs.existsSync(c)) return c;
    } catch {
      /* keep scanning */
    }
  }
  return null;
}

function cmdMemory(opts) {
  const sub = opts.args[0] || 'status';
  const h = harnessOrUnavailable();
  const semantic = !!h.config.semanticMemory;
  const palace = path.join(h.harnessHome, 'palace');
  const palaceExists = exists(palace);

  if (sub === 'status') {
    const bin = mempalaceBin();
    let wingCount = 0;
    let fileCount = 0;
    if (palaceExists) {
      try {
        for (const f of fs.readdirSync(palace)) {
          if (f.startsWith('.')) continue;
          wingCount++;
          fileCount += countFiles(path.join(palace, f));
        }
      } catch {
        /* best-effort stats */
      }
    }
    const detail = {
      enabled: semantic,
      palacePath: palace,
      palaceExists,
      mempalaceAvailable: !!bin,
      wings: wingCount,
      files: fileCount
    };
    if (opts.flags.json) return jsonOr(detail, opts.flags);
    const line = (k, v) => `  ${k.padEnd(18)}${v}`;
    let out = title('AIRA Memory');
    out += line('Semantic memory:', semantic ? 'enabled' : 'disabled') + '\n';
    out += line('Palace:', palace) + '\n';
    out += line('Palace exists:', palaceExists ? 'yes' : 'no') + '\n';
    out += line('mempalace CLI:', bin ? 'found' : 'not installed') + '\n';
    out += line('Wings / files:', `${wingCount} / ${fileCount}`) + '\n';
    if (!semantic) out += `\n${note('Enable "semantic memory" in the Desktop app Settings to search.')}\n`;
    if (!bin) out += `\n${note('Install the mempalace CLI (pip install mempalace) to enable search.')}\n`;
    console.log(out);
    return EXIT.OK;
  }

  if (sub === 'search') {
    const query = opts.args[1];
    if (!query) return fail(EXIT.USAGE, 'usage: aira memory search "<query>" [--results <n>]');
    if (!semantic) return fail(EXIT.UNAVAILABLE, 'semantic memory is disabled in the app config — enable it in Desktop Settings first.');
    if (!palaceExists) return fail(EXIT.UNAVAILABLE, `palace not found at ${palace} — the app mines memory each run when enabled.`);
    const bin = mempalaceBin();
    if (!bin) return fail(EXIT.UNAVAILABLE, 'mempalace CLI not found on PATH — `pip install mempalace` to search.');
    const n = flagValue(opts, 'results') || '5';
    const env = Object.assign({}, process.env, { MEMPALACE_PALACE_PATH: palace });
    const res = spawnSync(bin, ['search', query, '--results', String(n)], { encoding: 'utf8', env, timeout: 60_000 });
    if (res.error) return fail(EXIT.FAIL, `mempalace failed: ${res.error.message || res.error}`);
    if (res.stdout) process.stdout.write(redactSecrets(res.stdout));
    if (res.stderr) process.stderr.write(res.stderr);
    return typeof res.status === 'number' ? (res.status === 0 ? EXIT.OK : EXIT.FAIL) : EXIT.FAIL;
  }

  return fail(EXIT.USAGE, `unknown memory subcommand: ${sub} (use status | search)`);
}

function countFiles(dir) {
  try {
    let n = 0;
    for (const f of fs.readdirSync(dir)) {
      const full = path.join(dir, f);
      try {
        if (fs.statSync(full).isDirectory()) n += countFiles(full);
        else n++;
      } catch {
        /* unreadable entry */
      }
    }
    return n;
  } catch {
    return 0;
  }
}

module.exports = {
  cmdStatus,
  cmdAgents,
  cmdOpen,
  cmdWorkspace,
  cmdProvider,
  cmdConfig,
  cmdTask,
  cmdGit,
  cmdMemory
};