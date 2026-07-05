import { beforeEach, describe, expect, it, vi } from 'vitest';

// database.mts imports reportColumnMetadata from tally.mjs (which otherwise pulls
// in fs/http/nunjucks + reads pull/config.json). Mock it so the schema is
// controlled by the test and tally.mjs is never loaded.
vi.mock('./tally.mjs', () => ({
  reportColumnMetadata: vi.fn(),
}));

const { cacheTable, executeSQL } = await import('./database.mjs');
const tallyModule = await import('./tally.mjs');
const mockedMeta = vi.mocked(tallyModule.reportColumnMetadata);

const COLUMNS = [
  { identifier: 'LedgerName', name: 'ledger_name', datatype: 'string' },
  { identifier: 'GroupName', name: 'group_name', datatype: 'string' },
  { identifier: 'TxnDate', name: 'txn_date', datatype: 'date' },
  { identifier: 'Amount', name: 'amount', datatype: 'number' },
  { identifier: 'IsActive', name: 'is_active', datatype: 'boolean' },
];

// new Date(2025, 3, 1) == 1-Apr-2025 in local time (matches what tally.mts
// parseDate produces from Tally's "D-MMM-YY").
const DATA = [
  { ledger_name: 'Cash', group_name: 'Assets', txn_date: new Date(2025, 3, 1), amount: 1500, is_active: true },
  { ledger_name: 'Bank', group_name: 'Assets', txn_date: new Date(2025, 3, 15), amount: 2500.5, is_active: true },
  { ledger_name: 'Sales', group_name: 'Income', txn_date: new Date(2025, 4, 1), amount: -3000, is_active: false },
];

beforeEach(() => {
  mockedMeta.mockReset();
  mockedMeta.mockReturnValue(COLUMNS as any);
});

// ─── cacheTable ─────────────────────────────────────────────────────────────

describe('cacheTable', () => {
  it('returns empty string for empty or missing data', async () => {
    expect(await cacheTable('any', [])).toBe('');
    expect(await cacheTable('any', undefined as any)).toBe('');
  });

  it('returns empty string when the report has no column metadata', async () => {
    mockedMeta.mockReturnValue([] as any);
    expect(await cacheTable('any', DATA)).toBe('');
  });

  it('returns a table id (t_ prefix) for non-empty data', async () => {
    const tid = await cacheTable('trial-balance', DATA);
    expect(tid).toMatch(/^t_[0-9a-f]+$/);
  });

  it('creates independent tables per call', async () => {
    const a = await cacheTable('trial-balance', DATA);
    const b = await cacheTable('trial-balance', DATA);
    expect(a).not.toBe(b);
    // both are independently queryable
    expect((await executeSQL(`SELECT COUNT(*) FROM ${a}`)).split('\n')[1]).toBe('3');
    expect((await executeSQL(`SELECT COUNT(*) FROM ${b}`)).split('\n')[1]).toBe('3');
  });
});

// ─── round-trip / formatting ────────────────────────────────────────────────

describe('cacheTable + executeSQL round-trip', () => {
  it('returns a header row followed by data rows (TSV, no trailing newline)', async () => {
    const tid = await cacheTable('trial-balance', DATA);
    const out = await executeSQL(`SELECT ledger_name, amount FROM ${tid} ORDER BY amount DESC`);
    const lines = out.split('\n');
    expect(lines).toEqual([
      'ledger_name\tamount',
      'Bank\t2500.5',
      'Cash\t1500',
      'Sales\t-3000',
    ]);
    expect(out.endsWith('\n')).toBe(false);
  });

  it('formats integer-valued numbers without a trailing .0', async () => {
    const tid = await cacheTable('trial-balance', DATA);
    const out = await executeSQL(`SELECT amount FROM ${tid} WHERE ledger_name = 'Cash'`);
    expect(out).toBe('amount\n1500');
  });

  it('stores dates as YYYY-MM-DD text that sorts chronologically', async () => {
    const tid = await cacheTable('trial-balance', DATA);
    const out = await executeSQL(`SELECT txn_date FROM ${tid} ORDER BY txn_date`);
    expect(out).toBe('txn_date\n2025-04-01\n2025-04-15\n2025-05-01');
  });

  it('stores booleans as 0/1', async () => {
    const tid = await cacheTable('trial-balance', DATA);
    const out = await executeSQL(`SELECT is_active FROM ${tid} ORDER BY ledger_name`);
    // Bank=1, Cash=1, Sales=0
    expect(out).toBe('is_active\n1\n1\n0');
  });

  it('supports GROUP BY aggregation', async () => {
    const tid = await cacheTable('trial-balance', DATA);
    const out = await executeSQL(
      `SELECT group_name, SUM(amount) AS total FROM ${tid} GROUP BY group_name ORDER BY total DESC`,
    );
    expect(out).toBe('group_name\ttotal\nAssets\t4000.5\nIncome\t-3000');
  });

  it('supports WHERE filtering', async () => {
    const tid = await cacheTable('trial-balance', DATA);
    const out = await executeSQL(`SELECT ledger_name FROM ${tid} WHERE amount < 0`);
    expect(out).toBe('ledger_name\nSales');
  });

  it('returns the header even when no rows match', async () => {
    const tid = await cacheTable('trial-balance', DATA);
    const out = await executeSQL(`SELECT * FROM ${tid} WHERE amount > 999999`);
    expect(out).toBe('ledger_name\tgroup_name\ttxn_date\tamount\tis_active');
  });

  it('renders NULL values as empty cells', async () => {
    const rows = [
      { ledger_name: 'X', group_name: 'Y', txn_date: null, amount: undefined, is_active: null },
    ];
    const tid = await cacheTable('trial-balance', rows);
    const out = await executeSQL(`SELECT * FROM ${tid}`);
    expect(out).toBe('ledger_name\tgroup_name\ttxn_date\tamount\tis_active\nX\tY\t\t\t');
  });

  it('coerces non-numeric strings in number columns to NULL', async () => {
    const rows = [
      { ledger_name: 'Z', group_name: 'G', txn_date: new Date(2025, 0, 1), amount: 'n/a', is_active: true },
    ];
    const tid = await cacheTable('trial-balance', rows);
    const out = await executeSQL(`SELECT amount FROM ${tid}`);
    expect(out).toBe('amount\n');
  });
});

// ─── error handling ─────────────────────────────────────────────────────────

describe('executeSQL error handling', () => {
  it('rejects on invalid SQL / unknown table', async () => {
    await expect(executeSQL('SELECT * FROM does_not_exist')).rejects.toBeTruthy();
  });
});
