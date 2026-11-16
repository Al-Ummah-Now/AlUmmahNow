/**
 * Tier requests on the public API (lib/tierRequests.ts, wiki AUN-TIER-REQUESTS):
 *
 *   GET  /api/tiers/upgrade                  what /upgrade shows: requestable tiers
 *                                            (never prices); signed in, also the
 *                                            user's tier and latest request. With
 *                                            requests off and no provider ('closed')
 *                                            /upgrade is an off feature: 404 feature_off
 *                                            (owner decision 2026-11-19)
 *   GET  /api/me/tier                        the signed-in user's tier for Settings › Tier, in
 *                                            every mode (closed included; mode says whether
 *                                            /upgrade exists)
 *   POST /api/me/tier-requests               file a request (Turnstile via
 *                                            requireHuman('videos.tier_request'))
 *   POST /api/me/tier-requests/:id/withdraw  withdraw a pending request
 *   GET  /api/me/tier-requests               the user's own requests, newest first (?cursor=)
 */
import type { Context } from 'hono';
import { TIER_REQUEST_ERRORS, type TierRequestInput } from '@al-ummah/shared-types';
import { createTierRequest, listMyRequests, ownRequest, receivedNotificationPayload, TierRequestError, upgradeOverview, withdrawTierRequest } from '../../lib/tierRequests';
import { readTier } from '../../lib/creatorTiers';
import { enqueueNotification, type NotificationsEnv } from '../../lib/notifications';
import { logger } from '../../lib/logger';
import { turnstileMode } from '../../lib/bot-guard';
import { upgradeMode } from '../../lib/upgradeMode';
import { featureOff } from '../../lib/features/off';
import { soldTierIds, type ServiceEnv } from '../../lib/billing/service';

type RolesAuth = { payload?: { roles?: string[] } } | undefined;
const rolesOf = (c: Context) => (c.get('auth') as RolesAuth)?.payload?.roles;

function failure(c: Context, error: unknown, what: string) {
	if (error instanceof TierRequestError) return c.json({ success: false, code: error.code, error: error.message }, error.status as 400);
	logger.error(`[TierRequests] ${what} failed`, { userId: c.get('userId') ?? null, error: error instanceof Error ? error.message : String(error) });
	return c.json({ success: false, code: 'tier_requests_unavailable', error: 'This is briefly unavailable; try again shortly', retryAfter: 30 }, 503, { 'Retry-After': '30' });
}

export async function handleUpgradeOverview(c: Context) {
	const userId = c.get('userId') as string | undefined;
	try {
		const siteKey = turnstileMode(c.env) === 'off' ? null : (c.env.TURNSTILE_SITE_KEY as string | undefined) || null;
		const [{ mode }, sold] = await Promise.all([upgradeMode(c.env), soldTierIds(c.env as ServiceEnv)]);
		// Closed (requests off, no provider): the page vanishes like any off feature (owner 2026-11-19)
		if (mode === 'closed') return featureOff(c);
		const result = await upgradeOverview(c.env.SEARCH_DB, userId ? { userId, roles: rolesOf(c) } : null, siteKey, mode, sold);
		// Per viewer when signed in; the tier list alone is the same for everyone
		return c.json({ success: true, result }, 200, { 'Cache-Control': userId ? 'private, no-store' : 'public, max-age=60' });
	} catch (error) {
		return failure(c, error, 'Upgrade overview');
	}
}

/** GET /api/me/tier: Settings › Tier's data in every mode. The user's tier always shows; `mode` tells the page whether /upgrade (and its request history) exists. */
export async function handleMyTier(c: Context) {
	const userId = c.get('userId') as string | undefined;
	if (!userId) return c.json({ success: false, error: 'Authentication required' }, 401);
	try {
		const { mode } = await upgradeMode(c.env);
		const result = await upgradeOverview(c.env.SEARCH_DB, { userId, roles: rolesOf(c) }, null, mode);
		return c.json({ success: true, result }, 200, { 'Cache-Control': 'private, no-store' });
	} catch (error) {
		return failure(c, error, 'My tier');
	}
}

export async function handleCreateTierRequest(c: Context) {
	const userId = c.get('userId') as string | undefined;
	if (!userId) return c.json({ success: false, error: 'Authentication required' }, 401);
	const body = (await c.req.json().catch(() => null)) as Partial<TierRequestInput> | null;
	if (!body || typeof body !== 'object') return c.json({ success: false, code: TIER_REQUEST_ERRORS.invalid, error: 'A JSON body is required' }, 400);
	try {
		// Only in request mode: no provider enabled and the admin allows requests (owner rule 2026-11-15)
		const { mode } = await upgradeMode(c.env);
		if (mode === 'closed') return featureOff(c);
		if (mode !== 'request') {
			logger.info('[TierRequests] Request refused: requests are off', { userId, mode });
			return c.json({ success: false, code: TIER_REQUEST_ERRORS.requestsOff, error: mode === 'pay' ? 'Tiers are sold on the Upgrade page; requests are off' : 'Upgrades are not available right now', mode }, 403);
		}
		const request = await createTierRequest(c.env.SEARCH_DB, { userId, roles: rolesOf(c) }, body);
		logger.info('[TierRequests] Request filed', { userId, requestId: request.id, tierId: request.tierId, fromTierId: request.fromTierId });
		// "We received your request": best effort (the request stands either way)
		const notice = receivedNotificationPayload(request, await readTier(c.env.SEARCH_DB, request.tierId).catch(() => null));
		if (!(await enqueueNotification(c.env as NotificationsEnv, notice).catch(() => false))) logger.warn('[TierRequests] Received notice not queued', { requestId: request.id });
		return c.json({ success: true, result: { request: ownRequest(request) } }, 201);
	} catch (error) {
		return failure(c, error, 'Request');
	}
}

/** GET /api/me/tier-requests?cursor=: the user's own requests, newest first. */
export async function handleMyTierRequests(c: Context) {
	const userId = c.get('userId') as string | undefined;
	if (!userId) return c.json({ success: false, error: 'Authentication required' }, 401);
	try {
		const result = await listMyRequests(c.env.SEARCH_DB, userId, { cursor: c.req.query('cursor') ?? null, limit: Number(c.req.query('limit') ?? '') || undefined });
		return c.json({ success: true, result }, 200, { 'Cache-Control': 'private, no-store' });
	} catch (error) {
		return failure(c, error, 'History');
	}
}

export async function handleWithdrawTierRequest(c: Context) {
	const userId = c.get('userId') as string | undefined;
	if (!userId) return c.json({ success: false, error: 'Authentication required' }, 401);
	try {
		const request = await withdrawTierRequest(c.env.SEARCH_DB, userId, c.req.param('id') ?? '');
		return c.json({ success: true, result: { request: ownRequest(request) } });
	} catch (error) {
		return failure(c, error, 'Withdraw');
	}
}
