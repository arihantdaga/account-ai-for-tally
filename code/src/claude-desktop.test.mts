import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  connectClaudeDesktop,
  getClaudeDesktopConfigPath,
} from './claude-desktop.mjs';

let tmpDir: string;
let cfgPath: string;
const savedOverride = process.env.CLAUDE_DESKTOP_CONFIG_PATH;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-cfg-'));
  // deliberately nested so we exercise mkdir -p
  cfgPath = path.join(tmpDir, 'Claude', 'claude_desktop_config.json');
});

afterEach(() => {
  if (savedOverride === undefined) delete process.env.CLAUDE_DESKTOP_CONFIG_PATH;
  else process.env.CLAUDE_DESKTOP_CONFIG_PATH = savedOverride;
  try {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
});

function readJson(p: string): any {
  return JSON.parse(fs.readFileSync(p, 'utf-8'));
}

// ─── config path resolution ─────────────────────────────────────────────────

describe('getClaudeDesktopConfigPath', () => {
  it('honours the CLAUDE_DESKTOP_CONFIG_PATH override', () => {
    process.env.CLAUDE_DESKTOP_CONFIG_PATH = '/tmp/custom/claude.json';
    expect(getClaudeDesktopConfigPath()).toBe('/tmp/custom/claude.json');
  });

  it('ends with claude_desktop_config.json for the current platform default', () => {
    delete process.env.CLAUDE_DESKTOP_CONFIG_PATH;
    expect(getClaudeDesktopConfigPath().endsWith('claude_desktop_config.json')).toBe(
      true,
    );
  });
});

// ─── creating an entry ───────────────────────────────────────────────────────

describe('connectClaudeDesktop — fresh config', () => {
  it('creates the file (and parent dirs) with a tally entry, no backup', () => {
    const result = connectClaudeDesktop('/opt/tally-mcp', cfgPath);
    expect(result.ok).toBe(true);
    expect(result.path).toBe(cfgPath);
    expect(result.backedUp).toBe(false);

    const cfg = readJson(cfgPath);
    expect(cfg.mcpServers.tally).toEqual({
      command: '/opt/tally-mcp',
      args: ['--mcp'],
    });
    expect(fs.existsSync(`${cfgPath}.bak`)).toBe(false);
  });

  it('always sets args to ["--mcp"]', () => {
    connectClaudeDesktop('/opt/tally-mcp', cfgPath);
    expect(readJson(cfgPath).mcpServers.tally.args).toEqual(['--mcp']);
  });
});

// ─── merging into an existing config ─────────────────────────────────────────

describe('connectClaudeDesktop — existing config', () => {
  it('merges without clobbering other servers or top-level keys, and backs up', () => {
    fs.mkdirSync(path.dirname(cfgPath), { recursive: true });
    const original = {
      globalShortcut: 'Cmd+Space',
      mcpServers: {
        other: { command: '/usr/bin/other', args: ['x'] },
      },
    };
    fs.writeFileSync(cfgPath, JSON.stringify(original, null, 2), 'utf-8');

    const result = connectClaudeDesktop('/opt/tally-mcp', cfgPath);
    expect(result.ok).toBe(true);
    expect(result.backedUp).toBe(true);

    const cfg = readJson(cfgPath);
    // other server preserved
    expect(cfg.mcpServers.other).toEqual({ command: '/usr/bin/other', args: ['x'] });
    // tally added
    expect(cfg.mcpServers.tally).toEqual({ command: '/opt/tally-mcp', args: ['--mcp'] });
    // unrelated top-level key preserved
    expect(cfg.globalShortcut).toBe('Cmd+Space');

    // backup holds the original, unmodified content
    const bak = readJson(`${cfgPath}.bak`);
    expect(bak).toEqual(original);
    expect(bak.mcpServers.tally).toBeUndefined();
  });

  it('overwrites an existing tally entry (idempotent re-register)', () => {
    fs.mkdirSync(path.dirname(cfgPath), { recursive: true });
    fs.writeFileSync(
      cfgPath,
      JSON.stringify({ mcpServers: { tally: { command: '/old/path', args: [] } } }),
      'utf-8',
    );
    connectClaudeDesktop('/new/path', cfgPath);
    expect(readJson(cfgPath).mcpServers.tally).toEqual({
      command: '/new/path',
      args: ['--mcp'],
    });
  });

  it('adds mcpServers when the existing config lacks it', () => {
    fs.mkdirSync(path.dirname(cfgPath), { recursive: true });
    fs.writeFileSync(cfgPath, JSON.stringify({ someOther: true }), 'utf-8');
    const result = connectClaudeDesktop('/opt/tally-mcp', cfgPath);
    expect(result.ok).toBe(true);
    const cfg = readJson(cfgPath);
    expect(cfg.someOther).toBe(true);
    expect(cfg.mcpServers.tally.command).toBe('/opt/tally-mcp');
  });
});

// ─── corrupt existing config ─────────────────────────────────────────────────

describe('connectClaudeDesktop — corrupt config', () => {
  it('backs up the corrupt file and writes a fresh valid config', () => {
    fs.mkdirSync(path.dirname(cfgPath), { recursive: true });
    fs.writeFileSync(cfgPath, 'not valid json {{{', 'utf-8');

    const result = connectClaudeDesktop('/opt/tally-mcp', cfgPath);
    expect(result.ok).toBe(true);
    expect(result.backedUp).toBe(true);

    // new file is valid and has the tally entry
    const cfg = readJson(cfgPath);
    expect(cfg.mcpServers.tally.command).toBe('/opt/tally-mcp');

    // original (corrupt) content preserved in the backup
    expect(fs.readFileSync(`${cfgPath}.bak`, 'utf-8')).toBe('not valid json {{{');
  });
});
