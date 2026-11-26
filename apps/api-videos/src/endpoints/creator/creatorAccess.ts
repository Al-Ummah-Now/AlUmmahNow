/**
 * Creator tiers on the public API (lib/creatorTiers.ts):
 *
 *   GET  /api/me/creator  what the signed-in user may do (the web shows or hides
 *                         Upload and Create channel from it); nothing while an
 *                         admin deletion of their videos data is pending
 *   POST /api/channels    gated by channelCreateGate: a tier without the
 *                         channels flag (Member) -> 403
 *                         `uploads_by_invitation`; the tier's channel limit
 *                         reached -> 403 `channel_limit`
 */
import type { Context, Next } from 'hono';
import {
	CHANNEL_ACCESS_TABLE,
	CREATOR_ERROR_CODES,
	CURRENT_CREATOR_TERMS_VERSION,
	OWNERSHIP_TABLE,
	can,
	featureGate,
	isChannelRole,
	tierAllowsChannels,
	tierAllowsUploads,
	type CreatorAccess,
	type SwitchesEnv,
} from '@al-ummah/shared-types';
import { countChannelSlots, reserveChannelSlot, resolveCreator, settleChannelSlot } from '../../lib/creatorTiers';
import { readCreatorTermsAcceptance, recordCreatorTermsAcceptance } from '../../lib/creatorTerms';
import { apiError } from '../../lib/api-error';
import { upgradeMode } from '../../lib/upgradeMode';
import { logger } from '../../lib/logger';
import { cachedPendingUserDeletion } from '../../lib/admin/pendingUserDeletion';
import { enforceCreatorTerms, invitationOnly, UPLOAD_SESSION_OPERATION } from '../../middleware/upload-limits';
import { windowStart } from '../../middleware/rate-limit';
import { liveAccess } from '../../lib/live/tier-gate';

type RolesAuth = { payload?: { roles?: string[] } } | undefined;

const rolesOf = (c: Context) => (c.get('auth') as RolesAuth)?.payload?.roles;

function unavailable(c: Context, operation: 'terms_acceptance' | 'access_lookup' | 'channel_create_gate', error: unknown) {
	// The shared logger redacts sensitive fields and preserves Error causes.
	logger.warn('[Creator] Access unavailable', { operation, error });
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

/**
 * Channels `userId` helps run (a role that may upload, not owned) whose
 * owner's tier allows uploads: the same rule the upload path applies, since
 * channelIdMiddleware sets `channelOwnerId` and upload-limits resolves the
 * owner's tier (#759). Read from the channel_access and ownership indexes; a
 * hint for the picker only, as every upload is checked again.
 */
export async function memberUploadChannelIds(db: D1Database, userId: string, roles: readonly string[] | undefined): Promise<string[]> {
	const { results } = await db
		.prepare(
			`SELECT a.channel_id AS channel_id, a.role AS role, o.owner_id AS owner_id
			 FROM ${CHANNEL_ACCESS_TABLE} a
			 JOIN ${OWNERSHIP_TABLE} o ON o.kind = 'channel' AND o.id = a.channel_id
			 WHERE a.user_id = ? AND o.is_deleted = 0 AND o.is_hidden = 0 AND o.is_suspended = 0
			 ORDER BY a.channel_id`,
		)
		.bind(userId)
		.all<{ channel_id: string; role: string; owner_id: string | null }>();
	const byOwner = new Map<string, string[]>();
	for (const row of results ?? []) {
		if (!row.owner_id || row.owner_id === userId) continue;
		if (!isChannelRole(row.role) || !can(row.role, 'video.upload')) continue;
		byOwner.set(row.owner_id, [...(byOwner.get(row.owner_id) ?? []), row.channel_id]);
	}
	const eligible = await Promise.all(
		[...byOwner].map(async ([ownerId, channelIds]) => (tierAllowsUploads((await resolveCreator(db, { userId, roles, channelOwnerId: ownerId })).tier) ? channelIds : [])),
	);
	return eligible.flat();
}

export async function creatorAccess(
	db: D1Database,
	userId: string,
	roles: readonly string[] | undefined,
	env?: SwitchesEnv,
): Promise<CreatorAccess> {
	const creator = await resolveCreator(db, { userId, roles });
	const termsSwitchOn = env
		? (await featureGate(env, 'creatorTerms').catch((error) => {
			logger.warn('[Creator] creatorTerms switch read failed; omitting termsAccepted', { userId, error: error instanceof Error ? error.message : String(error) });
			return { on: false as const };
		})).on
		: false;
	const [channelsOwned, usage, uploadChannelIds, live, termsResult] = await Promise.all([
		countChannelSlots(db, userId),
		uploadUsage(db, userId),
		memberUploadChannelIds(db, userId, roles),
		liveAccess(db, userId, roles),
		termsSwitchOn
			? readCreatorTermsAcceptance(db, userId)
				.then((row) => ({ ok: true as const, row }))
				.catch((error) => {
					logger.warn('[Creator] Terms acceptance read failed; omitting termsAccepted from /api/me/creator', {
						userId,
						error: error instanceof Error ? error.message : String(error),
					});
					return { ok: false as const, row: null };
				})
			: Promise.resolve({ ok: false as const, row: null }),
	]);
	const tier = creator.tier;
	const channels = tierAllowsChannels(tier);
	const maxChannels = !tier || tier.unlimited ? null : tier.maxChannels;
	const termsFields = termsSwitchOn && termsResult.ok
		? {
			termsAccepted: termsResult.row?.termsVersion === CURRENT_CREATOR_TERMS_VERSION,
			termsAcceptedAt: termsResult.row?.acceptedAt ?? null,
			termsVersion: CURRENT_CREATOR_TERMS_VERSION,
		}
		: {};
	return {
		tier: tier ? { id: tier.id, name: tier.name, nameAr: tier.nameAr ?? null, unlimited: tier.unlimited, uploads: tierAllowsUploads(tier), channels } : null,
		via: creator.via,
		canUpload: tierAllowsUploads(tier) || uploadChannelIds.length > 0,
		uploadChannelIds,
		canCreateChannel: channels && (maxChannels === null || channelsOwned < maxChannels),
		channelsOwned,
		maxChannels: channels ? maxChannels : 0,
		limits: tier && !tier.unlimited ? { perHour: tier.perHour, perDay: tier.perDay, maxConcurrent: tier.maxConcurrent } : null,
		usage,
		live,
		...termsFields,
	};
}

/**
 * POST /api/me/creator/terms — records acceptance of the creator Terms & Community Guidelines once per account.
 * Contract: HTTP 409 on this route is reserved exclusively for `terms_version_changed` (native clients such as
 * Android #72 map every 409 on this route to `terms_version_changed` while Core#61 drops error codes).
 */
export async function handleAcceptCreatorTerms(c: Context) {
	const userId = c.get('userId') as string | undefined;
	if (!userId) return apiError(c, 401, 'authentication_required', { error: 'Authentication required' });
	const contentType = c.req.header('content-type') ?? '';
	const body = contentType.includes('application/json')
		? ((await c.req.json().catch(() => null)) as { version?: unknown } | null)
		: null;
	const requestedVersion = typeof body?.version === 'string' ? body.version.trim() : '';
	if (!requestedVersion || requestedVersion !== CURRENT_CREATOR_TERMS_VERSION) {
		return apiError(c, 409, CREATOR_ERROR_CODES.termsVersionChanged, {
			error: 'The Terms of Service were updated; please review the latest version.',
			currentVersion: CURRENT_CREATOR_TERMS_VERSION,
		});
	}
	try {
		const deletion = await cachedPendingUserDeletion(c.env.SEARCH_DB, userId);
		if (deletion) {
			return apiError(c, 403, 'videos_account_pending_deletion', {
				error: 'This account has a pending data deletion.',
			});
		}
		const accepted = await recordCreatorTermsAcceptance(c.env.SEARCH_DB, userId, requestedVersion);
		return c.json({
			success: true,
			result: {
				termsAccepted: accepted.termsVersion === CURRENT_CREATOR_TERMS_VERSION,
				termsAcceptedAt: accepted.acceptedAt,
				termsVersion: accepted.termsVersion,
			},
		});
	} catch (error) {
		return unavailable(c, 'terms_acceptance', error);
	}
}

export async function handleCreatorAccess(c: Context) {
	const userId = c.get('userId') as string | undefined;
	if (!userId) return c.json({ success: false, error: 'Authentication required' }, 401);
	try {
		const [access, deletion, mode] = await Promise.all([
			creatorAccess(c.env.SEARCH_DB, userId, rolesOf(c), c.env as SwitchesEnv),
			cachedPendingUserDeletion(c.env.SEARCH_DB, userId),
			// The header pill follows the Upgrade page's mode; if it cannot be read there is no mode and no pill
			upgradeMode(c.env).then((m) => m.mode).catch((error) => {
				logger.warn('[Creator] Upgrade page mode not read; the header pill is hidden', { userId, error: error instanceof Error ? error.message : String(error) });
				return undefined;
			}),
		]);
		// A pending admin deletion of their videos data refuses every upload and create (#701)
		const result: CreatorAccess = deletion
			? { ...access, canUpload: false, canCreateChannel: false, uploadChannelIds: [], live: { ...access.live, allowed: false, reason: 'pending_deletion' }, pendingDeletion: true, ...(mode ? { upgradeMode: mode } : {}) }
			: { ...access, ...(mode ? { upgradeMode: mode } : {}) };
		return c.json({ success: true, result });
	} catch (error) {
		return unavailable(c, 'access_lookup', error);
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
		if (!creator.tier || !tierAllowsChannels(creator.tier)) {
			logger.info('[Creator] Channel create refused: the tier allows no channels', { userId, tierId: creator.tier?.id ?? null });
			return invitationOnly(c);
		}
		const termsRefused = await enforceCreatorTerms(c, userId);
		if (termsRefused) return termsRefused;
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
		return unavailable(c, 'channel_create_gate', error);
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
