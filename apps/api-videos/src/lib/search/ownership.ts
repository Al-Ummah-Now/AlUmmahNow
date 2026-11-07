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
  OWNERSHIP_TABLE,
  OwnershipKind,
  SearchDb,
  SearchStatement,
  ownershipCompleteKey,
  ownershipDeleteStatement,
  ownershipInvalidatedKey,
  ownershipUpsertStatement,
  projectOwnership,
} from '@al-ummah/shared-types';
import { logger } from '../logger';

const BUCKET_FOR_KIND: Record<OwnershipKind, string> = { video: 'videos', channel: 'channels' };
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

/** Ids of the user's channels that are not deleted or hidden, in R2 key order. */
export function ownedChannelIds(env: OwnershipEnv, userId: string): Promise<string[] | null> {
  return whenComplete(env, 'channel', async db => {
    const { results } = await db.prepare(
      `SELECT id FROM ${OWNERSHIP_TABLE} WHERE kind = 'channel' AND owner_id = ? AND is_deleted = 0 AND is_hidden = 0 ORDER BY id`,
    ).bind(userId).all<{ id: string }>();
    return (results ?? []).map(r => r.id);
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
  /** Exclude live streams and videos shorter than 60 s (channel "Videos" tab). */
  longFormOnly?: boolean;
  /** Only public (`true`) or only private (`false`) videos. */
  isPublic?: boolean;
  /** Only live streams. */
  liveOnly?: boolean;
}

/**
 * One page of a channel's videos from the index (never deleted or hidden).
 * Fetches `limit + 1` ids so the caller knows if more exist.
 */
export function channelVideoIds(
  env: OwnershipEnv,
  channelId: string,
  query: ChannelVideoQuery,
): Promise<{ ids: string[]; hasMore: boolean } | null> {
  return whenComplete(env, 'video', async db => {
    const order = CHANNEL_VIDEO_ORDER[query.sort] ?? CHANNEL_VIDEO_ORDER.latest;
    const where = [`kind = 'video'`, 'channel_id = ?', 'is_deleted = 0', 'is_hidden = 0'];
    const params: unknown[] = [channelId];
    if (query.longFormOnly) {
      where.push('is_live = 0', '(duration IS NULL OR duration = 0 OR duration >= 60)');
    }
    if (query.liveOnly) where.push('is_live = 1');
    if (query.isPublic !== undefined) where.push(query.isPublic ? 'is_public = 1' : 'is_public = 0');
    if (typeof query.privateFor === 'string') {
      where.push('(is_public = 1 OR owner_id = ?)');
      params.push(query.privateFor);
    } else if (!query.privateFor) {
      where.push('is_public = 1');
    }
    const { results } = await db.prepare(
      `SELECT id FROM ${OWNERSHIP_TABLE} WHERE ${where.join(' AND ')} ORDER BY ${order} LIMIT ? OFFSET ?`,
    ).bind(...params, query.limit + 1, query.offset).all<{ id: string }>();
    const ids = (results ?? []).map(r => r.id);
    return { ids: ids.slice(0, query.limit), hasMore: ids.length > query.limit };
  });
}

/** Ids of every not-deleted, not-hidden video of the given channels. */
export function channelsVideoIds(env: OwnershipEnv, channelIds: string[]): Promise<string[] | null> {
  return whenComplete(env, 'video', async db => {
    if (!channelIds.length) return [];
    const placeholders = channelIds.map(() => '?').join(', ');
    const { results } = await db.prepare(
      `SELECT id FROM ${OWNERSHIP_TABLE} WHERE kind = 'video' AND channel_id IN (${placeholders}) AND is_deleted = 0 AND is_hidden = 0 ORDER BY id`,
    ).bind(...channelIds).all<{ id: string }>();
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
       WHERE kind = 'video' AND channel_id = ? AND is_deleted = 0 AND is_hidden = 0 AND is_public = 1
         AND (schedule_status IS NULL OR schedule_status = 'published')`,
    ).bind(channelId).first<{ videos: number; views: number }>();
    return { totalViews: Number(row?.views) || 0, videosCount: Number(row?.videos) || 0, partial: false };
  });
}

// ---------------------------------------------------------------------------
// Rebuild pass
// ---------------------------------------------------------------------------

export interface OwnershipPageResult {
  kind: OwnershipKind;
  scanned: number;
  upserted: number;
  removed: number;
  failed: number;
  nextCursor: string | null;
  done: boolean;
}

/** Write ownership rows for one page of the bucket. */
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
  await Promise.all(page.objects.map(async object => {
    const id = ownershipIdForKey(kind, object.key);
    if (!id) return;
    scanned++;
    try {
      const stored = await bucket.get(object.key);
      const value = stored ? await stored.json<Record<string, unknown>>() : null;
      if (!value) {
        statements.push(ownershipDeleteStatement(db, kind, id));
        removed++;
        return;
      }
      const row = projectOwnership(kind, id, value);
      if (row) statements.push(ownershipUpsertStatement(db, row, now));
    } catch (error) {
      failed++;
      logger.warn('[Ownership] Failed to read object during backfill', { kind, key: object.key, error: errorText(error) });
    }
  }));
  const upserted = statements.length - removed;
  for (let i = 0; i < statements.length; i += 50) {
    await db.batch(statements.slice(i, i + 50));
  }
  const nextCursor = page.truncated ? (page as { cursor?: string }).cursor ?? null : null;
  return { kind, scanned, upserted, removed, failed, nextCursor, done: !nextCursor };
}

interface PassState {
  cursor: string | null;
  startedAt: number;
  failed: number;
}

const passKey = (kind: OwnershipKind) => `ownership:sweep:${kind}`;
const leaseKey = (kind: OwnershipKind) => `ownership:heal:${kind}`;

async function readPass(db: SearchDb, kind: OwnershipKind): Promise<PassState | null> {
  const row = await db.prepare('SELECT value FROM search_meta WHERE key = ?').bind(passKey(kind)).first<{ value: string }>();
  if (!row) return null;
  try {
    return JSON.parse(row.value) as PassState;
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
}

/**
 * Advance the kind's rebuild pass by up to `maxPages` pages. The cursor is
 * kept in search_meta, so passes resume across cron runs, heals and internal
 * calls. When the bucket has been fully walked, rows not refreshed since the
 * pass started are pruned (objects removed without going through api-videos)
 * and, if no object failed to read and no write was lost since the pass
 * started, the kind is marked complete.
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
  let state: PassState = (await readPass(db, kind)) ?? { cursor: null, startedAt: clock(), failed: 0 };

  while (result.pages < maxPages) {
    const page = await backfillOwnershipPage(env, kind, { cursor: state.cursor, limit: options.pageSize, now: clock() });
    result.pages++;
    result.scanned += page.scanned;
    state = { ...state, cursor: page.nextCursor, failed: state.failed + page.failed };
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
  const trustworthy = state.failed === 0 && !(invalidated && Number(invalidated.updated_at) >= state.startedAt);
  const statements = [
    db.prepare(`DELETE FROM ${OWNERSHIP_TABLE} WHERE kind = ? AND indexed_at < ?`).bind(kind, state.startedAt),
    db.prepare('DELETE FROM search_meta WHERE key = ?').bind(passKey(kind)),
  ];
  if (trustworthy) {
    statements.push(db.prepare(
      `INSERT INTO search_meta (key, value, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    ).bind(ownershipCompleteKey(kind), String(state.startedAt), now));
  }
  await db.batch(statements);
  result.complete = trustworthy;
  logger.info('[Ownership] Pass finished', { kind, startedAt: state.startedAt, failed: state.failed, complete: result.complete });
  return result;
}

/** Daily cron: advance both passes (a full pass also refreshes complete markers). */
export async function reconcileOwnershipIndex(
  env: OwnershipEnv,
  options: { pagesPerKind?: number; pageSize?: number; now?: () => number } = {},
): Promise<Record<OwnershipKind, OwnershipPassResult>> {
  const summary = {} as Record<OwnershipKind, OwnershipPassResult>;
  const db = dbOf(env);
  for (const kind of ['channel', 'video'] as OwnershipKind[]) {
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

/** Take the heal lease; false when another heal holds it. */
async function acquireHealLease(db: SearchDb, kind: OwnershipKind, now: number): Promise<boolean> {
  const outcome = await db.prepare(
    `INSERT INTO search_meta (key, value, updated_at) VALUES (?, 'lease', ?)
     ON CONFLICT(key) DO UPDATE SET updated_at = excluded.updated_at WHERE search_meta.updated_at < ?`,
  ).bind(leaseKey(kind), now, now - OWNERSHIP_HEAL_LEASE_MS).run() as { meta?: { changes?: number } };
  return Number(outcome?.meta?.changes) > 0;
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
  for (const kind of ['video', 'channel'] as OwnershipKind[]) {
    stats[kind] = {
      rows: Number((results ?? []).find(r => r.kind === kind)?.rows) || 0,
      complete: await isOwnershipComplete(db, kind),
    };
  }
  return stats;
}
