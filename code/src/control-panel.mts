// Local web control panel (double-click mode). Binds to 127.0.0.1 only and
// serves a single self-contained page where a non-technical user sets the Tally
// host/port/company, tests the connection, and registers the binary with Claude
// Desktop. All state lives in ~/.account-ai-for-tally/config.json (see config.mts).
import { spawn } from 'node:child_process';
import http from 'node:http';
import { XMLParser } from 'fast-xml-parser';
import express from 'express';
import { connectClaudeCode, connectClaudeDesktop } from './claude-config.mjs';
import {
  getConfigPath,
  getTallyConnection,
  loadConfig,
  saveConfig,
  type TallyConfig,
} from './config.mjs';
import { utility } from './utility.mjs';

// A minimal report-style TDL (same shape as pull/list-master.xml) that lists the
// companies loaded in Tally as <DATA><ROW><F01>name</F01></ROW>… — a response
// format this repo already parses reliably. Used to both prove reachability and
// return the company list for "Test connection".
const LIST_COMPANIES_XML = `<?xml version="1.0" encoding="utf-8"?>
<ENVELOPE>
    <HEADER>
        <VERSION>1</VERSION>
        <TALLYREQUEST>Export</TALLYREQUEST>
        <TYPE>Data</TYPE>
        <ID>MyTallyLiveReport</ID>
    </HEADER>
    <BODY>
        <DESC>
            <STATICVARIABLES>
                <SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT>
            </STATICVARIABLES>
            <TDL>
                <TDLMESSAGE>
                    <REPORT NAME="MyTallyLiveReport"><FORMS>MyForm</FORMS></REPORT>
                    <FORM NAME="MyForm"><PARTS>MyPart01</PARTS><XMLTAG>DATA</XMLTAG></FORM>
                    <PART NAME="MyPart01"><LINES>MyLine01</LINES><REPEAT>MyLine01 : MyCollection</REPEAT><SCROLLED>Vertical</SCROLLED></PART>
                    <LINE NAME="MyLine01"><FIELDS>FldName</FIELDS><XMLTAG>ROW</XMLTAG></LINE>
                    <FIELD NAME="FldName"><SET>$Name</SET><XMLTAG>F01</XMLTAG></FIELD>
                    <COLLECTION NAME="MyCollection"><TYPE>Company</TYPE></COLLECTION>
                </TDLMESSAGE>
            </TDL>
        </DESC>
    </BODY>
</ENVELOPE>`;

export type PingResult =
  | { ok: true; companies: string[] }
  | { ok: false; error: string };

/** Low-level UTF-16 XML POST to a specific host/port with a timeout. */
function postXmlTo(
  host: string,
  port: number,
  xml: string,
  timeoutMs = 5000,
): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const req = http.request(
      {
        hostname: host,
        port,
        path: '',
        method: 'POST',
        headers: {
          'Content-Length': Buffer.byteLength(xml, 'utf16le'),
          'Content-Type': 'text/xml;charset=utf-16',
        },
      },
      (res) => {
        let data = '';
        res
          .setEncoding('utf16le')
          .on('data', (chunk) => {
            data += chunk.toString() || '';
          })
          .on('end', () => resolve(data))
          .on('error', reject);
      },
    );
    req.setTimeout(timeoutMs, () => {
      req.destroy(new Error(`Connection to ${host}:${port} timed out`));
    });
    req.on('error', reject);
    req.write(xml, 'utf16le');
    req.end();
  });
}

/** Extract company names from the <DATA><ROW><F01>…</F01></ROW> response. */
export function parseCompanyNames(xml: string): string[] {
  const parser = new XMLParser({
    parseTagValue: false,
    isArray: (tagName) => tagName === 'ROW',
  });
  const parsed = parser.parse(xml);
  const rows = parsed?.DATA?.ROW;
  if (!Array.isArray(rows)) return [];
  const names: string[] = [];
  for (const row of rows) {
    const raw = row?.F01;
    if (typeof raw === 'string' && raw.trim() !== '') {
      names.push(utility.String.unescapeHTML(raw).trim());
    } else if (typeof raw === 'number') {
      names.push(String(raw));
    }
  }
  return names;
}

/** Ping Tally at host/port and return the list of loaded companies. */
export async function pingCompanies(
  host: string,
  port: number,
): Promise<PingResult> {
  try {
    const resp = await postXmlTo(host, port, LIST_COMPANIES_XML, 5000);
    if (!resp || resp.trim() === '') {
      return { ok: false, error: 'Empty response from Tally' };
    }
    if (resp.startsWith('<EXCEPTION>')) {
      const match = resp.match(/<EXCEPTION>([\s\S]*?)<\/EXCEPTION>/);
      return { ok: false, error: match?.[1]?.trim() || 'Tally returned an error' };
    }
    return { ok: true, companies: parseCompanyNames(resp) };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // Friendlier message for the common "can't reach it" failures.
    if (/ECONNREFUSED|EHOSTUNREACH|ENETUNREACH|ETIMEDOUT|timed out/i.test(msg)) {
      return {
        ok: false,
        error: `Could not connect to Tally at ${host}:${port}. Is Tally running with its gateway (Server) on this port, and reachable from this machine?`,
      };
    }
    return { ok: false, error: msg };
  }
}

/** Config for the UI: omit the password value, just flag whether one is set. */
function publicConfig(cfg: TallyConfig): Record<string, unknown> {
  return {
    tallyHost: cfg.tallyHost,
    tallyPort: cfg.tallyPort,
    defaultCompany: cfg.defaultCompany ?? '',
    controlPanelPort: cfg.controlPanelPort,
    hasPassword: Boolean(cfg.tallyPassword),
  };
}

export function createControlPanelApp(): express.Express {
  const app = express();
  app.use(express.json());

  app.get('/', (_req, res) => {
    res.type('html').send(PAGE_HTML);
  });

  app.get('/api/config', (_req, res) => {
    res.json(publicConfig(loadConfig()));
  });

  app.post('/api/config', (req, res) => {
    const body = req.body ?? {};
    const patch: Partial<TallyConfig> = {};
    if (typeof body.tallyHost === 'string') patch.tallyHost = body.tallyHost.trim();
    if (body.tallyPort !== undefined) {
      const p = parseInt(String(body.tallyPort), 10);
      if (!Number.isNaN(p)) patch.tallyPort = p;
    }
    if (typeof body.defaultCompany === 'string') {
      patch.defaultCompany = body.defaultCompany.trim();
    }
    if (typeof body.tallyPassword === 'string') {
      patch.tallyPassword = body.tallyPassword;
    }
    const merged = saveConfig(patch);
    res.json({ ok: true, config: publicConfig(merged) });
  });

  app.post('/api/test', async (req, res) => {
    const body = req.body ?? {};
    const cfg = loadConfig();
    const host =
      typeof body.tallyHost === 'string' && body.tallyHost.trim() !== ''
        ? body.tallyHost.trim()
        : cfg.tallyHost;
    const port =
      body.tallyPort !== undefined && !Number.isNaN(parseInt(String(body.tallyPort), 10))
        ? parseInt(String(body.tallyPort), 10)
        : cfg.tallyPort;
    const result = await pingCompanies(host, port);
    res.json(result);
  });

  app.post('/api/connect-desktop', (_req, res) => {
    res.json(connectClaudeDesktop(process.execPath));
  });

  app.post('/api/connect-code', (_req, res) => {
    res.json(connectClaudeCode(process.execPath));
  });

  app.get('/api/status', async (_req, res) => {
    const { host, port } = getTallyConnection();
    const ping = await pingCompanies(host, port);
    res.json({
      configPath: getConfigPath(),
      tally: { host, port, reachable: ping.ok },
    });
  });

  return app;
}

/** Best-effort: open the given URL in the default browser. Never throws. */
function openBrowser(url: string): void {
  // Skip in headless/automated contexts (tests, CI, servers).
  if (process.env.TALLY_MCP_NO_OPEN) return;
  try {
    let cmd: string;
    let args: string[];
    switch (process.platform) {
      case 'darwin':
        cmd = 'open';
        args = [url];
        break;
      case 'win32':
        cmd = 'cmd';
        args = ['/c', 'start', '', url];
        break;
      default:
        cmd = 'xdg-open';
        args = [url];
    }
    const child = spawn(cmd, args, { stdio: 'ignore', detached: true });
    child.on('error', () => {});
    child.unref();
  } catch {
    // ignore — the URL is printed to the console as a fallback
  }
}

/**
 * Start the control panel. Binds 127.0.0.1 on the configured port; if busy,
 * tries the next few ports. Prints the URL and opens the browser.
 */
export async function startControlPanel(): Promise<void> {
  const app = createControlPanelApp();
  const basePort = loadConfig().controlPanelPort;
  const host = '127.0.0.1';
  const maxAttempts = 10;

  const listen = (port: number, attemptsLeft: number): void => {
    const server = http.createServer(app);
    server.on('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'EADDRINUSE' && attemptsLeft > 0) {
        listen(port + 1, attemptsLeft - 1);
      } else {
        console.error(`Failed to start control panel: ${err.message}`);
        process.exit(1);
      }
    });
    server.listen(port, host, () => {
      const url = `http://${host}:${port}`;
      console.log(`Account AI for Tally control panel running at ${url}`);
      console.log(`Config file: ${getConfigPath()}`);
      openBrowser(url);
    });
  };

  listen(basePort, maxAttempts);
}

// --- The page (single self-contained screen) --------------------------------

export const PAGE_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Account AI for Tally — Setup</title>
<style>
  :root {
    --bg: #f5f6f8; --card: #ffffff; --text: #1c2430; --muted: #667085;
    --border: #e2e6ec; --accent: #2f6bff; --accent-text: #ffffff;
    --ok: #157347; --err: #c9372c; --field: #ffffff;
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --bg: #12151b; --card: #1b1f27; --text: #e7ebf0; --muted: #9aa4b2;
      --border: #2a2f3a; --accent: #4d82ff; --accent-text: #ffffff;
      --ok: #4ade80; --err: #f87171; --field: #12151b;
    }
  }
  * { box-sizing: border-box; }
  body {
    margin: 0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    background: var(--bg); color: var(--text); line-height: 1.5;
    display: flex; justify-content: center; padding: 32px 16px;
  }
  .card {
    background: var(--card); border: 1px solid var(--border); border-radius: 14px;
    width: 100%; max-width: 540px; padding: 28px; box-shadow: 0 6px 24px rgba(0,0,0,.06);
  }
  h1 { font-size: 22px; margin: 0 0 4px; }
  .sub { color: var(--muted); margin: 0 0 20px; font-size: 14px; }
  .status { padding: 10px 14px; border-radius: 10px; border: 1px solid var(--border);
    font-size: 14px; margin-bottom: 20px; background: var(--field); }
  .status.ok { color: var(--ok); }
  .status.err { color: var(--err); }
  label { display: block; font-size: 13px; font-weight: 600; margin: 14px 0 6px; }
  .hint { font-weight: 400; color: var(--muted); font-size: 12px; }
  input {
    width: 100%; padding: 10px 12px; border: 1px solid var(--border); border-radius: 9px;
    background: var(--field); color: var(--text); font-size: 14px;
  }
  input:focus { outline: 2px solid var(--accent); outline-offset: 1px; }
  .row { display: flex; gap: 12px; }
  .row > div { flex: 1; }
  .buttons { display: flex; flex-wrap: wrap; gap: 10px; margin-top: 22px; }
  button {
    border: 1px solid var(--border); background: var(--field); color: var(--text);
    padding: 10px 16px; border-radius: 9px; font-size: 14px; font-weight: 600; cursor: pointer;
  }
  button:hover { border-color: var(--accent); }
  button.primary { background: var(--accent); color: var(--accent-text); border-color: var(--accent); }
  button:disabled { opacity: .6; cursor: default; }
  .msg { margin-top: 16px; font-size: 14px; white-space: pre-wrap; }
  .msg.ok { color: var(--ok); }
  .msg.err { color: var(--err); }
  ul.companies { margin: 8px 0 0; padding-left: 18px; }
  code { background: var(--bg); padding: 1px 5px; border-radius: 5px; font-size: 12px; }
</style>
</head>
<body>
  <div class="card">
    <h1>Account AI for Tally — Setup</h1>
    <p class="sub">Connect Claude Desktop to your Tally Prime company. No JSON editing required.</p>

    <div id="status" class="status">Checking connection…</div>

    <label for="host">Tally host <span class="hint">(the PC running Tally; use its LAN IP if remote)</span></label>
    <input id="host" placeholder="localhost" />

    <div class="row">
      <div>
        <label for="port">Port</label>
        <input id="port" placeholder="9000" />
      </div>
      <div>
        <label for="company">Default company <span class="hint">(optional)</span></label>
        <input id="company" placeholder="(current company)" />
      </div>
    </div>

    <label for="password">Password <span class="hint">(optional — usually not needed)</span></label>
    <input id="password" type="password" placeholder="usually leave blank" />

    <div class="buttons">
      <button id="test" type="button">Test connection</button>
      <button id="save" type="button">Save</button>
      <button id="connectDesktop" type="button" class="primary">Add to Claude Desktop</button>
      <button id="connectCode" type="button" class="primary">Add to Claude Code</button>
    </div>
    <p class="sub" style="margin-top:12px">Use <b>Claude Desktop</b> for the desktop app, or <b>Claude Code</b> for the CLI — they store settings in different places.</p>

    <div id="msg" class="msg"></div>
  </div>

<script>
  const $ = (id) => document.getElementById(id);
  const msg = $("msg");
  function setMsg(text, cls) { msg.className = "msg " + (cls || ""); msg.textContent = text; }
  function setMsgHTML(html, cls) { msg.className = "msg " + (cls || ""); msg.innerHTML = html; }

  async function refreshStatus() {
    const s = $("status");
    try {
      const r = await fetch("/api/status");
      const d = await r.json();
      if (d.tally && d.tally.reachable) {
        s.className = "status ok";
        s.textContent = "✅ Connected to Tally at " + d.tally.host + ":" + d.tally.port;
      } else {
        s.className = "status err";
        s.textContent = "❌ Not connected to Tally at " + (d.tally ? d.tally.host + ":" + d.tally.port : "?") + " — check host/port and that Tally's gateway is on.";
      }
    } catch (e) {
      s.className = "status err";
      s.textContent = "❌ Could not reach the control panel API.";
    }
  }

  async function loadConfig() {
    try {
      const r = await fetch("/api/config");
      const d = await r.json();
      $("host").value = d.tallyHost || "";
      $("port").value = d.tallyPort || "";
      $("company").value = d.defaultCompany || "";
      if (d.hasPassword) $("password").placeholder = "••• (saved)";
    } catch (e) {}
  }

  function body() {
    return {
      tallyHost: $("host").value.trim(),
      tallyPort: $("port").value.trim(),
      defaultCompany: $("company").value.trim(),
      tallyPassword: $("password").value,
    };
  }

  $("test").onclick = async () => {
    setMsg("Testing connection…");
    try {
      const r = await fetch("/api/test", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tallyHost: $("host").value.trim(), tallyPort: $("port").value.trim() }),
      });
      const d = await r.json();
      if (d.ok) {
        const list = (d.companies || []).map((c) => "<li>" + c.replace(/</g, "&lt;") + "</li>").join("");
        setMsgHTML("✅ Connected. Companies found:" + (list ? "<ul class='companies'>" + list + "</ul>" : " (none loaded)"), "ok");
      } else {
        setMsg("❌ " + (d.error || "Connection failed"), "err");
      }
    } catch (e) { setMsg("❌ " + e.message, "err"); }
  };

  $("save").onclick = async () => {
    setMsg("Saving…");
    try {
      const r = await fetch("/api/config", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body()),
      });
      const d = await r.json();
      if (d.ok) { setMsg("✅ Saved.", "ok"); refreshStatus(); }
      else setMsg("❌ Failed to save.", "err");
    } catch (e) { setMsg("❌ " + e.message, "err"); }
  };

  async function connect(target) {
    const label = target === "code" ? "Claude Code" : "Claude Desktop";
    setMsg("Registering with " + label + "…");
    try {
      // Save current settings first so Claude uses them.
      await fetch("/api/config", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body()),
      });
      const r = await fetch("/api/connect-" + target, { method: "POST" });
      const d = await r.json();
      if (d.ok) {
        setMsg("✅ Added to " + label + ". Restart " + label + ", then ask it about your Tally data.\\nConfig: " + d.path, "ok");
      } else {
        setMsg("❌ " + (d.error || "Failed to update config"), "err");
      }
    } catch (e) { setMsg("❌ " + e.message, "err"); }
  }
  $("connectDesktop").onclick = () => connect("desktop");
  $("connectCode").onclick = () => connect("code");

  loadConfig();
  refreshStatus();
</script>
</body>
</html>`;
