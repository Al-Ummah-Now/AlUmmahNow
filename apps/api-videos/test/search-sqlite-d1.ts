/**
 * D1-compatible adapter over node:sqlite (FTS5 enabled) so search index SQL
 * runs for real in unit tests. Applies the search migrations on creation.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const MIGRATIONS_DIR = join(__dirname, '..', 'migrations', 'search');

/** A statement as it ran (SqliteD1.trace), to check query plans in scale tests. */
export interface TracedQuery {
	sql: string;
	params: unknown[];
}

class Statement {
	constructor(private db: DatabaseSync, private sql: string, private values: unknown[] = [], private trace?: TracedQuery[] | null) {}

	bind(...values: unknown[]) {
		return new Statement(this.db, this.sql, values, this.trace);
	}

	private params() {
		const params = this.values.map(v => (typeof v === 'boolean' ? (v ? 1 : 0) : v === undefined ? null : v)) as any[];
		this.trace?.push({ sql: this.sql, params });
		return params;
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

	/** Used by batch(): reads return rows, writes return an empty result. */
	execute(): { results: unknown[]; success: true } {
		const stmt = this.db.prepare(this.sql);
		if (/^\s*(SELECT|WITH)/i.test(this.sql)) return { results: stmt.all(...this.params()), success: true };
		stmt.run(...this.params());
		return { results: [], success: true };
	}
}

export class SqliteD1 {
	db = new DatabaseSync(':memory:');
	queries = 0;
	/** When set, every statement run is appended (sql and bound values). */
	trace: TracedQuery[] | null = null;

	constructor() {
		for (const file of readdirSync(MIGRATIONS_DIR).filter(f => f.endsWith('.sql')).sort()) {
			this.db.exec(readFileSync(join(MIGRATIONS_DIR, file), 'utf8'));
		}
	}

	prepare(sql: string) {
		this.queries++;
		return new Statement(this.db, sql, [], this.trace);
	}

	/** SQLite's plan of one traced statement: its detail lines. */
	plan(query: TracedQuery): string[] {
		return (this.db.prepare(`EXPLAIN QUERY PLAN ${query.sql}`).all(...(query.params as any[])) as Array<{ detail: string }>).map(r => r.detail);
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
