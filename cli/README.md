# AIRA CLI

A terminal interface for **AIRA** — an **additional interface** to the existing Electron desktop application.

The Electron app is **untouched** by the CLI. The CLI is an isolated package (`cli/`) that talks to the harness through the same on-disk state the app itself reads and writes. It is not a second AI system: you keep one AIRA, one planet roster, one task ledger, one memory palace, one provider config.

```
    AIRA
        │
        ├── Electron Desktop App   (unchanged)
        └── AIRA CLI   (this package, `aira`)
```

---

## Installation

From the repository (installs the `aira` command globally on CMD / PowerShell / Windows Terminal / macOS / Linux terminals):

```bash
npm install -g ./cli
```

Then verify:

```bash
aira --version
aira --help
```

To uninstall:

```bash
npm uninstall -g aira-cli
```

No runtime dependencies are needed — the CLI runs on Node ≥ 18 with built-in modules only.

### Local development

From the repo root (does not touch the Electron commands):

```bash
npm run cli            # run the CLI (same as `node cli/bin/aira.js`)
npm run cli:build      # syntax-check every CLI module
npm run cli:test       # CLI unit tests
```

---

## Usage

```bash
aira                          interactive session (requests + /slash commands)
aira <"free text">            shorthand for `aira run`
aira run "<task>"             give AIRA a task
aira run --agent mercury "…"   route to one planet
aira agent mercury "…"        planet-specific routing, explicit
aira chat                     interactive conversation with AIRA
aira status | agents          what's running / the planet roster
aira open                     launch AIRA Desktop (packaged app, else `npm run dev`)
aira workspace status|path|list|use <path>
aira provider list|status|current
aira task list|show <id>|create "<title>"|cancel <id>
aira memory status|search "<query>"
aira config list|get <key>|set <key> <value>
aira git status|diff|log|commit  (git in the current directory)
aira version | help
```

`--json` is available on the read-only commands and on `run`:

```bash
aira status --json
aira agents --json
aira task list --json --status doing
aira git status --json
```

Exit codes: `0` success · `1` failure · `2` bad usage · `3` AIRA unavailable · `4` auth / secret policy blocked · `5` workspace error.

---

## What each command does

### `status` / `agents`
- `Core` is **Running** only when the app's fleet snapshot (`<hive>/fleet.json`) was written within the last ~25s — the desktop heartbeat. Otherwise it honestly reports "Not running" and suggests `aira open`.
- Planet states (`idle` / `working` / `paused` / `offline`) are derived from real `fleet.json` fields (`lastActiveSecAgo`, `onHold`, `breaker`), never guessed.
- `provider` shows the **configured** engine from your config (`godProvider` / `godModel`). Live connectivity is only verifiable from the running app, so the CLI does not claim it.

### `open`
Launches the **existing** AIRA Desktop app — never a second app. Resolution order:
1. `AIRA_APP` environment variable (a path/command to run),
2. a packaged installation (Windows NSIS/portable, macOS `.app`, Linux AppImage),
3. the source checkout in this repository (`npm run dev`). Requires `node_modules` first.

### `run` / `chat` / interactive
Requests are dispatched through **AIRA's own orchestration**: the CLI writes one message into her inbox using the harness's exact HiveMessage protocol (the same `hive.send()` file format the app, Slack, webhooks and voice use). AIRA decides who does the work — and if you pass `--agent <planet>`, the message asks her to route to that planet; she still owns the dispatch.

- If AIRA Desktop is **running**, `run` watches `fleet.json` and prints real agent activity, then prints her reply when it lands in the CLI's mailbox.
- If AIRA Desktop is **not running**, the request is durably **queued** in her inbox and processed on her next boot (the harness's normal durable-mail semantics). `chat` requires the app to be running and exits with guidance otherwise.

### `task`
Reads and writes the **one** on-disk ledger (`<hive>/tasks.json`) that AIRA and the kanban already use — created cards carry `origin: "aira-cli"` and the ledger's merge semantics are respected so no other card's fields are ever lost. There is no second task database.

### `memory`
`memory status` reports the real palace state. `memory search` runs the app's own `mempalace search` against the same palace (`<harnessHome>/palace`), with the same `MEMPALACE_PALACE_PATH` the agents use. If semantic memory is disabled or `mempalace` is not installed, it says so.

### `provider` / `config`
Reads your actual `config.json` (the app's own persisted `HarnessConfig`). `config set` and `workspace use` only run while the desktop app is **stopped** (it owns `config.json` while up), and the CLI refuses to write secret-shaped keys — use the app's Settings for authenticated providers.

### `git`
Passes your arguments through to the local `git` in the current directory (`--cwd` to target another). Nothing is ever pushed automatically; `commit` requires an explicit `-m`.

---

## Communication mechanism

The CLI deliberately creates **no new server and no IPC**: it reuses the harness's on-disk contracts.

| CLI need | Reuses |
| --- | --- |
| locate the harness | Electron `userData/config.json` (dev vs packaged name, most-recent wins) |
| status / roster / fleet | `<harnessHome>/hive/registry.json` + `fleet.json` + `log.jsonl` |
| send work to AIRA | a HiveMessage JSON into `<hive>/agents/<godId>/inbox/<id>.json` |
| read AIRA's replies | `<hive>/agents/cli/inbox/*.json` (the CLI's own reply mailbox) |
| tasks | `<harnessHome>/hive/tasks.json` (with `mergeTaskLedger` semantics) |
| memory | `<harnessHome>/palace` via the `mempalace` CLI the app already uses |
| open the app | the installed desktop app, else the repo's `npm run dev` |

The only extra directory the CLI creates is its own reply mailbox, `<hive>/agents/cli/inbox/` — an empty scene folder the app's router and roster ignore. No registry entries, no agents, no providers, no servers are added.

---

## Security

- Keys, tokens, passwords and credentials are never printed: secret-shaped config keys render as `[redacted]`, and free text (message replies, git/mempalace output paths) passes through a conservative secret-shape scrubber (PEM blocks, JWTs, `sk-*`, Bearer tokens, `key=value` assignments).
- `config set` refuses secret-shaped keys outright; authenticated providers are configured in the Desktop app where credentials use the platform's protected storage.
- Nothing is transmitted anywhere. The CLI is fully local.

---

## Troubleshooting

**`aira status` says "Could not locate AIRA Desktop state"** — the CLI found no `config.json` in the known Electron userData folders. Run `aira open` once so the app writes it, or set `AIRA_USERDATA` to the folder containing `config.json`.

**`aira run` queues instead of replying** — AIRA Desktop isn't running. Run `aira open`; her session picks the message up on boot. Polling with `aira run --no-wait` dispatches without waiting.

**`aira chat` exits with code 3** — the desktop core must be running for a live conversation.

**`config set` / `workspace use` are refused while the app is open** — stop AIRA Desktop, make the change, relaunch.

---

## Development layout

```
cli/
├── package.json      # aira-cli: installable via `npm install -g ./cli`
├── bin/aira.js       # executable entry (npm `bin: aira`)
├── src/
│   ├── cli.js        # parsing, dispatch, help/version, run/chat/interactive
│   ├── sys.js        # locating config.json + hive, loaders, ids, redaction
│   ├── dispatch.js   # god-inbox messaging + reply polling (hive protocol)
│   ├── commands.js   # status, agents, open, workspace, provider, config,
│   │                 #   task, memory, git
│   └── providers.json# static label mirror of AGENT_PROVIDER_PRESETS
├── test/smoke.test.cjs
└── README.md
```

The CLI version is managed independently in `cli/package.json` and is kept in lockstep with the app's version for compatibility (`aira --version` prints both).