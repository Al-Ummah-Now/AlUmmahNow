/**
 * Enforces videos bans (lib/admin/bans.ts) on signed-in requests.
 *
 * A banned usr_ id may still read public pages like a visitor, and may export
 * or erase its own data (/api/privacy/*). Everything else it would change is
 * refused with 403 `videos_banned`: uploads, comments, likes, subscriptions,
 * channel and profile actions, creating a new profile after a delete. GET
 * /api/profile answers the same code, so the web app can show the banned state
 * instead of the "create your profile" flow. The Auth account is not touched.
 */
import type { Context, Next } from 'hono';
import { VIDEOS_BANNED_CODE, type SearchDb } from '@al-ummah/shared-types';
import { cachedBan } from '../lib/admin/bans';
import { logger } from '../lib/logger';

const READ_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
const ALWAYS_ALLOWED = [/^\/api\/privacy(\/|$)/];
/** Signed-in reads that only make sense for an active account. */
const BLOCKED_READS = [/^\/api\/profile$/];

export function isBlockedForBannedUser(method: string, path: string): boolean {
	if (ALWAYS_ALLOWED.some((re) => re.test(path))) return false;
	if (READ_METHODS.has(method.toUpperCase())) return BLOCKED_READS.some((re) => re.test(path));
	return true;
}

export async function videosBanMiddleware(c: Context, next: Next) {
	const auth = c.get('auth') as { userId?: string } | undefined;
	const db = (c.env as { SEARCH_DB?: SearchDb }).SEARCH_DB;
	if (!auth?.userId || !db || !isBlockedForBannedUser(c.req.method, c.req.path)) return next();
	let ban = null;
	try {
		ban = await cachedBan(db, auth.userId);
	} catch (error) {
		// The ban table being unreachable must not take the site down with it
		logger.warn('[VideosBan] Ban lookup failed; request allowed', { error: error instanceof Error ? error.message : String(error) });
		return next();
	}
	if (!ban) return next();
	logger.info('[VideosBan] Request refused for a banned user', { userId: auth.userId, method: c.req.method, path: c.req.path });
	return c.json(
		{
			success: false,
			code: VIDEOS_BANNED_CODE,
			error: 'This account is banned on Al Ummah Now videos.',
			ban: { reason: ban.reason, bannedAt: ban.bannedAt },
		},
		403,
		{ 'Cache-Control': 'private, no-store' },
	);
}
