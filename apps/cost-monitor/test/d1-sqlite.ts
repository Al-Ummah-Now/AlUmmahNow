/**
 * A D1Database on node:sqlite with this app's migrations applied, so SQL is
 * tested for real (the subset the collector uses).
 */
import { DatabaseSync } from 'node:sqlite';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

// Tests run from apps/cost-monitor (pnpm test)
export const MIGRATIONS = join(process.cwd(), 'migrations');

export function sqliteD1(dir = MIGRATIONS): D1Database {
  const db = new DatabaseSync(':memory:');
  for (const file of readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()) db.exec(readFileSync(join(dir, file), 'utf8'));
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
