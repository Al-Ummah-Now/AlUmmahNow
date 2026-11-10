/**
 * Ownership index reads, rebuild pass and self-heal.
 *
 * Table: content_ownership (migrations/search/0002_content_ownership.sql),
 * written inline on every R2 put/delete of the videos and channels buckets
 * (lib/search/sync.ts) and by the processor for writes made elsewhere.
 *
 * Trust rule: a kind's rows are only used once search_meta holds
 * `ownership:complete:<kind>`, which a full pass sets after walking the whole
 * bucket (rows not seen during the pass are pruned). Until then, and whenever
 * the table is missing or a query fails, callers get `null` and fall back to
 * their bounded R2 scan, and `scheduleOwnershipHeal` queues the rebuild job
 * (admin-jobs queue; never run inside the request). A per-owner "has rows"
 * check is not enough: an owner with one new (indexed) and one old
 * (unindexed) channel would silently lose the old one.
 *
 * Once complete, a kind stays complete: an object whose write failed, or that
 * a pass could not read or index, is recorded in index_repairs and rewritten
 * by the repair job (./repairs.ts). One object never sends every reader back
 * to R2 scans.
 */

import {
  CHANNEL_ACCESS_TABLE,
  OWNERSHIP_TABLE,
  OwnershipKind,
  channelAccessStatements,
  SearchDb,
  SearchStatement,
  ownershipCompleteKey,
  ownershipDeleteStatement,
  ownershipDriftKey,
  legacyOwnershipCompleteKey,
  OWNERSHIP_DRIFT_SAMPLE,
  type OwnershipDrift,
  r2Version,
  tombstoneStatement,
  ownershipTombstone,
  ownershipInvalidatedKey,
  ownershipUpsertStatement,
  ownershipColumnsUpgradeStatement,
  projectOwnership,
  indexRepairStatement,
  pendingRepairCount,
  OWNERSHIP_SOURCES,
  ALL_OWNERSHIP_KINDS,
  OWNERSHIP_LIST_COLS_SINCE,
} from '@al-ummah/shared-types';
import { logger } from '../logger';
import { syncCommentIndex } from '../admin/commentIndex';

/** R2 binding of each kind (live streams share the videos bucket under `livestream:`). */
const BUCKET_FOR_KIND = Object.fromEntries(Object.entries(OWNERSHIP_SOURCES).map(([kind, source]) => [kind, source.bucket])) as Record<OwnershipKind, string>;
const INTERNAL_VIDEO_PREFIXES = ['index:', 'metadata:', 'livestream:'];

export const OWNERSHIP_PAGE_SIZE = 100;
/** Pages one self-heal advances (state persists, so a later heal continues). */
export const OWNERSHIP_HEAL_PAGES = 20;
/** A heal holds its lease this long; concurrent fallbacks do not start another. */
export const OWNERSHIP_HEAL_LEASE_MS = 2 * 60 * 1000;

export interface OwnershipEnv {
  SEARCH_DB?: SearchDb;
  [binding: string]: unknown;
}

function dbOf(env: OwnershipEnv): SearchDb | null {
  return (env?.SEARCH_DB as SearchDb | undefined) ?? null;
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Entity id stored under an R2 key, or null for nested/internal keys. */
export function ownershipIdForKey(kind: OwnershipKind, key: string): string | null {
  const prefix = OWNERSHIP_SOURCES[kind].prefix;
  if (prefix) {
    if (!key?.startsWith(prefix)) return null;
    key = key.slice(prefix.length);
  }
  if (!key || key.includes('/') || key.includes(':')) return null;
  if (kind === 'video' && INTERNAL_VIDEO_PREFIXES.some(prefix => key.startsWith(prefix))) return null;
  return key;
}

// ---------------------------------------------------------------------------
// Completeness marker
// ---------------------------------------------------------------------------

export async function isOwnershipComplete(db: SearchDb, kind: OwnershipKind): Promise<boolean> {
  const row = await db.prepare('SELECT value FROM search_meta WHERE key = ?').bind(ownershipCompleteKey(kind)).first<{ value: string }>();
  return !!row;
}

async function setMeta(db: SearchDb, key: string, value: string, now: number): Promise<void> {
  await db.prepare(
    `INSERT INTO search_meta (key, value, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
  ).bind(key, value, now).run();
}

/**
 * Run `query` only when the kind's index is complete. Returns null (caller
 * scans R2) when SEARCH_DB is unbound, the index is incomplete, or D1 fails.
 */
async function whenComplete<T>(env: OwnershipEnv, kind: OwnershipKind, query: (db: SearchDb) => Promise<T>, options: { listColumns?: boolean } = {}): Promise<T | null> {
  const db = dbOf(env);
  if (!db) return null;
  try {
    if (!(await isOwnershipComplete(db, kind))) return null;
    if (options.listColumns && !(await columnsCurrent(db, kind))) return null;
    return await query(db);
  } catch (error) {
    logger.warn('[Ownership] Index query failed, falling back to R2 scan', { kind, error: errorText(error) });
    return null;
  }
}

/**
 * True once no row of the kind predates the list columns (category, status;
 * migration 0013): one indexed probe. Rows written before keep NULL there
 * until the next ownership pass rewrites them.
 */
export async function columnsCurrent(db: SearchDb, kind: OwnershipKind): Promise<boolean> {
  const stale = await db.prepare(`SELECT 1 AS x FROM ${OWNERSHIP_TABLE} WHERE kind = ? AND admin_cols < ? LIMIT 1`)
    .bind(kind, OWNERSHIP_LIST_COLS_SINCE).first<{ x: number }>();
  return !stale;
}

// ---------------------------------------------------------------------------
// Keyset pages
// ---------------------------------------------------------------------------

/**
 * List orders. Every column is descending (or every one ascending), so a
 * page is one seek in the matching index of migration 0013, however deep.
 */
export type OwnershipSort = 'latest' | 'oldest' | 'popular' | 'updated' | 'live-first';

const SORT_COLUMNS: Record<OwnershipSort, { columns: string[]; direction: 'DESC' | 'ASC' }> = {
  latest: { columns: ['COALESCE(created_at, 0)', 'id'], direction: 'DESC' },
  oldest: { columns: ['COALESCE(created_at, 0)', 'id'], direction: 'ASC' },
  popular: { columns: ['views', 'id'], direction: 'DESC' },
  updated: { columns: ['COALESCE(updated_at, 0)', 'id'], direction: 'DESC' },
  'live-first': { columns: ['is_live', 'COALESCE(created_at, 0)', 'id'], direction: 'DESC' },
};

/** Where a page ended: the sort key values of its last row (the id last). */
export interface KeysetPosition {
  sort: OwnershipSort;
  values: Array<number | string>;
}

export const KEYSET_CURSOR_PREFIX = 'ks:';

/** Opaque, URL-safe cursor of a keyset position. */
export function encodeKeysetCursor(position: KeysetPosition): string {
  const bytes = new TextEncoder().encode(JSON.stringify([position.sort, ...position.values]));
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return KEYSET_CURSOR_PREFIX + btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** The position of a keyset cursor for `sort`, or null (absent, malformed, or of another order). */
export function decodeKeysetCursor(cursor: string | null | undefined, sort: OwnershipSort): KeysetPosition | null {
  if (!cursor?.startsWith(KEYSET_CURSOR_PREFIX)) return null;
  try {
    const b64 = cursor.slice(KEYSET_CURSOR_PREFIX.length).replace(/-/g, '+').replace(/_/g, '/');
    const binary = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
    const parsed = JSON.parse(new TextDecoder().decode(Uint8Array.from(binary, ch => ch.charCodeAt(0)))) as unknown;
    if (!Array.isArray(parsed) || parsed[0] !== sort) return null;
    const values = parsed.slice(1);
    const expected = SORT_COLUMNS[sort].columns.length;
    if (values.length !== expected) return null;
    if (typeof values[expected - 1] !== 'string') return null;
    if (!values.slice(0, -1).every(v => typeof v === 'number' && Number.isFinite(v))) return null;
    return { sort, values };
  } catch {
    return null;
  }
}

export interface KeysetPageQuery {
  kind: OwnershipKind;
  sort: OwnershipSort;
  limit: number;
  /** Continue after this position (null: the first page). */
  after?: KeysetPosition | null;
  /** Legacy offset cursors (`idx:<n>`) issued before keyset paging. */
  offset?: number;
  /** Extra conditions (AND-ed) and their parameters. */
  where: string[];
  params: unknown[];
}

/**
 * One page of rows in `sort` order after `after`. Fetches `limit + 1` so the
 * caller knows if more exist. Rows inserted meanwhile before the position are
 * not repeated, and none after it is skipped.
 */
export async function keysetPage(db: SearchDb, q: KeysetPageQuery): Promise<{ ids: string[]; last: KeysetPosition | null; hasMore: boolean }> {
  const { columns, direction } = SORT_COLUMNS[q.sort];
  const where = [`kind = ?`, ...q.where];
  const params: unknown[] = [q.kind, ...q.params];
  if (q.after && q.after.sort === q.sort) {
    // Row-value comparison: SQLite seeks the index to the position
    where.push(`(${columns.join(', ')}) ${direction === 'DESC' ? '<' : '>'} (${columns.map(() => '?').join(', ')})`);
    params.push(...q.after.values);
  }
  const select = columns.map((c, i) => `${c} AS k${i}`).join(', ');
  const offset = !q.after && q.offset ? ` OFFSET ${Math.max(0, Math.floor(q.offset))}` : '';
  const { results } = await db.prepare(
    `SELECT ${select} FROM ${OWNERSHIP_TABLE} WHERE ${where.join(' AND ')} ORDER BY ${columns.map(c => `${c} ${direction}`).join(', ')} LIMIT ?${offset}`,
  ).bind(...params, q.limit + 1).all<Record<string, number | string>>();
  const rows = (results ?? []).slice(0, q.limit);
  const lastRow = rows[rows.length - 1];
  return {
    ids: rows.map(r => String(r[`k${columns.length - 1}`])),
    last: lastRow ? { sort: q.sort, values: columns.map((_, i) => (i === columns.length - 1 ? String(lastRow[`k${i}`]) : Number(lastRow[`k${i}`]))) } : null,
    hasMore: (results ?? []).length > q.limit,
  };
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

/** Key order, or with `newest` only that many rows, newest first (a bounded read, SCALABILITY-AUDIT AV-16). */
function orderAndLimit(newest?: number): string {
  return newest ? 'ORDER BY created_at DESC, id LIMIT ?' : 'ORDER BY id';
}

/** Ids of the user's channels that are not deleted or hidden, in R2 key order. */
export function ownedChannelIds(env: OwnershipEnv, userId: string): Promise<string[] | null> {
  return whenComplete(env, 'channel', async db => {
    const { results } = await db.prepare(
      // Suspended channels stay in the owner's list (the endpoint shows them with the notice)
      `SELECT id FROM ${OWNERSHIP_TABLE} WHERE kind = 'channel' AND owner_id = ? AND is_deleted = 0 AND (is_hidden = 0 OR is_suspended = 1) ORDER BY id`,
    ).bind(userId).all<{ id: string }>();
    return (results ?? []).map(r => r.id);
  });
}

/**
 * Channels where the user holds a per-channel role (admin, editor,
 * moderator), from the channel_access index, by channel id. Callers re-check
 * the role on the R2 record. Same trust rule as the ownership rows: null
 * (scan R2) until the channel pass is complete or when the query fails.
 */
export function memberChannelRoles(env: OwnershipEnv, userId: string): Promise<Array<{ channelId: string; role: string }> | null> {
  return whenComplete(env, 'channel', async db => {
    const { results } = await db.prepare(
      `SELECT channel_id, role FROM ${CHANNEL_ACCESS_TABLE} WHERE user_id = ? ORDER BY channel_id`,
    ).bind(userId).all<{ channel_id: string; role: string }>();
    return (results ?? []).map(r => ({ channelId: r.channel_id, role: r.role }));
  });
}

/**
 * Ids of the user's not-deleted channels, or of their not-deleted videos in
 * `channelIds` (or in no channel), moderation-hidden ones included: owner-only
 * views such as analytics still count them.
 */
export function ownerContentIds(env: OwnershipEnv, kind: OwnershipKind, userId: string, channelIds?: string[], newest?: number): Promise<string[] | null> {
  return whenComplete(env, kind, async db => {
    const channelFilter = kind === 'video' && channelIds
      ? ` AND (channel_id IS NULL${channelIds.length ? ` OR channel_id IN (${channelIds.map(() => '?').join(', ')})` : ''})`
      : '';
    const { results } = await db.prepare(
      `SELECT id FROM ${OWNERSHIP_TABLE} WHERE kind = ? AND owner_id = ? AND is_deleted = 0${channelFilter} ${orderAndLimit(newest)}`,
    ).bind(kind, userId, ...(channelFilter ? channelIds ?? [] : []), ...(newest ? [newest] : [])).all<{ id: string }>();
    return (results ?? []).map(r => r.id);
  });
}

/**
 * Ids of the user's not-deleted videos that carry a schedule (optionally of
 * one channel and one schedule status): the scheduled-videos list without a
 * bucket scan (SCALABILITY-AUDIT AV-16).
 */
export function ownerScheduledVideoIds(env: OwnershipEnv, userId: string, filter: { channelId?: string; status?: string } = {}): Promise<string[] | null> {
  return whenComplete(env, 'video', async db => {
    const clauses = [`kind = 'video'`, 'owner_id = ?', 'is_deleted = 0', 'schedule_status IS NOT NULL'];
    const binds: unknown[] = [userId];
    if (filter.channelId) { clauses.push('channel_id = ?'); binds.push(filter.channelId); }
    if (filter.status) { clauses.push('schedule_status = ?'); binds.push(filter.status); }
    const { results } = await db.prepare(`SELECT id FROM ${OWNERSHIP_TABLE} WHERE ${clauses.join(' AND ')} ORDER BY id`).bind(...binds).all<{ id: string }>();
    return (results ?? []).map(r => r.id);
  });
}

/** Video totals from the ownership index for the metrics endpoint, or null when it is not usable. */
export function ownershipVideoTotals(env: OwnershipEnv): Promise<{ total: number; public: number; views: number } | null> {
  return whenComplete(env, 'video', async db => {
    const row = await db.prepare(
      `SELECT COUNT(*) AS total, COALESCE(SUM(is_public), 0) AS public, COALESCE(SUM(views), 0) AS views FROM ${OWNERSHIP_TABLE} WHERE kind = 'video' AND is_deleted = 0`,
    ).first<{ total: number; public: number; views: number }>();
    return { total: Number(row?.total ?? 0), public: Number(row?.public ?? 0), views: Number(row?.views ?? 0) };
  });
}

export type ChannelVideoSort = 'latest' | 'popular' | 'oldest';

export interface ChannelVideoQuery {
  sort: ChannelVideoSort;
  /** Legacy offset (`idx:<n>` cursors); ignored when `after` is set. */
  offset?: number;
  /** Continue after this keyset position. */
  after?: KeysetPosition | null;
  limit: number;
  /**
   * Which private videos are included: `true` all of them (channel owner),
   * a user id only those that user created, `false`/null none.
   */
  privateFor: boolean | string | null;
  /** Exclude live streams and Shorts (channel "Videos" tab; rule: shared-types video-format.ts). */
  longFormOnly?: boolean;
  /** Only Shorts, not live (channel "Shorts" tab; rule: shared-types video-format.ts). */
  shortsOnly?: boolean;
  /** Exclude Shorts, keep long-form and live (the playlist picker's "Videos" filter). */
  notShort?: boolean;
  /** Only public (`true`) or only private (`false`) videos. */
  isPublic?: boolean;
  /** Only live streams. */
  liveOnly?: boolean;
  /** Exclude live streams, keep long-form and Shorts (channel Home sections without a Shorts section). */
  notLive?: boolean;
  /** Only this category (needs the list columns, migration 0013). */
  category?: string;
}

/**
 * The index form of lib/visibility.ts isVideoReady: no upload status (older
 * videos) or ready. Every public list and count uses it.
 */
export const READY_SQL = "(upload_status IS NULL OR upload_status = 'ready')";

/**
 * The index form of lib/visibility.ts isVideoListedFor plus the list filters:
 * never deleted or hidden; private, scheduled and not-ready videos only for
 * `privateFor` (see ChannelVideoQuery).
 */
function videoListFilters(channelId: string | null, query: ChannelVideoQuery): { where: string[]; params: unknown[] } {
  const where = ['is_deleted = 0', 'is_hidden = 0'];
  const params: unknown[] = [];
  if (channelId) {
    where.unshift('channel_id = ?');
    params.push(channelId);
  }
  if (query.category) {
    where.push('video_category = ?');
    params.push(query.category);
  }
  if (query.longFormOnly) where.push('is_live = 0', 'is_short = 0');
  if (query.shortsOnly) where.push('is_live = 0', 'is_short = 1');
  if (query.notShort) where.push('is_short = 0');
  if (query.liveOnly) where.push('is_live = 1');
  if (query.notLive) where.push('is_live = 0');
  if (query.isPublic !== undefined) where.push(query.isPublic ? 'is_public = 1' : 'is_public = 0');
  // Public, ready and not waiting for a scheduled publish, unless the viewer may see it
  const PUBLIC = `(is_public = 1 AND ${READY_SQL} AND (schedule_status IS NULL OR schedule_status NOT IN ('scheduled', 'publishing')))`;
  if (typeof query.privateFor === 'string') {
    where.push(`(${PUBLIC} OR owner_id = ?)`);
    params.push(query.privateFor);
  } else if (!query.privateFor) {
    where.push(PUBLIC);
  }
  return { where, params };
}

/**
 * One page of videos from the index: one channel's, or with `channelId` null
 * every channel's (the home feed). Fetches `limit + 1` ids so the caller
 * knows if more exist; `last` is the keyset position to continue after.
 */
export function videoListIds(
  env: OwnershipEnv,
  channelId: string | null,
  query: ChannelVideoQuery,
): Promise<{ ids: string[]; hasMore: boolean; last: KeysetPosition | null } | null> {
  if (!(query.limit >= 1) || !((query.offset ?? 0) >= 0)) {
    return Promise.reject(new Error(`videoListIds: invalid page (limit ${query.limit}, offset ${query.offset})`));
  }
  const sort: OwnershipSort = query.sort === 'popular' ? 'popular' : query.sort === 'oldest' ? 'oldest' : 'latest';
  return whenComplete(env, 'video', async db => {
    const { where, params } = videoListFilters(channelId, query);
    return keysetPage(db, { kind: 'video', sort, limit: query.limit, after: query.after, offset: query.offset, where, params });
  }, { listColumns: !!query.category });
}

/** One page of a channel's videos (see videoListIds). */
export function channelVideoIds(
  env: OwnershipEnv,
  channelId: string,
  query: ChannelVideoQuery,
): Promise<{ ids: string[]; hasMore: boolean; last: KeysetPosition | null } | null> {
  return videoListIds(env, channelId, query);
}

export interface PlaylistListQuery {
  /** One channel's playlists, or every channel's (null). */
  channelId: string | null;
  sort: 'latest' | 'updated';
  limit: number;
  after?: KeysetPosition | null;
  /** Private playlists: `true` every one (the channel's managers), a user id only theirs, null none. */
  privateFor: boolean | string | null;
}

/** One page of playlists from the index (never deleted, hidden or system playlists such as Watch later). */
export function playlistListIds(env: OwnershipEnv, query: PlaylistListQuery): Promise<{ ids: string[]; hasMore: boolean; last: KeysetPosition | null } | null> {
  return whenComplete(env, 'playlist', async db => {
    const where = ['is_deleted = 0', 'is_hidden = 0', "(status IS NULL OR status <> 'system')"];
    const params: unknown[] = [];
    if (query.channelId) {
      where.unshift('channel_id = ?');
      params.push(query.channelId);
    }
    if (typeof query.privateFor === 'string') {
      where.push('(is_public = 1 OR owner_id = ?)');
      params.push(query.privateFor);
    } else if (!query.privateFor) {
      where.push('is_public = 1');
    }
    return keysetPage(db, { kind: 'playlist', sort: query.sort, limit: query.limit, after: query.after, where, params });
  });
}

export interface StreamListQuery {
  channelId: string | null;
  status?: string;
  limit: number;
  after?: KeysetPosition | null;
  /** Private and moderation-hidden streams are listed to their owner only (null: none). */
  viewerId: string | null;
}

/** One page of live streams, live ones first, then newest (the order the Live list always had). */
export function streamListIds(env: OwnershipEnv, query: StreamListQuery): Promise<{ ids: string[]; hasMore: boolean; last: KeysetPosition | null } | null> {
  return whenComplete(env, 'stream', async db => {
    const where = ['is_deleted = 0'];
    const params: unknown[] = [];
    if (query.channelId) {
      where.unshift('channel_id = ?');
      params.push(query.channelId);
    }
    if (query.status) {
      where.push('status = ?');
      params.push(query.status);
    }
    if (query.viewerId) {
      where.push('((is_public = 1 AND is_hidden = 0) OR owner_id = ?)');
      params.push(query.viewerId);
    } else {
      where.push('is_public = 1', 'is_hidden = 0');
    }
    return keysetPage(db, { kind: 'stream', sort: 'live-first', limit: query.limit, after: query.after, where, params });
  });
}

/** Ids of every not-deleted, not-hidden video of the given channels. */
export function channelsVideoIds(env: OwnershipEnv, channelIds: string[], newest?: number): Promise<string[] | null> {
  return whenComplete(env, 'video', async db => {
    if (!channelIds.length) return [];
    const placeholders = channelIds.map(() => '?').join(', ');
    const { results } = await db.prepare(
      `SELECT id FROM ${OWNERSHIP_TABLE} WHERE kind = 'video' AND channel_id IN (${placeholders}) AND is_deleted = 0 AND is_hidden = 0 ${orderAndLimit(newest)}`,
    ).bind(...channelIds, ...(newest ? [newest] : [])).all<{ id: string }>();
    return (results ?? []).map(r => r.id);
  });
}

/**
 * Public published video count and view sum of a channel (same rules as
 * computeChannelTotals). Views are the rows' `views`: written from the video
 * object on every write of it, and raised between writes by the view counter
 * after each flush (websocket-server view-counter.ts syncs the index). View
 * increments are not object writes that pass through here: before that sync
 * the sum lagged until the video was next edited or reconciled.
 */
export function channelTotalsFromIndex(env: OwnershipEnv, channelId: string): Promise<{ totalViews: number; videosCount: number; partial: boolean } | null> {
  return whenComplete(env, 'video', async db => {
    const row = await db.prepare(
      `SELECT COUNT(*) AS videos, COALESCE(SUM(views), 0) AS views FROM ${OWNERSHIP_TABLE}
       WHERE kind = 'video' AND channel_id = ? AND is_deleted = 0 AND is_hidden = 0 AND is_public = 1 AND ${READY_SQL}
         AND (schedule_status IS NULL OR schedule_status = 'published')`,
    ).bind(channelId).first<{ videos: number; views: number }>();
    return { totalViews: Number(row?.views) || 0, videosCount: Number(row?.videos) || 0, partial: false };
  });
}

/**
 * Public published video counts of several channels in one query (same rule
 * as channelTotalsFromIndex). Channels with no such video map to 0. Null when
 * the index is unavailable or incomplete (callers keep the stored count).
 */
export function channelVideoCountsFromIndex(env: OwnershipEnv, channelIds: string[]): Promise<Map<string, number> | null> {
  const ids = [...new Set(channelIds.filter(Boolean))];
  if (!ids.length) return Promise.resolve(new Map());
  return whenComplete(env, 'video', async db => {
    const counts = new Map<string, number>(ids.map(id => [id, 0]));
    // D1 caps bound parameters per statement; stay well under it
    for (let i = 0; i < ids.length; i += 50) {
      const chunk = ids.slice(i, i + 50);
      const placeholders = chunk.map(() => '?').join(', ');
      const { results } = await db.prepare(
        `SELECT channel_id, COUNT(*) AS videos FROM ${OWNERSHIP_TABLE}
         WHERE kind = 'video' AND channel_id IN (${placeholders}) AND is_deleted = 0 AND is_hidden = 0 AND is_public = 1 AND ${READY_SQL}
           AND (schedule_status IS NULL OR schedule_status = 'published')
         GROUP BY channel_id`,
      ).bind(...chunk).all<{ channel_id: string; videos: number }>();
      for (const row of results ?? []) counts.set(row.channel_id, Number(row.videos) || 0);
    }
    return counts;
  });
}

// ---------------------------------------------------------------------------
// Rebuild pass
// ---------------------------------------------------------------------------

export interface OwnershipPageResult {
  kind: OwnershipKind;
  /** Entity keys listed on the page (removed ones included) */
  scanned: number;
  upserted: number;
  removed: number;
  failed: number;
  /**
   * Listed objects that exist but whose write was refused (a tombstone newer
   * than the object): queued for repair by the pass. Objects that are not
   * this entity (projectOwnership is null: other JSON under an entity-like
   * key) are not counted; they have no row to miss.
   */
  skipped: number;
  /** Ids of skipped and failed objects (at most OWNERSHIP_DRIFT_SAMPLE) */
  problemIds: string[];
  /** Ids of every refused object on the page (the pass queues each for repair) */
  refusedIds: string[];
  /** Ids of every object the page could not read (queued for repair) */
  failedIds: string[];
  /** Listed objects that are not this entity (no row expected) */
  unindexable: number;
  nextCursor: string | null;
  done: boolean;
}

/** Bound parameters per verification query (D1 allows 100). */
const VERIFY_CHUNK = 90;

/**
 * Write ownership rows for one page of the bucket.
 *
 * Every object read is recorded as seen (indexed_at = now): rewritten when
 * its version is not older than the row's, otherwise the newer row is kept
 * and only marked seen. Without that mark the pass's prune deleted rows whose
 * stored version was ahead of the object's R2 `uploaded` time (rows written
 * by a write path that stamped a later clock: 2026-11-10, 345 videos and a
 * channel vanished from every list). The page then reads back which listed
 * objects have a row seen now; the rest are counted as skipped.
 */
export async function backfillOwnershipPage(
  env: OwnershipEnv,
  kind: OwnershipKind,
  options: { cursor?: string | null; limit?: number; now?: number } = {},
): Promise<OwnershipPageResult> {
  const db = dbOf(env);
  const bucket = env[BUCKET_FOR_KIND[kind]] as R2Bucket | undefined;
  if (!db || !bucket) throw new Error(`Ownership backfill unavailable: missing ${db ? BUCKET_FOR_KIND[kind] : 'SEARCH_DB'} binding`);
  const now = options.now ?? Date.now();
  const limit = Math.min(Math.max(Math.floor(options.limit ?? OWNERSHIP_PAGE_SIZE), 1), 1000);
  const prefix = OWNERSHIP_SOURCES[kind].prefix;
  const page = await bucket.list({ limit, ...(prefix ? { prefix } : {}), ...(options.cursor ? { cursor: options.cursor } : {}) });

  let scanned = 0;
  let failed = 0;
  let removed = 0;
  const statements: SearchStatement[] = [];
  /** Ids that must have a row seen by this page once the writes are applied */
  const expected: string[] = [];
  const unindexable: string[] = [];
  const failedIds: string[] = [];
  await Promise.all(page.objects.map(async object => {
    const id = ownershipIdForKey(kind, object.key);
    if (!id) return;
    scanned++;
    try {
      const stored = await bucket.get(object.key);
      const value = stored ? await stored.json<Record<string, unknown>>() : null;
      if (!value) {
        // Gone between list and get: a delete as of now (PR-8 order guard)
        statements.push(tombstoneStatement(db, ownershipTombstone(kind), id, now), ownershipDeleteStatement(db, kind, id, now));
        if (kind === 'channel') statements.push(...channelAccessStatements(db, id, null, now));
        removed++;
        return;
      }
      const row = projectOwnership(kind, id, value);
      if (!row) {
        unindexable.push(id);
        return;
      }
      // Version = when this copy was written, so a newer write made meanwhile is kept
      const version = r2Version(stored) ?? 0;
      statements.push(ownershipUpsertStatement(db, row, now, version), ownershipColumnsUpgradeStatement(db, row), ownershipSeenStatement(db, kind, id, now));
      expected.push(id);
      // The channel's role rows (channel_access) are rebuilt with it
      if (kind === 'channel') statements.push(...channelAccessStatements(db, id, value, version));
      // Admin comment list: rewritten only when the video's comments changed
      if (kind === 'video') await syncCommentIndex(db, id, value);
    } catch (error) {
      failed++;
      failedIds.push(id);
      logger.warn('[Ownership] Failed to read object during backfill', { kind, key: object.key, error: errorText(error) });
    }
  }));
  for (let i = 0; i < statements.length; i += 50) {
    await db.batch(statements.slice(i, i + 50));
  }
  // Read back: every listed object that exists must now have a row seen by this page
  const seen = new Set<string>();
  for (let i = 0; i < expected.length; i += VERIFY_CHUNK) {
    const chunk = expected.slice(i, i + VERIFY_CHUNK);
    const { results } = await db.prepare(
      `SELECT id FROM ${OWNERSHIP_TABLE} WHERE kind = ? AND indexed_at >= ? AND id IN (${chunk.map(() => '?').join(', ')})`,
    ).bind(kind, now, ...chunk).all<{ id: string }>();
    for (const r of results ?? []) seen.add(r.id);
  }
  const refused = expected.filter(id => !seen.has(id));
  if (refused.length || unindexable.length) {
    logger.warn('[Ownership] Listed objects not indexed', { kind, unindexable: unindexable.slice(0, 5), refused: refused.slice(0, 5), count: refused.length + unindexable.length });
  }
  const nextCursor = page.truncated ? (page as { cursor?: string }).cursor ?? null : null;
  return {
    kind,
    scanned,
    upserted: seen.size,
    removed,
    failed,
    skipped: refused.length,
    problemIds: [...refused, ...failedIds].sort().slice(0, OWNERSHIP_DRIFT_SAMPLE),
    refusedIds: refused,
    failedIds,
    unindexable: unindexable.length,
    nextCursor,
    done: !nextCursor,
  };
}

/** Marks an existing row seen when the upsert kept it because it is newer than the object read. */
function ownershipSeenStatement(db: SearchDb, kind: OwnershipKind, id: string, now: number): SearchStatement {
  return db.prepare(`UPDATE ${OWNERSHIP_TABLE} SET indexed_at = ? WHERE kind = ? AND id = ? AND indexed_at < ?`).bind(now, kind, id, now);
}

interface PassState {
  cursor: string | null;
  startedAt: number;
  failed: number;
  /** Absent in state saved by older builds (counted from then on) */
  skipped?: number;
  /** Objects listed and still stored (scanned minus removed) */
  stored?: number;
  problemIds?: string[];
  /** False when the pass resumed state from an older build: its counts are partial */
  counted?: boolean;
}

const passKey = (kind: OwnershipKind) => `ownership:sweep:${kind}`;
const leaseKey = (kind: OwnershipKind) => `ownership:heal:${kind}`;

async function readPass(db: SearchDb, kind: OwnershipKind): Promise<PassState | null> {
  const row = await db.prepare('SELECT value FROM search_meta WHERE key = ?').bind(passKey(kind)).first<{ value: string }>();
  if (!row) return null;
  try {
    const state = JSON.parse(row.value) as PassState;
    return state.stored === undefined ? { ...state, counted: false } : state;
  } catch {
    return null;
  }
}

export interface OwnershipPassResult {
  kind: OwnershipKind;
  pages: number;
  scanned: number;
  done: boolean;
  complete: boolean;
  /** Set when the pass finished: the drift it found, or null when the index holds every object */
  drift?: OwnershipDrift | null;
  /** Objects this run queued for the repair job */
  queuedRepairs?: number;
}

/** Forget the kind's pass in progress, so the next step starts a full pass from the first key. */
export async function resetOwnershipPass(db: SearchDb, kind: OwnershipKind): Promise<void> {
  await db.prepare('DELETE FROM search_meta WHERE key = ?').bind(passKey(kind)).run();
}

/** Drift flags of every kind (admin Errors page), oldest kind order. */
export async function readOwnershipDrift(db: SearchDb): Promise<OwnershipDrift[]> {
  const { results } = await db.prepare(`SELECT value FROM search_meta WHERE key LIKE 'ownership:drift:%' ORDER BY key`).all<{ value: string }>();
  const out: OwnershipDrift[] = [];
  for (const row of results ?? []) {
    try {
      out.push(JSON.parse(row.value) as OwnershipDrift);
    } catch {
      // A malformed flag is rewritten by the next pass
    }
  }
  return out;
}

/**
 * Advance the kind's rebuild pass by up to `maxPages` pages. The cursor is
 * kept in search_meta, so passes resume across job steps and internal calls.
 * When the bucket has been fully walked, rows not seen since the pass started
 * are pruned (objects removed without going through api-videos).
 *
 * Objects a page could not read or whose write was refused are queued for
 * the repair job (index_repairs) and no longer block the pass: the kind is
 * marked complete when every listed object has a row or is queued for repair
 * (one stuck object used to keep a kind incomplete, and every reader on R2
 * scans, forever). Otherwise the marker is removed and the drift flag set.
 */
export async function runOwnershipPass(
  env: OwnershipEnv,
  kind: OwnershipKind,
  options: { maxPages?: number; pageSize?: number; now?: () => number } = {},
): Promise<OwnershipPassResult> {
  const db = dbOf(env);
  const result: OwnershipPassResult = { kind, pages: 0, scanned: 0, done: false, complete: false };
  if (!db || !env[BUCKET_FOR_KIND[kind]]) return result;
  const clock = options.now ?? Date.now;
  const maxPages = Math.max(1, options.maxPages ?? OWNERSHIP_HEAL_PAGES);
  let state: PassState = (await readPass(db, kind)) ?? { cursor: null, startedAt: clock(), failed: 0, skipped: 0, stored: 0, problemIds: [], counted: true };

  while (result.pages < maxPages) {
    const page = await backfillOwnershipPage(env, kind, { cursor: state.cursor, limit: options.pageSize, now: clock() });
    // Objects the page could not index: repaired one by one, never blocking the pass
    const repairs = [
      ...page.refusedIds.map(id => indexRepairStatement(db, { entity: kind, id, reason: 'pass-refused', error: 'a delete newer than the stored object blocked the write' }, clock())),
      ...page.failedIds.map(id => indexRepairStatement(db, { entity: kind, id, reason: 'pass-unreadable', error: 'the pass could not read the object' }, clock())),
    ];
    for (let i = 0; i < repairs.length; i += 50) await db.batch(repairs.slice(i, i + 50));
    if (repairs.length) result.queuedRepairs = (result.queuedRepairs ?? 0) + repairs.length;
    result.pages++;
    result.scanned += page.scanned;
    state = {
      ...state,
      cursor: page.nextCursor,
      failed: state.failed + page.failed,
      skipped: (state.skipped ?? 0) + page.skipped,
      stored: (state.stored ?? 0) + page.scanned - page.removed - page.unindexable,
      problemIds: [...(state.problemIds ?? []), ...page.problemIds].slice(0, OWNERSHIP_DRIFT_SAMPLE),
    };
    if (page.done) {
      result.done = true;
      break;
    }
  }

  const now = clock();
  if (!result.done) {
    await setMeta(db, passKey(kind), JSON.stringify(state), now);
    return result;
  }
  const invalidated = await db.prepare('SELECT updated_at FROM search_meta WHERE key = ?')
    .bind(ownershipInvalidatedKey(kind)).first<{ updated_at: number }>();
  const skipped = state.skipped ?? 0;
  // A pass resumed from an older build's state did not count skips on its first pages.
  // `invalidated` is only written by workers built before per-object repairs (rollout).
  const trustworthy = state.counted !== false
    && !(invalidated && Number(invalidated.updated_at) >= state.startedAt);
  const statements = [
    db.prepare(`DELETE FROM ${OWNERSHIP_TABLE} WHERE kind = ? AND indexed_at < ?`).bind(kind, state.startedAt),
    db.prepare('DELETE FROM search_meta WHERE key = ?').bind(passKey(kind)),
    db.prepare('DELETE FROM search_meta WHERE key = ?').bind(legacyOwnershipCompleteKey(kind)),
  ];
  // Role rows of channels the pass pruned (removed without going through api-videos)
  if (kind === 'channel') {
    statements.splice(1, 0, db.prepare(
      `DELETE FROM ${CHANNEL_ACCESS_TABLE} WHERE channel_id NOT IN (SELECT id FROM ${OWNERSHIP_TABLE} WHERE kind = 'channel')`,
    ));
  }
  await db.batch(statements);
  // Compared after the prune: a row the pass saw is never pruned, so a missing one is drift
  result.drift = await recordOwnershipDrift(db, kind, state, now);
  result.complete = trustworthy && !result.drift;
  await (result.complete
    ? db.prepare(
      `INSERT INTO search_meta (key, value, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    ).bind(ownershipCompleteKey(kind), String(state.startedAt), now)
    // An earlier pass's marker must not outlive a pass that found the index incomplete
    : db.prepare('DELETE FROM search_meta WHERE key = ?').bind(ownershipCompleteKey(kind))).run();
  logger.info('[Ownership] Pass finished', { kind, startedAt: state.startedAt, failed: state.failed, skipped, complete: result.complete });
  return result;
}

/**
 * Compare the index with what the finished pass listed and set or clear the
 * drift flag. Rows beyond the listed count are objects created during the
 * pass (written inline after the listing passed their key): not drift.
 * `stored` in the flag is the listed count minus objects deleted meanwhile.
 */
async function recordOwnershipDrift(db: SearchDb, kind: OwnershipKind, state: PassState, now: number): Promise<OwnershipDrift | null> {
  const row = await db.prepare(`SELECT COUNT(*) AS n FROM ${OWNERSHIP_TABLE} WHERE kind = ?`).bind(kind).first<{ n: number }>();
  const indexed = Number(row?.n ?? 0);
  // Objects deleted while the pass ran were listed but rightly have no row (their tombstone is newer than the pass start)
  const deleted = await db.prepare('SELECT COUNT(*) AS n FROM search_tombstones WHERE entity = ? AND version >= ? AND version <= ?')
    .bind(ownershipTombstone(kind), state.startedAt, now).first<{ n: number }>();
  const stored = Math.max(0, (state.stored ?? 0) - Number(deleted?.n ?? 0));
  const skipped = state.skipped ?? 0;
  const counted = state.counted !== false;
  // Objects queued for repair are on their way into the index, not missing
  const queued = await pendingRepairCount(db, kind);
  if (indexed + queued >= stored) {
    // Partial counts from an older build's state give no verdict; the next pass decides
    if (counted) await db.prepare('DELETE FROM search_meta WHERE key = ?').bind(ownershipDriftKey(kind)).run();
    return null;
  }
  const drift: OwnershipDrift = {
    kind,
    stored,
    indexed,
    skipped,
    failed: state.failed,
    sampleIds: state.problemIds ?? [],
    at: new Date(now).toISOString(),
  };
  await setMeta(db, ownershipDriftKey(kind), JSON.stringify(drift), now);
  logger.warn('[Ownership] Index does not hold every stored object', { alert: 'ownership_drift', ...drift });
  return drift;
}

/**
 * Advance every kind's pass inline (internal endpoint and tests). The daily
 * cron no longer calls this: it queues one rebuild job per kind
 * (startIndexReconcile in ./reconcileJobs.ts), which finishes a whole pass in
 * minutes instead of 2000 objects a day.
 */
export async function reconcileOwnershipIndex(
  env: OwnershipEnv,
  options: { pagesPerKind?: number; pageSize?: number; now?: () => number } = {},
): Promise<Record<OwnershipKind, OwnershipPassResult>> {
  const summary = {} as Record<OwnershipKind, OwnershipPassResult>;
  const db = dbOf(env);
  // Profiles are indexed for the admin's user list (0005_admin_content.sql)
  for (const kind of ['channel', ...ALL_OWNERSHIP_KINDS.filter(k => k !== 'channel')] as OwnershipKind[]) {
    summary[kind] = { kind, pages: 0, scanned: 0, done: false, complete: false };
    if (!db || !env[BUCKET_FOR_KIND[kind]]) continue;
    // Share the pass lease so two runs never walk the same cursor at once.
    if (!(await acquireHealLease(db, kind, (options.now ?? Date.now)()))) continue;
    try {
      summary[kind] = await runOwnershipPass(env, kind, { maxPages: options.pagesPerKind ?? 20, pageSize: options.pageSize, now: options.now });
    } finally {
      await db.prepare('DELETE FROM search_meta WHERE key = ?').bind(leaseKey(kind)).run();
    }
  }
  logger.info('[Ownership] Reconcile finished', summary);
  return summary;
}

/**
 * Take the heal lease; false when another heal holds it. Every reader that
 * falls back to a scan asks for it, so a held lease is seen with a read first
 * and only a free (or expired) one costs a write (SCALABILITY-AUDIT AV-17).
 */
async function acquireHealLease(db: SearchDb, kind: OwnershipKind, now: number): Promise<boolean> {
  const held = await db.prepare('SELECT updated_at FROM search_meta WHERE key = ?').bind(leaseKey(kind)).first<{ updated_at: number }>();
  if (held && Number(held.updated_at) >= now - OWNERSHIP_HEAL_LEASE_MS) return false;
  const outcome = await db.prepare(
    `INSERT INTO search_meta (key, value, updated_at) VALUES (?, 'lease', ?)
     ON CONFLICT(key) DO UPDATE SET updated_at = excluded.updated_at WHERE search_meta.updated_at < ?`,
  ).bind(leaseKey(kind), now, now - OWNERSHIP_HEAL_LEASE_MS).run() as { meta?: { changes?: number } };
  return Number(outcome?.meta?.changes) > 0;
}

/**
 * Run `task` holding the kind's pass lease (shared with the cron and
 * self-heal, so two passes never walk the same cursor). Null when another
 * pass holds it.
 */
export async function withOwnershipLease<T>(env: OwnershipEnv, kind: OwnershipKind, task: () => Promise<T>, now = Date.now()): Promise<T | null> {
  const db = dbOf(env);
  if (!db) throw new Error('SEARCH_DB is not bound');
  if (!(await acquireHealLease(db, kind, now))) return null;
  try {
    return await task();
  } finally {
    await db.prepare('DELETE FROM search_meta WHERE key = ?').bind(leaseKey(kind)).run();
  }
}

/** A reader's heal request is honoured at most this often per kind (the job dedupes too). */
export const OWNERSHIP_HEAL_REQUEST_MS = 10 * 60 * 1000;
const healRequestKey = (kind: OwnershipKind) => `ownership:heal-queued:${kind}`;

/**
 * Called by a reader that fell back to an R2 scan: queue the kind's rebuild
 * job (admin-jobs queue, resumable steps, retries, Errors page on failure).
 * Nothing runs in the request: one read when a heal was requested recently,
 * else a lease write and the job lookup. Returns the background promise (also
 * handed to waitUntil) so tests can await it.
 */
export function scheduleOwnershipHeal(
  env: OwnershipEnv,
  waitUntil: ((promise: Promise<unknown>) => void) | null,
  kind: OwnershipKind,
): Promise<void> | null {
  const db = dbOf(env);
  if (!db || !env[BUCKET_FOR_KIND[kind]] || !env.ADMIN_JOBS_QUEUE) return null;
  const task = (async () => {
    try {
      const now = Date.now();
      const held = await db.prepare('SELECT updated_at FROM search_meta WHERE key = ?').bind(healRequestKey(kind)).first<{ updated_at: number }>();
      if (held && Number(held.updated_at) >= now - OWNERSHIP_HEAL_REQUEST_MS) return;
      const took = await db.prepare(
        `INSERT INTO search_meta (key, value, updated_at) VALUES (?, 'requested', ?)
         ON CONFLICT(key) DO UPDATE SET updated_at = excluded.updated_at WHERE search_meta.updated_at < ?`,
      ).bind(healRequestKey(kind), now, now - OWNERSHIP_HEAL_REQUEST_MS).run() as { meta?: { changes?: number } };
      if (!(Number(took?.meta?.changes) > 0)) return;
      const { startOwnershipRebuild } = await import('./ownershipRebuild');
      const { job, existing } = await startOwnershipRebuild(env as never, kind, 'system', { fresh: false });
      logger.info('[Ownership] Heal requested', { kind, jobId: job.id, existing });
    } catch (error) {
      logger.warn('[Ownership] Heal request failed', { kind, error: errorText(error) });
    }
  })();
  if (waitUntil) waitUntil(task);
  return task;
}

/** ExecutionContext.waitUntil of a Hono context, when the runtime provides one. */
export function waitUntilOf(c: { executionCtx?: { waitUntil(promise: Promise<unknown>): void } }): ((promise: Promise<unknown>) => void) | null {
  try {
    const ctx = c.executionCtx;
    return ctx?.waitUntil ? promise => ctx.waitUntil(promise) : null;
  } catch {
    return null;
  }
}

/** Counts for /internal/search/stats. */
export async function ownershipStats(db: SearchDb): Promise<Record<OwnershipKind, { rows: number; complete: boolean }>> {
  const { results } = await db.prepare(
    `SELECT kind, COUNT(*) AS rows FROM ${OWNERSHIP_TABLE} GROUP BY kind`,
  ).all<{ kind: OwnershipKind; rows: number }>();
  const stats = {} as Record<OwnershipKind, { rows: number; complete: boolean }>;
  for (const kind of ALL_OWNERSHIP_KINDS) {
    stats[kind] = {
      rows: Number((results ?? []).find(r => r.kind === kind)?.rows) || 0,
      complete: await isOwnershipComplete(db, kind),
    };
  }
  return stats;
}
