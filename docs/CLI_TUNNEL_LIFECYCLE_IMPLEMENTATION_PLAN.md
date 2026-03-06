# OpenChamber CLI Tunnel Lifecycle + Logs Overhaul Plan

## 0) Objective

Implement a mature, provider-agnostic tunnel CLI lifecycle with explicit subcommands, daemon-by-default server behavior, and file-backed logs with tail/follow support.

This plan replaces legacy tunnel flags UX and formalizes operations around:

- `openchamber tunnel start`
- `openchamber tunnel status`
- `openchamber tunnel stop`
- `openchamber tunnel providers`
- `openchamber tunnel check`
- `openchamber tunnel help`
- `openchamber logs`

---

## 1) Decisions Locked

1. Remove legacy tunnel flags immediately (hard fail):
   - `--try-cf-tunnel`
   - `--tunnel-qr`
   - `--tunnel-password-url`

2. Remove daemon flag entirely:
   - `--daemon` / `-d` removed.
   - `openchamber` and `openchamber serve` always run daemonized.

3. Tunnel lifecycle commands must target running OpenChamber instance(s):
   - `tunnel start`:
     - 0 instances: auto-start daemon server, then start tunnel on it.
     - 1 instance: use it.
     - >1 instances without `--port`: fail and require `--port`.

4. Logs:
   - Persist all server logs to files.
   - Add `openchamber logs` to tail/follow.
   - Log storage location:
     - `~/.config/openchamber/logs/openchamber-<port>.log` (or `OPENCHAMBER_DATA_DIR/logs` if set).

5. Keep global CLI compatibility flags and help metadata:
   - Keep `--port`, `--ui-password`, `--help`, `--version`.
   - Keep top-level `ENVIRONMENT` help section.

---

## 2) Scope

### In scope
- CLI command architecture in `packages/web/bin/cli.js`
- CLI tests in `packages/web/bin/cli.test.js`
- Docs/help updates in:
  - `README.md`
  - `packages/web/README.md`
  - inline CLI help (`showHelp`)
- Log file creation/rotation for daemonized server process
- New `logs` CLI command with tail/follow

### Out of scope
- Tunnel backend API contract changes (existing APIs already sufficient)
- Major server-side logging framework refactor
- New provider implementation (only provider-agnostic command surface)

---

## 3) Target UX

## 3.1 Top-level commands
- `openchamber serve` (daemon by default)
- `openchamber stop`
- `openchamber restart`
- `openchamber status`
- `openchamber update`
- `openchamber tunnel ...`
- `openchamber logs ...`

Global flags (must remain available):
- `-p, --port`
- `--ui-password`
- `-h, --help`
- `-v, --version`

## 3.2 Tunnel namespace
- `openchamber tunnel help`
- `openchamber tunnel start --provider <id> --mode <mode> [--config <path>] [--token <token>] [--hostname <hostname>] [--port <n>] [--json] [--qr]`
- `openchamber tunnel status [--port <n>] [--all] [--json]`
- `openchamber tunnel stop [--port <n>] [--all] [--json]`
- `openchamber tunnel providers [--port <n>] [--json]`
- `openchamber tunnel check [--provider <id>] [--port <n>] [--json]`

## 3.3 Logs command
- `openchamber logs` (default: follow latest running instance)
- `openchamber logs --port <n>`
- `openchamber logs --all`
- `openchamber logs --lines <n>`
- `openchamber logs --no-follow`

Defaults:
- follow = true
- lines = 200

---

## 4) Parser & Command Architecture Refactor

File: `packages/web/bin/cli.js`

Current parser is single-command + global options. Refactor to hierarchical command parsing.

## 4.1 Parse model
Return shape should include:
- `command` (top-level)
- `subcommand` (for tunnel namespace)
- `options`
- `warnings` (if still needed)
- `errors` (for hard-fail removed flags / invalid combinations)

Suggested command parsing:
- No positional command => `serve`
- `tunnel` second positional token => subcommand
- `openchamber tunnel` without subcommand => show tunnel help
- `openchamber tunnel help` => show tunnel help

## 4.2 Hard-fail removed flags
If any removed flag appears in argv:
- Fail immediately with exit code 1 and migration message.

Examples:
- `--try-cf-tunnel` -> `Error: --try-cf-tunnel was removed. Use: openchamber tunnel start --provider cloudflare --mode quick`
- `--tunnel-qr` -> `Error: --tunnel-qr was removed. Use: openchamber tunnel start ... --qr`
- `--tunnel-password-url` -> explain replacement or removal (prefer removal unless reintroduced under tunnel start semantics)
- `--daemon/-d` -> `Error: --daemon was removed. OpenChamber now always runs in daemon mode.`

---

## 5) Daemon-by-Default Server Startup

File: `packages/web/bin/cli.js`

## 5.1 Behavior
- Remove conditional daemon branch.
- `commands.serve` always uses detached child process with persisted pid/instance files.
- Preserve current readiness handshake (`openchamber:ready`) to resolve final assigned port.

## 5.2 Instance persistence
Keep instance metadata file (`openchamber-<port>.json`) and pid file behavior.

Update stored options schema:
- remove `daemon` field (no longer needed)
- keep:
  - port
  - ui password presence/value rules (existing secure behavior)
  - tunnel-related fields if needed for restart semantics

## 5.3 Restart/update implications
- restart path should assume daemon mode always.
- update path restart logic should no longer set/expect daemon flag.

---

## 6) Tunnel Command Implementation Details

All tunnel commands should interact with server API over localhost by port.

## 6.1 Shared helpers
Add helpers in `cli.js`:

- `discoverRunningInstances()`
  - returns array: `{ port, pid, pidFilePath, instanceFilePath }`
- `resolveTargetInstance({ port, allowAutoStart })`
  - if `port` provided: validate instance exists/running
  - if none running and `allowAutoStart`: call `commands.serve(...)`, then re-discover
  - if multiple and no `port`: throw user-facing error listing ports
- `requestTunnelProviders(port)`
- `requestTunnelCheck(port, provider?)`
- `requestTunnelStatus(port)`
- `requestTunnelStart(port, payload)`
- `requestTunnelStop(port)`

Add concise fetch timeout handling for each request.

## 6.2 `tunnel start`
Validation:
- Required: `--provider`, `--mode`
- Mode-based requirements:
  - `managed-remote`: requires `--token` and `--hostname`
  - `managed-local`: `--config` optional
  - `quick`: no token/hostname required

Flow:
1. Resolve target instance with `allowAutoStart=true`.
2. POST `/api/openchamber/tunnel/start`.
3. If `--qr`, render QR using returned connect/public URL.
4. Print structured output or JSON.

Notes:
- Keep payload generic (`provider`, `mode`, `configPath`, `token`, `hostname`) for provider-agnostic future.

## 6.3 `tunnel status`
- If `--all`: query each running instance and aggregate.
- Else resolve one target (without auto-start).
- Output includes:
  - active
  - provider
  - mode
  - url
  - connect URL/token availability
  - ttlConfig
  - localPort

## 6.4 `tunnel stop`
- `--all`: stop tunnel on all running instances.
- `--port`: stop on specific instance.
- default (no all/port):
  - one running instance => use it
  - multiple => require --port or --all
- Endpoint: POST `/api/openchamber/tunnel/stop`
- Keep server running; do not kill process.

## 6.5 `tunnel providers`
- Query `/api/openchamber/tunnel/providers` from target instance.
- If no running instance:
  - either auto-start then query, OR fallback to built-in provider descriptor.
  - Recommended for this command: keep current fallback behavior to avoid forcing startup.

## 6.6 `tunnel check`
- Query `/api/openchamber/tunnel/check?provider=...`.
- If provider omitted, default `cloudflare` for now; maintain provider-agnostic CLI shape.

---

## 7) `openchamber logs` Command

File: `packages/web/bin/cli.js`

## 7.1 Log file location
- Base dir:
  - `process.env.OPENCHAMBER_DATA_DIR` if set
  - else `~/.config/openchamber`
- Logs dir:
  - `<base>/logs`
- Log file:
  - `openchamber-<port>.log`

## 7.2 Server process stdio redirection
In daemon spawn:
- open/create log file fd in append mode.
- child stdio:
  - `stdin: ignore`
  - `stdout: log fd`
  - `stderr: log fd`
  - `ipc` preserved for ready handshake where needed.
- close fd in parent after spawn setup.

## 7.3 Rotation strategy
Before launching daemon:
- rotate if file exceeds threshold (e.g. 10MB).
- keep 5 generations:
  - `.4` -> `.5`, `.3` -> `.4`, ... `.1` -> `.2`, current -> `.1`, create new current.

## 7.4 Tail/follow implementation
Implement helper:
- `tailFile(filePath, lines)` initial read last N lines (avoid huge memory)
- `followFile(filePath)` using `fs.watch` or polling for append; handle truncation/rotation gracefully
- `--all`: multiplex multiple files, prefix each line with `[port <n>]`

Behavior:
- default follow true
- Ctrl+C exits cleanly

---

## 8) Help Text & Docs

## 8.1 Top-level help (`showHelp`)
- remove:
  - daemon option
  - old tunnel flags in options/examples
- add:
  - `tunnel        Tunnel lifecycle commands`
  - `logs          Tail OpenChamber logs`
  - hint: `openchamber tunnel help`
- keep:
  - `--port`, `--ui-password`, `--help`, `--version`
  - `ENVIRONMENT` section (do not drop)

`ENVIRONMENT` section should include at least:
- `OPENCHAMBER_UI_PASSWORD`
- `OPENCHAMBER_DATA_DIR`
- `OPENCODE_HOST`
- `OPENCODE_PORT`
- `OPENCODE_SKIP_START`

## 8.2 Tunnel help (`showTunnelHelp`)
Create dedicated tunnel help function with:
- subcommands, options, examples
- mode requirement table
- provider-agnostic wording

## 8.3 Docs
Update:
- `README.md`
- `packages/web/README.md`
Remove legacy flags references and add new tunnel lifecycle + logs docs.

---

## 9) Error Messaging Standards

All user-facing errors must be actionable and concise.

Examples:
- Multiple instances without port:
  - `Multiple OpenChamber instances found: 3000, 3001. Use --port <port> or --all.`
- No running instance for status/stop:
  - `No running OpenChamber instance found. Start one with 'openchamber serve'.`
- Removed flag:
  - explicit migration command example.

---

## 10) Test Plan

File: `packages/web/bin/cli.test.js` (+ split into multiple test files if needed)

## 10.1 Parser tests
- `openchamber` defaults to serve
- `openchamber serve` valid
- `openchamber tunnel` defaults to help
- `openchamber tunnel help`
- parse each tunnel subcommand options
- removed flags hard-fail
- removed daemon hard-fail

## 10.2 Tunnel resolution tests
Mock instance discovery:
- no instances + start auto-create for `tunnel start`
- single instance auto-select
- multiple instances require `--port`/`--all`

## 10.3 Request behavior tests
Mock fetch:
- status/provides/check/start/stop success + error paths
- json output shape with `--json`
- `--all` aggregation logic

## 10.4 Logs tests
- log path resolution
- rotation function
- `--lines` behavior
- `--no-follow` exits
- all-mode prefix formatting

---

## 11) File-by-File Change List

Primary:
- `packages/web/bin/cli.js` (major refactor)

Tests:
- `packages/web/bin/cli.test.js` (or split into parse/lifecycle/logs test files)

Docs:
- `README.md`
- `packages/web/README.md`
- optional: `docs/CLI_TUNNEL_COMMANDS.md`

No backend API changes required for core lifecycle.

---

## 12) Implementation Sequence (Recommended)

1. Add new tunnel namespace parser + help (without deleting old logic yet).
2. Implement tunnel subcommands with fetch helpers.
3. Implement daemon-by-default serve path.
4. Add hard-fail guard for removed flags.
5. Implement logs file redirection + logs command + rotation.
6. Remove old tunnel/daemon options from help and code paths.
7. Update tests.
8. Update docs.
9. Run validation.

---

## 13) Validation Commands

Run in repo root:

- `bun test`
- `bun run type-check`
- `bun run lint`
- `bun run build`

---

## 14) Acceptance Criteria

1. `openchamber serve` always daemonizes; `--daemon` no longer accepted.
2. Legacy tunnel flags fail with migration guidance.
3. `openchamber tunnel help` documents all lifecycle commands.
4. `tunnel start` auto-starts daemon if none running; requires `--port` when multiple running.
5. `tunnel stop` stops tunnel only, not server.
6. `openchamber logs` tails file logs and supports follow/port/all options.
7. Logs persist under config data dir with rotation.
8. Full test/type/lint/build pipeline is green.

---

## 15) Follow-ups (Optional)

- Add `openchamber tunnel links list/revoke` once server endpoints are formalized.
- Add `openchamber tunnel doctor` alias for `check`.
- Add structured machine-readable exit codes for automation.

---

## 15.1) Managed-Remote Profiles by Name (Required Follow-up)

Goal: add provider-agnostic CLI profile management for managed-remote tunnels, persisted in a local file and consumable by `tunnel start`.

### Commands to add

- `openchamber tunnel profile add --provider <id> --mode managed-remote --name <name> --hostname <host> --token <token> [--force] [--json]`
- `openchamber tunnel profile list [--provider <id>] [--json]`
- `openchamber tunnel profile show --name <name> [--provider <id>] [--json]`
- `openchamber tunnel profile remove --name <name> [--provider <id>] [--json]`
- `openchamber tunnel start --profile <name> [--provider <id>] [--port <n>] [--qr] [--json]`

### Persistence file

- Path: `${OPENCHAMBER_DATA_DIR || ~/.config/openchamber}/tunnel-profiles.json`
- Schema:
  - `version: 1`
  - `profiles: Array<{ id, name, provider, mode, hostname, token, createdAt, updatedAt }>`
- Name uniqueness rule: **unique per provider** (not global).

### Migration requirement (must happen before list/use)

Implement `ensureTunnelProfilesMigrated()` and call it before:
- `tunnel profile list/show/add/remove`
- `tunnel start --profile ...`

Migration source:
- legacy managed-remote token file: `cloudflare-managed-remote-tunnels.json`

Migration behavior:
1. If `tunnel-profiles.json` is missing or empty and legacy entries exist, import legacy entries.
2. Map imported entries to profile records:
   - `provider = cloudflare`
   - `mode = managed-remote`
   - `name = legacy.name`
   - `hostname/token` from legacy entry.
3. Resolve duplicate names deterministically per provider (`name`, `name-2`, `name-3`, ...).
4. Write canonical profile file once and continue command execution.

### Start by profile flow

For `tunnel start --profile <name>`:
1. Run migration first.
2. Resolve profile by `{provider, name}`.
3. Resolve target instance using existing lifecycle rules.
4. Sync token preset to server via `PUT /api/openchamber/tunnel/managed-remote-token`.
5. Start tunnel via `POST /api/openchamber/tunnel/start` using preset fields.

### Secret handling

- Token is stored in profile file per requirement.
- Mask token in human output (`list/show`) by default.
- Keep `--json` output explicit and deterministic.

### Validation and errors

- `profile add` requires: `provider`, `mode=managed-remote`, `name`, `hostname`, `token`.
- Duplicate profile name in same provider fails unless `--force`.
- `start --profile` missing profile should return actionable message and suggest `tunnel profile list`.

### Output style requirement

Profile commands must use the same beautified CLI layer as other tunnel commands:
- framed section start/end
- status symbols (`✓`, `○`, `⚠`, `✗`)
- dim indented metadata lines
- plain JSON only when `--json` is set

---

## 16) CLI Beautification Standards (Inspired by OpenCode)

Goal: maximize readability and perceived quality of non-JSON CLI output while keeping automation-safe output modes.

### 16.1 Reference implementation findings (from `/Users/iivashko/projects/opencode`)

Primary styling approach in OpenCode:
- Uses `@clack/prompts` for structured command output blocks:
  - `prompts.intro(...)` for framed section headers
  - `prompts.log.info/success/warn/error(...)` for item rows with symbols
  - `prompts.outro(...)` for framed section footer/count
- Uses custom ANSI style constants in `packages/opencode/src/cli/ui.ts` (`UI.Style.*`) for semantic color levels.
- Uses compact Unicode status symbols and predictable indentation patterns:
  - `✓`, `○`, `⚠`, `✗`
  - first line: status + name + dim status text
  - second line: indented dim metadata (URL/command/details)

Relevant OpenCode files:
- `packages/opencode/src/cli/cmd/mcp.ts`
- `packages/opencode/src/cli/ui.ts`
- dependency declaration in `packages/opencode/package.json` (`@clack/prompts`)

### 16.2 Apply same quality bar to OpenChamber CLI

Add a small output layer for `packages/web/bin/cli.js`:
- New helper module (recommended): `packages/web/bin/ui.ts`.
- Responsibilities:
  - semantic style constants (success, warning, error, dim, highlight)
  - symbol map (`✓`, `○`, `⚠`, `✗`)
  - reusable renderers for:
    - section header/footer
    - status line + metadata line
    - counts/summary blocks

### 16.3 Dependency and fallback strategy

Recommended:
- Add `@clack/prompts` to `packages/web` dependencies for rich output.
- Keep a plain-text fallback renderer if TTY is unavailable or output is piped.

TTY/automation safety rules:
- If `--json` is set: output strictly JSON (no symbols, no color wrappers).
- If non-TTY or `NO_COLOR` is set: disable ANSI color, keep readable plain text.
- Keep machine-readable fields stable in JSON output.

### 16.4 Commands requiring beautified output

Use the styled renderer for:
- `openchamber tunnel status`
- `openchamber tunnel providers`
- `openchamber tunnel check`
- `openchamber tunnel start` success/failure summary
- `openchamber tunnel stop` summary
- `openchamber logs` session header/footer (not every emitted log line)

### 16.5 Style conventions

- Prefer semantic colors and dim metadata over heavy color noise.
- Use one-line primary status with optional indented detail line.
- Keep symbols consistent across commands.
- Use box-drawing framing only for section boundaries, not for every row.
- Keep output width conservative for narrow terminals.

### 16.6 Tests for output layer

Add tests that assert:
- JSON mode never includes ANSI sequences or decorative wrappers.
- Non-TTY fallback remains readable.
- Key command summaries include expected status symbols/text.
- Multi-instance output remains aligned and unambiguous.
