// Shared configuration for the Tally MCP server + control panel.
//
// A single JSON file (`~/.tally-mcp/config.json`) is the source of truth for the
// Tally connection. It is written by the control panel and read *live* by the
// MCP server on every Tally request (see tally.mts) so a change in the panel
// takes effect without restarting Claude.
//
// Precedence per key: file value → env (TALLY_HOST/TALLY_PORT) → hardcoded
// default. This keeps existing env-based Claude Desktop setups working.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export interface TallyConfig {
  tallyHost: string; // default 'localhost'
  tallyPort: number; // default 9000
  tallyPassword?: string; // optional/reserved — stored but not sent yet
  defaultCompany?: string; // optional SVCURRENTCOMPANY fallback
  controlPanelPort: number; // default 4321
}

const DEFAULT_HOST = 'localhost';
const DEFAULT_PORT = 9000;
const DEFAULT_CONTROL_PANEL_PORT = 4321;

/**
 * Directory that holds config.json. Defaults to `~/.tally-mcp`; can be
 * redirected with the `TALLY_MCP_CONFIG_DIR` env var (used by tests, and handy
 * for pointing a run at an isolated config without touching the real home dir).
 */
export function getConfigDir(): string {
  const override = process.env.TALLY_MCP_CONFIG_DIR;
  if (override && override.trim() !== '') return override;
  return path.join(os.homedir(), '.tally-mcp');
}

export function getConfigPath(): string {
  return path.join(getConfigDir(), 'config.json');
}

/** Read the raw file contents, tolerating a missing or corrupt file. */
function readRawConfig(): Partial<TallyConfig> {
  try {
    const raw = fs.readFileSync(getConfigPath(), 'utf-8');
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Partial<TallyConfig>;
    }
    return {};
  } catch {
    // missing / unreadable / corrupt JSON → behave as if empty
    return {};
  }
}

function envPort(): number | undefined {
  const raw = process.env.TALLY_PORT;
  if (!raw) return undefined;
  const n = parseInt(raw, 10);
  return Number.isNaN(n) ? undefined : n;
}

/**
 * Resolve the effective config: file value → env → default, per key.
 * Never throws — falls back to defaults if the file is absent/corrupt.
 */
export function loadConfig(): TallyConfig {
  const file = readRawConfig();

  const tallyHost =
    typeof file.tallyHost === 'string' && file.tallyHost.trim() !== ''
      ? file.tallyHost
      : process.env.TALLY_HOST || DEFAULT_HOST;

  const tallyPort =
    typeof file.tallyPort === 'number' && !Number.isNaN(file.tallyPort)
      ? file.tallyPort
      : (envPort() ?? DEFAULT_PORT);

  const controlPanelPort =
    typeof file.controlPanelPort === 'number' &&
    !Number.isNaN(file.controlPanelPort)
      ? file.controlPanelPort
      : DEFAULT_CONTROL_PANEL_PORT;

  const config: TallyConfig = { tallyHost, tallyPort, controlPanelPort };

  if (typeof file.defaultCompany === 'string' && file.defaultCompany !== '') {
    config.defaultCompany = file.defaultCompany;
  }
  if (typeof file.tallyPassword === 'string' && file.tallyPassword !== '') {
    config.tallyPassword = file.tallyPassword;
  }

  return config;
}

/**
 * Deep-merge `patch` onto the current file contents, write pretty JSON, and
 * return the fully-resolved config. Creates the config dir if needed.
 */
export function saveConfig(patch: Partial<TallyConfig>): TallyConfig {
  const current = readRawConfig();
  const merged: Partial<TallyConfig> = { ...current };
  for (const [key, value] of Object.entries(patch)) {
    if (value !== undefined) {
      (merged as Record<string, unknown>)[key] = value;
    }
  }

  fs.mkdirSync(getConfigDir(), { recursive: true });
  fs.writeFileSync(getConfigPath(), JSON.stringify(merged, null, 2), 'utf-8');

  // invalidate the live-connection cache so the next request re-reads
  connCache = null;

  return loadConfig();
}

// --- live connection getter (mtime-cached) ---------------------------------

let connCache: { key: string; host: string; port: number } | null = null;

/**
 * Host/port for the *next* Tally request. Called on every request by tally.mts.
 * Re-reads config.json but caches by file mtime (nanosecond precision) so a
 * change in the panel is picked up immediately without hammering the disk.
 */
export function getTallyConnection(): { host: string; port: number } {
  try {
    const p = getConfigPath();
    const stat = fs.statSync(p, { bigint: true });
    const key = `${p}:${stat.mtimeNs.toString()}`;
    if (connCache && connCache.key === key) {
      return { host: connCache.host, port: connCache.port };
    }
    const cfg = loadConfig();
    connCache = { key, host: cfg.tallyHost, port: cfg.tallyPort };
    return { host: cfg.tallyHost, port: cfg.tallyPort };
  } catch {
    // file absent/unreadable → resolve from env/default (no caching)
    const cfg = loadConfig();
    return { host: cfg.tallyHost, port: cfg.tallyPort };
  }
}

export function getDefaultCompany(): string | undefined {
  return loadConfig().defaultCompany;
}

/** Test-only: drop the cached live connection. */
export function __resetConnectionCache(): void {
  connCache = null;
}
