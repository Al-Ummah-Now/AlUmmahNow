/**
 * In-memory Auth D1 (AUTH_DB): the Auth service's `users` table and its indexes (AlUmmahNowAuth
 * apps/auth/schema.snapshot.sql, the columns and indexes a lookup by id or email can use), with the
 * statements it was asked to run and their query plans. `fail = true` answers like D1 being down.
 */
import { DatabaseSync } from 'node:sqlite';

export class AuthDb {
	readonly raw = new DatabaseSync(':memory:');
	readonly queries: { sql: string; values: unknown[] }[] = [];
	fail = false;

	constructor(users: Record<string, string> = {}) {
		this.raw.exec(`CREATE TABLE users (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, email TEXT NOT NULL, name TEXT, status TEXT NOT NULL DEFAULT 'active', deleted_at INTEGER);
			CREATE INDEX idx_users_email ON users(email);
			CREATE INDEX idx_users_email_lower ON users(lower(email));
			CREATE INDEX idx_users_tenant ON users(tenant_id);
			CREATE UNIQUE INDEX idx_users_tenant_email ON users(tenant_id, email) WHERE deleted_at IS NULL;`);
		for (const [id, email] of Object.entries(users)) this.add(id, email);
	}

	add(id: string, email: string, opts: { name?: string | null; status?: string; deletedAt?: number | null } = {}): this {
		this.raw.prepare('INSERT INTO users (id, tenant_id, email, name, status, deleted_at) VALUES (?, ?, ?, ?, ?, ?)').run(id, 'default', email, opts.name ?? null, opts.status ?? 'active', opts.deletedAt ?? null);
		return this;
	}

	/** The plan of every statement run so far: each must be a SEARCH on an index, never a SCAN. */
	plans(): string[] {
		return this.queries.flatMap(({ sql, values }) => (this.raw.prepare(`EXPLAIN QUERY PLAN ${sql}`).all(...(values as string[])) as { detail: string }[]).map((r) => r.detail));
	}

	prepare(sql: string) {
		return {
			bind: (...values: unknown[]) => ({
				all: async <T>() => {
					this.queries.push({ sql, values });
					if (this.fail) throw new Error('D1_ERROR: network connection lost');
					return { results: this.raw.prepare(sql).all(...(values as string[])).map((r) => ({ ...(r as object) })) as T[] };
				},
			}),
		};
	}
}
