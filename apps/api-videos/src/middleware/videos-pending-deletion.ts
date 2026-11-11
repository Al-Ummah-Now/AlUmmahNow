/**
 * Blocks writes while an admin "Delete videos data" is pending (#701; owner
 * decision 2026-11-11). For the 30 days before the cleanup erases it, the
 * user's profile, channels and videos are hidden but restorable, so nothing
 * may be added to them:
 *
 * - The user can still sign in and read like a visitor.
 * - Every write answers 403 `videos_account_pending_deletion` (shared-types
 *   VIDEOS_ACCOUNT_PENDING_DELETION_CODE): uploads (new, resumed, retried,
 *   TUS), comments, likes, subscriptions, channels, videos, playlists,
 *   community posts, Studio, watch history, profile create/edit.
 * - GET /api/profile answers the same code, so clients show the state instead
 *   of the "create your profile" flow; so does GET /api/videos/upload/resume/:id.
 * - Allowed: /api/privacy/* (export or erase one's own data), playback
 *   counters a visitor also sends (view, watch-time, retention, client
 *   analytics events) and push-device registration (part of a native sign-in).
 *
 * An admin restore lifts it at once; after the purge the user starts fresh.
 * A ban (videos-ban.ts) runs first and wins. Clients: docs/native-apps/videos-account-states.md.
 */
import type { Context, Next } from 'hono';
import { VIDEOS_ACCOUNT_PENDING_DELETION_CODE, VIDEOS_ACCOUNT_PENDING_DELETION_MESSAGE, type SearchDb } from '@al-ummah/shared-types';
import { cachedPendingUserDeletion } from '../lib/admin/pendingUserDeletion';
import { logger } from '../lib/logger';

const READ_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
const ALWAYS_ALLOWED = [/^\/api\/privacy(\/|$)/];
/** Writes that change nothing of the user's own (a visitor sends them too), or belong to signing in. */
const ALLOWED_WRITES: Array<[method: string, path: RegExp]> = [
	['POST', /^\/api\/videos\/[^/]+\/(view|watch-time|retention)$/],
	['POST', /^\/api\/analytics\/events$/],
	['PUT', /^\/api\/devices\/[^/]+$/],
	['DELETE', /^\/api\/devices\/[^/]+$/],
];
/** Signed-in reads that only make sense for an active account (resume hands out upload credentials). */
const BLOCKED_READS = [/^\/api\/profile$/, /^\/api\/videos\/upload\/resume(\/|$)/];

export function isBlockedForPendingDeletion(method: string, path: string): boolean {
	const m = method.toUpperCase();
	if (ALWAYS_ALLOWED.some((re) => re.test(path))) return false;
	if (READ_METHODS.has(m)) return BLOCKED_READS.some((re) => re.test(path));
	return !ALLOWED_WRITES.some(([allowedMethod, re]) => allowedMethod === m && re.test(path));
}

export async function videosPendingDeletionMiddleware(c: Context, next: Next) {
	const auth = c.get('auth') as { userId?: string } | undefined;
	const db = (c.env as { SEARCH_DB?: SearchDb }).SEARCH_DB;
	if (!auth?.userId || !db || !isBlockedForPendingDeletion(c.req.method, c.req.path)) return next();
	let deletion = null;
	try {
		deletion = await cachedPendingUserDeletion(db, auth.userId);
	} catch (error) {
		// The deletions table being unreachable must not take the site down with it
		logger.warn('[PendingDeletion] Lookup failed; request allowed', { error: error instanceof Error ? error.message : String(error) });
		return next();
	}
	if (!deletion) return next();
	logger.debug('[PendingDeletion] Request refused: the user\'s videos data is scheduled for deletion', { userId: auth.userId, method: c.req.method, path: c.req.path });
	return c.json(
		{
			success: false,
			code: VIDEOS_ACCOUNT_PENDING_DELETION_CODE,
			error: VIDEOS_ACCOUNT_PENDING_DELETION_MESSAGE,
			deletion,
		},
		403,
		{ 'Cache-Control': 'private, no-store' },
	);
}
