# Account AI for Tally

Connect Claude (or any MCP-compatible AI assistant) to your **Tally Prime** company. Ask for reports in plain English, create and update masters, post vouchers, and run SQL over your data — all from a chat window.

Account AI for Tally is a [Model Context Protocol](https://modelcontextprotocol.io) server that runs on your machine and talks to Tally Prime over its HTTP/XML gateway (on `localhost` or across your office LAN). It ships as a **single self-contained binary** — no Node, no npm, no drivers to install.

- Runs locally; your data never leaves your machine or network.
- One downloadable file per operating system.
- Works against Tally on the same PC or another machine on the office LAN.

## What it can do

- **Reports** — trial balance, profit & loss, balance sheet, chart of accounts, stock summary, outstanding bills, and ledger / stock-item statements. Each result is cached so you can query it.
- **Query** — `query-database` runs SQL (SQLite dialect) over any cached report for totals, filtering, sorting, and joins.
- **Masters** — create, update, and delete ledgers, groups, stock items, and units (plus a generic `delete-master`), and set opening balances.
- **Vouchers** — create and cancel vouchers.

## Quick start

You need three things: Tally running with its gateway enabled, the binary, and one click to connect Claude.

### 1. Turn on Tally's gateway

In Tally Prime: **Gateway of Tally → F1 (Help) → Settings → Connectivity → Client/Server configuration**, then set **TallyPrime acts as: Server** and **Port: 9000**. Keep Tally open with your company loaded.

Running Claude on a different PC than Tally? Use the Tally PC's LAN IP instead of `localhost`, and allow port 9000 through its firewall.

### 2. Download the binary

From the Releases page, choose the file for your OS:

| OS | File |
|----|------|
| Windows | `account-ai-for-tally-win-x64.exe` |
| macOS (Apple Silicon) | `account-ai-for-tally-mac-arm64` |
| macOS (Intel) | `account-ai-for-tally-mac-x64` |

On macOS the first launch may be blocked by Gatekeeper — right-click → **Open**, or run `xattr -d com.apple.quarantine <file>`.

### 3. Connect Claude

Run the binary with no arguments. It opens a local setup page at **http://127.0.0.1:4321**. There:

1. Enter your Tally host (`localhost`, or the Tally PC's IP) and port (`9000`).
2. Click **Test connection** — your company should appear.
3. Click **Add to Claude Desktop** or **Add to Claude Code**.
4. Restart Claude, then ask something like *"Show me the trial balance for last year and total the expenses."*

## Connecting an agent manually

Launched with `--mcp`, the binary is a plain MCP stdio server. To register it by hand:

Claude Code:

```
claude mcp add tally -- /path/to/account-ai-for-tally --mcp
```

Any client, via config (`claude_desktop_config.json` for the desktop app, `~/.claude.json` for the CLI):

```json
{
  "mcpServers": {
    "tally": {
      "type": "stdio",
      "command": "/path/to/account-ai-for-tally",
      "args": ["--mcp"]
    }
  }
}
```

## Configuration

Settings live in `~/.account-ai-for-tally/config.json` (written by the control panel) and are read live on every request, so changing the host or port in the panel takes effect without restarting Claude.

| Variable | Default | Purpose |
|----------|---------|---------|
| `TALLY_HOST` | `localhost` | Host/IP where Tally's gateway listens |
| `TALLY_PORT` | `9000` | Tally gateway port |

The config file takes precedence over these environment variables.

## Building from source

Requires **Node 22+**; building the binary also requires **[Bun](https://bun.sh)**.

```
make setup      Install dependencies
make build      Compile TypeScript to code/dist (Node)
make test       Run the test suite
make typecheck  Type-check without emitting
make binary     Build a single binary for this OS -> code/dist-bin/
make binaries   Cross-compile Windows and macOS binaries
make panel      Run the control panel locally
make mcp        Run the MCP server over stdio
```

Run `make` (or `make help`) to list every target.

## How it works

- **One binary, two modes.** With `--mcp` (or when launched by Claude) it runs the MCP server over stdio. With no arguments it opens the local setup control panel.
- **No native dependencies.** Report data is cached in an in-memory SQLite database via `sql.js` (WebAssembly), so the whole server — report templates and SQL engine included — compiles into a single file.
- **Local only.** It talks directly to Tally over HTTP and keeps no external state.

## Project layout

```
code/            The server (TypeScript / Node)
  src/           Source
  pull/          Report templates (embedded into the binary at build time)
  scripts/       build-embeds.mjs — inlines templates + the sql.js wasm
documentation/   CHANGELOG, design docs, and the Tally XML reference
makefile         Task runner
```

## License

MIT — see [LICENSE](LICENSE).
