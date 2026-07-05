# 📒 Tally MCP Server

> **Talk to your Tally Prime books in plain English.** Connect Claude (or any MCP‑compatible AI) to Tally Prime and ask for your trial balance, create ledgers, post vouchers, set opening balances, and slice your data with SQL — all from a chat window.

Tally MCP is a [Model Context Protocol](https://modelcontextprotocol.io) server that bridges an AI assistant and your **Tally Prime** company. It ships as a **single self‑contained binary** — no Node, no `npm`, no drivers to install. Point it at Tally on `localhost` or across your office LAN and you're done.

- 🖥️ **Runs locally** — your financial data never leaves your machine/network.
- 📦 **One file** — download the binary for your OS, no runtime to install.
- 🔌 **Localhost or LAN** — talk to Tally on the same PC or another machine in the office.
- 📊 **26+ tools** — reports, lookups, masters, vouchers, and live SQL over cached data.

---

## ✨ What can it do?

| Category | Tools |
|---|---|
| 📊 **Reports** (cached → queryable) | `chart-of-accounts`, `trial-balance`, `profit-loss`, `balance-sheet`, `stock-summary`, `bills-outstanding`, `ledger-account`, `stock-item-account` |
| 🔎 **Lookups** | `list-master`, `ledger-balance`, `stock-item-balance` |
| 🧮 **Analysis** | `query-database` — run **SQL** over any cached report (aggregate, filter, sort, join) |
| ✍️ **Masters (write)** | `create-ledger`, `update-ledger` *(incl. opening balance)*, `delete-ledger`, `create-group`, `update-group`, `delete-group`, `create-stock-item`, `delete-stock-item`, `create-unit`, `delete-unit` |
| 🧾 **Vouchers** | `create-voucher`, `cancel-voucher` |

> 💡 Reports are cached into an in‑memory SQL table for ~15 minutes and return a `tableID`. The AI then runs `query-database` against it — so "what were my top 10 expenses last quarter?" becomes a single SQL query instead of dumping thousands of rows into the chat.

---

## 🚀 Quick Start (for users)

You need **3 things**: Tally running with its gateway on, the binary, and one line of config in Claude.

### 1️⃣ Turn on Tally's connector

In **Tally Prime**: `Gateway of Tally` → press **F1 (Help)** → **Settings** → **Connectivity** → **Client/Server configuration**, then set:

- **TallyPrime acts as** → `Server`
- **Port** → `9000`

Keep Tally open with your company loaded. ✅

> Running Claude on a **different PC** than Tally? Also allow port `9000` through the Tally PC's Windows Firewall, and use that PC's LAN IP (e.g. `192.168.1.9`) instead of `localhost` below.

### 2️⃣ Download the binary

Grab the file for your OS from [**Releases**](../../releases) and put it somewhere permanent:

| OS | File |
|---|---|
| 🪟 Windows | `tally-mcp-win-x64.exe` |
| 🍎 macOS (Apple Silicon) | `tally-mcp-mac-arm64` |
| 🍎 macOS (Intel) | `tally-mcp-mac-x64` |

> On macOS, first run may be blocked by Gatekeeper — right‑click → **Open** once, or `xattr -d com.apple.quarantine <file>`.

### 3️⃣ Connect Claude Desktop

**The easy way — double‑click the binary.** Running the file with no arguments opens a small **setup page** in your browser (a local control panel at `http://127.0.0.1:4321`, reachable only from your PC):

1. **Double‑click** the downloaded binary (on macOS: right‑click → **Open** the first time).
2. In the page that opens, set your **Tally host** (`localhost`, or the Tally PC's LAN IP) and **Port** (`9000`), optionally a **Default company**.
3. Click **Test connection** — you should see your company (e.g. *Arihant Daga EXP*) listed.
4. Click **Connect to Claude Desktop**. This safely adds a `tally` entry to `claude_desktop_config.json` (backing up any existing file to `…json.bak`) and points it at this binary with `"args": ["--mcp"]`.
5. **Restart Claude Desktop.**

Your settings are stored in `~/.tally-mcp/config.json` and read **live** on every request, so you can change the host/port in the panel and Claude picks it up without editing any JSON.

<details>
<summary><b>Prefer to edit the JSON yourself?</b></summary>

Open Claude Desktop → **Settings → Developer → Edit Config** and add a `tally` entry. Note the **`"args": ["--mcp"]`** — the binary needs that flag to run in MCP mode (with no args it opens the control panel):

```json
{
  "mcpServers": {
    "tally": {
      "command": "C:\\Tools\\tally-mcp-win-x64.exe",
      "args": ["--mcp"],
      "env": { "TALLY_HOST": "localhost", "TALLY_PORT": "9000" }
    }
  }
}
```

- `command` → the **full path** to the binary you downloaded.
- `TALLY_HOST` → `localhost` (same PC) or the Tally PC's IP (LAN). Values saved via the control panel (`~/.tally-mcp/config.json`) take precedence over these `env` values.

Config file location:
- 🪟 Windows: `%APPDATA%\Claude\claude_desktop_config.json`
- 🍎 macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`

</details>

**Restart Claude Desktop**, then try:

> 💬 *"List my ledgers."*
> 💬 *"Show me the trial balance for last financial year and total the expenses."*
> 💬 *"Create a ledger 'Acme Corp' under Sundry Debtors with an opening balance of ₹50,000 Dr."*

---

## 🤖 Connect an agent (Claude Code / programmatic)

**Claude Code (CLI):**

```bash
claude mcp add tally \
  --env TALLY_HOST=localhost \
  --env TALLY_PORT=9000 \
  -- /absolute/path/to/tally-mcp
```

**Any MCP client via project config** — add to your `.mcp.json`:

```json
{
  "mcpServers": {
    "tally": {
      "command": "/absolute/path/to/tally-mcp",
      "args": ["--mcp"],
      "env": { "TALLY_HOST": "localhost", "TALLY_PORT": "9000" }
    }
  }
}
```

> ℹ️ Pass **`--mcp`** so the binary runs the MCP stdio server. Launched with **no arguments** it instead opens the local setup control panel (see Quick Start).

The server speaks MCP over **stdio**, so any MCP‑compatible agent can drive it. Tip: have the agent call `list-master` to validate exact ledger/group names before writing.

---

## ⚙️ Configuration

| Variable | Default | Description |
|---|---|---|
| `TALLY_HOST` | `localhost` | Host/IP where Tally's gateway is listening |
| `TALLY_PORT` | `9000` | Tally gateway port |

That's it — no config files, no database setup. Everything the server needs (report templates + SQL engine) is baked into the binary.

---

## 🛠️ Build from source

Prerequisites: **Node ≥ 22**. For the single binary you also need **[Bun](https://bun.sh)** (`curl -fsSL https://bun.sh/install | bash`).

```bash
cd code
npm ci                 # install dependencies

# ── Run from source (Node) ──────────────────────────────
npm run build          # compile TypeScript -> dist/
node dist/main.mjs         # open the local control panel (double-click mode)
node dist/main.mjs --mcp   # start the MCP server (reads config / TALLY_HOST/TALLY_PORT)
node dist/index.mjs        # MCP server (backward-compatible entry point)

# ── Tests & checks ──────────────────────────────────────
npm test               # unit tests
npm run typecheck      # tsc --noEmit

# ── Single binary (Bun) ─────────────────────────────────
npm run build:binary       # -> dist-bin/tally-mcp  (current OS)
npm run build:binary:all   # -> Windows x64, macOS arm64, macOS x64
```

Handy scripts:

| Script | What it does |
|---|---|
| `npm run build:embeds` | Regenerate `src/generated/embedded.mts` (inlines report templates + the sql.js wasm) |
| `npm run build` | Type‑check & emit `dist/` (runs `build:embeds` first) |
| `npm run build:binary` | Compile a single executable for the current OS |
| `npm run build:binary:all` | Cross‑compile Windows/macOS binaries |
| `npm test` | Run the Vitest suite |

> 🧩 **How the single binary works:** the report XML templates and the SQLite‑WASM (`sql.js`) engine are inlined into the JS bundle at build time by `scripts/build-embeds.mjs`, then Bun compiles everything — runtime included — into one file. No `node_modules`, no native `.node` addon, nothing to read off disk.

---

## 🏗️ Architecture at a glance

```
  Claude / MCP agent ──stdio──►  tally-mcp (one binary)  ──HTTP:9000──►  Tally Prime
                                   │
                                   └── in-memory SQLite (sql.js) cache
                                       for query-database over report data
```

- **Read** tools export data from Tally (XML/TDL) and cache tabular results in an in‑memory SQLite table.
- **`query-database`** runs SQLite‑dialect SQL over those cached tables (dates stored as `YYYY-MM-DD`).
- **Write** tools import masters/vouchers into Tally (ledgers, groups, stock items, units, vouchers, opening balances).

---

## 🩺 Troubleshooting

| Symptom | Fix |
|---|---|
| ❌ *"Unable to connect to Tally"* | Tally must be **open** with a company loaded and set to **act as Server** on the configured port. |
| ❌ Works on the Tally PC but not another machine | Use the Tally PC's **LAN IP** as `TALLY_HOST` and open port `9000` in its firewall. |
| ❌ Tool says a ledger/group "not found" | Names must match exactly — ask the agent to run `list-master` first. |
| ❌ macOS won't open the binary | `xattr -d com.apple.quarantine <file>` or right‑click → **Open** once. |
| ❓ Wrong company | Pass `targetCompany` in the tool call, or select the intended company in Tally. |

---

## 📁 Project layout

```
code/            # the MCP server (TypeScript)
  src/           # source (mcp.mts, tally.mts, push.mts, database.mts, …)
  pull/          # report XML/TDL templates (source of truth for the embeds)
  scripts/       # build-embeds.mjs (inlines templates + wasm)
  docs/          # CHANGELOG and setup notes
documentation/   # Tally XML reference, distribution plan
```

---

## 🔐 A note on your data

Tally MCP runs entirely on your machine/LAN and talks directly to Tally over HTTP. It keeps **no** external state and sends nothing to any third‑party server. When used with a hosted AI (like Claude), only the specific data the assistant requests is shared with that AI to answer your question.

---

*Built for accountants who'd rather ask a question than navigate ten menus.* 🧮✨
