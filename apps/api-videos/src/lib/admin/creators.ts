/**
 * The videos admin's Creators page (creator tiers, lib/creatorTiers.ts).
 *
 * Lists every user who holds a tier, owns a channel or has uploaded a video.
 * Those who own a channel or uploaded but hold no tier are flagged
 * `needsTier`: their channels and videos stay visible, but they cannot upload
 * or create channels until an admin assigns a tier. Each row carries the
 * current hour's and day's upload sessions and the limit hits of the last 7
 * days, the admin's cue to raise a limit.
 */
import type { AdminCreatorRow, AdminCreatorsPage, CreatorTier } from '@al-ummah/shared-types';
import { readAssignments, readTiers } from '../creatorTiers';
import { windowStart } from '../../middleware/rate-limit';
import { UPLOAD_SESSION_OPERATION } from '../../middleware/upload-limits';
import { likeTerm, pageOf, readMany, toUserRow } from './directory';

export interface CreatorsEnv {
	SEARCH_DB?: D1Database;
	profiles: R2Bucket;
}

export interface CreatorsQuery {
	q?: string;
	/** needs_tier: content but no tier; assigned: holds a tier; limited: hit a limit in 7 days */
	filter?: 'all' | 'needs_tier' | 'assigned' | 'limited';
	tierId?: string;
	page?: number;
	pageSize?: number;
}

type Row = Record<string, unknown>;

/** Users with a tier, a channel or a video, with their counts (one row per user). */
const CREATORS_SQL = `
	WITH people AS (
		SELECT owner_id AS user_id FROM content_ownership WHERE kind IN ('channel', 'video') AND is_deleted = 0 AND owner_id IS NOT NULL
		UNION SELECT user_id FROM creator_tier_assignments
	)
	SELECT p.user_id AS user_id,
	       a.tier_id AS tier_id,
	       (SELECT COUNT(*) FROM content_ownership c WHERE c.kind = 'channel' AND c.owner_id = p.user_id AND c.is_deleted = 0) AS channels,
	       (SELECT COUNT(*) FROM content_ownership v WHERE v.kind = 'video' AND v.owner_id = p.user_id AND v.is_deleted = 0) AS videos,
	       (SELECT COUNT(*) FROM upload_limit_hits h WHERE h.user_id = p.user_id AND h.hit_at >= ?1) AS hits7d,
	       (SELECT MAX(hit_at) FROM upload_limit_hits h WHERE h.user_id = p.user_id) AS last_hit,
	       pr.admin_title AS display_name, pr.handle AS user_name, pr.email AS email
	FROM people p
	LEFT JOIN creator_tier_assignments a ON a.user_id = p.user_id
	LEFT JOIN content_ownership pr ON pr.kind = 'profile' AND pr.id = p.user_id`;

export async function listCreators(env: CreatorsEnv, query: CreatorsQuery, nowMs = Date.now()): Promise<AdminCreatorsPage> {
	const db = env.SEARCH_DB as D1Database;
	const now = Math.floor(nowMs / 1000);
	const weekAgo = now - 7 * 86400;
	const { page, pageSize, offset } = pageOf(query.page, query.pageSize);
	const where: string[] = [];
	const binds: unknown[] = [weekAgo];
	if (query.q?.trim()) {
		binds.push(likeTerm(query.q), query.q.trim());
		const like = `?${binds.length - 1}`;
		const exact = `?${binds.length}`;
		where.push(`(lower(display_name) LIKE ${like} ESCAPE '\\' OR lower(user_name) LIKE ${like} ESCAPE '\\' OR lower(email) LIKE ${like} ESCAPE '\\' OR user_id = ${exact})`);
	}
	if (query.filter === 'needs_tier') where.push('tier_id IS NULL AND (channels > 0 OR videos > 0)');
	if (query.filter === 'assigned') where.push('tier_id IS NOT NULL');
	if (query.filter === 'limited') where.push('hits7d > 0');
	if (query.tierId) {
		binds.push(query.tierId);
		where.push(`tier_id = ?${binds.length}`);
	}
	const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
	const [total, rows, notices] = await Promise.all([
		db.prepare(`SELECT COUNT(*) AS n FROM (${CREATORS_SQL}) ${whereSql}`).bind(...binds).first<{ n: number }>(),
		db
			.prepare(
				`SELECT * FROM (${CREATORS_SQL}) ${whereSql}
				 ORDER BY (tier_id IS NULL AND (channels > 0 OR videos > 0)) DESC, hits7d DESC, videos DESC, user_id
				 LIMIT ${pageSize} OFFSET ${offset}`,
			)
			.bind(...binds)
			.all<Row>(),
		db
			.prepare(
				`SELECT
				   (SELECT COUNT(DISTINCT user_id) FROM upload_limit_hits WHERE hit_at >= ?1) AS hits24h,
				   (SELECT COUNT(*) FROM (${CREATORS_SQL.replace('?1', '?2')}) WHERE tier_id IS NULL AND (channels > 0 OR videos > 0)) AS needs_tier`,
			)
			.bind(now - 86400, weekAgo)
			.first<{ hits24h: number; needs_tier: number }>(),
	]);
	const list = rows.results ?? [];
	const ids = list.map((r) => String(r.user_id));
	const [profiles, assignments, tiers, usage] = await Promise.all([
		readMany(env.profiles, ids),
		readAssignments(db, ids),
		readTiers(db),
		usageOf(db, ids, now),
	]);
	const tierName = new Map<string, CreatorTier>(tiers.map((t) => [t.id, t]));
	const items: AdminCreatorRow[] = list.map((r) => {
		const id = String(r.user_id);
		const user = toUserRow(id, profiles.get(id) ?? null, false, r);
		const assignment = assignments.get(id) ?? null;
		const channels = Number(r.channels) || 0;
		const videos = Number(r.videos) || 0;
		return {
			userId: id,
			displayName: user.displayName,
			userName: user.userName,
			email: user.email,
			avatarUrl: user.avatarUrl,
			assignment,
			tierName: assignment ? tierName.get(assignment.tierId)?.name ?? assignment.tierId : null,
			needsTier: !assignment && (channels > 0 || videos > 0),
			channels,
			videos,
			usage: usage.get(id) ?? { hour: 0, day: 0 },
			limitHits7d: Number(r.hits7d) || 0,
			lastLimitHitAt: r.last_hit ? new Date(Number(r.last_hit) * 1000).toISOString() : null,
		};
	});
	return {
		items,
		total: Number(total?.n) || 0,
		page,
		pageSize,
		limitHits24h: Number(notices?.hits24h) || 0,
		needsTier: Number(notices?.needs_tier) || 0,
	};
}

/** Upload sessions counted for each user in the current hour and day. */
async function usageOf(db: D1Database, ids: string[], now: number): Promise<Map<string, { hour: number; day: number }>> {
	const usage = new Map<string, { hour: number; day: number }>();
	if (!ids.length) return usage;
	const { results } = await db
		.prepare(
			`SELECT user_id, period, count FROM upload_rate_windows
			 WHERE operation = ? AND user_id IN (SELECT value FROM json_each(?))
			   AND ((period = 'hour' AND window_start = ?) OR (period = 'day' AND window_start = ?))`,
		)
		.bind(UPLOAD_SESSION_OPERATION, JSON.stringify(ids), windowStart('hour', now), windowStart('day', now))
		.all<{ user_id: string; period: string; count: number }>();
	for (const row of results ?? []) {
		const entry = usage.get(row.user_id) ?? { hour: 0, day: 0 };
		if (row.period === 'hour' || row.period === 'day') entry[row.period] = Number(row.count) || 0;
		usage.set(row.user_id, entry);
	}
	return usage;
}
