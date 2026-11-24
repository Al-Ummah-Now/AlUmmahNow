/**
 * The account behind a user id, read from the Auth service's D1 (AUTH_DB, SELECTs on `users` only).
 *
 * Auth holds the account's email; a videos profile only carries a copy of it. Anything that sends
 * mail to a person, or tells one account from another, reads it here by user id.
 *
 * Auth's D1 answers every sign-in and runs one query at a time, so only these lookups: by id (the
 * primary key), a batch of ids (the primary key) and by email (idx_users_email_lower).
 */
import type { AccountEmailSource } from '@al-ummah/shared-types';
import { logger } from '../logger';
import { AdminError } from './service';

interface AuthDb {
	prepare(sql: string): { bind(...values: unknown[]): { all<T>(): Promise<{ results?: T[] }> } };
}

export interface AuthUser {
	id: string;
	email: string;
	name: string | null;
	status: string;
}

export const AUTH_EMAIL_BY_ID_SQL = 'SELECT email FROM users WHERE id = ? AND deleted_at IS NULL';
export const AUTH_USER_BY_EMAIL_SQL = 'SELECT id, email, name, status FROM users WHERE lower(email) = ? AND deleted_at IS NULL LIMIT 1';
export const authEmailsByIdsSql = (n: number) => `SELECT id, email FROM users WHERE id IN (${Array(n).fill('?').join(', ')}) AND deleted_at IS NULL`;

export const authAccountsByIdsSql = (n: number) => `SELECT id, email, deleted_at FROM users WHERE id IN (${Array(n).fill('?').join(', ')})`;

/** Ids per batched lookup. */
export const AUTH_IDS_PER_QUERY = 50;

export const normalizeEmail = (email: unknown): string => (typeof email === 'string' ? email.trim().toLowerCase() : '');

/** Runs a lookup; 503 `auth_unavailable` when AUTH_DB is not bound or fails (a caller never reads that as "no account"). */
async function query<T>(env: object, sql: string, values: unknown[]): Promise<T[]> {
	const db = (env as { AUTH_DB?: AuthDb }).AUTH_DB;
	if (!db) throw new AdminError(503, 'auth_unavailable', 'AUTH_DB is not bound');
	try {
		return (await db.prepare(sql).bind(...values).all<T>()).results ?? [];
	} catch (error) {
		logger.error('[AuthUsers] Account lookup failed', { error: error instanceof Error ? error.message : String(error) });
		throw new AdminError(503, 'auth_unavailable', 'The account could not be read; try again shortly');
	}
}

/** The account's email; null when Auth has no such account. Throws 503 when Auth cannot be read. */
export async function authEmail(env: object, userId: string): Promise<string | null> {
	const [row] = await query<{ email: string | null }>(env, AUTH_EMAIL_BY_ID_SQL, [userId]);
	return normalizeEmail(row?.email) || null;
}

/** User id → email for the ids that have an account. Throws 503 when Auth cannot be read. */
export async function authEmails(env: object, userIds: string[]): Promise<Map<string, string>> {
	const ids = [...new Set(userIds.filter(Boolean))];
	const out = new Map<string, string>();
	for (let i = 0; i < ids.length; i += AUTH_IDS_PER_QUERY) {
		const chunk = ids.slice(i, i + AUTH_IDS_PER_QUERY);
		for (const row of await query<{ id: string; email: string | null }>(env, authEmailsByIdsSql(chunk.length), chunk)) {
			const email = normalizeEmail(row.email);
			if (email) out.set(row.id, email);
		}
	}
	return out;
}

/**
 * User id → account, deleted ones that are not purged yet (30 days) included. For the CSAM report facts
 * only: they identify the uploader even after the account was deleted. Throws 503 when Auth cannot be read.
 */
export async function authAccountsWithDeleted(env: object, userIds: string[]): Promise<Map<string, { email: string; deleted: boolean }>> {
	const ids = [...new Set(userIds.filter(Boolean))];
	const out = new Map<string, { email: string; deleted: boolean }>();
	for (let i = 0; i < ids.length; i += AUTH_IDS_PER_QUERY) {
		const chunk = ids.slice(i, i + AUTH_IDS_PER_QUERY);
		for (const row of await query<{ id: string; email: string | null; deleted_at: number | null }>(env, authAccountsByIdsSql(chunk.length), chunk)) {
			const email = normalizeEmail(row.email);
			if (email) out.set(row.id, { email, deleted: row.deleted_at !== null });
		}
	}
	return out;
}

/** The account with this email; null when there is none. Throws 503 when Auth cannot be read. */
export async function authUserByEmail(env: object, email: string): Promise<AuthUser | null> {
	const wanted = normalizeEmail(email);
	if (!wanted) return null;
	const [row] = await query<AuthUser>(env, AUTH_USER_BY_EMAIL_SQL, [wanted]);
	return row ?? null;
}

/** For pages and records that must still load while Auth cannot be read: the email and where it is from. */
export async function accountEmailForDisplay(env: object, userId: string): Promise<{ email: string | null; emailSource: AccountEmailSource }> {
	try {
		const email = await authEmail(env, userId);
		return { email, emailSource: email ? 'auth' : 'none' };
	} catch {
		return { email: null, emailSource: 'unavailable' };
	}
}
