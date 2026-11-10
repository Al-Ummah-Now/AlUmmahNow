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
 * their R2 scan, scheduling a heal (`scheduleOwnershipHeal`) that advances the
 * pass in the background. A per-owner "has rows" check is not enough: an owner
 * with one new (indexed) and one old (unindexed) channel would silently lose
 * the old one, and a channel with no videos would scan forever.
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
  projectOwnership,
} from '@al-ummah/shared-types';
import { logger } from '../logger';
import { syncCommentIndex } from '../admin/commentIndex';

const BUCKET_FOR_KIND: Record<OwnershipKind, string> = { video: 'videos', channel: 'channels', profile: 'profiles' };
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
async function whenComplete<T>(env: OwnershipEnv, kind: OwnershipKind, query: (db: SearchDb) => Promise<T>): Promise<T | null> {
  const db = dbOf(env);
  if (!db) return null;
  try {
    if (!(await isOwnershipComplete(db, kind))) return null;
    return await query(db);
  } catch (error) {
    logger.warn('[Ownership] Index query failed, falling back to R2 scan', { kind, error: errorText(error) });
    return null;
  }
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

const CHANNEL_VIDEO_ORDER: Record<ChannelVideoSort, string> = {
  latest: 'COALESCE(created_at, 0) DESC, id',
  popular: 'views DESC, id',
  oldest: 'COALESCE(created_at, 0) ASC, id',
};

export interface ChannelVideoQuery {
  sort: ChannelVideoSort;
  offset: number;
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
  /** Only public (`true`) or only private (`false`) videos. */
  isPublic?: boolean;
  /** Only live streams. */
  liveOnly?: boolean;
  /** Exclude live streams, keep long-form and Shorts (channel Home sections without a Shorts section). */
  notLive?: boolean;
}

/**
 * The index form of lib/visibility.ts isVideoReady: no upload status (older
 * videos) or ready. Every public list and count uses it.
 */
export const READY_SQL = "(upload_status IS NULL OR upload_status = 'ready')";

/**
 * One page of a channel's videos from the index (never deleted or hidden).
 * Fetches `limit + 1` ids so the caller knows if more exist.
 */
export function channelVideoIds(
  env: OwnershipEnv,
  channelId: string,
  query: ChannelVideoQuery,
): Promise<{ ids: string[]; hasMore: boolean } | null> {
  if (!(query.limit >= 1) || !(query.offset >= 0)) {
    return Promise.reject(new Error(`channelVideoIds: invalid page (limit ${query.limit}, offset ${query.offset})`));
  }
  return whenComplete(env, 'video', async db => {
    const order = CHANNEL_VIDEO_ORDER[query.sort] ?? CHANNEL_VIDEO_ORDER.latest;
    const where = [`kind = 'video'`, 'channel_id = ?', 'is_deleted = 0', 'is_hidden = 0'];
    const params: unknown[] = [channelId];
    if (query.longFormOnly) {
      where.push('is_live = 0', 'is_short = 0');
    }
    if (query.shortsOnly) {
      where.push('is_live = 0', 'is_short = 1');
    }
    if (query.liveOnly) where.push('is_live = 1');
    if (query.notLive) where.push('is_live = 0');
    if (query.isPublic !== undefined) where.push(query.isPublic ? 'is_public = 1' : 'is_public = 0');
    if (typeof query.privateFor === 'string') {
      where.push('(is_public = 1 OR owner_id = ?)');
      params.push(query.privateFor);
    } else if (!query.privateFor) {
      where.push('is_public = 1');
    }
    // Videos still uploading/processing (or failed) are listed only to their
    // owner: the playlist does not exist yet (2026-11-10 incident)
    if (typeof query.privateFor === 'string') {
      where.push(`(${READY_SQL} OR owner_id = ?)`);
      params.push(query.privateFor);
    } else if (!query.privateFor) {
      where.push(READY_SQL);
    }
    const { results } = await db.prepare(
      `SELECT id FROM ${OWNERSHIP_TABLE} WHERE ${where.join(' AND ')} ORDER BY ${order} LIMIT ? OFFSET ?`,
    ).bind(...params, query.limit + 1, query.offset).all<{ id: string }>();
    const ids = (results ?? []).map(r => r.id);
    return { ids: ids.slice(0, query.limit), hasMore: ids.length > query.limit };
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
 * computeChannelTotals). Views are those stored on the video objects as of
 * their last write (every view increment is such a write).
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
   * Listed objects that exist but have no row refreshed by this page: not
   * this entity (projectOwnership is null) or the write was refused (a
   * tombstone newer than the object). A pass counts them like failures.
   */
  skipped: number;
  /** Ids of skipped and failed objects (at most OWNERSHIP_DRIFT_SAMPLE) */
  problemIds: string[];
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
  const page = await bucket.list({ limit, ...(options.cursor ? { cursor: options.cursor } : {}) });

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
      statements.push(ownershipUpsertStatement(db, row, now, version), ownershipSeenStatement(db, kind, id, now));
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
  const skippedIds = [...unindexable, ...refused];
  if (skippedIds.length) {
    logger.warn('[Ownership] Listed objects not indexed', { kind, unindexable: unindexable.slice(0, 5), refused: refused.slice(0, 5), count: skippedIds.length });
  }
  const nextCursor = page.truncated ? (page as { cursor?: string }).cursor ?? null : null;
  return {
    kind,
    scanned,
    upserted: seen.size,
    removed,
    failed,
    skipped: skippedIds.length,
    problemIds: [...skippedIds, ...failedIds].sort().slice(0, OWNERSHIP_DRIFT_SAMPLE),
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
 * kept in search_meta, so passes resume across cron runs, heals and internal
 * calls. When the bucket has been fully walked, rows not seen since the pass
 * started are pruned (objects removed without going through api-videos).
 * The kind is marked complete only if every listed object was indexed (none
 * failed to read, none skipped) and no write was lost since the pass started;
 * otherwise the completeness marker is removed, so readers fall back to R2.
 * Either way the finished pass compares the index with what it listed and
 * sets (or clears) the kind's drift flag for the admin Errors page.
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
    result.pages++;
    result.scanned += page.scanned;
    state = {
      ...state,
      cursor: page.nextCursor,
      failed: state.failed + page.failed,
      skipped: (state.skipped ?? 0) + page.skipped,
      stored: (state.stored ?? 0) + page.scanned - page.removed,
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
  // A pass resumed from an older build's state did not count skips on its first pages
  const trustworthy = state.counted !== false && state.failed === 0 && skipped === 0
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
  if (counted && indexed >= stored && skipped === 0 && state.failed === 0) {
    await db.prepare('DELETE FROM search_meta WHERE key = ?').bind(ownershipDriftKey(kind)).run();
    return null;
  }
  if (!counted && indexed >= stored && skipped === 0 && state.failed === 0) {
    // Partial counts from an older build's state: no verdict; the next pass decides
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

/** Daily cron: advance both passes (a full pass also refreshes complete markers). */
export async function reconcileOwnershipIndex(
  env: OwnershipEnv,
  options: { pagesPerKind?: number; pageSize?: number; now?: () => number } = {},
): Promise<Record<OwnershipKind, OwnershipPassResult>> {
  const summary = {} as Record<OwnershipKind, OwnershipPassResult>;
  const db = dbOf(env);
  // Profiles are indexed for the admin's user list (0005_admin_content.sql)
  for (const kind of ['channel', 'video', 'profile'] as OwnershipKind[]) {
    summary[kind] = { kind, pages: 0, scanned: 0, done: false, complete: false };
    if (!db || !env[BUCKET_FOR_KIND[kind]]) continue;
    // Share the self-heal lease so the cron and a heal never walk the same cursor at once.
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

/**
 * Called by a reader that fell back to an R2 scan: advance the rebuild pass in
 * the background (one heal at a time per kind). Returns the background
 * promise (also handed to waitUntil) so tests can await it.
 */
export function scheduleOwnershipHeal(
  env: OwnershipEnv,
  waitUntil: ((promise: Promise<unknown>) => void) | null,
  kind: OwnershipKind,
): Promise<void> | null {
  const db = dbOf(env);
  if (!db || !env[BUCKET_FOR_KIND[kind]]) return null;
  const task = (async () => {
    try {
      if (!(await acquireHealLease(db, kind, Date.now()))) return;
      try {
        const result = await runOwnershipPass(env, kind, { maxPages: OWNERSHIP_HEAL_PAGES });
        logger.info('[Ownership] Self-heal step finished', { ...result });
      } finally {
        await db.prepare('DELETE FROM search_meta WHERE key = ?').bind(leaseKey(kind)).run();
      }
    } catch (error) {
      logger.warn('[Ownership] Self-heal failed', { kind, error: errorText(error) });
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
  for (const kind of ['video', 'channel', 'profile'] as OwnershipKind[]) {
    stats[kind] = {
      rows: Number((results ?? []).find(r => r.kind === kind)?.rows) || 0,
      complete: await isOwnershipComplete(db, kind),
    };
  }
  return stats;
}
