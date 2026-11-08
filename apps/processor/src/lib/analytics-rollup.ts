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
 * Rollups are best-effort read-modify-write updates: two consumers updating the
 * same document at the same instant can lose an increment. The lifetime `views`
 * counter on the video object remains the source of truth for totals.
 */

import type { R2Bucket } from '../types';

export const ROLLUP_PREFIX = 'analytics/rollups';

export interface DailyRollupEntry {
  views: number;
  watchTime: number;
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
  watchTimeSeconds: number
): MonthlyRollup {
  const month = day.slice(0, 7);
  const next: MonthlyRollup = doc && doc.month === month
    ? { ...doc, days: { ...doc.days } }
    : { entityType, entityId, month, days: {} };
  const current = next.days[day] || { views: 0, watchTime: 0 };
  const watchTime = Number.isFinite(watchTimeSeconds) && watchTimeSeconds > 0 ? watchTimeSeconds : 0;
  next.days[day] = {
    views: current.views + 1,
    watchTime: Math.round((current.watchTime + watchTime) * 100) / 100,
  };
  next.updatedAt = new Date().toISOString();
  return next;
}

async function updateRollup(
  bucket: R2Bucket,
  entityType: 'video' | 'channel',
  entityId: string,
  day: string,
  watchTime: number
): Promise<void> {
  const key = rollupKey(entityType, entityId, day.slice(0, 7));
  const existing = await bucket.get(key);
  const doc = existing ? await existing.json<MonthlyRollup>() : null;
  const updated = applyView(doc, entityType, entityId, day, watchTime);
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

  await Promise.all([
    updateRollup(bucket, 'video', videoId, day, watchTime),
    channelId ? updateRollup(bucket, 'channel', channelId, day, watchTime) : Promise.resolve(),
  ]);
  return true;
}
