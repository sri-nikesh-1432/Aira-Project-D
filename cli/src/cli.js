'use strict';

/**
 * cli.js — `aira` entry: argument parsing, command dispatch, interactive mode.
 *
 * architecture: a SECOND, isolated interface to the existing AIRA desktop
 * app. It never changes the Electron app; the mechanism is
 * documented in cli/README.md (Communication) and in dispatch.js.
 */

const fs = require('node:fs');
const path = require('node:path');
const readline = require('node:readline');

const {
  EXIT,
  harness,
  isCoreRunning,
  planetGlyph,
  truncate,
  redactSecrets,
  title,
  note
} = require('./sys.js');
const {
  dispatchToGod,
  awaitReply,
  archiveReply,
  preview
} = require('./dispatch.js');
const commands = require('./commands.js');

const VERSION = (() => {
  try {
    return require('../package.json').version;
  } catch {
    return '0.0.0';
  }
})();

const KNOWN = new Set([
  'help', 'version', 'open', 'status', 'agents', 'run', 'chat', 'agent',
  'workspace', 'provider', 'config', 'task', 'memory', 'git'
]);

const VALUE_OPTS = new Set([
  '--agent', '-A', '--assignee', '--status', '--timeout', '--results',
  '--cwd', '-m', '--message'
]);

function parseArgs(argv) {
  const positional = [];
  const options = {};
  let json = false;
  let help = false;
  let version = false;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--json') { json = true; continue; }
    if (arg === '--help' || arg === '-h') { help = true; continue; }
    if (arg === '--version' || arg === '-v') { version = true; continue; }
    if (arg === '--no-wait') { options['--no-wait'] = true; continue; }
    if (arg.startsWith('--') && arg.includes('=')) {
      const eq = arg.indexOf('=');
      options[arg.slice(0, eq)] = arg.slice(eq + 1);
      continue;
    }
    if (VALUE_OPTS.has(arg)) {
      options[arg] = argv[i + 1];
      i++;
      continue;
    }
    if (arg.startsWith('-') && arg !== '-') {
      options[arg] = true;
      continue;
    }
    positional.push(arg);
  }
  return { positional, options, flags: { json, help, version }, raw: argv.join(' ') };
}

// ---------------------------------------------------------------------------
// help / version
// ---------------------------------------------------------------------------

function showHelp() {
  console.log(`AIRA CLI

Usage:
  aira <command> [options]

Commands:

  chat            Interactive conversation with AIRA
  run "<task>"    Give AIRA a task ("aira \\"build this\\"" also works)
                  --agent <planet>  route to a specific planet
                  --no-wait         dispatch and exit (no reply polling)
  agent <planet> "<task>"   Route a task to one planet explicitly
  agents          View AIRA and the planets
  status          View AIRA status (core, workspace, provider, planets)
  open            Launch AIRA Desktop (the existing Electron app)
  workspace       Manage workspace  (status | path | list | use <path>)
  provider        Provider info     (list | status | current)
  task            Task ledger       (list | show <id> | create | cancel)
  memory          Memory            (status | search "<query>")
  config          Config            (list | get <key> | set <key> <value>)
  git             Git operations    (status | diff | log | commit)
  version         Show CLI version
  help            Show this help

Options:
  --json          Machine-readable JSON output (status, agents, task, provider,
                  workspace, memory, config, git status, run --json)
  --help, -h      Show help
  --version, -v   Show version

Exit codes:
  0 success   1 failure   2 bad usage   3 AIRA unavailable
  4 auth/no-secrets-violation   5 workspace error

Run \`aira\` with no command for the interactive session.
`);
}

function showVersion() {
  let compat = '';
  try {
    const repo = findRepoPackage();
    if (repo) compat = ` · compatible with AIRA ${repo.version}`;
  } catch {
    /* ignore */
  }
  console.log(`aira ${VERSION}${compat}`);
}

function findRepoPackage() {
  for (const start of [process.cwd(), path.resolve(__dirname, '..', '..')]) {
    let dir = start;
    for (let i = 0; i < 6; i++) {
      try {
        const pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
        if (pkg.name === 'munder-difflin') return pkg;
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

// ---------------------------------------------------------------------------
// run
// ---------------------------------------------------------------------------

async function cmdRun(raw, ctx) {
  const { positional, options, flags } = ctx;
  let text;
  let routing;
  if (raw) {
    text = raw;
    routing = options['--agent'] || options['-A'] || null;
  } else {
    const args = positional.slice(1);
    if (!args.length) {
      return usage('aira run "<task>"  (or: aira "<task>")');
    }
    text = args.join(' ');
    routing = options['--agent'] || options['-A'] || null;
  }

  const h = harness();
  if (!h || !h.hiveRoot) return fail(EXIT.UNAVAILABLE, 'could not locate AIRA Desktop state. Run `aira open` once, then retry.');
  const running = isCoreRunning(h.hiveRoot);
  const subject = `CLI request: ${truncate(text.replace(/\n/g, ' ').trim(), 80)}`;
  const sent = dispatchToGod(h.hiveRoot, { body: text, subject, routing: routing || undefined }, running);
  if (!sent.ok) return fail(EXIT.UNAVAILABLE, sent.error);

  const timeoutMs = Number(options['--timeout']) > 0 ? Number(options['--timeout']) : 120_000;
  const noWait = Object.prototype.hasOwnProperty.call(options, '--no-wait') || flags.json;

  if (flags.json) {
    const result = { sent: true, messageId: sent.message.id, conversation: sent.message.conversation, queued: sent.queued, to: sent.godId };
    if (!running) result.queueNote = 'AIRA Desktop is not running; the message waits in her inbox until next boot.';
    console.log(JSON.stringify(result, null, 2));
    return EXIT.OK;
  }

  if (sent.queued) {
    console.log(`Message queued to AIRA's inbox (${sent.godId}) — AIRA Desktop is not running.`);
    console.log(note('The request will be processed on her next boot. Run `aira open` to launch.'));
    return EXIT.OK;
  }

  console.log(`Delivered to AIRA (id ${sent.message.id.slice(0, 12)}).` + (noWait ? '' : ' Watching for the reply...'));
  if (noWait) return EXIT.OK;

  const seen = new Set();
  const onTick = (fleet) => {
    if (!fleet || !Array.isArray(fleet.agents)) return;
    for (const a of fleet.agents) {
      const busy = a.lastActiveSecAgo !== null && a.lastActiveSecAgo !== undefined && a.lastActiveSecAgo < 60;
      if (!busy) continue;
      const tool = a.lastTool ? ` (${a.lastTool})` : '';
      const line = `  ${planetGlyph(a.id)} ${a.name || a.id} working${tool}`;
      if (!seen.has(line)) {
        seen.add(line);
        console.log(line);
      }
    }
  };

  const { reply, replies } = await awaitReply({
    hiveRoot: h.hiveRoot,
    godId: sent.godId,
    conversation: sent.message.conversation,
    timeoutMs,
    onTick
  });

  for (const r of replies) {
    if (r.body) console.log(`\nAIRA > ${preview(redactSecrets(r.body))}`);
    else if (r.subject) console.log(`\nAIRA > ${preview(redactSecrets(r.subject))}`);
    archiveReply(h.hiveRoot, r.id);
  }

  if (!reply) {
    console.log(`\nNo reply within ${Math.round(timeoutMs / 1000)}s. The request is still in AIRA's inbox — she keeps working in the background.`);
  }
  return EXIT.OK;
}

// ---------------------------------------------------------------------------
// chat
// ---------------------------------------------------------------------------

function fail(code, message) {
  console.error(`[aira] ${message}`);
  return code;
}

function usage(message) {
  console.error(`[aira] ${message}`);
  return EXIT.USAGE;
}

function makeChat(kind) {
  return async (ctx) => {
    const h = harness();
    if (!h || !h.hiveRoot) return fail(EXIT.UNAVAILABLE, 'could not locate AIRA Desktop state. Run `aira open` once, then retry.');
    const running = isCoreRunning(h.hiveRoot);
    if (!running) {
      return fail(EXIT.UNAVAILABLE, 'AIRA Desktop is not running. Run `aira open` to launch it, then retry.');
    }

    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    let conversation = null;
    let godId = null;
    const timeoutMs = Number(ctx.options['--timeout']) > 0 ? Number(ctx.options['--timeout']) : 300_000;

    const prompt = kind === 'chat' ? 'You > ' : 'AIRA > ';
    rl.setPrompt(prompt);

    if (kind === 'chat') {
      console.log(title('AIRA CLI'));
      console.log('  Connected to AIRA. Type your message; `exit` or Ctrl+C to quit.');
    } else {
      console.log(`╭──────────────────────────────────────────╮
│                  AIRA                    │
│          Command Line Interface          │
╰──────────────────────────────────────────╯`);
      console.log('  Type a request, or a slash command (/help /status /agents /task /provider /workspace /git /memory /open /version /exit).');
    }
    console.log('');

    const dispatchAndReply = async (text) => {
      const subject = `CLI chat: ${truncate(text.replace(/\n/g, ' ').trim(), 80)}`;
      const sent = dispatchToGod(h.hiveRoot, { body: text, subject }, true);
      if (!sent.ok) {
        console.error(`[aira] ${sent.error}`);
        return;
      }
      godId = sent.godId;
      conversation = conversation || sent.message.conversation;
      console.log('  (waiting for AIRA...)');
      const { replies } = await awaitReply({
        hiveRoot: h.hiveRoot,
        godId,
        conversation,
        timeoutMs,
        onTick: null
      });
      for (const r of replies) {
        if (r.body) console.log(`\nAIRA > ${preview(redactSecrets(r.body))}`);
        else if (r.subject) console.log(`\nAIRA > ${preview(redactSecrets(r.subject))}`);
        archiveReply(h.hiveRoot, r.id);
      }
      if (!replies.length) console.log('  (no reply yet — AIRA is busy; keep going or wait a moment)');
    };

    const handleSlash = async (line) => {
      const [word, ...rest] = line.trim().split(/\s+/);
      const sub = rest.join(' ');
      switch (word) {
        case '/help': showHelp(); break;
        case '/version': showVersion(); break;
        case '/status': await commands.cmdStatus({ args: sub ? sub.split(' ') : [], options: {}, flags: {} }); break;
        case '/agents': await commands.cmdAgents({ args: [], options: {}, flags: {} }); break;
        case '/task': await commands.cmdTask({ args: sub ? sub.split(' ') : ['list'], options: {}, flags: {} }); break;
        case '/provider': await commands.cmdProvider({ args: sub ? sub.split(' ') : ['status'], options: {}, flags: {} }); break;
        case '/workspace': await commands.cmdWorkspace({ args: sub ? sub.split(' ') : ['status'], options: {}, flags: {} }); break;
        case '/memory': await commands.cmdMemory({ args: sub ? sub.split(' ') : ['status'], options: {}, flags: {} }); break;
        case '/git': await commands.cmdGit({ args: sub ? sub.split(' ') : [], options: {}, flags: {} }); break;
        case '/open': await commands.cmdOpen({ args: [], options: {}, flags: {} }); break;
        case '/exit':
        case '/quit': rl.close(); return 'exit';
        default:
          console.error(`[aira] unknown slash command: ${word} (try /help)`);
      }
      return null;
    };

    return await new Promise((resolve) => {
      let exited = false;
      const done = (code) => {
        if (exited) return;
        exited = true;
        rl.close();
        resolve(code);
      };

      rl.on('line', async (line) => {
        rl.pause();
        const trimmed = line.trim();
        try {
          if (!trimmed) { rl.resume(); return; }
          if (kind === 'chat' && /^(exit|quit|bye)$/i.test(trimmed)) {
            console.log('bye.');
            done(EXIT.OK);
            return;
          }
          if (trimmed.startsWith('/')) {
            const r = await handleSlash(trimmed);
            if (r === 'exit') { done(EXIT.OK); return; }
          } else {
            await dispatchAndReply(trimmed);
          }
        } catch (e) {
          console.error(`[aira] ${e && e.stack ? e.stack : e}`);
        }
        if (!exited) rl.resume();
      });

      rl.on('SIGINT', () => {
        console.log('\nbye.');
        done(EXIT.OK);
      });

      rl.on('close', () => done(EXIT.OK));
      rl.prompt();
    });
  };
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------

async function main(argv) {
  const { positional, options, flags } = parseArgs(argv);
  const cmd = positional[0];

  if (flags.help) { showHelp(); return EXIT.OK; }
  if (flags.version) { showVersion(); return EXIT.OK; }
  if (!cmd || cmd === 'interactive') {
    if (!cmd) { const chat = makeChat('interactive'); return chat({ options, flags }); }
    showHelp();
    return EXIT.OK;
  }

  // `aira "<free text>"` → treat as a run request (spec §11).
  if (!KNOWN.has(cmd)) {
    return cmdRun(argv.join(' '), { positional: [cmd, ...positional.slice(1)], options, flags });
  }

  switch (cmd) {
    case 'help': showHelp(); return EXIT.OK;
    case 'version': showVersion(); return EXIT.OK;
    case 'open': return commands.cmdOpen({ args: positional.slice(1), options, flags });
    case 'status': return commands.cmdStatus({ args: positional.slice(1), options, flags });
    case 'agents': return commands.cmdAgents({ args: positional.slice(1), options, flags });
    case 'run': return cmdRun(null, { positional, options, flags });
    case 'chat': { const chat = makeChat('chat'); return chat({ options, flags }); }
    case 'agent': {
      const agent = positional[1];
      const text = positional.slice(2).join(' ').trim();
      if (!agent || !text) return usage('usage: aira agent <planet> "<task>"');
      return cmdRun(text, { positional, options: Object.assign({}, options, { '--agent': agent }), flags });
    }
    case 'workspace': return commands.cmdWorkspace({ args: positional.slice(1), options, flags });
    case 'provider': return commands.cmdProvider({ args: positional.slice(1), options, flags });
    case 'config': return commands.cmdConfig({ args: positional.slice(1), options, flags });
    case 'task': return commands.cmdTask({ args: positional.slice(1), options, flags });
    case 'memory': return commands.cmdMemory({ args: positional.slice(1), options, flags });
    case 'git': return commands.cmdGit({ args: positional.slice(1), options, flags });
    default:
      return usage(`unknown command: ${cmd} (run \`aira help\` to see commands)`);
  }
}

module.exports = { main, parseArgs, VERSION, KNOWN };