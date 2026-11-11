/**
 * Admin lists over the ownership index (content_ownership with the admin
 * columns of migrations/search/0005_admin_content.sql) and the admin comment
 * index. Pages are filtered, sorted and counted in D1; the rows of one page
 * are then read from R2 for the fields the index does not hold.
 *
 * Index readiness: a kind is usable once its ownership pass completed and no
 * row predates the admin columns. Until then each list advances the pass
 * (the same lease the cron and self-heal use) before querying, and reports
 * `indexComplete: false` if the pass is still not done.
 */
import {
	OWNERSHIP_ADMIN_COLS_VERSION,
	OWNERSHIP_TABLE,
	ownershipCompleteKey,
	type AdminChannelQuery,
	type AdminChannelRow,
	type AdminCommentQuery,
	type AdminCommentRow,
	type AdminPage,
	type AdminUserQuery,
	type AdminUserRow,
	type AdminVideoQuery,
	type AdminVideoR2,
	type AdminVideoR2Badge,
	type AdminVideoR2Result,
	sanitizeRungs,
	type AdminVideoRow,
	type OwnershipKind,
	type SearchDb,
} from '@al-ummah/shared-types';
import { isOwnershipComplete, scheduleOwnershipHeal, type OwnershipEnv, byKey } from '../search/ownership';
import { subscriberCounts } from '../subscription-store';
import { bansFor } from './bans';
import { logger } from '../logger';

export interface AdminEnv extends OwnershipEnv {
	SEARCH_DB?: SearchDb;
	NOTIFICATIONS_DB?: D1Database;
	videos: R2Bucket;
	channels: R2Bucket;
	profiles: R2Bucket;
	playlists: R2Bucket;
	community_posts: R2Bucket;
	watch_history?: R2Bucket;
}

type Row = Record<string, any>;

const R2_STATUSES = ['queued', 'transcoding', 'ready', 'failed'];

/** A record's `r2` when it looks like one (epic #687), else null. */
function r2Of(video: Row | null | undefined): Row | null {
	const r2 = video?.r2;
	return r2 && typeof r2 === 'object' && R2_STATUSES.includes(r2.status) ? r2 : null;
}

/** The list badge: status, progress while transcoding, the error when failed. */
export function adminR2Badge(video: Row | null | undefined): AdminVideoR2Badge | null {
	const r2 = r2Of(video);
	if (!r2) return null;
	return {
		status: r2.status,
		...(typeof r2.progress === 'number' ? { progress: r2.progress } : {}),
		...(typeof r2.error === 'string' && r2.error ? { error: r2.error } : {}),
	};
}

/** The video page's Processing card: the record's `r2` with the transcode result summarised (rungs, source, timings), without the move/previous bookkeeping. */
export function adminR2Detail(video: Row | null | undefined): AdminVideoR2 | null {
	const r2 = r2Of(video);
	if (!r2) return null;
	const out: Row = { status: r2.status, jobId: String(r2.jobId ?? ''), rev: String(r2.rev ?? ''), access: r2.access === 'pub' ? 'pub' : 'priv', attempts: Number(r2.attempts) || 0, queuedAt: String(r2.queuedAt ?? '') };
	for (const key of ['startedAt', 'readyAt', 'failedAt', 'error'] as const) if (typeof r2[key] === 'string' && r2[key]) out[key] = r2[key];
	if (typeof r2.progress === 'number') out.progress = r2.progress;
	if (r2.failure && typeof r2.failure === 'object') out.failure = r2.failure;
	if (typeof r2.containerSeconds === 'number') out.containerSeconds = r2.containerSeconds;
	const rungs = sanitizeRungs(r2.rungs);
	if (rungs?.length) out.rungs = rungs;
	const result = r2.result as Row | undefined;
	if (result && Array.isArray(result.rungs)) {
		const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
		const summary: AdminVideoR2Result = {
			rungs: result.rungs.slice(0, 8).map((r: Row) => ({
				name: String(r?.name ?? ''),
				width: num(r?.width) ?? 0,
				height: num(r?.height) ?? 0,
				...(num(r?.bandwidth) !== undefined ? { bandwidth: num(r.bandwidth) } : {}),
				...(num(r?.bytes) !== undefined ? { bytes: num(r.bytes) } : {}),
			})),
			source: {
				width: num(result.source?.width) ?? 0,
				height: num(result.source?.height) ?? 0,
				...(typeof result.source?.file === 'string' && result.source.file ? { file: result.source.file.slice(0, 60) } : {}),
			},
			...(result.timings && typeof result.timings === 'object' ? { timings: result.timings } : {}),
		};
		out.result = summary;
	}
	return out as AdminVideoR2;
}

export const DEFAULT_PAGE_SIZE = 20;
export const MAX_PAGE_SIZE = 100;

export function pageOf(page?: number, pageSize?: number): { page: number; pageSize: number; offset: number } {
	const size = Math.min(Math.max(Math.floor(pageSize ?? DEFAULT_PAGE_SIZE), 1), MAX_PAGE_SIZE);
	const p = Math.max(Math.floor(page ?? 1), 1);
	return { page: p, pageSize: size, offset: (p - 1) * size };
}

/** `%term%` with LIKE wildcards in the term escaped (use with ESCAPE '\'). */
/** The COUNT row, or -1 when the caller skipped it (noTotal). */
const totalOf = (row: { n: number } | null | undefined): number => (row === null ? -1 : Number(row?.n) || 0);

export function likeTerm(q: string): string {
	return `%${q.trim().toLowerCase().replace(/[\\%_]/g, (m) => `\\${m}`)}%`;
}

function dbOf(env: AdminEnv): SearchDb {
	if (!env.SEARCH_DB) throw new Error('SEARCH_DB is not bound');
	return env.SEARCH_DB;
}

const iso = (ms: unknown) => (typeof ms === 'number' && Number.isFinite(ms) ? new Date(ms).toISOString() : null);
const msOf = (value?: string) => {
	if (!value) return null;
	const t = Date.parse(value);
	return Number.isFinite(t) ? t : null;
};

async function readJson<T = Row>(bucket: R2Bucket, key: string): Promise<T | null> {
	try {
		const object = await bucket.get(key);
		return object ? ((await object.json()) as T) : null;
	} catch {
		return null;
	}
}

export async function readMany<T = Row>(bucket: R2Bucket, keys: string[]): Promise<Map<string, T>> {
	const out = new Map<string, T>();
	await Promise.all(
		[...new Set(keys)].map(async (key) => {
			const value = await readJson<T>(bucket, key);
			if (value) out.set(key, value);
		}),
	);
	return out;
}

// ---------------------------------------------------------------------------
// Index readiness
// ---------------------------------------------------------------------------

export async function adminIndexReady(db: SearchDb, kind: OwnershipKind): Promise<boolean> {
	if (!(await isOwnershipComplete(db, kind))) return false;
	const stale = await db
		.prepare(`SELECT 1 AS x FROM ${OWNERSHIP_TABLE} WHERE kind = ? AND admin_cols < ? LIMIT 1`)
		.bind(kind, OWNERSHIP_ADMIN_COLS_VERSION)
		.first<{ x: number }>();
	return !stale;
}

/** Runs work after the response has been sent (the request's executionCtx.waitUntil). */
export type WaitUntil = (promise: Promise<unknown>) => void;

/**
 * Advances the ownership pass for `kind` when the admin columns are not usable yet.
 *
 * With `waitUntil` (the admin lists) the pass runs after the response and the list
 * answers at once from the rows already indexed, flagged indexComplete: false. Awaiting
 * it made every admin Channels page take ~40 s on QA (2026-11-11): the profile index
 * (22k rows, mostly E2E accounts) rarely completes, since any failed sync write restarts
 * the pass, so each request paid for one pass. Without `waitUntil` (callers that must
 * not use an incomplete index) it still awaits.
 */
export async function ensureAdminIndex(env: AdminEnv, kind: OwnershipKind, waitUntil?: WaitUntil): Promise<boolean> {
	const db = dbOf(env);
	if (await adminIndexReady(db, kind)) return true;
	if (await isOwnershipComplete(db, kind)) {
		// Rows from before the admin columns: start a fresh pass that rewrites every row
		await db.prepare("DELETE FROM search_meta WHERE key = ?").bind(ownershipCompleteKey(kind)).run();
	}
	const pass = (async () => {
		try {
			await scheduleOwnershipHeal(env, null, kind);
		} catch (error) {
			logger.warn('[AdminDirectory] Index pass failed', { kind, error: error instanceof Error ? error.message : String(error) });
		}
	})();
	if (waitUntil) {
		waitUntil(pass);
		return false;
	}
	await pass;
	return adminIndexReady(db, kind);
}

// ---------------------------------------------------------------------------
// Channels
// ---------------------------------------------------------------------------

const CHANNEL_SORT: Record<string, string> = {
	newest: 'c.created_at DESC, c.id',
	oldest: 'c.created_at ASC, c.id',
	name: 'lower(c.admin_title) ASC, c.id',
	views: 'total_views DESC, c.id',
};

export async function listChannels(env: AdminEnv, query: AdminChannelQuery, waitUntil?: WaitUntil): Promise<AdminPage<AdminChannelRow>> {
	const db = dbOf(env);
	const [channelsReady, profilesReady] = await Promise.all([ensureAdminIndex(env, 'channel', waitUntil), ensureAdminIndex(env, 'profile', waitUntil)]);
	const indexComplete = channelsReady && profilesReady;
	const { page, pageSize, offset } = pageOf(query.page, query.pageSize);
	const where: string[] = ["c.kind = 'channel'", 'c.is_deleted = 0'];
	const binds: unknown[] = [];
	if (query.q?.trim()) {
		const term = likeTerm(query.q);
		where.push(`(lower(c.admin_title) LIKE ?1 ESCAPE '\\' OR lower(c.handle) LIKE ?1 ESCAPE '\\' OR lower(c.email) LIKE ?1 ESCAPE '\\' OR c.id = ?2 OR c.owner_id = ?2
			OR c.owner_id IN (SELECT p.id FROM ${OWNERSHIP_TABLE} p WHERE p.kind = 'profile' AND lower(p.email) LIKE ?1 ESCAPE '\\'))`);
		binds.push(term, query.q.trim());
	}
	const n = () => `?${binds.length}`;
	if (query.verified) where.push(`c.is_verified = ${query.verified === 'yes' ? 1 : 0}`);
	if (query.suspended) where.push(`c.is_suspended = ${query.suspended === 'yes' ? 1 : 0}`);
	if (query.ownerId) {
		binds.push(query.ownerId);
		where.push(`c.owner_id = ${n()}`);
	}
	if (query.ids) {
		binds.push(JSON.stringify(query.ids));
		where.push(`c.id IN (SELECT value FROM json_each(${n()}))`);
	}
	const from = msOf(query.createdFrom);
	if (from !== null) {
		binds.push(from);
		where.push(`c.created_at >= ${n()}`);
	}
	const to = msOf(query.createdTo);
	if (to !== null) {
		binds.push(to + 24 * 3600 * 1000 - 1);
		where.push(`c.created_at <= ${n()}`);
	}
	const whereSql = where.join(' AND ');
	const total = query.noTotal ? null : await db.prepare(`SELECT COUNT(*) AS n FROM ${OWNERSHIP_TABLE} c WHERE ${whereSql}`).bind(...binds).first<{ n: number }>();
	const { results } = await db
		.prepare(
			`SELECT c.*, (SELECT COALESCE(SUM(v.views), 0) FROM ${OWNERSHIP_TABLE} v WHERE v.kind = 'video' AND v.channel_id = c.id AND v.is_deleted = 0) AS total_views
			 FROM ${OWNERSHIP_TABLE} c WHERE ${whereSql} ORDER BY ${CHANNEL_SORT[query.sort ?? 'newest'] ?? CHANNEL_SORT.newest} LIMIT ${pageSize} OFFSET ${offset}`,
		)
		.bind(...binds)
		.all<Row>();
	const rows = results ?? [];
	return { items: await hydrateChannels(env, rows), total: totalOf(total), page, pageSize, indexComplete };
}

/** Index rows → AdminChannelRow, with R2 for names/avatars and D1 for subscriber counts. */
export async function hydrateChannels(env: AdminEnv, rows: Row[]): Promise<AdminChannelRow[]> {
	const objects = await readMany(env.channels, rows.map((r) => r.id));
	const counts = await subscriberCounts(env.NOTIFICATIONS_DB, [...objects.values()] as never).catch(() => new Map<string, number>());
	const ownerIds = [...new Set(rows.map((r) => r.owner_id).filter(Boolean))];
	const owners = ownerIds.length
		? await dbOf(env)
				.prepare(`SELECT id, email FROM ${OWNERSHIP_TABLE} WHERE kind = 'profile' AND id IN (SELECT value FROM json_each(?))`)
				.bind(JSON.stringify(ownerIds))
				.all<{ id: string; email: string | null }>()
		: { results: [] };
	const ownerEmail = new Map((owners.results ?? []).map((o) => [o.id, o.email]));
	return rows.map((r) => {
		const ch = objects.get(r.id) ?? {};
		return {
			id: r.id,
			name: (ch.name as string) || r.admin_title || r.id,
			handle: (ch.handle as string) || r.handle || null,
			ownerId: r.owner_id ?? null,
			ownerEmail: ownerEmail.get(r.owner_id) ?? r.email ?? null,
			avatarUrl: (ch.avatarUrl as string) || null,
			isVerified: ch.isVerified === true || r.is_verified === 1,
			isSuspended: ch.isSuspended === true || r.is_suspended === 1,
			isPrivate: ch.isPrivate === true || r.is_public === 0,
			isDeleted: ch.isDeleted === true || r.is_deleted === 1,
			subscribers: counts.get(r.id) ?? Number(r.subscribers) ?? 0,
			views: Number(r.total_views ?? r.views) || 0,
			createdAt: iso(r.created_at) ?? ((ch.dateCreated as string) || null),
		};
	});
}

// ---------------------------------------------------------------------------
// Videos
// ---------------------------------------------------------------------------

const VIDEO_SORT: Record<string, string> = {
	newest: 'v.created_at DESC, v.id',
	oldest: 'v.created_at ASC, v.id',
	views: 'v.views DESC, v.id',
	title: 'lower(v.admin_title) ASC, v.id',
};

export async function listVideos(env: AdminEnv, query: AdminVideoQuery, waitUntil?: WaitUntil): Promise<AdminPage<AdminVideoRow>> {
	const db = dbOf(env);
	const indexComplete = await ensureAdminIndex(env, 'video', waitUntil);
	const { page, pageSize, offset } = pageOf(query.page, query.pageSize);
	const where: string[] = ["v.kind = 'video'", 'v.is_deleted = 0'];
	const binds: unknown[] = [];
	const n = () => `?${binds.length}`;
	if (query.q?.trim()) {
		binds.push(likeTerm(query.q));
		const like = n();
		binds.push(query.q.trim());
		where.push(`(lower(v.admin_title) LIKE ${like} ESCAPE '\\' OR v.id = ${n()})`);
	}
	if (query.noChannel) where.push('v.channel_id IS NULL');
	else if (query.channelId) {
		binds.push(query.channelId);
		where.push(`v.channel_id = ${n()}`);
	}
	if (query.ownerId) {
		binds.push(query.ownerId);
		where.push(`v.owner_id = ${n()}`);
	}
	if (query.status) {
		binds.push(query.status);
		// Videos without an upload status are legacy uploads that play: treat them as ready
		where.push(query.status === 'ready' ? `(v.upload_status = ${n()} OR v.upload_status IS NULL)` : `v.upload_status = ${n()}`);
	}
	if (query.visibility) where.push(`v.is_public = ${query.visibility === 'public' ? 1 : 0}`);
	if (query.hidden) where.push(`v.is_hidden = ${query.hidden === 'yes' ? 1 : 0}`);
	if (query.ids) {
		binds.push(JSON.stringify(query.ids));
		where.push(`v.id IN (SELECT value FROM json_each(${n()}))`);
	}
	const from = msOf(query.createdFrom);
	if (from !== null) {
		binds.push(from);
		where.push(`v.created_at >= ${n()}`);
	}
	const to = msOf(query.createdTo);
	if (to !== null) {
		binds.push(to + 24 * 3600 * 1000 - 1);
		where.push(`v.created_at <= ${n()}`);
	}
	const whereSql = where.join(' AND ');
	const total = query.noTotal ? null : await db.prepare(`SELECT COUNT(*) AS n FROM ${OWNERSHIP_TABLE} v WHERE ${whereSql}`).bind(...binds).first<{ n: number }>();
	const { results } = await db
		.prepare(
			`SELECT v.*, ch.admin_title AS channel_name FROM ${OWNERSHIP_TABLE} v
			 LEFT JOIN ${OWNERSHIP_TABLE} ch ON ch.kind = 'channel' AND ch.id = v.channel_id
			 WHERE ${whereSql} ORDER BY ${VIDEO_SORT[query.sort ?? 'newest'] ?? VIDEO_SORT.newest} LIMIT ${pageSize} OFFSET ${offset}`,
		)
		.bind(...binds)
		.all<Row>();
	return { items: await hydrateVideos(env, results ?? []), total: totalOf(total), page, pageSize, indexComplete };
}

export async function hydrateVideos(env: AdminEnv, rows: Row[]): Promise<AdminVideoRow[]> {
	const objects = await readMany(env.videos, rows.map((r) => r.id));
	return rows.map((r) => {
		const v = objects.get(r.id) ?? {};
		return {
			id: r.id,
			title: (v.title as string) || r.admin_title || r.id,
			channelId: r.channel_id ?? null,
			channelName: r.channel_name ?? null,
			ownerId: r.owner_id ?? null,
			status: r.upload_status ?? ((v.uploadStatus as string) || null),
			isPublic: r.is_public === 1,
			isHidden: r.is_hidden === 1,
			isDeleted: r.is_deleted === 1,
			views: Number(r.views) || 0,
			duration: r.duration ?? null,
			thumbnailUrl: (v.thumbnailUrl as string) || null,
			createdAt: iso(r.created_at) ?? ((v.dateCreated as string) || null),
			r2: adminR2Badge(v),
		};
	});
}

/** How long a list total is reused (#891). */
export const ADMIN_COUNT_TTL_MS = 60_000;

/**
 * A list's total, reused for ADMIN_COUNT_TTL_MS per filter (search_meta, key admin-count:<key>).
 * Counting every profile on each users-list call read ~28.7k rows a time on QA, the search
 * database's largest reader (#891); a total a minute old is fine for the header and the pager.
 */
export async function cachedCount(db: SearchDb, key: string, count: () => Promise<number>, now = Date.now()): Promise<number> {
	const metaKey = `admin-count:${key}`;
	const hit = await db.prepare('SELECT value, updated_at FROM search_meta WHERE key = ?').bind(metaKey).first<{ value: string; updated_at: number }>();
	if (hit && Number(hit.updated_at) > now - ADMIN_COUNT_TTL_MS) return Number(hit.value) || 0;
	const n = await count();
	await db.batch([
		db.prepare(
			`INSERT INTO search_meta (key, value, updated_at) VALUES (?, ?, ?)
			 ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
		).bind(metaKey, String(n), now),
		// Totals of searches nobody repeats do not pile up
		db.prepare(`DELETE FROM search_meta WHERE key > 'admin-count:' AND key < 'admin-count;' AND updated_at < ?`).bind(now - 3_600_000),
	]).catch(() => undefined);
	return n;
}

// ---------------------------------------------------------------------------
// Users (videos profiles + bans)
// ---------------------------------------------------------------------------

const USER_SORT: Record<string, string> = {
	newest: 'created_at DESC, id',
	oldest: 'created_at ASC, id',
	name: 'lower(display_name) ASC, id',
};

export async function listUsers(env: AdminEnv, query: AdminUserQuery, waitUntil?: WaitUntil): Promise<AdminPage<AdminUserRow>> {
	const db = dbOf(env);
	const indexComplete = await ensureAdminIndex(env, 'profile', waitUntil);
	const { page, pageSize, offset } = pageOf(query.page, query.pageSize);
	// A picker's first pages (no query, no filter, newest first): profiles straight off
	// idx_content_ownership_created, not the sorted union below (which reads every profile twice)
	if (query.noTotal && !query.q?.trim() && !query.banned && (query.sort ?? 'newest') === 'newest') {
		const { results } = await db
			.prepare(
				`SELECT p.id AS id, p.admin_title AS display_name, p.handle AS user_name, p.email AS email, p.created_at AS created_at,
				        EXISTS (SELECT 1 FROM videos_bans b WHERE b.user_id = p.id) AS banned
				 FROM ${OWNERSHIP_TABLE} p
				 WHERE p.kind = 'profile' AND p.is_deleted = 0
				   AND NOT EXISTS (SELECT 1 FROM admin_deletions d WHERE d.kind = 'user' AND d.target_id = p.id AND d.purged_at IS NULL)
				 ORDER BY p.created_at DESC LIMIT ${pageSize} OFFSET ${offset}`,
			)
			.all<Row>();
		const rows = results ?? [];
		const profiles = await readMany(env.profiles, rows.map((r) => r.id));
		return { items: rows.map((r) => toUserRow(r.id, profiles.get(r.id) ?? null, r.banned === 1, r)), total: -1, page, pageSize, indexComplete };
	}
	// Profiles, plus banned users whose profile was deleted (the ban outlives the data)
	const base = `
		SELECT p.id AS id, p.admin_title AS display_name, p.handle AS user_name, p.email AS email, p.created_at AS created_at,
		       b.user_id IS NOT NULL AS banned, 0 AS profile_deleted
		FROM ${OWNERSHIP_TABLE} p LEFT JOIN videos_bans b ON b.user_id = p.id
		WHERE p.kind = 'profile' AND p.is_deleted = 0
		  -- users whose data an admin soft-deleted are in Recently deleted instead (lib/admin/deletions.ts)
		  AND NOT EXISTS (SELECT 1 FROM admin_deletions d WHERE d.kind = 'user' AND d.target_id = p.id AND d.purged_at IS NULL)
		UNION ALL
		SELECT b.user_id, NULL, NULL, NULL, CAST(strftime('%s', b.banned_at) AS INTEGER) * 1000, 1, 1
		FROM videos_bans b WHERE NOT EXISTS (SELECT 1 FROM ${OWNERSHIP_TABLE} p WHERE p.kind = 'profile' AND p.id = b.user_id)`;
	const where: string[] = [];
	const binds: unknown[] = [];
	if (query.q?.trim()) {
		binds.push(likeTerm(query.q), query.q.trim());
		where.push(`(lower(display_name) LIKE ?1 ESCAPE '\\' OR lower(user_name) LIKE ?1 ESCAPE '\\' OR lower(email) LIKE ?1 ESCAPE '\\' OR id = ?2)`);
	}
	if (query.banned) where.push(`banned = ${query.banned === 'yes' ? 1 : 0}`);
	const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
	// noTotal: a picker's page never shows the total, so it skips the count
	const total = query.noTotal ? -1 : await cachedCount(db, `users:${query.banned ?? ''}:${(query.q ?? '').trim().toLowerCase().slice(0, 80)}`, () =>
		db.prepare(`SELECT COUNT(*) AS n FROM (${base}) ${whereSql}`).bind(...binds).first<{ n: number }>().then((r) => Number(r?.n) || 0));
	const { results } = await db
		.prepare(`SELECT * FROM (${base}) ${whereSql} ORDER BY ${USER_SORT[query.sort ?? 'newest'] ?? USER_SORT.newest} LIMIT ${pageSize} OFFSET ${offset}`)
		.bind(...binds)
		.all<Row>();
	const rows = results ?? [];
	const profiles = await readMany(env.profiles, rows.filter((r) => !r.profile_deleted).map((r) => r.id));
	return {
		items: rows.map((r) => toUserRow(r.id, profiles.get(r.id) ?? null, r.banned === 1, r)),
		total,
		page,
		pageSize,
		indexComplete,
	};
}

export function toUserRow(id: string, profile: Row | null, isBanned: boolean, indexRow?: Row): AdminUserRow {
	const name = (profile?.displayName as string) || [profile?.firstName, profile?.lastName].filter(Boolean).join(' ') || indexRow?.display_name || '';
	return {
		id,
		displayName: name,
		userName: (profile?.userName as string) || indexRow?.user_name || null,
		email: (profile?.email as string) || indexRow?.email || null,
		avatarUrl: (profile?.avatarUrl as string) || null,
		createdAt: (profile?.dateCreated as string) || iso(indexRow?.created_at) || null,
		isBanned,
		...(profile ? {} : { profileDeleted: true }),
	};
}

export async function userRows(env: AdminEnv, ids: string[]): Promise<Map<string, AdminUserRow>> {
	const unique = [...new Set(ids.filter(Boolean))];
	const [profiles, bans] = await Promise.all([readMany(env.profiles, unique), bansFor(dbOf(env), unique)]);
	return new Map(unique.map((id) => [id, toUserRow(id, profiles.get(id) ?? null, bans.has(id))]));
}

// ---------------------------------------------------------------------------
// Comments (admin_comments)
// ---------------------------------------------------------------------------

export async function listComments(env: AdminEnv, query: AdminCommentQuery, waitUntil?: WaitUntil): Promise<AdminPage<AdminCommentRow>> {
	const db = dbOf(env);
	const indexComplete = await ensureAdminIndex(env, 'video', waitUntil);
	const { page, pageSize, offset } = pageOf(query.page, query.pageSize);
	const where: string[] = ['1 = 1'];
	const binds: unknown[] = [];
	const n = () => `?${binds.length}`;
	if (query.q?.trim()) {
		binds.push(likeTerm(query.q));
		where.push(`lower(c.text) LIKE ${n()} ESCAPE '\\'`);
	}
	if (query.videoId) {
		binds.push(query.videoId);
		where.push(`c.video_id = ${n()}`);
	}
	if (query.userId) {
		binds.push(query.userId);
		where.push(`c.user_id = ${n()}`);
	}
	const whereSql = where.join(' AND ');
	const total = query.noTotal ? null : await db.prepare(`SELECT COUNT(*) AS n FROM admin_comments c WHERE ${whereSql}`).bind(...binds).first<{ n: number }>();
	const { results } = await db
		.prepare(
			`SELECT c.*, v.admin_title AS video_title FROM admin_comments c
			 LEFT JOIN ${OWNERSHIP_TABLE} v ON v.kind = 'video' AND v.id = c.video_id
			 WHERE ${whereSql} ORDER BY c.created_at DESC, c.comment_id LIMIT ${pageSize} OFFSET ${offset}`,
		)
		.bind(...binds)
		.all<Row>();
	return {
		items: (results ?? []).map((r) => ({
			id: r.comment_id,
			videoId: r.video_id,
			videoTitle: r.video_title ?? r.video_id,
			parentId: r.parent_id ?? null,
			userId: r.user_id ?? '',
			channelId: r.channel_id ?? null,
			text: r.text ?? '',
			isHidden: r.is_hidden === 1,
			status: r.status ?? null,
			createdAt: r.created_at ?? '',
		})),
		total: totalOf(total),
		page,
		pageSize,
		indexComplete,
	};
}

// ---------------------------------------------------------------------------
// Counts used by detail pages
// ---------------------------------------------------------------------------

export async function channelVideoStats(db: SearchDb, channelId: string): Promise<{ videos: number; views: number }> {
	const row = await db
		.prepare(`SELECT COUNT(*) AS videos, COALESCE(SUM(views), 0) AS views FROM ${OWNERSHIP_TABLE} WHERE kind = 'video' AND channel_id = ? AND is_deleted = 0`)
		.bind(channelId)
		.first<{ videos: number; views: number }>();
	return { videos: Number(row?.videos) || 0, views: Number(row?.views) || 0 };
}

/** Ids of every not-deleted item of `kind` in a channel or owned by a user (cascades). */
export async function contentIds(db: SearchDb, kind: OwnershipKind, by: { channelId?: string; ownerId?: string }): Promise<string[]> {
	const column = by.channelId ? 'channel_id' : 'owner_id';
	const { results } = await db
		// Sorted here, not by D1: ORDER BY id made it scan every row of the kind (ownership.ts orderAndLimit)
		.prepare(`SELECT id FROM ${OWNERSHIP_TABLE} WHERE kind = ? AND ${column} = ? AND is_deleted = 0`)
		.bind(kind, by.channelId ?? by.ownerId)
		.all<{ id: string }>();
	return byKey((results ?? []).map((r) => r.id));
}

export async function countPrefix(bucket: R2Bucket | undefined, prefix: string, max = 10000): Promise<number> {
	if (!bucket) return 0;
	let total = 0;
	let cursor: string | undefined;
	do {
		const page = await bucket.list({ prefix, limit: 1000, cursor });
		total += page.objects.length;
		cursor = page.truncated ? (page as { cursor?: string }).cursor : undefined;
	} while (cursor && total < max);
	return total;
}
