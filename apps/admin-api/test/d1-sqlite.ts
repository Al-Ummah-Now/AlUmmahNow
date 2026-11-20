/**
 * A D1Database on node:sqlite with this app's migrations applied, so SQL is
 * tested for real: prepare/bind/first/all/run/batch, the subset the code uses.
 */
import { DatabaseSync } from 'node:sqlite';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

// Tests run from apps/admin-api (pnpm test)
const MIGRATIONS = join(process.cwd(), 'migrations');

/**
 * `beforeMigration(file, sql)` runs raw SQL just before a migration file is applied: a test can put the
 * data a later migration meets in production in place (e.g. an admin's edit made before a data fix).
 */
export function sqliteD1(
  migrations: string[] = readdirSync(MIGRATIONS).filter((f) => f.endsWith('.sql')).sort(),
  beforeMigration?: (file: string, sql: (statement: string) => void) => void,
): D1Database {
  const db = new DatabaseSync(':memory:');
  for (const file of migrations) {
    beforeMigration?.(file, (statement) => db.exec(statement));
    db.exec(readFileSync(join(MIGRATIONS, file), 'utf8'));
  }
  const exec = (sql: string, args: unknown[]) => {
    // D1 refuses LIKE/GLOB patterns over 50 bytes (SQLITE_MAX_LIKE_PATTERN_LENGTH); node:sqlite allows
    // 50,000, so a bound pattern that only works here would fail in production
    if (/\b(LIKE|GLOB)\s+\?/i.test(sql) && args.some((a) => typeof a === 'string' && Buffer.byteLength(a) > 50 && /[%_*?]/.test(a))) {
      throw new Error('D1_ERROR: LIKE or GLOB pattern too complex: SQLITE_ERROR');
    }
    const stmt = db.prepare(sql);
    const params = args.map((a) => (a === undefined ? null : a)) as never[];
    if (/^\s*(SELECT|WITH)/i.test(sql)) return { results: stmt.all(...params), success: true, meta: { changes: 0 } };
    // INSERT/UPDATE ... RETURNING: rows come back like a SELECT
    if (/\bRETURNING\b/i.test(sql)) {
      const rows = stmt.all(...params);
      return { results: rows, success: true, meta: { changes: rows.length } };
    }
    const r = stmt.run(...params);
    return { results: [], success: true, meta: { changes: Number(r.changes) } };
  };
  const statement = (sql: string, args: unknown[] = []) => ({
    bind: (...next: unknown[]) => statement(sql, next),
    first: async <T>() => ((exec(sql, args).results[0] as T) ?? null),
    all: async () => exec(sql, args),
    run: async () => exec(sql, args),
    _exec: () => exec(sql, args),
  });
  return {
    prepare: (sql: string) => statement(sql),
    batch: async (list: { _exec(): unknown }[]) => list.map((s) => s._exec()),
  } as unknown as D1Database;
}
