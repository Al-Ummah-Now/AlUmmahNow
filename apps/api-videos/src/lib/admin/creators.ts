/**
 * The videos admin's Creators page (creator tiers, lib/creatorTiers.ts).
 *
 * Lists every videos user: each profile in the ownership index, plus anyone
 * who holds a tier, owns a channel or has uploaded without a profile row.
 * Those who own a channel or uploaded but hold no tier are flagged
 * `needsTier`: their channels and videos stay visible, but they cannot upload
 * or create channels until an admin assigns a tier. Each row carries where
 * its tier came from (an admin, the super admin role or a subscription), the
 * current hour's and day's upload sessions and the limit hits of the last 7
 * days, the admin's cue to raise a limit.
 *
 * Counts come from grouped joins (one pass over each table), not a subquery
 * per user, so the page stays cheap with every profile in it.
 */
import {
	MAX_BULK_CREATOR_TIER,
	NO_CREATOR_TIER,
	SUPER_ADMIN_TIER_ASSIGNER,
	creatorTierOrigin,
	type AdminCreatorFilter,
	type AdminCreatorRow,
	type AdminCreatorsPage,
	type CreatorTier,
	type CreatorTierBulkResult,
	type CreatorTierCounts,
} from '@al-ummah/shared-types';
import { CreatorTierError, readAssignments, readTier, readTiers } from '../creatorTiers';
import { windowStart } from '../../middleware/rate-limit';
import { UPLOAD_SESSION_OPERATION } from '../../middleware/upload-limits';
import { cachedCount, likeTerm, pageOf, readMany, toUserRow } from './directory';

export interface CreatorsEnv {
	SEARCH_DB?: D1Database;
	profiles: R2Bucket;
}

export interface CreatorsQuery {
	q?: string;
	/** needs_tier: content but no tier; assigned: holds a tier; limited: hit a limit in 7 days */
	filter?: AdminCreatorFilter;
	/** A tier id, or `none` for users without a tier */
	tierId?: string;
	page?: number;
	pageSize?: number;
}

type Row = Record<string, unknown>;

/** Every videos user with their tier and counts (one row per user). ?1 = start of the 7-day window. */
const CREATORS_SQL = `
	WITH people AS (
		SELECT id AS user_id FROM content_ownership WHERE kind = 'profile' AND is_deleted = 0
		UNION SELECT owner_id FROM content_ownership WHERE kind IN ('channel', 'video') AND is_deleted = 0 AND owner_id IS NOT NULL
		UNION SELECT user_id FROM creator_tier_assignments
	),
	owned AS (
		SELECT owner_id,
		       SUM(CASE WHEN kind = 'channel' THEN 1 ELSE 0 END) AS channels,
		       SUM(CASE WHEN kind = 'video' THEN 1 ELSE 0 END) AS videos
		FROM content_ownership WHERE kind IN ('channel', 'video') AND is_deleted = 0 AND owner_id IS NOT NULL
		GROUP BY owner_id
	),
	hits AS (
		SELECT user_id, SUM(CASE WHEN hit_at >= ?1 THEN 1 ELSE 0 END) AS hits7d, MAX(hit_at) AS last_hit
		FROM upload_limit_hits GROUP BY user_id
	)
	SELECT p.user_id AS user_id,
	       a.tier_id AS tier_id,
	       COALESCE(o.channels, 0) AS channels,
	       COALESCE(o.videos, 0) AS videos,
	       COALESCE(h.hits7d, 0) AS hits7d,
	       h.last_hit AS last_hit,
	       pr.admin_title AS display_name, pr.handle AS user_name, pr.email AS email
	FROM people p
	LEFT JOIN creator_tier_assignments a ON a.user_id = p.user_id
	LEFT JOIN owned o ON o.owner_id = p.user_id
	LEFT JOIN hits h ON h.user_id = p.user_id
	LEFT JOIN content_ownership pr ON pr.kind = 'profile' AND pr.id = p.user_id`;

const NEEDS_TIER = 'tier_id IS NULL AND (channels > 0 OR videos > 0)';

export async function listCreators(env: CreatorsEnv, query: CreatorsQuery, nowMs = Date.now()): Promise<AdminCreatorsPage> {
	const db = env.SEARCH_DB as D1Database;
	const now = Math.floor(nowMs / 1000);
	const weekAgo = now - 7 * 86400;
	const { page, pageSize, offset } = pageOf(query.page, query.pageSize);
	const where: string[] = [];
	const binds: unknown[] = [weekAgo];
	const q = query.q?.trim().replace(/^@/, '');
	if (q) {
		binds.push(likeTerm(q), q);
		const like = `?${binds.length - 1}`;
		const exact = `?${binds.length}`;
		where.push(`(lower(display_name) LIKE ${like} ESCAPE '\\' OR lower(user_name) LIKE ${like} ESCAPE '\\' OR lower(email) LIKE ${like} ESCAPE '\\' OR user_id = ${exact})`);
	}
	if (query.filter === 'needs_tier') where.push(NEEDS_TIER);
	if (query.filter === 'assigned') where.push('tier_id IS NOT NULL');
	if (query.filter === 'limited') where.push('hits7d > 0');
	if (query.tierId === NO_CREATOR_TIER) where.push('tier_id IS NULL');
	else if (query.tierId) {
		binds.push(query.tierId);
		where.push(`tier_id = ?${binds.length}`);
	}
	const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
	// The total and the needs-tier count each scan every profile (~33k on QA): reused for a minute per
	// filter (cachedCount, as the users list), so a page load costs one scan, not three. Under suite
	// load the three scans overloaded the search database and the Creators page failed to load (CRE-02).
	const filterKey = `creators:${query.filter ?? ''}:${query.tierId ?? ''}:${(q ?? '').toLowerCase().slice(0, 80)}`;
	const [total, rows, notices, needsTier] = await Promise.all([
		cachedCount(db as never, filterKey, () =>
			db.prepare(`SELECT COUNT(*) AS n FROM (${CREATORS_SQL}) ${whereSql}`).bind(...binds).first<{ n: number }>().then((r) => Number(r?.n) || 0), nowMs),
		db
			.prepare(
				`SELECT * FROM (${CREATORS_SQL}) ${whereSql}
				 ORDER BY (${NEEDS_TIER}) DESC, hits7d DESC, (tier_id IS NOT NULL) DESC, videos DESC, channels DESC, lower(COALESCE(display_name, user_name, user_id)), user_id
				 LIMIT ${pageSize} OFFSET ${offset}`,
			)
			.bind(...binds)
			.all<Row>(),
		db
			.prepare(
				`SELECT
				   (SELECT COUNT(DISTINCT user_id) FROM upload_limit_hits WHERE hit_at >= ?2) AS hits24h,
				   (SELECT COUNT(DISTINCT user_id) FROM upload_limit_hits WHERE hit_at >= ?1) AS hits7d`,
			)
			.bind(weekAgo, now - 86400)
			.first<{ hits24h: number; hits7d: number }>(),
		cachedCount(db as never, 'creators:needs-tier', () =>
			db.prepare(`SELECT COUNT(*) AS n FROM (${CREATORS_SQL}) WHERE ${NEEDS_TIER}`).bind(weekAgo).first<{ n: number }>().then((r) => Number(r?.n) || 0), nowMs),
	]);
	const list = rows.results ?? [];
	const ids = list.map((r) => String(r.user_id));
	const [profiles, assignments, tiers, usage] = await Promise.all([
		readMany(env.profiles, ids),
		readAssignments(db, ids),
		readTiers(db),
		usageOf(db, ids, now),
	]);
	const assigners = await namesOf(db, [...new Set([...assignments.values()].map((a) => a.assignedBy))]);
	const tierById = new Map<string, CreatorTier>(tiers.map((t) => [t.id, t]));
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
			origin: creatorTierOrigin(assignment),
			assignedByName: assignment ? assigners.get(assignment.assignedBy) ?? null : null,
			tierName: assignment ? tierById.get(assignment.tierId)?.name ?? assignment.tierId : null,
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
		total,
		page,
		pageSize,
		limitHits24h: Number(notices?.hits24h) || 0,
		limitHits7d: Number(notices?.hits7d) || 0,
		needsTier,
	};
}

/** Display names (videos profiles) of the admins who assigned tiers. */
async function namesOf(db: D1Database, ids: string[]): Promise<Map<string, string>> {
	const real = ids.filter((id) => id && id !== SUPER_ADMIN_TIER_ASSIGNER);
	if (!real.length) return new Map();
	const { results } = await db
		.prepare(`SELECT id, admin_title, handle FROM content_ownership WHERE kind = 'profile' AND id IN (SELECT value FROM json_each(?))`)
		.bind(JSON.stringify(real))
		.all<{ id: string; admin_title: string | null; handle: string | null }>();
	const names = new Map<string, string>();
	for (const row of results ?? []) {
		const name = row.admin_title || row.handle;
		if (name) names.set(row.id, name);
	}
	return names;
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

/** Users on each tier, and videos users (profiles) without one. */
export async function tierCounts(db: D1Database): Promise<CreatorTierCounts> {
	const [byTier, none] = await Promise.all([
		db.prepare('SELECT tier_id, COUNT(*) AS n FROM creator_tier_assignments GROUP BY tier_id').all<{ tier_id: string; n: number }>(),
		db
			.prepare(
				`SELECT COUNT(*) AS n FROM content_ownership p
				 WHERE p.kind = 'profile' AND p.is_deleted = 0
				   AND NOT EXISTS (SELECT 1 FROM creator_tier_assignments a WHERE a.user_id = p.id)`,
			)
			.first<{ n: number }>(),
	]);
	return {
		byTier: Object.fromEntries((byTier.results ?? []).map((r) => [r.tier_id, Number(r.n) || 0])),
		none: Number(none?.n) || 0,
	};
}

/** Users who hit an upload limit in the last 7 days. */
export async function limitHitsSince(db: D1Database, nowMs = Date.now()): Promise<number> {
	const since = Math.floor(nowMs / 1000) - 7 * 86400;
	const row = await db.prepare('SELECT COUNT(DISTINCT user_id) AS n FROM upload_limit_hits WHERE hit_at >= ?').bind(since).first<{ n: number }>();
	return Number(row?.n) || 0;
}

const USER_ID = /^[A-Za-z0-9_-]{1,128}$/;

/**
 * Assign one tier (or remove it: null) for many users in one D1 batch.
 * Super admins' automatic Unlimited is never changed in bulk, and users who
 * already hold the tier from an admin are left alone (idempotent: running the
 * same change twice changes nothing the second time). `dryRun` returns the
 * plan without writing, so the caller can audit before the change.
 */
export async function bulkAssignTier(
	db: D1Database,
	input: { userIds: string[]; tierId: string | null; dryRun?: boolean },
	actorId: string,
	now = new Date().toISOString(),
): Promise<CreatorTierBulkResult> {
	const userIds = [...new Set(input.userIds)];
	if (!userIds.length || userIds.length > MAX_BULK_CREATOR_TIER || !userIds.every((id) => USER_ID.test(id))) {
		throw new CreatorTierError(400, 'invalid_users', `userIds: 1 to ${MAX_BULK_CREATOR_TIER} user ids`);
	}
	if (input.tierId !== null && !(await readTier(db, input.tierId))) throw new CreatorTierError(404, 'tier_not_found');
	const current = await readAssignments(db, userIds);
	const result: CreatorTierBulkResult = { changed: [], unchanged: [], skippedSuperAdmin: [] };
	for (const userId of userIds) {
		const previous = current.get(userId) ?? null;
		if (creatorTierOrigin(previous) === 'super_admin') result.skippedSuperAdmin.push(userId);
		else if (input.tierId === null ? !previous : previous?.tierId === input.tierId && previous.source === 'admin') result.unchanged.push(userId);
		else result.changed.push({ userId, previous });
	}
	if (input.dryRun || !result.changed.length) return result;
	const statements = result.changed.map(({ userId }) =>
		input.tierId === null
			? db.prepare('DELETE FROM creator_tier_assignments WHERE user_id = ?').bind(userId)
			: db
					.prepare(
						`INSERT INTO creator_tier_assignments (user_id, tier_id, source, assigned_by, assigned_at) VALUES (?, ?, 'admin', ?, ?)
						 ON CONFLICT (user_id) DO UPDATE SET tier_id = excluded.tier_id, source = excluded.source,
						   assigned_by = excluded.assigned_by, assigned_at = excluded.assigned_at`,
					)
					.bind(userId, input.tierId, actorId, now),
	);
	await db.batch(statements);
	return result;
}
