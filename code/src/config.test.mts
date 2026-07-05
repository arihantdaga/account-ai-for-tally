import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  __resetConnectionCache,
  getConfigPath,
  getDefaultCompany,
  getTallyConnection,
  loadConfig,
  saveConfig,
} from './config.mjs';

let tmpDir: string;
const savedEnv = {
  dir: process.env.TALLY_MCP_CONFIG_DIR,
  host: process.env.TALLY_HOST,
  port: process.env.TALLY_PORT,
};

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tally-cfg-'));
  process.env.TALLY_MCP_CONFIG_DIR = tmpDir;
  delete process.env.TALLY_HOST;
  delete process.env.TALLY_PORT;
  __resetConnectionCache();
});

afterEach(() => {
  // restore env
  if (savedEnv.dir === undefined) delete process.env.TALLY_MCP_CONFIG_DIR;
  else process.env.TALLY_MCP_CONFIG_DIR = savedEnv.dir;
  if (savedEnv.host === undefined) delete process.env.TALLY_HOST;
  else process.env.TALLY_HOST = savedEnv.host;
  if (savedEnv.port === undefined) delete process.env.TALLY_PORT;
  else process.env.TALLY_PORT = savedEnv.port;
  vi.restoreAllMocks();
  try {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
});

function writeConfig(obj: unknown): void {
  fs.writeFileSync(getConfigPath(), JSON.stringify(obj), 'utf-8');
}

// ─── defaults / precedence ──────────────────────────────────────────────────

describe('loadConfig precedence (file > env > default)', () => {
  it('returns hardcoded defaults when there is no file and no env', () => {
    const cfg = loadConfig();
    expect(cfg.tallyHost).toBe('localhost');
    expect(cfg.tallyPort).toBe(9000);
    expect(cfg.controlPanelPort).toBe(4321);
    expect(cfg.defaultCompany).toBeUndefined();
  });

  it('uses env when the file is absent', () => {
    process.env.TALLY_HOST = '10.0.0.5';
    process.env.TALLY_PORT = '9001';
    const cfg = loadConfig();
    expect(cfg.tallyHost).toBe('10.0.0.5');
    expect(cfg.tallyPort).toBe(9001);
  });

  it('prefers the file value over env', () => {
    process.env.TALLY_HOST = 'env-host';
    process.env.TALLY_PORT = '1111';
    writeConfig({ tallyHost: 'file-host', tallyPort: 2222 });
    const cfg = loadConfig();
    expect(cfg.tallyHost).toBe('file-host');
    expect(cfg.tallyPort).toBe(2222);
  });

  it('falls back to env per-key when the file omits a key', () => {
    process.env.TALLY_HOST = 'env-host';
    process.env.TALLY_PORT = '1111';
    writeConfig({ tallyPort: 2222 }); // host omitted
    const cfg = loadConfig();
    expect(cfg.tallyHost).toBe('env-host'); // from env
    expect(cfg.tallyPort).toBe(2222); // from file
  });

  it('exposes optional defaultCompany and tallyPassword from the file', () => {
    writeConfig({ defaultCompany: 'Acme Ltd', tallyPassword: 'secret' });
    const cfg = loadConfig();
    expect(cfg.defaultCompany).toBe('Acme Ltd');
    expect(cfg.tallyPassword).toBe('secret');
    expect(getDefaultCompany()).toBe('Acme Ltd');
  });
});

// ─── corrupt-file tolerance ─────────────────────────────────────────────────

describe('corrupt / invalid config tolerance', () => {
  it('falls back to defaults on unparseable JSON without throwing', () => {
    fs.writeFileSync(getConfigPath(), '{ this is not json ', 'utf-8');
    expect(() => loadConfig()).not.toThrow();
    const cfg = loadConfig();
    expect(cfg.tallyHost).toBe('localhost');
    expect(cfg.tallyPort).toBe(9000);
  });

  it('ignores a non-object (array) config', () => {
    fs.writeFileSync(getConfigPath(), '[1,2,3]', 'utf-8');
    const cfg = loadConfig();
    expect(cfg.tallyHost).toBe('localhost');
  });
});

// ─── saveConfig round-trip ──────────────────────────────────────────────────

describe('saveConfig', () => {
  it('creates the dir, writes pretty JSON, and returns the merged config', () => {
    const nested = path.join(tmpDir, 'sub', 'dir');
    process.env.TALLY_MCP_CONFIG_DIR = nested;
    const merged = saveConfig({ tallyHost: '1.2.3.4', tallyPort: 9002 });
    expect(merged.tallyHost).toBe('1.2.3.4');
    expect(merged.tallyPort).toBe(9002);
    expect(fs.existsSync(getConfigPath())).toBe(true);
    const raw = fs.readFileSync(getConfigPath(), 'utf-8');
    expect(raw).toContain('\n'); // pretty-printed
    expect(JSON.parse(raw).tallyHost).toBe('1.2.3.4');
  });

  it('deep-merges onto existing file contents without clobbering other keys', () => {
    writeConfig({ tallyHost: 'keep-host', tallyPort: 9000, defaultCompany: 'Old Co' });
    const merged = saveConfig({ defaultCompany: 'New Co' });
    expect(merged.tallyHost).toBe('keep-host'); // preserved
    expect(merged.tallyPort).toBe(9000); // preserved
    expect(merged.defaultCompany).toBe('New Co'); // updated
  });

  it('round-trips through loadConfig', () => {
    saveConfig({ tallyHost: 'rt-host', tallyPort: 9999, defaultCompany: 'RT' });
    const cfg = loadConfig();
    expect(cfg.tallyHost).toBe('rt-host');
    expect(cfg.tallyPort).toBe(9999);
    expect(cfg.defaultCompany).toBe('RT');
  });

  it('ignores undefined values in the patch', () => {
    writeConfig({ tallyHost: 'stays' });
    const merged = saveConfig({ tallyHost: undefined, tallyPort: 8888 });
    expect(merged.tallyHost).toBe('stays');
    expect(merged.tallyPort).toBe(8888);
  });
});

// ─── getTallyConnection: live re-read + mtime cache ─────────────────────────

describe('getTallyConnection (mtime-cached live getter)', () => {
  it('resolves host/port from env when there is no file', () => {
    process.env.TALLY_HOST = 'live-host';
    process.env.TALLY_PORT = '9010';
    expect(getTallyConnection()).toEqual({ host: 'live-host', port: 9010 });
  });

  it('picks up a file change once the mtime advances', () => {
    writeConfig({ tallyHost: 'host-A', tallyPort: 9000 });
    expect(getTallyConnection()).toEqual({ host: 'host-A', port: 9000 });

    // rewrite the file directly (NOT via saveConfig, so only mtime can
    // invalidate the cache) and push mtime forward to guarantee a change
    writeConfig({ tallyHost: 'host-B', tallyPort: 9001 });
    const future = new Date(Date.now() + 2000);
    fs.utimesSync(getConfigPath(), future, future);

    expect(getTallyConnection()).toEqual({ host: 'host-B', port: 9001 });
  });

  it('does not re-read the file when the mtime is unchanged (cache hit)', () => {
    writeConfig({ tallyHost: 'cache-host', tallyPort: 9000 });
    // first call populates the cache
    expect(getTallyConnection()).toEqual({ host: 'cache-host', port: 9000 });

    const readSpy = vi.spyOn(fs, 'readFileSync');
    // second call with unchanged mtime should serve from cache
    expect(getTallyConnection()).toEqual({ host: 'cache-host', port: 9000 });
    expect(readSpy).not.toHaveBeenCalled();
  });
});
