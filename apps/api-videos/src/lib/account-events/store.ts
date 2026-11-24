/** Account events in the search D1 (migration 0124). Every read and write is by key or by index. */
import type { AccountEvent, AccountEventType } from './set';

export type ReceivedStatus = 'received' | 'applied' | 'ignored' | 'failed';

export interface ReceivedRow {
	jti: string;
	seq: number;
	type: AccountEventType;
	user_id: string;
	reason: 'age' | 'deleted' | null;
	status: ReceivedStatus;
	progress: string | null;
	queued_at: number | null;
}

const INSERT_SQL = `INSERT INTO account_events_received (jti, seq, type, user_id, reason, status, received_at, settled_at)
	VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8) ON CONFLICT (jti) DO NOTHING`;
const SEEN_SQL = `INSERT INTO account_event_status (id, last_valid_at) VALUES (1, ?1)
	ON CONFLICT (id) DO UPDATE SET last_valid_at = MAX(last_valid_at, excluded.last_valid_at)`;
const READ_SQL = 'SELECT jti, seq, type, user_id, reason, status, progress, queued_at FROM account_events_received WHERE jti = ?1';
const QUEUED_SQL = `UPDATE account_events_received SET queued_at = ?2 WHERE jti = ?1 AND status = 'received'`;
const SETTLE_SQL = `UPDATE account_events_received SET status = ?2, error = ?3, progress = NULL, settled_at = ?4 WHERE jti = ?1 AND status = 'received'`;
const PROGRESS_SQL = `UPDATE account_events_received SET progress = ?2 WHERE jti = ?1 AND status = 'received'`;
const REOPEN_SQL = `UPDATE account_events_received SET status = 'received', error = NULL, settled_at = NULL, queued_at = NULL WHERE jti = ?1 AND status = 'failed'`;
/**
 * The one conditional write that decides: it takes the account for this event only when the event is newer than the
 * last one applied (or is that one, and not done yet), nothing was purged, and nobody else is working on the account.
 */
const CLAIM_SQL = `INSERT INTO account_event_users (user_id, seq, jti, type, purged, lease, lease_until, updated_at)
	VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
	ON CONFLICT (user_id) DO UPDATE SET seq = excluded.seq, jti = excluded.jti, type = excluded.type, purged = excluded.purged, done = 0,
		lease = excluded.lease, lease_until = excluded.lease_until, updated_at = excluded.updated_at
	WHERE account_event_users.lease_until <= ?8
		AND ((account_event_users.jti = excluded.jti AND account_event_users.done = 0) OR (account_event_users.purged = 0 AND account_event_users.seq < excluded.seq))
	RETURNING seq`;
const USER_SQL = 'SELECT seq, jti, purged, done FROM account_event_users WHERE user_id = ?1';
const RELEASE_SQL = 'UPDATE account_event_users SET lease = NULL, lease_until = 0 WHERE user_id = ?1 AND lease = ?2';
const DONE_SQL = 'UPDATE account_event_users SET done = 1 WHERE user_id = ?1 AND jti = ?2 AND lease = ?3';
const RENEW_SQL = 'UPDATE account_event_users SET lease_until = ?3 WHERE user_id = ?1 AND lease = ?2 RETURNING seq';
const OPEN_NEVER_SQL = `SELECT jti FROM account_events_received INDEXED BY idx_account_events_received_open WHERE status = 'received' AND queued_at IS NULL LIMIT ?1`;
const OPEN_QUIET_SQL = `SELECT jti FROM account_events_received INDEXED BY idx_account_events_received_open WHERE status = 'received' AND queued_at <= ?1 ORDER BY queued_at LIMIT ?2`;
const CLEAN_SQL = `DELETE FROM account_events_received WHERE jti IN (
	SELECT jti FROM account_events_received INDEXED BY idx_account_events_received_settled WHERE status = ?1 AND settled_at <= ?2 ORDER BY settled_at LIMIT ?3)`;

/** For the test that none of them scans a table. */
export const ACCOUNT_EVENT_SQL = { READ_SQL, QUEUED_SQL, SETTLE_SQL, PROGRESS_SQL, REOPEN_SQL, USER_SQL, RELEASE_SQL, DONE_SQL, RENEW_SQL, OPEN_NEVER_SQL, OPEN_QUIET_SQL, CLEAN_SQL };

/** Records an event, and that one arrived. A verification is done once recorded. */
export async function recordReceived(db: D1Database, e: AccountEvent, now: number): Promise<void> {
	const done = e.type === 'verification';
	await db.batch([
		db.prepare(INSERT_SQL).bind(e.jti, e.seq, e.type, e.userId, e.reason, done ? 'applied' : 'received', now, done ? now : null),
		db.prepare(SEEN_SQL).bind(now),
	]);
}

export const readReceived = (db: D1Database, jti: string) => db.prepare(READ_SQL).bind(jti).first<ReceivedRow>();
export const markQueued = (db: D1Database, jti: string, now: number) => db.prepare(QUEUED_SQL).bind(jti, now).run();
export const settle = (db: D1Database, jti: string, status: Exclude<ReceivedStatus, 'received'>, now: number, error: string | null = null) => db.prepare(SETTLE_SQL).bind(jti, status, error, now).run();
/** The event is applied: in one batch, so it can't run again and can't be cleaned up before the account says so. */
export async function settleApplied(db: D1Database, row: ReceivedRow, lease: string, now: number): Promise<void> {
	await db.batch([db.prepare(DONE_SQL).bind(row.user_id, row.jti, lease), db.prepare(SETTLE_SQL).bind(row.jti, 'applied', null, now)]);
}
export const saveProgress = (db: D1Database, jti: string, progress: string | null) => db.prepare(PROGRESS_SQL).bind(jti, progress).run();

/** A failed event again (the admin's Retry). False when it is not failed. */
export async function reopen(db: D1Database, jti: string): Promise<boolean> {
	const r = await db.prepare(REOPEN_SQL).bind(jti).run();
	return r.meta.changes === 1;
}

/** Takes the account for an event: 'mine', 'busy' (someone works on it), or 'old' (a newer event, or a purge, came first). */
export async function claimUser(db: D1Database, row: ReceivedRow, lease: string, leaseMs: number, now: number): Promise<'mine' | 'busy' | 'old'> {
	const won = await db
		.prepare(CLAIM_SQL)
		.bind(row.user_id, row.seq, row.jti, row.type, row.type === 'account-purged' ? 1 : 0, lease, now + leaseMs, now)
		.first();
	if (won) return 'mine';
	const user = await db.prepare(USER_SQL).bind(row.user_id).first<{ seq: number; jti: string; purged: number; done: number }>();
	if (user && (user.jti === row.jti ? user.done === 1 : user.purged === 1 || user.seq >= row.seq)) return 'old';
	return 'busy';
}

export const releaseUser = (db: D1Database, userId: string, lease: string) => db.prepare(RELEASE_SQL).bind(userId, lease).run();

/** Keeps the account a while longer; false when it is no longer ours. */
export async function renewUser(db: D1Database, userId: string, lease: string, until: number): Promise<boolean> {
	return (await db.prepare(RENEW_SQL).bind(userId, lease, until).first()) !== null;
}

/** Events that are not done and were never queued, or were queued before `before` and went quiet. */
export async function openEvents(db: D1Database, before: number, limit: number): Promise<string[]> {
	const [never, quiet] = await db.batch<{ jti: string }>([db.prepare(OPEN_NEVER_SQL).bind(limit), db.prepare(OPEN_QUIET_SQL).bind(before, limit)]);
	return [...(never?.results ?? []), ...(quiet?.results ?? [])].map((r) => r.jti).slice(0, limit);
}

/** Removes settled events older than `before`, failed ones aside: an admin still has to retry those. */
export async function cleanReceived(db: D1Database, before: number, limit: number): Promise<number> {
	const results = await db.batch([db.prepare(CLEAN_SQL).bind('applied', before, limit), db.prepare(CLEAN_SQL).bind('ignored', before, limit)]);
	return results.reduce((n, r) => n + (r.meta.changes ?? 0), 0);
}
