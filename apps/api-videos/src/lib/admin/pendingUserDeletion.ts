/**
 * Whether a user's videos data has a pending admin deletion (owner decision on
 * #701, 2026-11-11: while "Delete videos data" is pending, the user may sign in
 * and read, but every write is refused; middleware/videos-pending-deletion.ts).
 *
 * The lookup is a primary-key point read of admin_deletions (kind, target_id),
 * made only for requests that would be refused (writes, GET /api/profile).
 * Each isolate remembers a "not pending" answer briefly, so an ordinary user's
 * writes cost one D1 read per window, not one per request. A "pending" answer
 * is never remembered across requests: an admin restore lifts the block at
 * once on every isolate. A new deletion reaches the isolate that recorded it at
 * once, and others within NOT_PENDING_CACHE_MS.
 */
import { purgeAfterOf, type SearchDb } from '@al-ummah/shared-types';

export const NOT_PENDING_CACHE_MS = 15_000;
const MAX_ENTRIES = 5000;
const notPending = new Map<string, number>();

export interface PendingUserDeletion {
	deletedAt: string;
	/** When the scheduled cleanup erases the data (unless an admin restores it first) */
	purgeAfter: string;
}

export async function readPendingUserDeletion(db: SearchDb, userId: string): Promise<PendingUserDeletion | null> {
	const row = await db
		.prepare("SELECT deleted_at FROM admin_deletions WHERE kind = 'user' AND target_id = ? AND purged_at IS NULL")
		.bind(userId)
		.first<{ deleted_at: string }>();
	return row ? { deletedAt: row.deleted_at, purgeAfter: purgeAfterOf(row.deleted_at) } : null;
}

/** Cached lookup for request enforcement (see the module note). */
export async function cachedPendingUserDeletion(db: SearchDb, userId: string, now = Date.now()): Promise<PendingUserDeletion | null> {
	const checkedAt = notPending.get(userId);
	if (checkedAt !== undefined && now - checkedAt < NOT_PENDING_CACHE_MS) return null;
	const pending = await readPendingUserDeletion(db, userId);
	if (pending) {
		notPending.delete(userId);
		return pending;
	}
	notPending.set(userId, now);
	if (notPending.size > MAX_ENTRIES) notPending.delete(notPending.keys().next().value as string);
	return null;
}

/** Drops this isolate's remembered answer (called when a deletion is recorded). */
export function forgetPendingUserDeletion(userId: string): void {
	notPending.delete(userId);
}
