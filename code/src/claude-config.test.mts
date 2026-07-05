import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  connectClaudeCode,
  connectClaudeDesktop,
  getClaudeCodeConfigPath,
  getClaudeDesktopConfigPath,
} from './claude-config.mjs';

let tmpDir: string;
let cfgPath: string;
const savedDesktop = process.env.CLAUDE_DESKTOP_CONFIG_PATH;
const savedCode = process.env.CLAUDE_CODE_CONFIG_PATH;

const TALLY_ENTRY = { type: 'stdio', command: '/opt/account-ai-for-tally', args: ['--mcp'] };

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-cfg-'));
  cfgPath = path.join(tmpDir, 'Claude', 'config.json'); // nested → exercises mkdir -p
});

afterEach(() => {
  if (savedDesktop === undefined) delete process.env.CLAUDE_DESKTOP_CONFIG_PATH;
  else process.env.CLAUDE_DESKTOP_CONFIG_PATH = savedDesktop;
  if (savedCode === undefined) delete process.env.CLAUDE_CODE_CONFIG_PATH;
  else process.env.CLAUDE_CODE_CONFIG_PATH = savedCode;
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

describe('config path resolution', () => {
  it('Desktop: honours CLAUDE_DESKTOP_CONFIG_PATH override', () => {
    process.env.CLAUDE_DESKTOP_CONFIG_PATH = '/tmp/custom/desktop.json';
    expect(getClaudeDesktopConfigPath()).toBe('/tmp/custom/desktop.json');
  });

  it('Desktop: default ends with claude_desktop_config.json', () => {
    delete process.env.CLAUDE_DESKTOP_CONFIG_PATH;
    expect(getClaudeDesktopConfigPath().endsWith('claude_desktop_config.json')).toBe(true);
  });

  it('Code: honours CLAUDE_CODE_CONFIG_PATH override', () => {
    process.env.CLAUDE_CODE_CONFIG_PATH = '/tmp/custom/.claude.json';
    expect(getClaudeCodeConfigPath()).toBe('/tmp/custom/.claude.json');
  });

  it('Code: default is ~/.claude.json', () => {
    delete process.env.CLAUDE_CODE_CONFIG_PATH;
    expect(getClaudeCodeConfigPath()).toBe(path.join(os.homedir(), '.claude.json'));
  });
});

// ─── creating an entry ───────────────────────────────────────────────────────

describe('connect — fresh config', () => {
  it('creates the file (and parent dirs) with a stdio tally entry, no backup', () => {
    const result = connectClaudeDesktop('/opt/account-ai-for-tally', cfgPath);
    expect(result.ok).toBe(true);
    expect(result.path).toBe(cfgPath);
    expect(result.backedUp).toBe(false);
    expect(readJson(cfgPath).mcpServers.tally).toEqual(TALLY_ENTRY);
    expect(fs.existsSync(`${cfgPath}.bak`)).toBe(false);
  });

  it('always sets type=stdio and args=["--mcp"]', () => {
    connectClaudeCode('/opt/account-ai-for-tally', cfgPath);
    const entry = readJson(cfgPath).mcpServers.tally;
    expect(entry.type).toBe('stdio');
    expect(entry.args).toEqual(['--mcp']);
  });
});

// ─── merging into an existing config ─────────────────────────────────────────

describe('connect — existing config', () => {
  it('merges without clobbering other servers or top-level keys, and backs up', () => {
    fs.mkdirSync(path.dirname(cfgPath), { recursive: true });
    const original = {
      numStartups: 42,
      mcpServers: {
        context7: { type: 'http', url: 'https://example' },
        other: { command: '/usr/bin/other', args: ['x'] },
      },
    };
    fs.writeFileSync(cfgPath, JSON.stringify(original, null, 2), 'utf-8');

    const result = connectClaudeCode('/opt/account-ai-for-tally', cfgPath);
    expect(result.ok).toBe(true);
    expect(result.backedUp).toBe(true);

    const cfg = readJson(cfgPath);
    expect(cfg.mcpServers.context7).toEqual({ type: 'http', url: 'https://example' });
    expect(cfg.mcpServers.other).toEqual({ command: '/usr/bin/other', args: ['x'] });
    expect(cfg.mcpServers.tally).toEqual(TALLY_ENTRY);
    expect(cfg.numStartups).toBe(42);

    // backup holds the original, unmodified content
    expect(readJson(`${cfgPath}.bak`)).toEqual(original);
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
      type: 'stdio',
      command: '/new/path',
      args: ['--mcp'],
    });
  });

  it('adds mcpServers when the existing config lacks it', () => {
    fs.mkdirSync(path.dirname(cfgPath), { recursive: true });
    fs.writeFileSync(cfgPath, JSON.stringify({ someOther: true }), 'utf-8');
    const result = connectClaudeDesktop('/opt/account-ai-for-tally', cfgPath);
    expect(result.ok).toBe(true);
    const cfg = readJson(cfgPath);
    expect(cfg.someOther).toBe(true);
    expect(cfg.mcpServers.tally.command).toBe('/opt/account-ai-for-tally');
  });
});

// ─── corrupt existing config: REFUSE, don't overwrite ────────────────────────

describe('connect — corrupt config is protected', () => {
  it('backs up but refuses to overwrite an unparseable config', () => {
    fs.mkdirSync(path.dirname(cfgPath), { recursive: true });
    fs.writeFileSync(cfgPath, 'not valid json {{{', 'utf-8');

    const result = connectClaudeCode('/opt/account-ai-for-tally', cfgPath);
    expect(result.ok).toBe(false);
    expect(result.backedUp).toBe(true);
    expect(result.error).toMatch(/not valid JSON/i);

    // original left UNCHANGED (critical for the large ~/.claude.json)
    expect(fs.readFileSync(cfgPath, 'utf-8')).toBe('not valid json {{{');
    expect(fs.readFileSync(`${cfgPath}.bak`, 'utf-8')).toBe('not valid json {{{');
  });
});
