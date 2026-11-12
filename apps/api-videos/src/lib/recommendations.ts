/**
 * Candidate selection for GET /api/recommendations.
 *
 * Ranking used to read up to 500 full video objects from R2 per request (7+ s
 * on production). Candidates now come from the D1 search index in one batch,
 * bounded per source, and only the winners are read from R2. The bucket scan
 * remains as the fallback for an unavailable or empty index.
 */
import {
  SEARCH_TABLES,
  SearchDb,
  SearchStatement,
  SearchVideoPayload,
  buildFtsQuery,
} from '@al-ummah/shared-types';
import { DiscoveryVideo, isDiscoverable, loadDiscoverableVideos } from './discovery';
import { logger } from './logger';
import { findSeriesNext } from './series';

/** Rows read per source: the upper bound on what one request ranks. */
export const CANDIDATE_LIMITS = { category: 100, channel: 40, text: 50, recent: 50, recentWithoutSeeds: 200 };
/** Distinct seed categories and channels queried. */
const MAX_SEED_FACETS = 3;
/** Extra winners read from R2 to replace any the index had stale. */
const HYDRATE_BUFFER = 5;
/** History entries used as seeds. */
export const MAX_HISTORY_SEEDS = 10;
const MAX_HISTORY_LISTED = 200;

const { base: VIDEOS, fts: VIDEOS_FTS } = SEARCH_TABLES.video;
const JOIN_CHANNEL = 'LEFT JOIN search_channels c ON c.id = d.channel_id';
const LISTED = 'd.visible = 1 AND (c.id IS NULL OR c.visible = 1)';

interface CandidateRow {
  id: string;
  payload: string;
}

function fromRow(row: CandidateRow): DiscoveryVideo | null {
  try {
    const payload = JSON.parse(row.payload) as SearchVideoPayload;
    if (!payload?.title) return null;
    return {
      id: row.id,
      title: payload.title,
      description: payload.description,
      channelId: payload.channelId,
      channelName: payload.channelName,
      thumbnailUrl: payload.thumbnailUrl,
      dateCreated: payload.dateCreated,
      views: payload.views,
      likesCount: payload.likesCount,
      duration: payload.duration,
      category: payload.category,
      language: payload.language,
      tags: payload.tags,
    };
  } catch {
    return null;
  }
}

function rowsOf(result: unknown): DiscoveryVideo[] {
  const rows = (result as { results?: CandidateRow[] })?.results ?? [];
  return rows.map(fromRow).filter((video): video is DiscoveryVideo => !!video);
}

function distinct(values: Array<string | undefined>): string[] {
  return [...new Set(values.filter((value): value is string => !!value))].slice(0, MAX_SEED_FACETS);
}

/** Seed videos found in the index, keyed by id. */
export async function indexedSeeds(db: SearchDb, ids: string[]): Promise<Map<string, DiscoveryVideo>> {
  if (ids.length === 0) return new Map();
  const placeholders = ids.map(() => '?').join(', ');
  const result = await db
    .prepare(`SELECT d.id, d.payload FROM ${VIDEOS} d ${JOIN_CHANNEL} WHERE d.id IN (${placeholders}) AND ${LISTED}`)
    .bind(...ids)
    .all<CandidateRow>();
  return new Map(rowsOf(result).map(video => [video.id, video]));
}

/** Bounded candidates sharing a category, channel or words with the seeds, plus recent videos. */
export async function indexedCandidates(db: SearchDb, seeds: DiscoveryVideo[]): Promise<DiscoveryVideo[]> {
  const select = `SELECT d.id, d.payload FROM ${VIDEOS} d ${JOIN_CHANNEL} WHERE ${LISTED}`;
  const statements: SearchStatement[] = [
    ...distinct(seeds.map(seed => seed.category)).map(category =>
      db.prepare(`${select} AND d.category = ? ORDER BY d.created_at DESC LIMIT ?`).bind(category, CANDIDATE_LIMITS.category)),
    ...distinct(seeds.map(seed => seed.channelId)).map(channelId =>
      db.prepare(`${select} AND d.channel_id = ? ORDER BY d.created_at DESC LIMIT ?`).bind(channelId, CANDIDATE_LIMITS.channel)),
    db.prepare(`${select} ORDER BY d.created_at DESC LIMIT ?`)
      .bind(seeds.length > 0 ? CANDIDATE_LIMITS.recent : CANDIDATE_LIMITS.recentWithoutSeeds),
  ];

  const primary = seeds[0];
  const match = primary
    ? buildFtsQuery([primary.title ?? '', ...(primary.tags ?? [])].join(' '), { mode: 'any', prefix: false })
    : null;
  if (match) {
    statements.push(
      db.prepare(
        `SELECT d.id, d.payload FROM ${VIDEOS_FTS} JOIN ${VIDEOS} d ON d.rowid = ${VIDEOS_FTS}.rowid ${JOIN_CHANNEL}
         WHERE ${VIDEOS_FTS} MATCH ? AND ${LISTED} ORDER BY bm25(${VIDEOS_FTS}, 10.0, 2.0) LIMIT ?`,
      ).bind(match, CANDIDATE_LIMITS.text),
    );
  }

  const unique = new Map<string, DiscoveryVideo>();
  for (const result of await db.batch(statements)) {
    for (const video of rowsOf(result)) unique.set(video.id, video);
  }
  return [...unique.values()];
}

export interface CandidatePool {
  seeds: DiscoveryVideo[];
  candidates: DiscoveryVideo[];
  source: 'index' | 'scan';
}

async function readSeedObject(bucket: R2Bucket, id: string): Promise<DiscoveryVideo | null> {
  return bucket.get(id).then(o => (o ? o.json<DiscoveryVideo>() : null)).catch(() => null);
}

async function poolFromIndex(db: SearchDb, bucket: R2Bucket, videoId: string | undefined, historyIds: string[]): Promise<CandidatePool | null> {
  const found = await indexedSeeds(db, [...new Set([...(videoId ? [videoId] : []), ...historyIds])]);
  // A video outside the index (e.g. private) can still seed its own shelf.
  const seed = videoId ? found.get(videoId) ?? await readSeedObject(bucket, videoId) : null;
  const seeds = [
    ...(seed ? [seed] : []),
    ...historyIds.map(id => found.get(id)).filter((video): video is DiscoveryVideo => !!video),
  ];
  const candidates = await indexedCandidates(db, seeds);
  return candidates.length > 0 ? { seeds, candidates, source: 'index' } : null;
}

async function poolFromScan(bucket: R2Bucket, videoId: string | undefined, historyIds: string[]): Promise<CandidatePool> {
  const candidates = await loadDiscoverableVideos(bucket);
  const byId = new Map(candidates.map(video => [video.id, video]));
  const seed = videoId ? byId.get(videoId) ?? await readSeedObject(bucket, videoId) : null;
  const seeds = [
    ...(seed ? [seed] : []),
    ...historyIds.map(id => byId.get(id)).filter((video): video is DiscoveryVideo => !!video),
  ];
  return { seeds, candidates, source: 'scan' };
}

/** Candidates from the index, falling back to a bucket scan when it cannot answer. */
export async function loadCandidatePool(
  env: { SEARCH_DB?: unknown; videos: R2Bucket },
  videoId: string | undefined,
  historyIds: string[],
): Promise<CandidatePool> {
  const db = env.SEARCH_DB as SearchDb | undefined;
  if (db) {
    try {
      const pool = await poolFromIndex(db, env.videos, videoId, historyIds);
      if (pool) return pool;
      logger.warn('[Recommendations] Index returned no candidates, scanning the bucket');
    } catch (error) {
      logger.warn('[Recommendations] Index lookup failed, scanning the bucket', { error: error instanceof Error ? error.message : String(error) });
    }
  }
  return poolFromScan(env.videos, videoId, historyIds);
}

export function hydrationCount(limit: number): number {
  return limit + HYDRATE_BUFFER;
}

/**
 * Read ranked winners from R2 in rank order, dropping any that are no longer
 * discoverable (the index is updated asynchronously), at most `limit` of them.
 */
export async function hydrateRanked<T extends { video: DiscoveryVideo }>(
  bucket: R2Bucket,
  ranked: T[],
  limit: number,
): Promise<T[]> {
  const loaded = await Promise.all(ranked.map(async item => {
    try {
      const object = await bucket.get(item.video.id);
      const video = object ? await object.json<DiscoveryVideo>() : null;
      return isDiscoverable(video) ? { ...item, video } : null;
    } catch (error) {
      logger.warn('[Recommendations] Skipping unreadable video', { videoId: item.video.id, error });
      return null;
    }
  }));
  return loaded.filter((item): item is NonNullable<typeof item> => !!item).slice(0, limit) as T[];
}

export interface RecentHistory {
  /** Every listed video id. */
  watchedIds: string[];
  /** The most recently written entries, newest first. */
  seedIds: string[];
}

/**
 * Watch history from the listing alone: keys are `<userId>:<videoId>` and each
 * progress update rewrites the object, so no entry needs to be read.
 */
export async function loadRecentHistory(bucket: R2Bucket | undefined, userId: string): Promise<RecentHistory> {
  if (!bucket) return { watchedIds: [], seedIds: [] };
  const prefix = `${userId}:`;
  const listing = await bucket.list({ prefix, limit: MAX_HISTORY_LISTED });
  const newestFirst = [...listing.objects].sort((a, b) => new Date(b.uploaded).getTime() - new Date(a.uploaded).getTime());
  const ids = newestFirst.map(object => object.key.slice(prefix.length)).filter(Boolean);
  return { watchedIds: ids, seedIds: ids.slice(0, MAX_HISTORY_SEEDS) };
}

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

/**
 * Cache path for one recommendations result. Anonymous viewers share an entry
 * per video; a signed-in viewer's entry is keyed by a hash of their id, and by
 * the history pause flag so pausing applies at once (#242).
 */
export async function recommendationsCachePath(options: {
  videoId?: string;
  limit: number;
  userId?: string | null;
  historyPaused: boolean;
  excludeWatched: boolean;
}): Promise<string> {
  const video = encodeURIComponent(options.videoId || '_');
  if (!options.userId) return `recommendations/v1/anon/${video}/${options.limit}`;
  const viewer = await sha256Hex(options.userId);
  return `recommendations/v1/user/${viewer}/${video}/${options.limit}/${options.historyPaused ? 'paused' : 'active'}/${options.excludeWatched ? 'unwatched' : 'all'}`;
}

/** Most videos of one channel read to find a series continuation (one indexed query). */
export const SERIES_CHANNEL_LIMIT = 2000;

interface SeriesRow {
  id: string;
  channel_id: string | null;
  payload: string;
}

function seriesTitles(payload: string): string[] {
  try {
    const p = JSON.parse(payload) as { title?: string; titleLocalized?: Record<string, string> };
    return [p.title ?? '', ...Object.values(p.titleLocalized ?? {})].filter((t) => typeof t === 'string' && t.length > 0);
  } catch {
    return [];
  }
}

/**
 * The listed video that continues `videoId`'s numbered series in its channel (lib/series.ts), from
 * the search index: the video's own row and its channel's listed rows (idx_search_videos_channel,
 * bounded). Never a bucket scan; null without the index, a channel or a continuation.
 */
export async function seriesNextFromIndex(db: SearchDb, bucket: R2Bucket, videoId: string): Promise<string | null> {
  const current = await db.prepare(`SELECT id, channel_id, payload FROM ${VIDEOS} WHERE id = ?`).bind(videoId).first<SeriesRow>();
  let titles = current ? seriesTitles(current.payload) : [];
  let channelId = current?.channel_id ?? null;
  if (!current) {
    // A video outside the index (private, unlisted) still continues its channel's public series
    const own = await readSeedObject(bucket, videoId) as (DiscoveryVideo & { titleLocalized?: Record<string, string> }) | null;
    if (!own) return null;
    titles = [own.title ?? '', ...Object.values(own.titleLocalized ?? {})].filter(Boolean);
    channelId = own.channelId ?? null;
  }
  if (!channelId || titles.length === 0 || !titles.some((t) => /\d|[٠-٩۰-۹]/.test(t))) return null;
  const result = await db
    .prepare(`SELECT d.id, d.payload FROM ${VIDEOS} d ${JOIN_CHANNEL} WHERE d.channel_id = ? AND ${LISTED} ORDER BY d.created_at ASC LIMIT ?`)
    .bind(channelId, SERIES_CHANNEL_LIMIT)
    .all<CandidateRow>();
  const siblings = ((result as { results?: CandidateRow[] }).results ?? []).map((r) => ({ id: r.id, titles: seriesTitles(r.payload) }));
  return findSeriesNext({ id: videoId, titles }, siblings);
}
