/**
 * Daily view / watch-time rollups.
 *
 * Every tracked view (MessageType.VideoView sent by POST /api/videos/:id/view,
 * which is the only producer that also increments the video's `views` counter)
 * is folded into monthly documents in MESSAGES_BUCKET:
 *
 *   analytics/rollups/video/<videoId>/<YYYY-MM>.json
 *   analytics/rollups/channel/<channelId>/<YYYY-MM>.json
 *
 * Each document has the shape { days: { "YYYY-MM-DD": { views, watchTime } } }
 * (watchTime in seconds). api-videos reads these documents to build owner-scoped
 * analytics time series. Monthly documents keep reads to one or two objects per
 * entity for typical (<= 60 day) ranges.
 *
 * Rollups are read-modify-write updates. A queue batch is processed in parallel
 * (index.ts), and a view and the watch-time reports of one watch usually share a
 * batch, so updates of one document are chained per key within the isolate;
 * without that, both read the same document and the last write dropped the
 * other's increment. Two isolates updating the same document at the same instant
 * can still lose an increment. The lifetime `views` counter on the video object
 * remains the source of truth for totals.
 */

import type { R2Bucket } from '../types';

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
}

/** Pure: add one to a bounded counter map. */
export function incrementBounded(map: Record<string, number> | undefined, key: string, maxKeys: number): Record<string, number> {
  const next = { ...(map || {}) };
  const target = key in next || Object.keys(next).filter((k) => k !== OTHER_ORIGIN).length < maxKeys ? key : OTHER_ORIGIN;
  next[target] = (next[target] || 0) + 1;
  return next;
}

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

/**
 * Pure: add one view (and its watch time) to a monthly rollup document.
 */
export function applyView(
  doc: MonthlyRollup | null,
  entityType: 'video' | 'channel',
  entityId: string,
  day: string,
  watchTimeSeconds: number,
  dimensions: ViewDimensions = {}
): MonthlyRollup {
  const month = day.slice(0, 7);
  const next: MonthlyRollup = doc && doc.month === month
    ? { ...doc, days: { ...doc.days } }
    : { entityType, entityId, month, days: {} };
  const current = next.days[day] || { views: 0, watchTime: 0 };
  const watchTime = Number.isFinite(watchTimeSeconds) && watchTimeSeconds > 0 ? watchTimeSeconds : 0;
  const entry: DailyRollupEntry = {
    ...current,
    views: current.views + 1,
    watchTime: Math.round((current.watchTime + watchTime) * 100) / 100,
  };
  if (dimensions.source) {
    entry.sources = incrementBounded(current.sources, dimensions.source, 10);
    if (dimensions.source === 'embed') {
      entry.embedOrigins = incrementBounded(current.embedOrigins, dimensions.embedOrigin || 'unknown', MAX_EMBED_ORIGINS);
    }
  }
  next.days[day] = entry;
  next.updatedAt = new Date().toISOString();
  return next;
}

/**
 * Pure: add played seconds (#235 watch-time reports) to a monthly rollup
 * document without counting a view.
 */
export function applyWatchTime(
  doc: MonthlyRollup | null,
  entityType: 'video' | 'channel',
  entityId: string,
  day: string,
  seconds: number
): MonthlyRollup {
  const month = day.slice(0, 7);
  const next: MonthlyRollup = doc && doc.month === month
    ? { ...doc, days: { ...doc.days } }
    : { entityType, entityId, month, days: {} };
  const current = next.days[day] || { views: 0, watchTime: 0 };
  const add = Number.isFinite(seconds) && seconds > 0 ? Math.min(seconds, MAX_WATCH_TIME_DELTA_SECONDS) : 0;
  // Keep the day's other fields (views, sources, embedOrigins)
  next.days[day] = { ...current, watchTime: Math.round((current.watchTime + add) * 100) / 100 };
  next.updatedAt = new Date().toISOString();
  return next;
}

/** Same cap as api-videos (videoWatchTime.ts): one report never adds more. */
export const MAX_WATCH_TIME_DELTA_SECONDS = 60;

type Apply = (doc: MonthlyRollup | null, entityType: 'video' | 'channel', entityId: string, day: string, amount: number) => MonthlyRollup;

/** Tail of the pending updates per rollup key in this isolate. */
const pendingByKey = new Map<string, Promise<void>>();

function updateRollup(
  bucket: R2Bucket,
  entityType: 'video' | 'channel',
  entityId: string,
  day: string,
  watchTime: number,
  apply: Apply = applyView
): Promise<void> {
  const key = rollupKey(entityType, entityId, day.slice(0, 7));
  const previous = pendingByKey.get(key) ?? Promise.resolve();
  const run = previous
    .catch(() => undefined)
    .then(() => writeRollup(bucket, key, entityType, entityId, day, watchTime, apply));
  pendingByKey.set(key, run);
  void run.catch(() => undefined).then(() => {
    if (pendingByKey.get(key) === run) pendingByKey.delete(key);
  });
  return run;
}

async function writeRollup(
  bucket: R2Bucket,
  key: string,
  entityType: 'video' | 'channel',
  entityId: string,
  day: string,
  watchTime: number,
  apply: Apply
): Promise<void> {
  const existing = await bucket.get(key);
  const doc = existing ? await existing.json<MonthlyRollup>() : null;
  const updated = apply(doc, entityType, entityId, day, watchTime);
  await bucket.put(key, JSON.stringify(updated), {
    httpMetadata: { contentType: 'application/json' },
  });
}

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
 * Record a tracked view: always the video rollup, plus the channel rollup when
 * the video belongs to a channel. Legacy (imported) videos have channelId null;
 * they used to be skipped entirely, so their creators' series stayed empty.
 * Returns false (and writes nothing) for events that are not tracked views.
 */
export async function recordViewRollup(
  bucket: R2Bucket | undefined,
  payload: ViewEventPayload,
  messageTimestamp: number | string
): Promise<boolean> {
  if (!bucket || typeof bucket.get !== 'function' || typeof bucket.put !== 'function') return false;
  if (!isTrackedView(payload)) return false;
  const videoId = payload.videoId as string;
  const channelId = typeof payload.videoChannelId === 'string' ? payload.videoChannelId : '';

  const watchTime = typeof payload.watchTime === 'number' ? payload.watchTime : Number(payload.watchTime) || 0;
  const day = toUtcDay(typeof payload.timestamp === 'string' ? payload.timestamp : messageTimestamp);

  const dimensions = viewDimensions(payload);
  const withDimensions: Apply = (doc, entityType, entityId, d, amount) => applyView(doc, entityType, entityId, d, amount, dimensions);
  await Promise.all([
    updateRollup(bucket, 'video', videoId, day, watchTime, withDimensions),
    channelId ? updateRollup(bucket, 'channel', channelId, day, watchTime, withDimensions) : Promise.resolve(),
  ]);
  return true;
}

export interface WatchTimeEventPayload {
  videoId?: unknown;
  videoChannelId?: unknown;
  seconds?: unknown;
  timestamp?: unknown;
}

/**
 * Record a watch-time report (#235): the seconds go to the video rollup, and to
 * the channel rollup when the video has a channel. Views are not touched.
 * Returns false (and writes nothing) for an invalid payload.
 */
export async function recordWatchTimeRollup(
  bucket: R2Bucket | undefined,
  payload: WatchTimeEventPayload,
  messageTimestamp: number | string
): Promise<boolean> {
  if (!bucket || typeof bucket.get !== 'function' || typeof bucket.put !== 'function') return false;
  if (!payload || typeof payload.videoId !== 'string' || !payload.videoId) return false;
  const seconds = typeof payload.seconds === 'number' ? payload.seconds : Number(payload.seconds);
  if (!Number.isFinite(seconds) || seconds <= 0) return false;
  const channelId = typeof payload.videoChannelId === 'string' ? payload.videoChannelId : '';
  const day = toUtcDay(typeof payload.timestamp === 'string' ? payload.timestamp : messageTimestamp);

  await Promise.all([
    updateRollup(bucket, 'video', payload.videoId, day, seconds, applyWatchTime),
    channelId ? updateRollup(bucket, 'channel', channelId, day, seconds, applyWatchTime) : Promise.resolve(),
  ]);
  return true;
}
