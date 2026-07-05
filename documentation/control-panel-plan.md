# Build plan — Tally MCP Control Panel (config server + web UI)

> **Objective:** Make the existing single binary do double duty. A non‑technical accountant
> downloads **one file**, double‑clicks it, a **local web page** opens where they set the Tally
> host/port and click **"Connect to Claude Desktop"** — no JSON editing, no terminal. The *same*
> binary, when launched by Claude over stdio, runs the MCP server exactly as today.

This document is the implementation spec. Build it on branch `feat/control-panel` (already created
from `main`). Keep everything working under plain `node` **and** inside the compiled Bun binary.

---

## 1. Design — one binary, two modes

```
 ┌──────────────────────────── tally-mcp (single binary) ────────────────────────────┐
 │  entry: src/main.mts  →  dispatch on args                                          │
 │                                                                                    │
 │   • launched with  --mcp   (or by Claude Desktop)  → MCP SERVER over stdio         │
 │   • launched with no args  (double‑click)          → CONTROL PANEL (local web UI)  │
 └────────────────────────────────────────────────────────────────────────────────────┘
             │                                        │
             │ reads (live)                           │ reads / writes
             ▼                                        ▼
   ~/.tally-mcp/config.json   ◄───────────────────────┘
   { tallyHost, tallyPort, defaultCompany, ... }
```

**Mode decision (`src/main.mts`):**
- If `process.argv.slice(2).includes('--mcp')` → start the MCP stdio server (today's `index.mts` logic).
- Otherwise → start the control panel web server and open the browser.
- Rationale: an explicit flag is reliable across OSes (TTY detection is not). The control panel's
  "Connect to Claude Desktop" writes `"args": ["--mcp"]` into Claude's config, so Claude always
  launches MCP mode.

---

## 2. New / changed files

| File | Action | Purpose |
|---|---|---|
| `code/src/config.mts` | **new** | Load/save `~/.tally-mcp/config.json`; live connection getter |
| `code/src/claude-desktop.mts` | **new** | Locate + safely patch `claude_desktop_config.json` |
| `code/src/control-panel.mts` | **new** | Express server + embedded HTML page + JSON API |
| `code/src/main.mts` | **new** | Entry dispatcher (`--mcp` vs control panel) |
| `code/src/tally.mts` | **edit** | Read host/port **live** from `config.mts` instead of env-at-startup |
| `code/src/index.mts` | **keep** | Leave as pure MCP stdio entry (backward compat for `node dist/index.mjs`) |
| `code/package.json` | **edit** | Point `build:binary*` at `src/main.mts`; keep others |
| `code/src/config.test.mts` | **new** | Unit tests for config precedence + save |
| `code/src/claude-desktop.test.mts` | **new** | Unit tests for merge/backup patching |
| `README.md` | **edit** | Add "double‑click" quickstart; note `--mcp` for manual Claude config |

Do **not** touch `database.mts`, `push.mts`, `mcp.mts` tool logic, or the embed pipeline.

---

## 3. `config.mts` — the shared config

Config file: `path.join(os.homedir(), '.tally-mcp', 'config.json')`.

```ts
export interface TallyConfig {
  tallyHost: string;        // default 'localhost'
  tallyPort: number;        // default 9000
  tallyPassword?: string;   // optional/reserved — Tally's HTTP gateway is usually open; store but do not send yet
  defaultCompany?: string;  // optional SVCURRENTCOMPANY fallback
  controlPanelPort: number; // default 4321
}
```

- `loadConfig(): TallyConfig` — read the file if present (tolerate missing/corrupt JSON → fall back);
  **precedence per key: file value → env (`TALLY_HOST`/`TALLY_PORT`) → hardcoded default**
  (`localhost`/`9000`). This keeps existing env‑based Claude Desktop setups working.
- `saveConfig(patch: Partial<TallyConfig>): TallyConfig` — deep‑merge onto current, `mkdir -p` the dir,
  write pretty JSON, return the merged config.
- `getTallyConnection(): { host: string; port: number }` — used by `tally.mts` on **every** request.
  Re‑read the file but **cache by mtime** (stat the file; only re‑parse when mtime changes) so a change
  in the panel takes effect immediately without restarting Claude, and without hammering the disk.
- `getConfigPath(): string`, `getDefaultCompany(): string | undefined` helpers.

All FS access must be guarded so the MCP path never throws if the file is absent (first run).

## 4. `tally.mts` change — live connection

Currently:
```ts
const tally_host = process.env.TALLY_HOST || 'localhost';
const tally_port = parseInt(process.env.TALLY_PORT || '9000');
```
Replace with a call inside `postTallyXML` (and anywhere host/port is used):
```ts
import { getTallyConnection } from './config.mjs';
// inside postTallyXML:
const { host, port } = getTallyConnection();
```
Keep the rest of `postTallyXML` identical. This is the only behavioural change to the MCP path, and it
must remain fully backward compatible (env still honoured via `loadConfig` precedence).

## 5. `claude-desktop.mts` — auto‑register

Config file location by platform:
- macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`
- Windows: `%APPDATA%\Claude\claude_desktop_config.json`
- Linux: `~/.config/Claude/claude_desktop_config.json`

`connectClaudeDesktop(binaryPath: string)`:
1. Resolve the config path for the current OS; `mkdir -p` its directory.
2. Read + `JSON.parse` existing config (or start from `{}` if missing/corrupt).
3. Back up the original to `claude_desktop_config.json.bak` (only if it existed).
4. Ensure `config.mcpServers` object; set:
   ```json
   "tally": { "command": "<binaryPath>", "args": ["--mcp"] }
   ```
   Use `process.execPath` as `binaryPath` when running as the compiled binary.
5. Write pretty JSON (2‑space). Return `{ ok, path, backedUp }`.
Never throw to the caller — return `{ ok:false, error }` on failure.

## 6. `control-panel.mts` — the local web app

- Express app bound to **`127.0.0.1`** only (never `0.0.0.0`) on `config.controlPanelPort` (default 4321);
  if the port is busy, try the next few ports and log the chosen one.
- Serve one self‑contained HTML page (inline HTML/CSS/JS string — no external assets, works in the binary).

**API (all JSON):**

| Method | Route | Body / Result |
|---|---|---|
| `GET` | `/api/config` | → current config (omit/mask `tallyPassword`) |
| `POST` | `/api/config` | `{tallyHost, tallyPort, defaultCompany, tallyPassword?}` → saves, returns merged config |
| `POST` | `/api/test` | `{tallyHost?, tallyPort?}` (optional overrides) → pings Tally, returns `{ok, companies:[names]}` or `{ok:false, error}` |
| `POST` | `/api/connect-claude` | → calls `connectClaudeDesktop(process.execPath)`, returns `{ok, path, backedUp}` |
| `GET` | `/api/status` | → `{configPath, tally:{host,port,reachable}}` |

**`/api/test` implementation:** reuse the existing UTF‑16 XML POST (factor a small `pingCompanies(host,port)`
helper — or import `postTallyXML` after temporarily using the posted host/port). Send the
`List of Companies` collection request (see `documentation/tally_sample_xml_reference.md` / the harness in
this repo's scratchpad used `TYPE=Collection, ID=List of Companies`). Parse company `NAME`s. 5s timeout.

**On startup (control‑panel mode):** print the URL, then best‑effort open the browser:
`open` (macOS), `start ""` (Windows), `xdg-open` (Linux) via `child_process`. Never crash if it fails.

**The page (single screen):**
- Header: "Tally MCP — Setup".
- A status line: ✅/❌ "Connected to Tally at host:port" (calls `/api/status` on load).
- Form fields: **Tally host** (default `localhost`), **Port** (`9000`), **Default company** (optional),
  **Password** (optional, greyed with a "usually not needed" hint).
- Buttons:
  - **Test connection** → `POST /api/test`; on success show the list of companies found.
  - **Save** → `POST /api/config`.
  - **Connect to Claude Desktop** → `POST /api/connect-claude`; on success show "✅ Added. Restart Claude Desktop, then ask it about your Tally data." and the config path.
- Keep it clean and friendly (a little CSS, no framework). Light/dark friendly is a bonus, not required.

## 7. `main.mts` — dispatcher

```ts
// pseudocode
const argv = process.argv.slice(2);
if (argv.includes('--mcp')) {
  await startMcpStdio();            // same as index.mts today
} else {
  await startControlPanel();       // control-panel.mts
}
```
Factor the stdio startup so both `index.mts` and `main.mts` share it (e.g. export `startMcpStdio()` from a
small module, or from `index.mts`). Load `dotenv` as today.

## 8. Build changes

- `package.json`: change the three `build:binary*` scripts to compile **`src/main.mts`** (not `index.mts`).
  Everything else (embeds prebuild, targets, outfile names) stays.
- Verify Express bundles into the Bun binary (it's already a dependency). The HTML is an inline string,
  so nothing is read off disk.
- `node dist/index.mjs` must still start the MCP server (backward compat). `node dist/main.mjs` →
  control panel; `node dist/main.mjs --mcp` → MCP.

## 9. Testing & acceptance criteria

**Automated (must pass):**
- `cd code && npm run typecheck` clean.
- `npm test` — existing **78** tests still pass, plus:
  - `config.test.mts`: precedence (file > env > default), `saveConfig` round‑trip, corrupt‑file fallback,
    mtime‑cached live getter. Use a temp `HOME`/dir; do not touch the real `~/.tally-mcp`.
  - `claude-desktop.test.mts`: creates entry in an empty config, merges into an existing config without
    clobbering other servers, writes a `.bak`. Use a temp dir.

**Integration (run against the live test Tally):** `TALLY_HOST=192.168.1.9 TALLY_PORT=9000`,
company **"Arihant Daga EXP"** (you may create/cleanup throwaway masters):
- Start control panel (`node dist/main.mjs` or the binary with no args). `curl` the endpoints:
  - `GET /api/config` returns defaults/config.
  - `POST /api/test` with `{"tallyHost":"192.168.1.9","tallyPort":9000}` returns `ok:true` and lists
    companies including "Arihant Daga EXP".
  - `POST /api/connect-claude` writes a `tally` entry (test against a **temp** Claude config path, not the
    real one — parameterize the path in tests).
- **MCP mode unchanged:** build the binary, drive it with `--mcp` over stdio (reuse the pattern in
  `scratchpad/mcpclient.mjs`: initialize → tools/list → `query-database` → a live `chart-of-accounts`)
  and confirm it still works end‑to‑end.
- Compile `npm run build:binary`; verify **both** modes on the produced binary:
  no‑args opens the panel; `--mcp` speaks MCP.

**Acceptance:** a fresh user can run the binary, see the page, Test connection shows their companies,
Connect writes Claude's config, and after restarting Claude the tools work — with the config file driving
the connection live.

## 10. Out of scope (v2 — do NOT build now)

- Log viewer / live logs tab (leave a placeholder link only if trivial).
- Auth on the control panel (it's localhost‑only; not needed).
- Using `tallyPassword` (store it, don't send it — Tally gateway is open on LAN).
- Windows Firewall / `tally.ini` automation.

## 11. House rules

- Match the surrounding code style. The repo is **not** Biome‑clean at baseline — do **not** run
  `biome check --write` across the repo; only keep your new files tidy.
- `src/generated/` and `dist-bin/` are gitignored (regenerated by the build) — don't commit them.
- Commit your work on `feat/control-panel` in focused commits ending with the repo's Co‑Authored‑By
  trailer. Do not push or open a PR — leave that to the human.
- When done, report: files added/changed, test results (typecheck + unit + the live‑Tally integration
  checks), and any deviations from this plan.
