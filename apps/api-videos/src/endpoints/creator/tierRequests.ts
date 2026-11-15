/**
 * Tier requests on the public API (lib/tierRequests.ts, wiki AUN-TIER-REQUESTS):
 *
 *   GET  /api/tiers/upgrade                  what /upgrade shows: requestable tiers
 *                                            (never prices); signed in, also the
 *                                            user's tier and latest request
 *   POST /api/me/tier-requests               file a request (Turnstile via
 *                                            requireHuman('videos.tier_request'))
 *   POST /api/me/tier-requests/:id/withdraw  withdraw a pending request
 */
import type { Context } from 'hono';
import { TIER_REQUEST_ERRORS, type TierRequestInput } from '@al-ummah/shared-types';
import { createTierRequest, ownRequest, TierRequestError, upgradeOverview, withdrawTierRequest } from '../../lib/tierRequests';
import { logger } from '../../lib/logger';
import { turnstileMode } from '../../lib/bot-guard';
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
		const sold = await soldTierIds(c.env as ServiceEnv);
		const result = await upgradeOverview(c.env.SEARCH_DB, userId ? { userId, roles: rolesOf(c) } : null, siteKey, sold);
		// Per viewer when signed in; the tier list alone is the same for everyone
		return c.json({ success: true, result }, 200, { 'Cache-Control': userId ? 'private, no-store' : 'public, max-age=60' });
	} catch (error) {
		return failure(c, error, 'Upgrade overview');
	}
}

export async function handleCreateTierRequest(c: Context) {
	const userId = c.get('userId') as string | undefined;
	if (!userId) return c.json({ success: false, error: 'Authentication required' }, 401);
	const body = (await c.req.json().catch(() => null)) as Partial<TierRequestInput> | null;
	if (!body || typeof body !== 'object') return c.json({ success: false, code: TIER_REQUEST_ERRORS.invalid, error: 'A JSON body is required' }, 400);
	try {
		const request = await createTierRequest(c.env.SEARCH_DB, { userId, roles: rolesOf(c) }, body);
		logger.info('[TierRequests] Request filed', { userId, requestId: request.id, tierId: request.tierId, fromTierId: request.fromTierId });
		return c.json({ success: true, result: { request: ownRequest(request) } }, 201);
	} catch (error) {
		return failure(c, error, 'Request');
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
