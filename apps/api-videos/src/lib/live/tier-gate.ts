/**
 * Live streaming within the channel owner's creator tier (packages/shared-types
 * creator-tiers.ts `live*`, migration search/0060).
 *
 * Checked before any provider is asked, on create, ingest (it provisions a
 * session) and start:
 *   - no tier, or a tier without live           -> 403 live_not_in_tier
 *   - the month's live hours used (UTC month)    -> 402 live_hours_used
 *   - start only: the tier's streams-at-once cap -> 403 live_concurrent_limit
 * Unlimited tiers and super admins skip the limits.
 *
 * Each session carries the minutes it may stay live (`limit_minutes`, set when
 * it is provisioned and again when it starts): the tier's longest stream, or
 * what is left of the month if less. The live sweep ends a session past it
 * (lib/live/service.ts sweepLiveSessions, end_reason 'tier_limit'), so the
 * cron never needs the owner's roles.
 */
import { LIVE_TIER_ERROR_CODES, can, channelRoleOf, tierAllowsLive, type CreatorTier, type LiveAccess, type LiveTierErrorCode } from '@al-ummah/shared-types';
import { loadChannelRecord } from '../channelAccess';
import { resolveCreator } from '../creatorTiers';
import { logger } from '../logger';

export interface LiveTierWho {
	userId: string;
	roles?: readonly string[] | null;
	/** The channel's owner (whose tier applies); the caller when absent */
	channelOwnerId?: string | null;
}

export type LiveTierOp = 'create' | 'ingest' | 'start';

export type LiveTierResult =
	| { ok: true; subjectId: string; tier: CreatorTier; limitMinutes: number | null }
	| { ok: false; status: 402 | 403; code: LiveTierErrorCode; error: string; subjectId: string; details: Record<string, number | string | null> };

export const LIVE_TIER_MESSAGES: Record<LiveTierErrorCode, string> = {
	// Never shown: a create, ingest or start refused for it answers 404 feature_off (live is hidden)
	live_not_in_tier: 'Live streaming is off for this channel.',
	live_hours_used: 'You have used this month\'s live streaming hours. They renew on the 1st.',
	live_concurrent_limit: 'You already have the most streams live at once. End one to go live.',
};

const monthStart = (now: number) => {
	const d = new Date(now);
	return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1);
};

/** Minutes streamed this UTC month by the holder's sessions, and how many are live (or starting) now. */
export async function liveUsage(db: D1Database, ownerId: string, now = Date.now(), exceptSessionId: string | null = null): Promise<{ usedMinutes: number; active: number }> {
	const row = await db
		.prepare(
			`SELECT
			   COALESCE(SUM(CASE WHEN first_segment_at IS NULL THEN 0 ELSE MAX(0, COALESCE(ended_at, ?1) - MAX(first_segment_at, ?2)) END), 0) AS ms,
			   COALESCE(SUM(CASE WHEN id IS NOT ?3 AND (status = 'live' OR (status = 'provisioned' AND start_requested_at IS NOT NULL)) THEN 1 ELSE 0 END), 0) AS active
			 FROM live_sessions WHERE owner_id = ?4 AND (created_at >= ?2 OR status IN ('provisioned', 'live'))`,
		)
		.bind(now, monthStart(now), exceptSessionId, ownerId)
		.first<{ ms: number; active: number }>();
	return { usedMinutes: Math.floor(Number(row?.ms ?? 0) / 60_000), active: Number(row?.active ?? 0) };
}

const refuse = (code: LiveTierErrorCode, status: 402 | 403, subjectId: string, details: Record<string, number | string | null> = {}): LiveTierResult => ({
	ok: false,
	status,
	code,
	error: LIVE_TIER_MESSAGES[code],
	subjectId,
	details,
});

/** Whether the channel owner's tier lets this request go ahead. Throws when D1 cannot answer (callers fail closed). */
export async function checkLiveTier(db: D1Database, who: LiveTierWho, op: LiveTierOp, opts: { sessionId?: string | null; now?: number } = {}): Promise<LiveTierResult> {
	const now = opts.now ?? Date.now();
	const creator = await resolveCreator(db, { userId: who.userId, roles: who.roles, channelOwnerId: who.channelOwnerId });
	const subjectId = creator.subjectId;
	if (!creator.tier || !tierAllowsLive(creator.tier)) {
		return refuse(LIVE_TIER_ERROR_CODES.notInTier, 403, subjectId, { tierId: creator.tier?.id ?? null });
	}
	const tier = creator.tier;
	if (tier.unlimited) return { ok: true, subjectId, tier, limitMinutes: null };
	const usage = await liveUsage(db, subjectId, now, opts.sessionId ?? null);
	const monthMinutes = tier.liveHoursMonth * 60;
	const left = monthMinutes - usage.usedMinutes;
	if (left <= 0) return refuse(LIVE_TIER_ERROR_CODES.hoursUsed, 402, subjectId, { hoursMonth: tier.liveHoursMonth, usedMinutes: usage.usedMinutes });
	if (op === 'start' && usage.active >= tier.liveMaxConcurrent) {
		return refuse(LIVE_TIER_ERROR_CODES.concurrentLimit, 403, subjectId, { maxConcurrent: tier.liveMaxConcurrent, active: usage.active });
	}
	return { ok: true, subjectId, tier, limitMinutes: Math.min(tier.liveMaxStreamMinutes, left) };
}

/** The live part of GET /api/me/creator: what the user may do on their own channels. */
export async function liveAccess(db: D1Database, userId: string, roles: readonly string[] | null | undefined, now = Date.now()): Promise<LiveAccess> {
	const creator = await resolveCreator(db, { userId, roles });
	const tier = creator.tier;
	const usedMinutes = (await liveUsage(db, creator.subjectId, now)).usedMinutes;
	if (!tier || !tierAllowsLive(tier)) {
		return { allowed: false, reason: tier ? 'not_in_tier' : 'no_tier', unlimited: false, hoursMonth: null, usedMinutes, maxConcurrent: null, maxStreamMinutes: null };
	}
	if (tier.unlimited) return { allowed: true, reason: null, unlimited: true, hoursMonth: null, usedMinutes, maxConcurrent: null, maxStreamMinutes: null };
	const hoursUsed = usedMinutes >= tier.liveHoursMonth * 60;
	return {
		allowed: !hoursUsed,
		reason: hoursUsed ? 'hours_used' : null,
		unlimited: false,
		hoursMonth: tier.liveHoursMonth,
		usedMinutes,
		maxConcurrent: tier.liveMaxConcurrent,
		maxStreamMinutes: tier.liveMaxStreamMinutes,
	};
}

/**
 * Whose tier applies to a stream (its channel's owner) and the caller's role on that channel
 * now: a member removed since creating the stream holds none and may not go live under the
 * owner's tier. A stream without a channel falls back to its creator. Throws when R2 cannot answer.
 */
export async function streamTierContext(
	env: { channels?: R2Bucket },
	stream: { channelId?: string | null; userId?: string | null },
	callerId: string,
): Promise<{ ownerId: string | null; callerMayGoLive: boolean }> {
	if (!stream.channelId) return { ownerId: stream.userId ?? null, callerMayGoLive: !!callerId && stream.userId === callerId };
	try {
		const channel = await loadChannelRecord(env, stream.channelId);
		return { ownerId: channel?.userId ?? null, callerMayGoLive: !!channel && can(channelRoleOf(channel, callerId), 'live.manage') };
	} catch (error) {
		logger.warn('[Live] Could not read the stream\'s channel', { channelId: stream.channelId, error: error instanceof Error ? error.message : String(error) });
		throw error;
	}
}
