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
    const statement: D1PreparedStatement & { runSync(): Record<string, unknown>[] } = {
      // Runs the statement and returns its rows (RETURNING rows for writes), like a D1 batch result
      runSync: () => raw.prepare(sql).all(...params).map((r) => ({ ...r })),
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
    // Like D1: a batch is one transaction (all or nothing) and batches never interleave
    batch: async <T>(statements: D1PreparedStatement[]) => {
      raw.exec('BEGIN');
      const results: Record<string, unknown>[][] = [];
      try {
        for (const s of statements) results.push((s as unknown as { runSync(): Record<string, unknown>[] }).runSync());
        raw.exec('COMMIT');
      } catch (error) {
        raw.exec('ROLLBACK');
        throw error;
      }
      return results.map((rows) => ({ success: true, results: rows, meta: {} })) as never as import('../types').D1Result<T>[];
    },
    exec: async (sql: string) => {
      raw.exec(sql);
      return { count: 1, duration: 0 };
    },
  };
}
