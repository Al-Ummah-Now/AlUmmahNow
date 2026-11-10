/**
 * A D1Database on node:sqlite with this app's migrations applied, so SQL is
 * tested for real: prepare/bind/first/all/run/batch, the subset the code uses.
 */
import { DatabaseSync } from 'node:sqlite';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

// Tests run from apps/admin-api (pnpm test)
const MIGRATIONS = join(process.cwd(), 'migrations');

export function sqliteD1(migrations: string[] = readdirSync(MIGRATIONS).filter((f) => f.endsWith('.sql')).sort()): D1Database {
  const db = new DatabaseSync(':memory:');
  for (const file of migrations) db.exec(readFileSync(join(MIGRATIONS, file), 'utf8'));
  const exec = (sql: string, args: unknown[]) => {
    const stmt = db.prepare(sql);
    const params = args.map((a) => (a === undefined ? null : a)) as never[];
    if (/^\s*(SELECT|WITH)/i.test(sql)) return { results: stmt.all(...params), success: true, meta: { changes: 0 } };
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
