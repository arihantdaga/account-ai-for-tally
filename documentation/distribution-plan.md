# Making Account AI for Tally usable by non-technical accountants — distribution plan

> **Goal:** Let an accountant (Windows, sometimes Mac; no npm/terminal skills) connect Claude to their
> Tally Prime and start working — without editing JSON, installing Node, or configuring a server URL by hand.
>
> **Decision (2026-07):** build **two** interfaces in parallel tracks:
> 1. **LAN Desktop Extension** — self-contained, no backend we operate.
> 2. **Hosted connector + bridge agent** — works from anywhere incl. mobile.

---

## 1. The three real frictions

Packaging alone doesn't make this work. There are three separable problems:

| # | Friction | Removable by packaging? |
|---|----------|--------------------------|
| A | Install + configure the MCP (JSON, npx, Node, PATH) | **Yes** — this is what `.mcpb` / a bundled agent solves |
| B | **Network path to Tally.** Tally's HTTP/XML gateway (port 9000) listens only on the local machine / LAN, behind the office NAT. Whatever runs the MCP must be able to reach that port. | **No** — this forks the architecture (local vs bridge) |
| C | Enabling Tally's gateway (Gateway of Tally → F1 Settings → Connectivity → *TallyPrime acts as **Server***, port 9000) | **No**, but we can guide it (screenshots) or auto-write `tally.ini` (`Server=True`, `TallyPort=9000`) from an installer |

C is unavoidable in every design — Tally must be told to listen. Everything below is about A and B.

---

## 2. What already exists in this repo (important)

- `code/src/mcp.mts` — `registerMcpServer()` registers all pull + push tools. **Transport-agnostic.**
- `code/src/index.mts` — **stdio** entry point (what Claude Desktop / Claude Code use locally).
- `code/src/server.mts` — **Streamable-HTTP** entry point with a **full OAuth 2.0 authorization server**:
  dynamic client registration (`/register`), `/authorize` (PKCE S256) + `authorize.html` login page, `/token`,
  `.well-known/oauth-authorization-server` + `oauth-protected-resource` discovery, Bearer auth on `/mcp`,
  per-session `StreamableHTTPServerTransport`.
- `code/src/tally.mts` — `postTallyXML()` posts UTF-16 XML to `TALLY_HOST:TALLY_PORT` over HTTP.

So the **remote-MCP transport and the OAuth scaffolding are already here.** Two gaps make it a real product:

1. **NAT/bridge:** `server.mts` still calls Tally *directly* via `postTallyXML`. Hosted in the cloud it cannot
   reach an accountant's local Tally. Need a bridge (outbound tunnel from the Tally PC) + routing.
2. **Multi-tenancy:** auth is a single shared `PASSWORD` (default `'password'`) with **in-memory** client/token
   stores. Fine for one office / a demo; not for many accounts.

---

## 3. Shared foundation (Phase 0 — do first, both tracks depend on it)

Small refactor; unblocks everything.

1. **Transport seam in `tally.mts`.** Extract an interface so the tools don't hardcode a direct HTTP call:
   ```ts
   interface TallyTransport { post(xml: string): Promise<string>; }
   class DirectHttpTransport implements TallyTransport { /* current postTallyXML */ }
   ```
   `registerMcpServer(transport)` injects it; `mcp.mts`/`push.mts`/pull all call `transport.post(...)`.
   - Local/LAN uses `DirectHttpTransport`.
   - Hosted uses a `BridgeTransport` (Phase 3) that forwards over the tenant's bridge.
2. **`tally-status` health tool.** A friendly "am I connected to Tally?" tool that pings the gateway and returns
   a plain-language result + fix hint. Helps non-technical users in *both* interfaces (turns silent failures into
   "Tally isn't reachable — is TallyPrime open and set to act as Server?").
3. **Config plumbing.** Normalise `host`, `port`, and an optional `defaultCompany` (used as the
   `SVCURRENTCOMPANY` fallback) so both entry points read the same config.

---

## 4. Interface 1 — LAN Desktop Extension (`.mcpb`)

**User experience:** install Claude Desktop → drag one `.mcpb` into Settings → Extensions → a form asks for
*Tally host* (default `localhost`; on LAN, the Tally PC's IP) + *port* (9000) + optional default company →
toggle Tally's gateway once → chat. No JSON, no Node.

**Build:**
1. `manifest.json` (mcpb): `server.type = "node"`, entry `dist/index.mjs`; declare `user_config` fields
   (`tally_host` default `localhost`, `tally_port` number default 9000, `default_company` optional) and template
   them into the server's `env` (`TALLY_HOST`/`TALLY_PORT`/`TALLY_DEFAULT_COMPANY`). Claude Desktop ships the Node
   runtime, so the accountant needs neither Node nor npm.
2. Packaging pipeline: `npm run build` → `mcpb pack` → signed `.mcpb`. Add a `make dxt` target.
3. **Code signing / notarization** — Windows Authenticode + macOS Developer ID/notarization so the installer
   doesn't throw SmartScreen/Gatekeeper warnings at a non-technical user. (Worth the cert cost.)
4. Icon + directory metadata.
5. **LAN specifics** (when Claude runs on a *different* PC than Tally): a one-page guide + optional PowerShell
   helper to run **on the Tally PC** — set `tally.ini` to act as Server on all interfaces, and add a Windows
   Firewall inbound rule for TCP 9000.

**⚠ Packaging risk — native module.** `@duckdb/node-api` is a **native** addon. `.mcpb` bundles must include the
prebuilt binary for each target OS/arch, so either ship **per-platform `.mcpb` files**, or make DuckDB **lazy/
optional** (the caching layer) and degrade gracefully when absent. Resolve this early — it's the main technical
unknown for this track.

**Pros:** lowest friction; **data never leaves the machine** (a real trust selling point for financial books);
zero infra/auth to operate; works offline. **Cons:** only where Tally is LAN-reachable; no mobile/web.

**Effort: S–M** (mostly packaging + signing + the DuckDB question).

---

## 5. Interface 2 — Hosted connector + Tally Bridge agent

**User experience:** install one signed `.exe` on the Tally PC (autostarts, no npm) → it dials out to our cloud
and pairs to the accountant's account (pairing code / browser login) → in Claude (web/desktop/**mobile**) they add
our connector URL once and sign in (OAuth). Chat from anywhere.

**Topology (outbound bridge solves NAT — no port-forwarding, no exposing Tally to the internet):**
```
Claude (web/desktop/mobile)
   │  remote MCP over HTTPS (Streamable HTTP) + OAuth      ← server.mts already does this
   ▼
[Cloud: Remote MCP server]  ── maps authenticated account → its live bridge
   ▲  persistent OUTBOUND WebSocket, opened BY the bridge (traverses any NAT/firewall)
   │
[Tally Bridge agent on the accountant's Windows PC]
   ▼  local UTF-16 XML → 127.0.0.1:9000
[Tally Prime]
```

**Build (the big track):**
1. **`BridgeTransport`** (implements the Phase-0 seam): instead of direct HTTP, forward the XML over the
   requesting account's bridge WebSocket, correlate request/response by id, apply a timeout. Everything else in
   `mcp.mts`/tools is reused unchanged.
2. **Bridge registry + routing** in the cloud: authenticated MCP session → account → live bridge connection.
   In-memory for MVP; **Redis pub/sub** for horizontal scale (any MCP node can reach any bridge).
3. **The bridge agent** — Node relay compiled to a **single Windows `.exe`** (Node SEA / `bun build --compile` /
   `pkg`; the bridge needs **no DuckDB**, so it stays tiny). Runs as a Windows Service or tray app (status:
   *Cloud ✓ / Tally ✓*), auto-updates, auto-starts. macOS (launchd) later.
4. **Real multi-tenant auth** — replace the single `PASSWORD` + in-memory stores with per-account users and
   tenant isolation. Fastest route: a managed IdP (WorkOS / Auth0 / Clerk) behind the existing OAuth endpoints;
   or extend `server.mts`'s provider with a real user store. Bridges authenticate with a device credential
   (pairing code → long-lived device token, hashed at rest).
5. **Security & compliance (financial data — take seriously):** TLS end-to-end (WSS/HTTPS); **relay without
   retaining** book data (process in memory, don't log payloads); per-account isolation; **audit log of write
   operations** (create/cancel voucher, ledger edits); rate limiting; secret management for signing keys; a clear
   privacy policy. Honest caveat: any hosted connector means Anthropic's cloud (and the model) processes tool
   results — that's inherent; our commitment is "we relay, we don't retain."
6. Multi-company / multi-PC per account (an accountant with several clients).

**Effort: L + ongoing ops.**

---

## 6. Optional stepping-stone — single-office self-host + tunnel (fast mobile win)

`server.mts` **already** works as a remote MCP for one office *if it runs inside the LAN* (it can reach Tally
directly). Put it behind a **Cloudflare Tunnel / ngrok** for a public HTTPS URL and the accountant adds it as a
custom connector → **mobile/web access today**, reusing existing code, no bridge and no multi-tenant build.
Before exposing it: force a strong secret (kill the `'password'` default), and bind `allowedHosts` to the tunnel
domain. Good for pilots and a handful of offices; it does **not** scale to a clean consumer SaaS (each office
self-hosts / we host one instance each), but it's the cheapest way to validate the "from anywhere" demand while
Interface 2 is built.

---

## 7. Recommended sequence

1. **Phase 0 — shared foundation** (transport seam, `tally-status`, config). *Small, unblocks both.*
2. **Phase 1 — Interface 1 `.mcpb`** (+ resolve DuckDB native packaging, + signing, + LAN guide). *Ship the fast win to real accountants.*
3. **Phase 2 — tunnel stepping-stone** (harden `server.mts`, document Cloudflare Tunnel). *Cheap "works on mobile" for pilot offices.*
4. **Phase 3 — Interface 2** (bridge agent + `BridgeTransport` + registry + real multi-tenant auth + security). *The product.*
5. **Phase 4 — polish** (auto-update both artifacts, macOS bridge, admin dashboard, submit both to Claude's Connectors Directory for in-app discovery, observability).

## 8. Open questions to settle before Phase 3

- **Auth:** managed IdP (WorkOS/Auth0/Clerk) vs extend the in-repo OAuth server? (Managed = faster, safer.)
- **Hosting:** Fly.io / Render / Railway / AWS? (Need stateful WebSocket + a Redis.)
- **Data retention & compliance** posture to advertise (no-retention relay; audit logs; region).
- **Pricing / who pays** (per accountant? per client company?) — shapes tenancy model.
- **Bridge packaging tool:** Node SEA vs Bun `--compile` vs `pkg` (native-module-free relay makes all three viable).
