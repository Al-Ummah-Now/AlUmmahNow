/**
 * Admin lists over the ownership index (content_ownership with the admin
 * columns of migrations/search/0005_admin_content.sql) and the admin comment
 * index. Pages are filtered, sorted and counted in D1; the rows of one page
 * are then read from R2 for the fields the index does not hold.
 *
 * Index readiness: a kind is usable once its ownership pass completed and no
 * row predates the admin columns. Until then a list queues the kind's rebuild
 * job (admin-jobs queue, deduped; nothing runs inside the request and the
 * public readers' completeness marker is never touched), answers from the
 * rows it has, and reports `indexComplete: false`.
 */
import {
	OWNERSHIP_ADMIN_COLS_VERSION,
	OWNERSHIP_TABLE,
	type AdminChannelQuery,
	type AdminChannelRow,
	type AdminCommentQuery,
	type AdminCommentRow,
	type AdminPage,
	type AdminUserQuery,
	type AdminUserRow,
	type AdminVideoQuery,
	type AdminVideoRow,
	type OwnershipKind,
	type SearchDb,
} from '@al-ummah/shared-types';
import { isOwnershipComplete, type OwnershipEnv } from '../search/ownership';
import { startOwnershipRebuild } from '../search/ownershipRebuild';
import type { JobQueue } from './jobs';
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
	ADMIN_JOBS_QUEUE?: JobQueue;
}

type Row = Record<string, any>;

export const DEFAULT_PAGE_SIZE = 20;
export const MAX_PAGE_SIZE = 100;

export function pageOf(page?: number, pageSize?: number): { page: number; pageSize: number; offset: number } {
	const size = Math.min(Math.max(Math.floor(pageSize ?? DEFAULT_PAGE_SIZE), 1), MAX_PAGE_SIZE);
	const p = Math.max(Math.floor(page ?? 1), 1);
	return { page: p, pageSize: size, offset: (p - 1) * size };
}

/** `%term%` with LIKE wildcards in the term escaped (use with ESCAPE '\'). */
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

/**
 * True when the admin columns of `kind` are usable. Otherwise the kind's
 * rebuild job is queued (an active one is reused: one lookup per request) and
 * false is returned. The rebuild rewrites stale rows while the public readers
 * keep their (still valid) completeness marker.
 */
export async function ensureAdminIndex(env: AdminEnv, kind: OwnershipKind): Promise<boolean> {
	const db = dbOf(env);
	if (await adminIndexReady(db, kind)) return true;
	try {
		// A complete index with rows from before the admin columns: rewrite every row from the first key
		const fresh = await isOwnershipComplete(db, kind);
		await startOwnershipRebuild(env as never, kind, 'system', { fresh });
	} catch (error) {
		logger.warn('[AdminDirectory] Could not queue the index rebuild', { kind, error: error instanceof Error ? error.message : String(error) });
	}
	return false;
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

export async function listChannels(env: AdminEnv, query: AdminChannelQuery): Promise<AdminPage<AdminChannelRow>> {
	const db = dbOf(env);
	const indexComplete = (await ensureAdminIndex(env, 'channel')) && (await ensureAdminIndex(env, 'profile'));
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
	const total = await db.prepare(`SELECT COUNT(*) AS n FROM ${OWNERSHIP_TABLE} c WHERE ${whereSql}`).bind(...binds).first<{ n: number }>();
	const { results } = await db
		.prepare(
			`SELECT c.*, (SELECT COALESCE(SUM(v.views), 0) FROM ${OWNERSHIP_TABLE} v WHERE v.kind = 'video' AND v.channel_id = c.id AND v.is_deleted = 0) AS total_views
			 FROM ${OWNERSHIP_TABLE} c WHERE ${whereSql} ORDER BY ${CHANNEL_SORT[query.sort ?? 'newest'] ?? CHANNEL_SORT.newest} LIMIT ${pageSize} OFFSET ${offset}`,
		)
		.bind(...binds)
		.all<Row>();
	const rows = results ?? [];
	return { items: await hydrateChannels(env, rows), total: Number(total?.n) || 0, page, pageSize, indexComplete };
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

export async function listVideos(env: AdminEnv, query: AdminVideoQuery): Promise<AdminPage<AdminVideoRow>> {
	const db = dbOf(env);
	const indexComplete = await ensureAdminIndex(env, 'video');
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
	const total = await db.prepare(`SELECT COUNT(*) AS n FROM ${OWNERSHIP_TABLE} v WHERE ${whereSql}`).bind(...binds).first<{ n: number }>();
	const { results } = await db
		.prepare(
			`SELECT v.*, ch.admin_title AS channel_name FROM ${OWNERSHIP_TABLE} v
			 LEFT JOIN ${OWNERSHIP_TABLE} ch ON ch.kind = 'channel' AND ch.id = v.channel_id
			 WHERE ${whereSql} ORDER BY ${VIDEO_SORT[query.sort ?? 'newest'] ?? VIDEO_SORT.newest} LIMIT ${pageSize} OFFSET ${offset}`,
		)
		.bind(...binds)
		.all<Row>();
	return { items: await hydrateVideos(env, results ?? []), total: Number(total?.n) || 0, page, pageSize, indexComplete };
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
		};
	});
}

// ---------------------------------------------------------------------------
// Users (videos profiles + bans)
// ---------------------------------------------------------------------------

const USER_SORT: Record<string, string> = {
	newest: 'created_at DESC, id',
	oldest: 'created_at ASC, id',
	name: 'lower(display_name) ASC, id',
};

export async function listUsers(env: AdminEnv, query: AdminUserQuery): Promise<AdminPage<AdminUserRow>> {
	const db = dbOf(env);
	const indexComplete = await ensureAdminIndex(env, 'profile');
	const { page, pageSize, offset } = pageOf(query.page, query.pageSize);
	// Profiles, plus banned users whose profile was deleted (the ban outlives the data)
	const base = `
		SELECT p.id AS id, p.admin_title AS display_name, p.handle AS user_name, p.email AS email, p.created_at AS created_at,
		       b.user_id IS NOT NULL AS banned, 0 AS profile_deleted
		FROM ${OWNERSHIP_TABLE} p LEFT JOIN videos_bans b ON b.user_id = p.id
		WHERE p.kind = 'profile' AND p.is_deleted = 0
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
	const total = await db.prepare(`SELECT COUNT(*) AS n FROM (${base}) ${whereSql}`).bind(...binds).first<{ n: number }>();
	const { results } = await db
		.prepare(`SELECT * FROM (${base}) ${whereSql} ORDER BY ${USER_SORT[query.sort ?? 'newest'] ?? USER_SORT.newest} LIMIT ${pageSize} OFFSET ${offset}`)
		.bind(...binds)
		.all<Row>();
	const rows = results ?? [];
	const profiles = await readMany(env.profiles, rows.filter((r) => !r.profile_deleted).map((r) => r.id));
	return {
		items: rows.map((r) => toUserRow(r.id, profiles.get(r.id) ?? null, r.banned === 1, r)),
		total: Number(total?.n) || 0,
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

export async function listComments(env: AdminEnv, query: AdminCommentQuery): Promise<AdminPage<AdminCommentRow>> {
	const db = dbOf(env);
	const indexComplete = await ensureAdminIndex(env, 'video');
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
	const total = await db.prepare(`SELECT COUNT(*) AS n FROM admin_comments c WHERE ${whereSql}`).bind(...binds).first<{ n: number }>();
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
		total: Number(total?.n) || 0,
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
		.prepare(`SELECT id FROM ${OWNERSHIP_TABLE} WHERE kind = ? AND ${column} = ? AND is_deleted = 0 ORDER BY id`)
		.bind(kind, by.channelId ?? by.ownerId)
		.all<{ id: string }>();
	return (results ?? []).map((r) => r.id);
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
