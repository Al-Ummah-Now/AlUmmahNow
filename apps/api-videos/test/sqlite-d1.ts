/**
 * In-memory D1 stand-in backed by node:sqlite with the notifications/library
 * migrations (apps/processor/migrations-notifications) applied.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const MIGRATIONS_DIR = join(__dirname, '..', '..', 'processor', 'migrations-notifications');

export function createSqliteD1(migrationsDir: string = MIGRATIONS_DIR) {
	const raw = new DatabaseSync(':memory:');
	for (const file of readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort()) {
		raw.exec(readFileSync(join(migrationsDir, file), 'utf8'));
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
		};
		return statement;
	};
	return {
		raw,
		prepare,
		batch: async (statements: any[]) => {
			const results = [];
			for (const s of statements) results.push(await s.run());
			return results;
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
