/**
 * Admin lists over the ownership index (content_ownership with the admin
 * columns of migrations/search/0005, 0013 and 0014) and the admin comment
 * index. A page is a keyset seek (cursor = sort key of the last row shown,
 * lib/search/keyset.ts), totals are counted up to ADMIN_TOTAL_CAP, searches
 * use the trigram FTS tables, channel views come from channel_totals, and the
 * list fields come from the index row: R2 is read only for rows written
 * before the media columns (columns version 3).
 *
 * Index readiness: a kind is usable once its ownership pass completed and no
 * row predates the admin columns. Until then a list queues the kind's rebuild
 * job (admin-jobs queue, deduped; nothing runs inside the request and the
 * public readers' completeness marker is never touched), answers from the
 * rows it has, and reports `indexComplete: false`.
 */
import {
	ADMIN_TOTAL_CAP,
	OWNERSHIP_ADMIN_COLS_SINCE,
	OWNERSHIP_MEDIA_COLS_SINCE,
	OWNERSHIP_TABLE,
	type AdminChannelQuery,
	type AdminChannelRow,
	type AdminCommentQuery,
	type AdminCommentRow,
	type AdminPage,
	type AdminPlaylistRow,
	type AdminUserQuery,
	type AdminUserRow,
	type AdminVideoQuery,
	type AdminVideoRow,
	type OwnershipKind,
	type SearchDb,
} from '@al-ummah/shared-types';
import { isOwnershipComplete, type OwnershipEnv } from '../search/ownership';
import { cappedCount, decodeCursor, encodeCursor, keysetQuery, trigramPhrase, type Direction, type KeyValue } from '../search/keyset';
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

export async function adminIndexReady(db: SearchDb, kind: OwnershipKind, since = OWNERSHIP_ADMIN_COLS_SINCE): Promise<boolean> {
	if (!(await isOwnershipComplete(db, kind))) return false;
	const stale = await db
		.prepare(`SELECT 1 AS x FROM ${OWNERSHIP_TABLE} WHERE kind = ? AND admin_cols < ? LIMIT 1`)
		.bind(kind, since)
		.first<{ x: number }>();
	return !stale;
}

/**
 * True when the admin columns of `kind` are usable. Otherwise the kind's
 * rebuild job is queued (an active one is reused: one lookup per request) and
 * false is returned. The rebuild rewrites stale rows while the public readers
 * keep their (still valid) completeness marker.
 */
export async function ensureAdminIndex(env: AdminEnv, kind: OwnershipKind, since = OWNERSHIP_ADMIN_COLS_SINCE): Promise<boolean> {
	const db = dbOf(env);
	if (await adminIndexReady(db, kind, since)) return true;
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
// Keyset pages
// ---------------------------------------------------------------------------

/** Media columns (image, item count; migration 0014) are on rows written from this version. */
const hasMediaCols = (r: Row) => Number(r.admin_cols) >= OWNERSHIP_MEDIA_COLS_SINCE;

interface ListPlan {
	/** Cursor tag: the list and its order (a cursor of another order starts over). */
	tag: string;
	from: string;
	select: string;
	where: string[];
	params: unknown[];
	columns: string[];
	direction: Direction;
	types: Array<'number' | 'string'>;
	/** FROM for the count (defaults to `from`). */
	countFrom?: string;
}

interface PageQuery {
	cursor?: string;
	page?: number;
	pageSize?: number;
}

/**
 * One admin page: a keyset seek after the cursor (or the first page), and
 * the matching rows counted up to ADMIN_TOTAL_CAP. Legacy `page` numbers
 * (links from before cursors) are served by offset within the cap.
 */
async function adminPage(db: SearchDb, plan: ListPlan, query: PageQuery): Promise<{ rows: Row[]; cursor: string; total: number; totalCapped: boolean; page: number; pageSize: number }> {
	const { page, pageSize, offset } = pageOf(query.page, query.pageSize);
	const after = decodeCursor(query.cursor, plan.tag, plan.types);
	const [count, result] = await Promise.all([
		cappedCount(db, plan.countFrom ?? plan.from, plan.where, plan.params, ADMIN_TOTAL_CAP),
		!after && offset > 0
			? offsetPage(db, plan, pageSize, offset)
			: keysetQuery<Row>(db, { from: plan.from, select: plan.select, where: plan.where, params: plan.params, columns: plan.columns, direction: plan.direction, after, limit: pageSize }),
	]);
	return {
		rows: result.rows,
		cursor: result.hasMore && result.last ? encodeCursor(plan.tag, result.last) : '',
		total: count.total,
		totalCapped: count.capped,
		page: after ? 1 : page,
		pageSize,
	};
}

/** A legacy numbered page: offset paging, within ADMIN_TOTAL_CAP rows. */
async function offsetPage(db: SearchDb, plan: ListPlan, pageSize: number, offset: number) {
	if (offset >= ADMIN_TOTAL_CAP) return { rows: [] as Row[], last: null, hasMore: false };
	const select = [plan.select, ...plan.columns.map((c, i) => `${c} AS k${i}`)].join(', ');
	const { results } = await db
		.prepare(
			`SELECT ${select} FROM ${plan.from} WHERE ${plan.where.join(' AND ')} ORDER BY ${plan.columns.map((c) => `${c} ${plan.direction}`).join(', ')} LIMIT ? OFFSET ?`,
		)
		.bind(...plan.params, pageSize + 1, offset)
		.all<Row>();
	const all = results ?? [];
	const rows = all.slice(0, pageSize);
	const last = rows.length ? plan.columns.map((_, i) => rows[rows.length - 1][`k${i}`] as KeyValue) : null;
	return { rows, last, hasMore: all.length > pageSize };
}

/**
 * Text search over the ownership rows (titles, handles, emails): rowids
 * from content_ownership_fts (trigram, substring match from 3 characters).
 * `column` restricts it to one column (e.g. email).
 */
function ftsRowids(column?: 'admin_title' | 'handle' | 'email'): string {
	return `SELECT rowid FROM content_ownership_fts WHERE content_ownership_fts MATCH ${column ? `'${column} : ' || ?` : '?'}`;
}

/** Upper bound of a prefix range (`prefix` ≤ x < bound). */
function prefixBound(prefix: string): string {
	return prefix + '\u{10FFFF}';
}

/**
 * Condition for an admin search `q` on alias `a` (rows of `kind`): a
 * substring of the title, handle or email (FTS) from 3 characters, a title
 * prefix below that, the exact id, and optionally the owner (id, or email
 * from 3 characters). Every alternative is an index seek returning rowids;
 * the list reads its rows by rowid (its table NOT INDEXED, so it never walks
 * an order index probing each row) and sorts them: the cost follows the
 * matches, never the table.
 */
function searchCondition(a: string, kind: OwnershipKind, q: string, extra: { owner?: boolean } = {}): { where: string; params: unknown[] } {
	const term = q.trim();
	const phrase = trigramPhrase(term);
	const sets: string[] = [];
	const params: unknown[] = [];
	if (phrase) {
		sets.push(ftsRowids());
		params.push(phrase);
	} else {
		sets.push(`SELECT rowid FROM ${OWNERSHIP_TABLE} WHERE kind = ? AND lower(COALESCE(admin_title, '')) >= ? AND lower(COALESCE(admin_title, '')) < ?`);
		params.push(kind, term.toLowerCase(), prefixBound(term.toLowerCase()));
	}
	sets.push(`SELECT rowid FROM ${OWNERSHIP_TABLE} WHERE kind = ? AND id = ?`);
	params.push(kind, term);
	if (extra.owner) {
		sets.push(`SELECT rowid FROM ${OWNERSHIP_TABLE} WHERE kind = ? AND owner_id = ?`);
		params.push(kind, term);
		if (phrase) {
			sets.push(
				`SELECT o.rowid FROM ${OWNERSHIP_TABLE} p JOIN ${OWNERSHIP_TABLE} o ON o.kind = ? AND o.owner_id = p.id WHERE p.rowid IN (${ftsRowids('email')}) AND p.kind = 'profile'`,
			);
			params.push(kind, phrase);
		}
	}
	return { where: `${a}.rowid IN (${sets.join(' UNION ')})`, params };
}

// ---------------------------------------------------------------------------
// Channels
// ---------------------------------------------------------------------------

const CHANNEL_ORDER: Record<string, { columns: string[]; direction: Direction; types: Array<'number' | 'string'> }> = {
	newest: { columns: ['COALESCE(c.created_at, 0)', 'c.id'], direction: 'DESC', types: ['number', 'string'] },
	oldest: { columns: ['COALESCE(c.created_at, 0)', 'c.id'], direction: 'ASC', types: ['number', 'string'] },
	name: { columns: ["lower(COALESCE(c.admin_title, ''))", 'c.id'], direction: 'ASC', types: ['string', 'string'] },
	views: { columns: ['t.views', 't.channel_id'], direction: 'DESC', types: ['number', 'string'] },
};

export async function listChannels(env: AdminEnv, query: AdminChannelQuery): Promise<AdminPage<AdminChannelRow>> {
	const db = dbOf(env);
	const indexComplete = (await ensureAdminIndex(env, 'channel')) && (await ensureAdminIndex(env, 'profile'));
	const sort = CHANNEL_ORDER[query.sort ?? 'newest'] ? (query.sort ?? 'newest') : 'newest';
	const where: string[] = ["c.kind = 'channel'", 'c.is_deleted = 0'];
	const params: unknown[] = [];
	let searching = false;
	if (query.q?.trim()) {
		searching = true;
		const search = searchCondition('c', 'channel', query.q, { owner: true });
		where.push(search.where);
		params.push(...search.params);
	}
	if (query.verified) where.push(`c.is_verified = ${query.verified === 'yes' ? 1 : 0}`);
	if (query.suspended) where.push(`c.is_suspended = ${query.suspended === 'yes' ? 1 : 0}`);
	if (query.ownerId) {
		where.push('c.owner_id = ?');
		params.push(query.ownerId);
	}
	if (query.ids) {
		searching = true;
		where.push(`c.rowid IN (SELECT rowid FROM ${OWNERSHIP_TABLE} WHERE kind = 'channel' AND id IN (SELECT value FROM json_each(?)))`);
		params.push(JSON.stringify(query.ids));
	}
	const from = msOf(query.createdFrom);
	if (from !== null) {
		where.push('COALESCE(c.created_at, 0) >= ?');
		params.push(from);
	}
	const to = msOf(query.createdTo);
	if (to !== null) {
		where.push('COALESCE(c.created_at, 0) <= ?');
		params.push(to + 24 * 3600 * 1000 - 1);
	}
	const order = CHANNEL_ORDER[sort];
	// A search finds its rows by rowid (NOT INDEXED: never walk an order index probing each row)
	const channelTable = `${OWNERSHIP_TABLE} c${searching ? ' NOT INDEXED' : ''}`;
	const plan: ListPlan = {
		tag: `ch:${sort}`,
		// Views: walk idx_channel_totals_views, each channel by key (CROSS JOIN keeps that order);
		// a search reads its matches by rowid first
		from:
			sort === 'views'
				? searching
					? `${channelTable} CROSS JOIN channel_totals t ON t.channel_id = c.id`
					: `channel_totals t CROSS JOIN ${channelTable} ON c.id = t.channel_id`
				: channelTable,
		countFrom: channelTable,
		select: sort === 'views' ? 'c.*, t.views AS total_views, t.videos AS total_videos' : 'c.*',
		where,
		params,
		...order,
	};
	const result = await adminPage(db, plan, query);
	return {
		items: await hydrateChannels(env, result.rows),
		total: result.total,
		totalCapped: result.totalCapped,
		page: result.page,
		pageSize: result.pageSize,
		cursor: result.cursor,
		indexComplete,
	};
}

/**
 * Index rows → AdminChannelRow: names, avatars and totals from the index
 * (channel_totals), subscriber counts from D1; the channel object is read
 * only for rows written before the media columns.
 */
export async function hydrateChannels(env: AdminEnv, rows: Row[]): Promise<AdminChannelRow[]> {
	const db = dbOf(env);
	const ids = rows.map((r) => r.id as string);
	const objects = await readMany(env.channels, rows.filter((r) => !hasMediaCols(r)).map((r) => r.id));
	const ownerIds = [...new Set(rows.map((r) => r.owner_id).filter(Boolean))];
	const [counts, owners, totals] = await Promise.all([
		subscriberCounts(env.NOTIFICATIONS_DB, rows.map((r) => objects.get(r.id) ?? { id: r.id }) as never).catch(() => new Map<string, number>()),
		ownerIds.length
			? db
					.prepare(`SELECT id, email FROM ${OWNERSHIP_TABLE} WHERE kind = 'profile' AND id IN (SELECT value FROM json_each(?))`)
					.bind(JSON.stringify(ownerIds))
					.all<{ id: string; email: string | null }>()
			: Promise.resolve({ results: [] as Array<{ id: string; email: string | null }> }),
		rows.every((r) => r.total_views !== undefined) || !ids.length
			? Promise.resolve(new Map<string, number>())
			: db
					.prepare('SELECT channel_id, views FROM channel_totals WHERE channel_id IN (SELECT value FROM json_each(?))')
					.bind(JSON.stringify(ids))
					.all<{ channel_id: string; views: number }>()
					.then(({ results }) => new Map((results ?? []).map((t) => [t.channel_id, Number(t.views) || 0]))),
	]);
	const ownerEmail = new Map((owners.results ?? []).map((o) => [o.id, o.email]));
	return rows.map((r) => {
		const ch = objects.get(r.id) ?? {};
		const subscribers = counts.get(r.id) || Number(r.subscribers) || 0;
		return {
			id: r.id,
			name: (ch.name as string) || r.admin_title || r.title || r.id,
			handle: (ch.handle as string) || r.handle || null,
			ownerId: r.owner_id ?? null,
			ownerEmail: ownerEmail.get(r.owner_id) ?? r.email ?? null,
			avatarUrl: (hasMediaCols(r) ? r.image_url : (ch.avatarUrl as string)) || null,
			isVerified: ch.isVerified === true || r.is_verified === 1,
			isSuspended: ch.isSuspended === true || r.is_suspended === 1,
			isPrivate: ch.isPrivate === true || r.is_public === 0,
			isDeleted: ch.isDeleted === true || r.is_deleted === 1,
			subscribers,
			views: Number(r.total_views ?? totals.get(r.id) ?? 0) || 0,
			createdAt: iso(r.created_at) ?? ((ch.dateCreated as string) || null),
		};
	});
}

// ---------------------------------------------------------------------------
// Videos
// ---------------------------------------------------------------------------

const VIDEO_ORDER: Record<string, { columns: string[]; direction: Direction; types: Array<'number' | 'string'> }> = {
	newest: { columns: ['COALESCE(v.created_at, 0)', 'v.id'], direction: 'DESC', types: ['number', 'string'] },
	oldest: { columns: ['COALESCE(v.created_at, 0)', 'v.id'], direction: 'ASC', types: ['number', 'string'] },
	views: { columns: ['v.views', 'v.id'], direction: 'DESC', types: ['number', 'string'] },
	title: { columns: ["lower(COALESCE(v.admin_title, ''))", 'v.id'], direction: 'ASC', types: ['string', 'string'] },
};

export async function listVideos(env: AdminEnv, query: AdminVideoQuery): Promise<AdminPage<AdminVideoRow>> {
	const db = dbOf(env);
	const indexComplete = await ensureAdminIndex(env, 'video');
	const sort = VIDEO_ORDER[query.sort ?? 'newest'] ? (query.sort ?? 'newest') : 'newest';
	const where: string[] = ["v.kind = 'video'", 'v.is_deleted = 0'];
	const params: unknown[] = [];
	let searching = false;
	if (query.q?.trim()) {
		searching = true;
		const search = searchCondition('v', 'video', query.q);
		where.push(search.where);
		params.push(...search.params);
	}
	if (query.noChannel) where.push('v.channel_id IS NULL');
	else if (query.channelId) {
		where.push('v.channel_id = ?');
		params.push(query.channelId);
	}
	if (query.ownerId) {
		where.push('v.owner_id = ?');
		params.push(query.ownerId);
	}
	if (query.status) {
		// Videos without an upload status are legacy uploads that play: treat them as ready
		where.push(query.status === 'ready' ? "(v.upload_status = 'ready' OR v.upload_status IS NULL)" : 'v.upload_status = ?');
		if (query.status !== 'ready') params.push(query.status);
	}
	if (query.visibility) where.push(`v.is_public = ${query.visibility === 'public' ? 1 : 0}`);
	if (query.hidden) where.push(`v.is_hidden = ${query.hidden === 'yes' ? 1 : 0}`);
	if (query.ids) {
		searching = true;
		where.push(`v.rowid IN (SELECT rowid FROM ${OWNERSHIP_TABLE} WHERE kind = 'video' AND id IN (SELECT value FROM json_each(?)))`);
		params.push(JSON.stringify(query.ids));
	}
	const from = msOf(query.createdFrom);
	if (from !== null) {
		where.push('COALESCE(v.created_at, 0) >= ?');
		params.push(from);
	}
	const to = msOf(query.createdTo);
	if (to !== null) {
		where.push('COALESCE(v.created_at, 0) <= ?');
		params.push(to + 24 * 3600 * 1000 - 1);
	}
	const result = await adminPage(
		db,
		{
			tag: `v:${sort}`,
			from: `${OWNERSHIP_TABLE} v${searching ? ' NOT INDEXED' : ''}`,
			select: `v.*, (SELECT ch.admin_title FROM ${OWNERSHIP_TABLE} ch WHERE ch.kind = 'channel' AND ch.id = v.channel_id) AS channel_name`,
			where,
			params,
			...VIDEO_ORDER[sort],
		},
		query,
	);
	return {
		items: await hydrateVideos(env, result.rows),
		total: result.total,
		totalCapped: result.totalCapped,
		page: result.page,
		pageSize: result.pageSize,
		cursor: result.cursor,
		indexComplete,
	};
}

/** Index rows → AdminVideoRow; the video object is read only for rows written before the media columns. */
export async function hydrateVideos(env: AdminEnv, rows: Row[]): Promise<AdminVideoRow[]> {
	const objects = await readMany(env.videos, rows.filter((r) => !hasMediaCols(r)).map((r) => r.id));
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
			thumbnailUrl: (hasMediaCols(r) ? r.image_url : (v.thumbnailUrl as string)) || null,
			createdAt: iso(r.created_at) ?? ((v.dateCreated as string) || null),
		};
	});
}

// ---------------------------------------------------------------------------
// Users (videos profiles + bans)
// ---------------------------------------------------------------------------

const BANNED_AT_MS = "COALESCE(CAST(strftime('%s', b.banned_at) AS INTEGER), 0) * 1000";

const USER_ORDER: Record<string, { profile: string; orphan: string; direction: Direction; type: 'number' | 'string' }> = {
	// The orphan key is idx_videos_bans_banned's expression, written the same way
	newest: { profile: 'COALESCE(p.created_at, 0)', orphan: BANNED_AT_MS, direction: 'DESC', type: 'number' },
	oldest: { profile: 'COALESCE(p.created_at, 0)', orphan: BANNED_AT_MS, direction: 'ASC', type: 'number' },
	name: { profile: "lower(COALESCE(p.admin_title, ''))", orphan: "''", direction: 'ASC', type: 'string' },
};

/** SQLite's BINARY order of text (UTF-8 bytes), for merging two keyset sources. */
function compareKey(a: KeyValue, b: KeyValue): number {
	if (typeof a === 'number' && typeof b === 'number') return a - b;
	const x = new TextEncoder().encode(String(a));
	const y = new TextEncoder().encode(String(b));
	for (let i = 0; i < Math.min(x.length, y.length); i++) if (x[i] !== y[i]) return x[i] - y[i];
	return x.length - y.length;
}

/**
 * Profiles, plus banned users whose profile was deleted (the ban outlives
 * the data): two keyset sources in the same order, merged. Profiles seek the
 * ownership index; the orphaned bans are few (a scan of the bans only).
 */
export async function listUsers(env: AdminEnv, query: AdminUserQuery): Promise<AdminPage<AdminUserRow>> {
	const db = dbOf(env);
	const indexComplete = await ensureAdminIndex(env, 'profile');
	const sort = USER_ORDER[query.sort ?? 'newest'] ? (query.sort ?? 'newest') : 'newest';
	const order = USER_ORDER[sort];
	const { pageSize } = pageOf(1, query.pageSize);
	const tag = `u:${sort}`;
	const types: Array<'number' | 'string'> = [order.type, 'string'];
	const after = decodeCursor(query.cursor, tag, types);
	const q = query.q?.trim();

	const profileWhere: string[] = ["p.kind = 'profile'", 'p.is_deleted = 0'];
	const profileParams: unknown[] = [];
	if (q) {
		const search = searchCondition('p', 'profile', q);
		profileWhere.push(search.where);
		profileParams.push(...search.params);
	}
	if (query.banned) profileWhere.push(`${query.banned === 'yes' ? 'EXISTS' : 'NOT EXISTS'} (SELECT 1 FROM videos_bans b WHERE b.user_id = p.id)`);
	const profileFrom = `${OWNERSHIP_TABLE} p${q ? ' NOT INDEXED' : ''}`;
	const profileSelect = `p.id AS id, p.admin_title AS display_name, p.handle AS user_name, p.email AS email, p.created_at AS created_at,
		EXISTS (SELECT 1 FROM videos_bans b WHERE b.user_id = p.id) AS banned, 0 AS profile_deleted`;

	const orphanWhere = [`NOT EXISTS (SELECT 1 FROM ${OWNERSHIP_TABLE} p WHERE p.kind = 'profile' AND p.id = b.user_id)`];
	const orphanParams: unknown[] = [];
	if (q) {
		orphanWhere.push('b.user_id = ?');
		orphanParams.push(q);
	}
	const withOrphans = query.banned !== 'no';
	const orphanSelect = `b.user_id AS id, NULL AS display_name, NULL AS user_name, NULL AS email, ${BANNED_AT_MS} AS created_at, 1 AS banned, 1 AS profile_deleted`;

	const [profiles, orphans, profileCount, orphanCount] = await Promise.all([
		keysetQuery<Row>(db, { from: profileFrom, select: profileSelect, where: profileWhere, params: profileParams, columns: [order.profile, 'p.id'], direction: order.direction, after, limit: pageSize }),
		withOrphans
			? keysetQuery<Row>(db, { from: 'videos_bans b', select: orphanSelect, where: orphanWhere, params: orphanParams, columns: [order.orphan, 'b.user_id'], direction: order.direction, after, limit: pageSize })
			: Promise.resolve({ rows: [] as Row[], last: null, hasMore: false }),
		cappedCount(db, profileFrom, profileWhere, profileParams, ADMIN_TOTAL_CAP),
		withOrphans ? cappedCount(db, 'videos_bans b', orphanWhere, orphanParams, ADMIN_TOTAL_CAP) : Promise.resolve({ total: 0, capped: false }),
	]);
	const sign = order.direction === 'DESC' ? -1 : 1;
	const merged = [...profiles.rows, ...orphans.rows].sort((a, b) => sign * (compareKey(a.k0 as KeyValue, b.k0 as KeyValue) || compareKey(a.k1 as KeyValue, b.k1 as KeyValue)));
	const rows = merged.slice(0, pageSize);
	const more = merged.length > pageSize || profiles.hasMore || orphans.hasMore;
	const last = rows[rows.length - 1];
	const profileObjects = await readMany(env.profiles, rows.filter((r) => !r.profile_deleted).map((r) => r.id));
	const total = profileCount.total + orphanCount.total;
	return {
		items: rows.map((r) => toUserRow(r.id, profileObjects.get(r.id) ?? null, r.banned === 1, r)),
		total: Math.min(total, ADMIN_TOTAL_CAP),
		totalCapped: profileCount.capped || orphanCount.capped || total > ADMIN_TOTAL_CAP,
		page: 1,
		pageSize,
		cursor: more && last ? encodeCursor(tag, [last.k0 as KeyValue, String(last.k1)]) : '',
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

/** Newest first; created_at is ISO text (sorts as time). */
const COMMENT_COLUMNS = ["COALESCE(c.created_at, '')", 'c.video_id', 'c.comment_id'];

export async function listComments(env: AdminEnv, query: AdminCommentQuery): Promise<AdminPage<AdminCommentRow>> {
	const db = dbOf(env);
	const indexComplete = await ensureAdminIndex(env, 'video');
	const where: string[] = [];
	const params: unknown[] = [];
	const phrase = trigramPhrase(query.q);
	let searching = false;
	if (query.q?.trim()) {
		searching = true;
		// Comment text from 3 characters (trigram index); a shorter term matches comment ids only
		where.push(
			phrase
				? `(c.video_id, c.comment_id) IN (SELECT video_id, comment_id FROM admin_comment_keys WHERE k IN (SELECT rowid FROM admin_comments_fts WHERE admin_comments_fts MATCH ?))`
				: 'c.comment_id = ?',
		);
		params.push(phrase ?? query.q.trim());
	}
	if (query.videoId) {
		where.push('c.video_id = ?');
		params.push(query.videoId);
	}
	if (query.userId) {
		where.push('c.user_id = ?');
		params.push(query.userId);
	}
	if (!where.length) where.push('1 = 1');
	const result = await adminPage(
		db,
		{
			tag: 'cm',
			from: 'admin_comments c',
			select: `c.*, (SELECT v.admin_title FROM ${OWNERSHIP_TABLE} v WHERE v.kind = 'video' AND v.id = c.video_id) AS video_title`,
			where,
			params,
			columns: COMMENT_COLUMNS,
			direction: 'DESC',
			types: ['string', 'string', 'string'],
		},
		query,
	);
	return {
		items: result.rows.map((r) => ({
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
		total: result.total,
		totalCapped: result.totalCapped,
		page: result.page,
		pageSize: result.pageSize,
		cursor: result.cursor,
		indexComplete,
	};
}

// ---------------------------------------------------------------------------
// Playlists
// ---------------------------------------------------------------------------

/**
 * Playlists from the ownership index (kind 'playlist', migration 0013),
 * newest first, or null while that index is incomplete (the caller scans).
 */
export async function listPlaylistsFromIndex(
	env: AdminEnv,
	query: { q?: string; channelId?: string; ownerId?: string; cursor?: string | null; pageSize?: number },
): Promise<{ items: AdminPlaylistRow[]; nextCursor: string | null } | null> {
	const db = dbOf(env);
	if (!(await isOwnershipComplete(db, 'playlist'))) return null;
	if (query.cursor && !decodeCursor(query.cursor, 'pl', ['number', 'string'])) return null;
	const where: string[] = ["p.kind = 'playlist'", 'p.is_deleted = 0'];
	const params: unknown[] = [];
	const searching = !!query.q?.trim();
	if (searching) {
		const search = searchCondition('p', 'playlist', query.q!);
		where.push(search.where);
		params.push(...search.params);
	}
	if (query.channelId) {
		where.push('p.channel_id = ?');
		params.push(query.channelId);
	}
	if (query.ownerId) {
		where.push('p.owner_id = ?');
		params.push(query.ownerId);
	}
	const { pageSize } = pageOf(1, query.pageSize);
	const result = await keysetQuery<Row>(db, {
		from: `${OWNERSHIP_TABLE} p${searching ? ' NOT INDEXED' : ''}`,
		select: 'p.*',
		where,
		params,
		columns: ['COALESCE(p.created_at, 0)', 'p.id'],
		direction: 'DESC',
		after: decodeCursor(query.cursor, 'pl', ['number', 'string']),
		limit: pageSize,
	});
	const objects = await readMany(env.playlists, result.rows.filter((r) => !hasMediaCols(r)).map((r) => r.id));
	return {
		items: result.rows.map((r) => {
			const p = objects.get(r.id);
			return {
				id: r.id,
				title: (p?.title as string) || (p?.name as string) || r.admin_title || '',
				channelId: r.channel_id ?? null,
				ownerId: r.owner_id ?? null,
				isPublic: r.is_public === 1,
				videoCount: p ? (Array.isArray(p.videos) ? p.videos.length : 0) : Number(r.item_count) || 0,
				createdAt: iso(r.created_at),
			};
		}),
		nextCursor: result.hasMore && result.last ? encodeCursor('pl', result.last) : null,
	};
}

// ---------------------------------------------------------------------------
// Counts used by detail pages
// ---------------------------------------------------------------------------

/** A channel's videos and views (not deleted), kept by triggers in channel_totals (migration 0014). */
export async function channelVideoStats(db: SearchDb, channelId: string): Promise<{ videos: number; views: number }> {
	const row = await db.prepare('SELECT videos, views FROM channel_totals WHERE channel_id = ?').bind(channelId).first<{ videos: number; views: number }>();
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
