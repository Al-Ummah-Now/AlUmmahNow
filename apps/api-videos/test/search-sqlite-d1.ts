/**
 * D1-compatible adapter over node:sqlite (FTS5 enabled) so search index SQL
 * runs for real in unit tests. Applies the search migrations on creation.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const MIGRATIONS_DIR = join(__dirname, '..', 'migrations', 'search');

class Statement {
	constructor(private db: DatabaseSync, private sql: string, private values: unknown[] = []) {}

	bind(...values: unknown[]) {
		return new Statement(this.db, this.sql, values);
	}

	private params() {
		return this.values.map(v => (typeof v === 'boolean' ? (v ? 1 : 0) : v === undefined ? null : v)) as any[];
	}

	async first<T = Record<string, unknown>>(): Promise<T | null> {
		return (this.db.prepare(this.sql).get(...this.params()) as T) ?? null;
	}

	async all<T = Record<string, unknown>>(): Promise<{ results: T[]; success: true }> {
		return { results: this.db.prepare(this.sql).all(...this.params()) as T[], success: true };
	}

	async run() {
		const info = this.db.prepare(this.sql).run(...this.params());
		return { success: true, meta: { changes: Number(info.changes) } };
	}

	/** Used by batch(): reads return rows, writes return an empty result with `meta.changes` (as D1 does). */
	execute(): { results: unknown[]; success: true; meta: { changes: number } } {
		const stmt = this.db.prepare(this.sql);
		if (/^\s*(SELECT|WITH)/i.test(this.sql)) return { results: stmt.all(...this.params()), success: true, meta: { changes: 0 } };
		const info = stmt.run(...this.params());
		return { results: [], success: true, meta: { changes: Number(info.changes) } };
	}
}

export class SqliteD1 {
	db = new DatabaseSync(':memory:');
	queries = 0;

	constructor() {
		for (const file of readdirSync(MIGRATIONS_DIR).filter(f => f.endsWith('.sql')).sort()) {
			this.db.exec(readFileSync(join(MIGRATIONS_DIR, file), 'utf8'));
		}
	}

	prepare(sql: string) {
		this.queries++;
		return new Statement(this.db, sql);
	}

	async batch(statements: Statement[]) {
		this.db.exec('BEGIN');
		try {
			const results = statements.map(s => s.execute());
			this.db.exec('COMMIT');
			return results;
		} catch (error) {
			this.db.exec('ROLLBACK');
			throw error;
		}
	}

	count(table: string): number {
		return Number((this.db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n);
	}
}
