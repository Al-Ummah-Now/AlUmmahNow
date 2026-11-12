/**
 * Daily view / watch-time rollups (docs/architecture/SCALABILITY-AUDIT.md, PR-1).
 *
 * Every tracked view (MessageType.VideoView sent by POST /api/videos/:id/view)
 * and every watch-time report (MessageType.VideoWatchTime) becomes increments
 * of the D1 daily counters (analytics-counters.ts, table analytics_daily), per
 * video and per channel:
 *
 *   views +1, watch_time +seconds, source[watch|embed] +1, embed_origin[<origin>] +1
 *
 * The queue handler collects the increments of a whole batch in one
 * CounterBatch and writes them in one D1 transaction of atomic upserts.
 * Nothing here reads before writing, so concurrent consumers in any number of
 * isolates never lose an update.
 *
 * Before this, the processor read-modify-wrote monthly documents in
 * MESSAGES_BUCKET (analytics/rollups/{video,channel}/<id>/<YYYY-MM>.json),
 * serialised only inside one isolate. importLegacyRollups() moves those
 * documents into D1, exactly once each, and readers add whatever has not been
 * imported yet (api-videos lib/analytics.ts loadRollups).
 */

import {
  RETENTION_BUCKET_COUNT,
  TRAFFIC_SOURCES,
  isTrafficSource,
  normalizeReferrerHost,
  type ViewTrafficSource,
} from '@al-ummah/shared-types';
import type { D1Database, R2Bucket } from '../types';
import { CounterBatch, bulkUpsertStatements, type CounterIncrement, type EntityType } from './analytics-counters';


export const ROLLUP_PREFIX = 'analytics/rollups';

export interface DailyRollupEntry {
  views: number;
  watchTime: number;
  /** Views per playback surface ("watch" | "embed"). Absent on documents written before embeds. */
  sources?: Record<string, number>;
  /** Embed views per embedding origin; at most MAX_EMBED_ORIGINS keys, the rest under "other". */
  embedOrigins?: Record<string, number>;
}

/** Bound on distinct embed origins kept per day (the rest are counted under "other"). */
export const MAX_EMBED_ORIGINS = 50;
export const OTHER_ORIGIN = 'other';

export interface ViewDimensions {
  source?: 'watch' | 'embed';
  embedOrigin?: string | null;
  trafficSource?: ViewTrafficSource;
  referrerHost?: string;
}

/** Legacy monthly document in R2 (read only by the import). */
export interface MonthlyRollup {
  entityType: 'video' | 'channel';
  entityId: string;
  month: string;
  days: Record<string, DailyRollupEntry>;
  updatedAt?: string;
}

export function rollupKey(entityType: 'video' | 'channel', entityId: string, month: string): string {
  return `${ROLLUP_PREFIX}/${entityType}/${entityId}/${month}.json`;
}

export function toUtcDay(timestamp: number | string | undefined): string {
  const date = timestamp !== undefined ? new Date(timestamp) : new Date();
  const valid = Number.isFinite(date.getTime()) ? date : new Date();
  return valid.toISOString().slice(0, 10);
}

/** Same cap as api-videos (videoWatchTime.ts): one report never adds more. */
export const MAX_WATCH_TIME_DELTA_SECONDS = 60;

export interface ViewEventPayload {
  videoId?: unknown;
  /** Set by POST /api/videos/:id/view (the only producer that counts a view). */
  trackedView?: unknown;
  videoChannelId?: unknown;
  watchTime?: unknown;
  timestamp?: unknown;
  /** "watch" | "embed" (docs/embeds §6); absent on views sent before embeds */
  source?: unknown;
  embedOrigin?: unknown;
  /** Where the view came from (docs/specs/CREATOR-STUDIO.md §8.4) */
  trafficSource?: unknown;
  referrerHost?: unknown;
  /** True when the player started the video on its own (up next, playlist advance) */
  autoplay?: unknown;
}

/** Pure: the rollup dimensions a tracked view carries (invalid values dropped). */
export function viewDimensions(payload: ViewEventPayload): ViewDimensions {
  if (payload.source !== 'watch' && payload.source !== 'embed') return {};
  if (payload.source === 'watch') return { source: 'watch' };
  const origin = typeof payload.embedOrigin === 'string' && /^https?:\/\/[^/\s]{1,253}$/.test(payload.embedOrigin)
    ? payload.embedOrigin
    : null;
  return { source: 'embed', embedOrigin: origin };
}

/**
 * True for views sent by the view-tracking endpoint. Fetch/search telemetry also
 * uses MessageType.VideoView but never carries `videoChannelId` (nor
 * `trackedView`), so it never inflates the series. The view endpoint always sets
 * the `videoChannelId` key, even to null for legacy videos without a channel.
 */
export function isTrackedView(payload: ViewEventPayload): boolean {
  if (!payload || typeof payload.videoId !== 'string' || !payload.videoId) return false;
  return payload.trackedView === true || Object.prototype.hasOwnProperty.call(payload, 'videoChannelId');
}

/**
 * Pure: the traffic dimensions of a tracked view. A missing or invalid source is
 * "unknown", so per-source counts add up to total views. Only external views
 * keep a host.
 */
export function trafficDimensions(payload: ViewEventPayload): ViewDimensions {
  const trafficSource: ViewTrafficSource = isTrafficSource(payload.trafficSource) ? payload.trafficSource : 'unknown';
  if (trafficSource !== 'external') return { trafficSource };
  const referrerHost = normalizeReferrerHost(payload.referrerHost);
  return referrerHost ? { trafficSource, referrerHost } : { trafficSource };
}

/** Bound on distinct referring hosts kept per day; the rest are counted under "other". */
export const MAX_EXTERNAL_HOSTS = 50;
const MAX_TRAFFIC_SOURCES = TRAFFIC_SOURCES.length;

/** Bound on distinct playback surfaces per day (only "watch" and "embed" exist). */
export const MAX_SOURCES = 10;

function entities(videoId: string, channelId: string): Array<[EntityType, string]> {
  return channelId ? [['video', videoId], ['channel', channelId]] : [['video', videoId]];
}

/**
 * Pure: the counter increments of one tracked view (video, plus its channel
 * when it has one; legacy imported videos have channelId null). Null for
 * events that are not tracked views.
 */
export function viewIncrements(payload: ViewEventPayload, messageTimestamp: number | string): CounterIncrement[] | null {
  if (!isTrackedView(payload)) return null;
  const videoId = payload.videoId as string;
  const channelId = typeof payload.videoChannelId === 'string' ? payload.videoChannelId : '';
  const rawWatch = typeof payload.watchTime === 'number' ? payload.watchTime : Number(payload.watchTime) || 0;
  const watchTime = Number.isFinite(rawWatch) && rawWatch > 0 ? rawWatch : 0;
  const day = toUtcDay(typeof payload.timestamp === 'string' ? payload.timestamp : messageTimestamp);
  const dimensions = viewDimensions(payload);
  const traffic = trafficDimensions(payload);

  const out: CounterIncrement[] = [];
  for (const [entityType, entityId] of entities(videoId, channelId)) {
    const base = { entityType, entityId, day };
    out.push({ ...base, metric: 'views', value: 1 });
    if (watchTime > 0) out.push({ ...base, metric: 'watch_time', value: watchTime });
    out.push({ ...base, metric: 'traffic', dim: traffic.trafficSource ?? 'unknown', value: 1, maxDims: MAX_TRAFFIC_SOURCES });
    // Autoplayed views apart from views the viewer chose (both add up to `views`)
    out.push({ ...base, metric: 'playback', dim: payload.autoplay === true ? 'autoplay' : 'chosen', value: 1, maxDims: 2 });
    if (traffic.referrerHost) {
      out.push({ ...base, metric: 'external_host', dim: traffic.referrerHost, value: 1, maxDims: MAX_EXTERNAL_HOSTS });
    }
    if (dimensions.source) {
      out.push({ ...base, metric: 'source', dim: dimensions.source, value: 1, maxDims: MAX_SOURCES });
      if (dimensions.source === 'embed') {
        out.push({ ...base, metric: 'embed_origin', dim: dimensions.embedOrigin || 'unknown', value: 1, maxDims: MAX_EMBED_ORIGINS });
      }
    }
  }
  return out;
}

/** Queues a tracked view in `counters`. False (nothing queued) for other events. */
export function recordViewRollup(counters: CounterBatch, payload: ViewEventPayload, messageTimestamp: number | string): boolean {
  const increments = viewIncrements(payload, messageTimestamp);
  if (!increments) return false;
  for (const inc of increments) counters.add(inc);
  return true;
}

export interface RetentionEventPayload {
  videoId?: unknown;
  buckets?: unknown;
  timestamp?: unknown;
}

/** Pure: valid, unique, sorted buckets, or null when the report is invalid. */
export function sanitizeRetentionBuckets(value: unknown): number[] | null {
  if (!Array.isArray(value) || value.length === 0) return null;
  const valid = value.every((bucket) => Number.isInteger(bucket) && bucket >= 0 && bucket < RETENTION_BUCKET_COUNT);
  return valid ? [...new Set(value as number[])].sort((a, b) => a - b) : null;
}

/**
 * Pure: the increments of one retention report (MessageType.VideoRetention):
 * 'retention' +1 per bucket reached (dim = bucket number), and
 * 'retention_start' +1 when the report includes bucket 0. Per video only.
 */
export function retentionIncrements(payload: RetentionEventPayload, messageTimestamp: number | string): CounterIncrement[] | null {
  if (!payload || typeof payload.videoId !== 'string' || !payload.videoId) return null;
  const buckets = sanitizeRetentionBuckets(payload.buckets);
  if (!buckets) return null;
  const base = { entityType: 'video' as const, entityId: payload.videoId, day: toUtcDay(typeof payload.timestamp === 'string' ? payload.timestamp : messageTimestamp) };
  return [
    ...(buckets.includes(0) ? [{ ...base, metric: 'retention_start', value: 1 }] : []),
    ...buckets.map((bucket) => ({ ...base, metric: 'retention', dim: String(bucket), value: 1 })),
  ];
}

/** Queues a retention report in `counters`. False (nothing queued) for an invalid report. */
export function recordRetentionRollup(counters: CounterBatch, payload: RetentionEventPayload, messageTimestamp: number | string): boolean {
  const increments = retentionIncrements(payload, messageTimestamp);
  if (!increments) return false;
  for (const inc of increments) counters.add(inc);
  return true;
}

export interface WatchTimeEventPayload {
  videoId?: unknown;
  videoChannelId?: unknown;
  seconds?: unknown;
  timestamp?: unknown;
}

/** Pure: the increments of one watch-time report (#235); views are not touched. Null when invalid. */
export function watchTimeIncrements(payload: WatchTimeEventPayload, messageTimestamp: number | string): CounterIncrement[] | null {
  if (!payload || typeof payload.videoId !== 'string' || !payload.videoId) return null;
  const seconds = typeof payload.seconds === 'number' ? payload.seconds : Number(payload.seconds);
  if (!Number.isFinite(seconds) || seconds <= 0) return null;
  const channelId = typeof payload.videoChannelId === 'string' ? payload.videoChannelId : '';
  const day = toUtcDay(typeof payload.timestamp === 'string' ? payload.timestamp : messageTimestamp);
  const value = Math.min(seconds, MAX_WATCH_TIME_DELTA_SECONDS);
  return entities(payload.videoId, channelId).map(([entityType, entityId]) => ({ entityType, entityId, day, metric: 'watch_time', value }));
}

/** Queues a watch-time report in `counters`. False (nothing queued) for an invalid payload. */
export function recordWatchTimeRollup(counters: CounterBatch, payload: WatchTimeEventPayload, messageTimestamp: number | string): boolean {
  const increments = watchTimeIncrements(payload, messageTimestamp);
  if (!increments) return false;
  for (const inc of increments) counters.add(inc);
  return true;
}

// ---------------------------------------------------------------------------
// Legacy R2 documents → D1 (one-time move, run by the hourly cron)
// ---------------------------------------------------------------------------

/** A document is imported only once nothing writes it any more (older processor versions during a rollout). */
export const IMPORT_MIN_AGE_MS = 24 * 60 * 60 * 1000;
/** Documents per run: list + get + 1 D1 batch + delete each stays far below the subrequest limit. */
export const IMPORT_BUDGET = 200;

const LEGACY_KEY = /^analytics\/rollups\/(video|channel)\/(.+)\/(\d{4}-\d{2})\.json$/;

export function parseRollupKey(key: string): { entityType: EntityType; entityId: string; month: string } | null {
  const m = LEGACY_KEY.exec(key);
  return m && m[2] && m[3] ? { entityType: m[1] as EntityType, entityId: m[2], month: m[3] } : null;
}

/** Pure: the counter rows a legacy monthly document holds. */
export function docIncrements(doc: MonthlyRollup, entityType: EntityType, entityId: string, month: string): CounterIncrement[] {
  const out: CounterIncrement[] = [];
  for (const [day, entry] of Object.entries(doc?.days || {})) {
    if (!day.startsWith(month) || !/^\d{4}-\d{2}-\d{2}$/.test(day) || !entry) continue;
    const base = { entityType, entityId, day };
    if (entry.views > 0) out.push({ ...base, metric: 'views', value: entry.views });
    if (entry.watchTime > 0) out.push({ ...base, metric: 'watch_time', value: entry.watchTime });
    for (const [dim, n] of Object.entries(entry.sources || {})) if (n > 0) out.push({ ...base, metric: 'source', dim, value: n });
    for (const [dim, n] of Object.entries(entry.embedOrigins || {})) if (n > 0) out.push({ ...base, metric: 'embed_origin', dim, value: n });
  }
  return out;
}

export interface ImportResult {
  imported: number;
  /** Already imported by an earlier (or concurrent) run: just deleted */
  alreadyImported: number;
  /** Still written to recently: left for a later run */
  tooRecent: number;
  failed: number;
  /** More documents than the budget allowed */
  more: boolean;
}

function isUniqueViolation(error: unknown): boolean {
  return /UNIQUE constraint failed|SQLITE_CONSTRAINT/i.test(String((error as Error)?.message ?? error));
}

/**
 * Moves legacy rollup documents into D1. Each document's counts and its
 * marker row commit in one transaction, so a document is added at most once
 * even if two runs overlap; the document is deleted afterwards (readers skip
 * marked documents in between).
 */
export async function importLegacyRollups(
  bucket: R2Bucket,
  db: D1Database,
  opts: { now?: number; budget?: number; minAgeMs?: number } = {},
): Promise<ImportResult> {
  const now = opts.now ?? Date.now();
  const budget = opts.budget ?? IMPORT_BUDGET;
  const minAgeMs = opts.minAgeMs ?? IMPORT_MIN_AGE_MS;
  const result: ImportResult = { imported: 0, alreadyImported: 0, tooRecent: 0, failed: 0, more: false };

  let cursor: string | undefined;
  let seen = 0;
  do {
    const page = await bucket.list({ prefix: `${ROLLUP_PREFIX}/`, limit: Math.min(100, budget - seen), ...(cursor ? { cursor } : {}) });
    for (const object of page.objects) {
      seen++;
      const parsed = parseRollupKey(object.key);
      if (!parsed) continue;
      const uploaded = object.uploaded ? new Date(object.uploaded).getTime() : 0;
      if (now - uploaded < minAgeMs) {
        result.tooRecent++;
        continue;
      }
      try {
        const body = await bucket.get(object.key);
        if (!body) continue;
        const doc = await body.json<MonthlyRollup>();
        const rows = docIncrements(doc, parsed.entityType, parsed.entityId, parsed.month);
        try {
          await db.batch([
            db.prepare('INSERT INTO analytics_rollup_imports (r2_key, imported_at) VALUES (?, ?)').bind(object.key, new Date(now).toISOString()),
            ...bulkUpsertStatements(db, rows),
          ]);
          result.imported++;
        } catch (error) {
          if (!isUniqueViolation(error)) throw error;
          result.alreadyImported++;
        }
        await bucket.delete?.(object.key);
      } catch {
        result.failed++;
      }
    }
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor && seen < budget);
  result.more = !!cursor;
  return result;
}
