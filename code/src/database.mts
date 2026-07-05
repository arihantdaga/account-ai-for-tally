import crypto from 'node:crypto';
import initSqlJs from 'sql.js';
import { sqljsWasmBase64 } from './generated/embedded.mjs';
import type { ModelPullReportOutputFieldInfo } from './models.mjs';
import { reportColumnMetadata } from './tally.mjs';

// sql.js is SQLite compiled to WebAssembly — a pure JS/WASM engine with no
// native addon, so the whole server can be bundled into a single portable
// executable (no per-platform .node binary to ship, unlike DuckDB).
// A static import (not createRequire) keeps it visible to Bun's bundler so it
// gets embedded in the compiled binary.

// In-memory database — same lifecycle as the previous DuckDB `:memory:` engine:
// tables are created per report, queried during a conversation, and dropped
// after 15 minutes. Nothing is persisted across process restarts (by design).
// The wasm bytes are passed in directly (embedded at build time) so sql.js never
// touches the filesystem or node_modules — required for the single-binary build.
// biome-ignore lint/suspicious/noExplicitAny: sql.js Database instance is untyped here.
const SQL: any = await initSqlJs({
  wasmBinary: Buffer.from(sqljsWasmBase64, 'base64'),
});
// biome-ignore lint/suspicious/noExplicitAny: sql.js Database instance is untyped here.
const db: any = new SQL.Database();

const generateRandomString = (): string => {
  return 't_' + crypto.randomUUID().replace(/-/g, '');
};

// Map a report field's logical datatype to a SQLite column affinity.
// SQLite has no DECIMAL/DATE/BOOLEAN types, so:
//   number  -> REAL     (fine for report display/aggregation)
//   boolean -> INTEGER  (0/1)
//   date    -> TEXT     ('YYYY-MM-DD', which sorts and compares chronologically)
//   other   -> TEXT
function sqliteType(datatype: string): string {
  if (datatype === 'number') return 'REAL';
  if (datatype === 'boolean') return 'INTEGER';
  return 'TEXT'; // date (ISO string) and everything else
}

// Convert a JS row value into what sql.js should bind for the given datatype.
// biome-ignore lint/suspicious/noExplicitAny: values come from loosely-typed report rows.
function toBindValue(value: any, datatype: string): any {
  if (value === undefined || value === null) return null;

  if (datatype === 'number') {
    const n = typeof value === 'number' ? value : Number(value);
    return Number.isNaN(n) ? null : n;
  }

  if (datatype === 'boolean') {
    return value ? 1 : 0;
  }

  if (datatype === 'date') {
    if (value instanceof Date) {
      // Store the Date's *local* Y/M/D (which is what tally.mts `parseDate`
      // produced from Tally's "D-MMM-YY") as an ISO date string. Using local
      // components avoids the timezone day-shift that the DuckDB path had to
      // work around, and ISO text sorts/filters chronologically in SQLite.
      const y = value.getFullYear();
      const m = String(value.getMonth() + 1).padStart(2, '0');
      const d = String(value.getDate()).padStart(2, '0');
      return `${y}-${m}-${d}`;
    }
    return null;
  }

  // text / other
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

export function cacheTable(reportName: string, data: any[]): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    try {
      // no table to be created if no data is found
      if (!data || data.length === 0) return resolve('');

      const columns: ModelPullReportOutputFieldInfo[] =
        reportColumnMetadata(reportName) || [];
      if (columns.length === 0) return resolve('');

      // generate a random table name (fresh UUID => never collides)
      const tableId = generateRandomString();

      const columnDefs = columns
        .map((col) => `"${col.name}" ${sqliteType(col.datatype)}`)
        .join(', ');
      db.run(`CREATE TABLE "${tableId}" (${columnDefs});`);

      // Bulk-insert inside a single transaction with a prepared statement.
      // (Row-by-row autocommit inserts are pathologically slow in SQLite;
      // one transaction keeps this on par with DuckDB's appender.)
      const placeholders = columns.map(() => '?').join(', ');
      const stmt = db.prepare(`INSERT INTO "${tableId}" VALUES (${placeholders});`);
      db.run('BEGIN;');
      try {
        for (const row of data) {
          const values = columns.map((col) => toBindValue(row[col.name], col.datatype));
          stmt.run(values);
        }
        db.run('COMMIT;');
      } catch (txErr) {
        db.run('ROLLBACK;');
        throw txErr;
      } finally {
        stmt.free();
      }

      // drop the table after 15 min; unref so it never keeps the process alive
      const timer = setTimeout(
        () => {
          try {
            db.run(`DROP TABLE IF EXISTS "${tableId}";`);
          } catch {
            /* table may already be gone */
          }
        },
        15 * 60 * 1000,
      );
      if (typeof timer.unref === 'function') timer.unref();

      resolve(tableId);
    } catch (err) {
      console.error(JSON.stringify(err));
      reject(err);
    }
  });
}

export function executeSQL(sql: string): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    // biome-ignore lint/suspicious/noExplicitAny: sql.js Statement is untyped here.
    let stmt: any;
    try {
      // Use prepare/step (not db.exec) so column headers are returned even when
      // the query matches zero rows — matching the previous engine's behaviour.
      stmt = db.prepare(sql);
      const headers: string[] = stmt.getColumnNames();

      let retval = headers.join('\t') + '\n';
      while (stmt.step()) {
        // biome-ignore lint/suspicious/noExplicitAny: cell values are dynamic.
        const rowValues: any[] = stmt.get();
        const rowText = rowValues.map((cell) =>
          cell === null || cell === undefined ? '' : String(cell),
        );
        retval += rowText.join('\t') + '\n';
      }
      // remove last newline
      retval = retval.slice(0, -1);

      resolve(retval);
    } catch (err) {
      console.error(JSON.stringify(err));
      reject(err);
    } finally {
      if (stmt) stmt.free();
    }
  });
}
