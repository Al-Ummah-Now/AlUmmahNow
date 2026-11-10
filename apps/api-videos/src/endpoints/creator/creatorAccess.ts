/**
 * Creator tiers on the public API (lib/creatorTiers.ts):
 *
 *   GET  /api/me/creator  what the signed-in user may do (the web shows or hides
 *                         Upload and Create channel from it)
 *   POST /api/channels    gated by channelCreateGate: no tier -> 403
 *                         `uploads_by_invitation`; the tier's channel limit
 *                         reached -> 403 `channel_limit`
 */
import type { Context, Next } from 'hono';
import { CREATOR_ERROR_CODES, type CreatorAccess } from '@al-ummah/shared-types';
import { countChannelSlots, reserveChannelSlot, resolveCreator, settleChannelSlot } from '../../lib/creatorTiers';
import { logger } from '../../lib/logger';
import { invitationOnly, UPLOAD_SESSION_OPERATION } from '../../middleware/upload-limits';
import { windowStart } from '../../middleware/rate-limit';

type RolesAuth = { payload?: { roles?: string[] } } | undefined;

const rolesOf = (c: Context) => (c.get('auth') as RolesAuth)?.payload?.roles;

function unavailable(c: Context) {
	return c.json({ success: false, code: 'creator_access_unavailable', error: 'This is briefly unavailable; try again shortly', retryAfter: 30 }, 503, {
		'Retry-After': '30',
	});
}

/** Upload sessions counted for `userId` in the current hour and day. */
export async function uploadUsage(db: D1Database, userId: string, nowMs = Date.now()): Promise<{ hour: number; day: number }> {
	const now = Math.floor(nowMs / 1000);
	const { results } = await db
		.prepare(
			`SELECT period, count FROM upload_rate_windows WHERE user_id = ? AND operation = ?
			 AND ((period = 'hour' AND window_start = ?) OR (period = 'day' AND window_start = ?))`,
		)
		.bind(userId, UPLOAD_SESSION_OPERATION, windowStart('hour', now), windowStart('day', now))
		.all<{ period: string; count: number }>();
	const usage = { hour: 0, day: 0 };
	for (const row of results ?? []) if (row.period === 'hour' || row.period === 'day') usage[row.period] = Number(row.count) || 0;
	return usage;
}

export async function creatorAccess(db: D1Database, userId: string, roles: readonly string[] | undefined): Promise<CreatorAccess> {
	const creator = await resolveCreator(db, { userId, roles });
	const [channelsOwned, usage] = await Promise.all([countChannelSlots(db, userId), uploadUsage(db, userId)]);
	const tier = creator.tier;
	const maxChannels = !tier || tier.unlimited ? null : tier.maxChannels;
	return {
		tier: tier ? { id: tier.id, name: tier.name, unlimited: tier.unlimited } : null,
		via: creator.via,
		canUpload: !!tier,
		canCreateChannel: !!tier && (maxChannels === null || channelsOwned < maxChannels),
		channelsOwned,
		maxChannels: tier ? maxChannels : 0,
		limits: tier && !tier.unlimited ? { perHour: tier.perHour, perDay: tier.perDay, maxConcurrent: tier.maxConcurrent } : null,
		usage,
	};
}

export async function handleCreatorAccess(c: Context) {
	const userId = c.get('userId') as string | undefined;
	if (!userId) return c.json({ success: false, error: 'Authentication required' }, 401);
	try {
		return c.json({ success: true, result: await creatorAccess(c.env.SEARCH_DB, userId, rolesOf(c)) });
	} catch (error) {
		logger.error('[Creator] Access lookup failed', { userId, error: error instanceof Error ? error.message : String(error) });
		return unavailable(c);
	}
}

/** Mounted on POST /api/channels before the create endpoint. */
export async function channelCreateGate(c: Context, next: Next) {
	if (c.req.method !== 'POST') return next();
	const userId = c.get('userId') as string | undefined;
	if (!userId) return next();
	let reservation: string | null = null;
	try {
		const creator = await resolveCreator(c.env.SEARCH_DB, { userId, roles: rolesOf(c) });
		if (!creator.tier) {
			logger.info('[Creator] Channel create refused: no creator tier', { userId });
			return invitationOnly(c);
		}
		const max = creator.tier.unlimited ? null : creator.tier.maxChannels;
		if (max !== null) {
			reservation = await reserveChannelSlot(c.env.SEARCH_DB, userId, max);
			if (!reservation) {
				const owned = await countChannelSlots(c.env.SEARCH_DB, userId);
				logger.info('[Creator] Channel create refused: channel limit', { userId, owned, max, tierId: creator.tier.id });
				return c.json(
					{ success: false, code: CREATOR_ERROR_CODES.channelLimit, error: `You can own up to ${max} channels`, maxChannels: max, channelsOwned: owned },
					403,
				);
			}
		}
	} catch (error) {
		logger.error('[Creator] Channel create gate failed; refusing', { userId, error: error instanceof Error ? error.message : String(error) });
		return unavailable(c);
	}
	if (!reservation) return next();

	let channelId: string | null = null;
	try {
		await next();
		if (c.res.status < 300) {
			const body = (await c.res.clone().json().catch(() => null)) as { result?: { channel?: { id?: unknown } } } | null;
			const id = body?.result?.channel?.id;
			channelId = typeof id === 'string' && id ? id : null;
			// Created but no id in the answer: keep the slot taken until it expires
			if (!channelId) return;
		}
	} finally {
		await settleChannelSlot(c.env.SEARCH_DB, userId, reservation, channelId).catch((error) =>
			logger.error('[Creator] Channel slot not settled', { userId, error: error instanceof Error ? error.message : String(error) }),
		);
	}
}
