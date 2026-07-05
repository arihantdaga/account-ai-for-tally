// Locate and safely patch Claude Desktop's config so the control panel's
// "Connect to Claude Desktop" button registers this binary as an MCP server
// without the user hand-editing JSON.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export interface ConnectClaudeResult {
  ok: boolean;
  path?: string;
  backedUp?: boolean;
  error?: string;
}

/**
 * Path to `claude_desktop_config.json` for the current OS. Can be overridden
 * with the `CLAUDE_DESKTOP_CONFIG_PATH` env var (used by tests so they never
 * touch the real file).
 */
export function getClaudeDesktopConfigPath(): string {
  const override = process.env.CLAUDE_DESKTOP_CONFIG_PATH;
  if (override && override.trim() !== '') return override;

  switch (process.platform) {
    case 'darwin':
      return path.join(
        os.homedir(),
        'Library',
        'Application Support',
        'Claude',
        'claude_desktop_config.json',
      );
    case 'win32': {
      const appData =
        process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
      return path.join(appData, 'Claude', 'claude_desktop_config.json');
    }
    default:
      // linux + others
      return path.join(
        os.homedir(),
        '.config',
        'Claude',
        'claude_desktop_config.json',
      );
  }
}

/**
 * Register (or update) a `tally` MCP server entry in Claude Desktop's config.
 * - Merges into any existing config without clobbering other servers.
 * - Backs up the original to `<file>.bak` if it existed.
 * - Uses `["--mcp"]` args so Claude always launches this binary in MCP mode.
 * Never throws — returns `{ ok: false, error }` on failure.
 */
export function connectClaudeDesktop(
  binaryPath: string,
  configPath: string = getClaudeDesktopConfigPath(),
): ConnectClaudeResult {
  try {
    fs.mkdirSync(path.dirname(configPath), { recursive: true });

    let existed = false;
    let config: Record<string, unknown> = {};
    if (fs.existsSync(configPath)) {
      existed = true;
      try {
        const parsed = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          config = parsed as Record<string, unknown>;
        }
      } catch {
        // corrupt JSON → start fresh (the original is preserved via .bak below)
        config = {};
      }
    }

    // Back up the original before overwriting (only if it existed).
    let backedUp = false;
    if (existed) {
      try {
        fs.copyFileSync(configPath, `${configPath}.bak`);
        backedUp = true;
      } catch {
        backedUp = false;
      }
    }

    const servers = config.mcpServers;
    if (!servers || typeof servers !== 'object' || Array.isArray(servers)) {
      config.mcpServers = {};
    }
    (config.mcpServers as Record<string, unknown>).tally = {
      command: binaryPath,
      args: ['--mcp'],
    };

    fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8');
    return { ok: true, path: configPath, backedUp };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
