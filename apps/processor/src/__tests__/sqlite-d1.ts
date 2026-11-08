/**
 * In-memory D1 stand-in backed by node:sqlite, with the notifications
 * migrations applied, so tests run the real SQL.
 */
import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import type { D1Database, D1PreparedStatement } from '../types';

interface SqliteStatement {
  get(...params: unknown[]): Record<string, unknown> | undefined;
  all(...params: unknown[]): Record<string, unknown>[];
  run(...params: unknown[]): { changes: number | bigint };
}
interface SqliteDatabase {
  exec(sql: string): void;
  prepare(sql: string): SqliteStatement;
}

const MIGRATIONS_DIR = join(__dirname, '..', '..', 'migrations-notifications');
/** Reports DB (moderation tables) is migrated from admin-api. */
export const REPORTS_MIGRATIONS_DIR = join(__dirname, '..', '..', '..', 'admin-api', 'migrations');

export function createSqliteD1(migrationsDir: string = MIGRATIONS_DIR): D1Database & { raw: SqliteDatabase } {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { DatabaseSync } = require('node:sqlite') as { DatabaseSync: new (path: string) => SqliteDatabase };
  const raw = new DatabaseSync(':memory:');
  for (const file of readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort()) {
    raw.exec(readFileSync(join(migrationsDir, file), 'utf8'));
  }

  const prepare = (sql: string): D1PreparedStatement => {
    let params: unknown[] = [];
    const statement: D1PreparedStatement = {
      bind: (...values: unknown[]) => {
        params = values;
        return statement;
      },
      first: async <T>(column?: string) => {
        const row = raw.prepare(sql).get(...params);
        if (!row) return null;
        return (column ? row[column] : { ...row }) as T;
      },
      run: async () => {
        const result = raw.prepare(sql).run(...params);
        return { success: true, meta: { changes: Number(result.changes) } };
      },
      all: async <T>() => ({ success: true, results: raw.prepare(sql).all(...params).map((r) => ({ ...r })) as T[] }),
    };
    return statement;
  };

  return {
    raw,
    prepare,
    batch: async <T>(statements: D1PreparedStatement[]) => {
      const results = [];
      for (const s of statements) results.push(await s.run());
      return results as never as import('../types').D1Result<T>[];
    },
    exec: async (sql: string) => {
      raw.exec(sql);
      return { count: 1, duration: 0 };
    },
  };
}
