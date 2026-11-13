/**
 * Purged content answers 410 Gone (owner decision D-SEO-4, wiki AUN-SEO): an item deleted and then
 * purged (after the 30-day restore window, or at once by "Delete permanently") keeps its row in
 * admin_deletions with purged_at set. That row is the tombstone. While an item can still be
 * restored it stays a plain 404, like anything else nobody may see.
 */
import type { AdminDeletionKind } from '@al-ummah/shared-types';
import { getDeletion } from './admin/deletions';
import { logger } from './logger';

export interface GoneEnv {
	SEARCH_DB?: D1Database;
}

/** True only when the item was purged; any lookup failure is "not known gone" (a 404). */
export async function isPurged(env: GoneEnv, kind: AdminDeletionKind, id: string): Promise<boolean> {
	if (!env.SEARCH_DB || !id) return false;
	try {
		const deletion = await getDeletion(env.SEARCH_DB as never, kind, id);
		return !!deletion?.purgedAt;
	} catch (error) {
		logger.warn('[gone] tombstone lookup failed', { kind, id, error: error instanceof Error ? error.message : String(error) });
		return false;
	}
}

/** The body of a 410 (same shape as the 404s next to it). */
export const GONE_BODY = { success: false, error: 'Gone', code: 'gone' } as const;
