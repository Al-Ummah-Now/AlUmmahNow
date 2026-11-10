/**
 * In-memory D1 stand-in backed by node:sqlite with the notifications/library
 * migrations (apps/processor/migrations-notifications) applied.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const MIGRATIONS_DIR = join(__dirname, '..', '..', 'processor', 'migrations-notifications');

export function createSqliteD1() {
	const raw = new DatabaseSync(':memory:');
	for (const file of readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort()) {
		raw.exec(readFileSync(join(MIGRATIONS_DIR, file), 'utf8'));
	}
	const prepare = (sql: string) => {
		let params: any[] = [];
		const statement: any = {
			bind: (...values: any[]) => {
				params = values.map((v) => (v === undefined ? null : v));
				return statement;
			},
			first: async (column?: string) => {
				const row = raw.prepare(sql).get(...params) as Record<string, unknown> | undefined;
				if (!row) return null;
				return column ? row[column] : { ...row };
			},
			run: async () => {
				const result = raw.prepare(sql).run(...params);
				return { success: true, meta: { changes: Number(result.changes) } };
			},
			all: async () => ({ success: true, results: raw.prepare(sql).all(...params).map((r) => ({ ...(r as object) })) }),
			/** Runs now, like one statement of a D1 batch: rows for SELECT / RETURNING, changes otherwise. */
			execSync: () => {
				const prepared = raw.prepare(sql);
				if (prepared.columns().length > 0) {
					const results = prepared.all(...params).map((r) => ({ ...(r as object) }));
					return { success: true, results, meta: { changes: /^\s*(insert|update|delete)/i.test(sql) ? results.length : 0 } };
				}
				const result = prepared.run(...params);
				return { success: true, results: [], meta: { changes: Number(result.changes) } };
			},
		};
		return statement;
	};
	return {
		raw,
		prepare,
		// Like D1: a batch is one transaction (all or nothing) and batches never interleave
		batch: async (statements: any[]) => {
			raw.exec('BEGIN');
			try {
				const results = statements.map((s) => s.execSync());
				raw.exec('COMMIT');
				return results;
			} catch (error) {
				raw.exec('ROLLBACK');
				throw error;
			}
		},
		exec: async (sql: string) => {
			raw.exec(sql);
			return { count: 1, duration: 0 };
		},
		rows(sql: string, ...params: any[]) {
			return raw.prepare(sql).all(...params).map((r) => ({ ...(r as object) })) as any[];
		},
	};
}
