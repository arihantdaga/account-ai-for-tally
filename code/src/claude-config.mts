// Locate and safely patch Claude's config files so the control panel can
// register this binary as an MCP server without the user hand-editing JSON.
// Supports both Claude Desktop (claude_desktop_config.json) and Claude Code
// (~/.claude.json). Both use a top-level `mcpServers` object — only the file
// location differs.
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
 * Path to `claude_desktop_config.json` (the Claude Desktop app) for the current
 * OS. Override with `CLAUDE_DESKTOP_CONFIG_PATH` (used by tests so they never
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
 * Path to Claude Code's config (`~/.claude.json`), where user-scope (global)
 * MCP servers live under a top-level `mcpServers` object. Same on every OS
 * (the user's home directory). Override with `CLAUDE_CODE_CONFIG_PATH` (tests).
 */
export function getClaudeCodeConfigPath(): string {
  const override = process.env.CLAUDE_CODE_CONFIG_PATH;
  if (override && override.trim() !== '') return override;
  return path.join(os.homedir(), '.claude.json');
}

/**
 * Register (or update) a `tally` stdio MCP server entry in a Claude config file.
 * - Merges into any existing config; never clobbers other servers or top-level keys.
 * - Backs up the original to `<file>.bak` if it existed.
 * - If the existing file is not valid JSON, it is backed up and the operation
 *   is REFUSED (rather than overwritten) — important for the large, critical
 *   `~/.claude.json`.
 * - Uses `["--mcp"]` args so Claude always launches this binary in MCP mode.
 * Never throws — returns `{ ok: false, error }` on failure.
 */
export function registerTallyServer(
  binaryPath: string,
  configPath: string,
): ConnectClaudeResult {
  try {
    fs.mkdirSync(path.dirname(configPath), { recursive: true });

    let existed = false;
    let corrupt = false;
    let config: Record<string, unknown> = {};
    if (fs.existsSync(configPath)) {
      existed = true;
      try {
        const parsed = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          config = parsed as Record<string, unknown>;
        } else {
          corrupt = true; // valid JSON but not an object (e.g. array/number)
        }
      } catch {
        corrupt = true;
      }
    }

    // Always back up an existing file before doing anything else.
    let backedUp = false;
    if (existed) {
      try {
        fs.copyFileSync(configPath, `${configPath}.bak`);
        backedUp = true;
      } catch {
        backedUp = false;
      }
    }

    // Refuse to overwrite a config we couldn't parse — protects the user's
    // existing settings (especially the large ~/.claude.json).
    if (corrupt) {
      return {
        ok: false,
        path: configPath,
        backedUp,
        error: `${configPath} is not valid JSON. It was backed up to ${configPath}.bak — please fix or remove it and try again.`,
      };
    }

    const servers = config.mcpServers;
    if (!servers || typeof servers !== 'object' || Array.isArray(servers)) {
      config.mcpServers = {};
    }
    (config.mcpServers as Record<string, unknown>).tally = {
      type: 'stdio',
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

/** Register the binary with the Claude Desktop app. */
export function connectClaudeDesktop(
  binaryPath: string,
  configPath: string = getClaudeDesktopConfigPath(),
): ConnectClaudeResult {
  return registerTallyServer(binaryPath, configPath);
}

/** Register the binary with Claude Code (user scope, ~/.claude.json). */
export function connectClaudeCode(
  binaryPath: string,
  configPath: string = getClaudeCodeConfigPath(),
): ConnectClaudeResult {
  return registerTallyServer(binaryPath, configPath);
}
