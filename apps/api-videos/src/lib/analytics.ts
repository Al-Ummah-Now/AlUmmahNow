/**
 * Owner-scoped analytics built from data the platform actually stores.
 *
 * Sources:
 * - Video objects (videos bucket): lifetime `views` counter, `likes[]`,
 *   `dislikes[]` and `comments[]` records (each with `dateCreated`).
 * - Channel subscriptions (NOTIFICATIONS_DB channel_subscriptions, or the legacy
 *   R2 `subscriptions[]` of channels not imported yet): one per subscriber
 *   identity, a member subscribing as themselves or as one of their channels
 *   (attachSubscriberStats). `subscribers[]` records are the older test shape.
 * - Daily view/watch-time rollups written by the processor for every tracked view
 *   (analytics bucket, `analytics/rollups/{video|channel}/<id>/<YYYY-MM>.json`).
 *
 * Nothing is estimated or randomized. Metrics the platform does not record
 * (shares, impressions/click-through) are reported as 0.
 */

import { logger } from './logger';
import { OwnershipEnv, ownerContentIds, scheduleOwnershipHeal } from './search/ownership';
import { FALLBACK_SCAN_OBJECTS } from './scanBudget';
import { RETENTION_BUCKET_COUNT } from '@al-ummah/shared-types';
import { subscriberDailyStats } from './subscription-store';

export interface AnalyticsVideo {
  id: string;
  title?: string;
  userId?: string;
  channelId?: string;
  thumbnailUrl?: string;
  dateCreated?: string;
  views?: number;
  duration?: number;
  likes?: Array<{ dateCreated?: string }>;
  dislikes?: Array<{ dateCreated?: string }>;
  comments?: Array<{ dateCreated?: string; isDeleted?: boolean }>;
  isDeleted?: boolean;
}

export interface AnalyticsChannel {
  id: string;
  name?: string;
  userId?: string;
  subscribers?: Array<{ dateCreated?: string }>;
  /** Legacy R2 subscriptions (channels not imported into D1 yet) */
  subscriptions?: Array<{ channelId?: string; userId?: string; dateCreated?: string }> | null;
  /** New subscribers per UTC day, from the subscription store (attachSubscriberStats) */
  subscribersByDay?: Record<string, number>;
  /** Current subscriber count, from the subscription store (attachSubscriberStats) */
  subscriberTotal?: number;
  isDeleted?: boolean;
}

export interface DailyRollupEntry {
  views: number;
  watchTime: number;
  traffic?: Record<string, number>;
  externalHosts?: Record<string, number>;
}

export interface MonthlyRollup {
  days: Record<string, DailyRollupEntry>;
}

export interface DailyMetric {
  date: string;
  views: number;
  likes: number;
  comments: number;
  shares: number;
  subscribers: number;
  watchTime: number;
}

export interface DateRange {
  from: Date;
  to: Date;
}

const DAY_MS = 24 * 60 * 60 * 1000;
export const MAX_RANGE_DAYS = 366;
export const DEFAULT_RANGE_DAYS = 28;

export function dayKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/**
 * Parse `dateFrom`/`dateTo` (ISO dates). Defaults to the last 28 days and clamps
 * the range to one year so a single request stays bounded.
 */
export function parseRange(dateFrom?: string, dateTo?: string, now: Date = new Date()): DateRange {
  const toCandidate = dateTo ? new Date(dateTo) : now;
  const to = Number.isFinite(toCandidate.getTime()) ? toCandidate : now;
  const fromCandidate = dateFrom ? new Date(dateFrom) : new Date(to.getTime() - (DEFAULT_RANGE_DAYS - 1) * DAY_MS);
  let from = Number.isFinite(fromCandidate.getTime()) ? fromCandidate : new Date(to.getTime() - (DEFAULT_RANGE_DAYS - 1) * DAY_MS);
  if (from > to) from = to;
  if ((to.getTime() - from.getTime()) / DAY_MS > MAX_RANGE_DAYS) {
    from = new Date(to.getTime() - MAX_RANGE_DAYS * DAY_MS);
  }
  return { from, to };
}

export function daysInRange(range: DateRange): string[] {
  const days: string[] = [];
  const start = Date.UTC(range.from.getUTCFullYear(), range.from.getUTCMonth(), range.from.getUTCDate());
  const end = Date.UTC(range.to.getUTCFullYear(), range.to.getUTCMonth(), range.to.getUTCDate());
  for (let t = start; t <= end; t += DAY_MS) days.push(dayKey(new Date(t)));
  return days;
}

export function monthsInRange(range: DateRange): string[] {
  return [...new Set(daysInRange(range).map(day => day.slice(0, 7)))];
}

/** The equally long period immediately before `range`. */
export function previousRange(range: DateRange): DateRange {
  const length = range.to.getTime() - range.from.getTime();
  const to = new Date(range.from.getTime() - DAY_MS);
  return { from: new Date(to.getTime() - length), to };
}

function emptySeries(days: string[]): Map<string, DailyMetric> {
  return new Map(days.map(date => [date, { date, views: 0, likes: 0, comments: 0, shares: 0, subscribers: 0, watchTime: 0 }]));
}

function countByDay(
  series: Map<string, DailyMetric>,
  events: Array<{ dateCreated?: string; isDeleted?: boolean }> | undefined,
  field: 'likes' | 'comments' | 'subscribers'
): void {
  for (const event of events || []) {
    if (!event?.dateCreated || event.isDeleted) continue;
    const date = new Date(event.dateCreated);
    if (!Number.isFinite(date.getTime())) continue;
    const entry = series.get(dayKey(date));
    if (entry) entry[field] += 1;
  }
}

/**
 * Pure: build a daily series from videos, channels and view rollups.
 */
export function buildDailySeries(
  range: DateRange,
  videos: AnalyticsVideo[],
  channels: AnalyticsChannel[],
  rollups: MonthlyRollup[]
): DailyMetric[] {
  const days = daysInRange(range);
  const series = emptySeries(days);
  for (const video of videos) {
    countByDay(series, video.likes, 'likes');
    countByDay(series, video.comments, 'comments');
  }
  for (const channel of channels) {
    if (channel.subscribersByDay) {
      for (const [date, n] of Object.entries(channel.subscribersByDay)) {
        const entry = series.get(date);
        if (entry) entry.subscribers += n;
      }
    } else {
      countByDay(series, channel.subscribers, 'subscribers');
    }
  }
  for (const rollup of rollups) {
    for (const [date, entry] of Object.entries(rollup?.days || {})) {
      const target = series.get(date);
      if (!target) continue;
      target.views += entry.views || 0;
      target.watchTime += entry.watchTime || 0;
    }
  }
  return days.map(date => {
    const entry = series.get(date)!;
    return { ...entry, watchTime: Math.round(entry.watchTime) };
  });
}

export function sumSeries(series: DailyMetric[]): Omit<DailyMetric, 'date'> {
  return series.reduce(
    (acc, d) => ({
      views: acc.views + d.views,
      likes: acc.likes + d.likes,
      comments: acc.comments + d.comments,
      shares: acc.shares + d.shares,
      subscribers: acc.subscribers + d.subscribers,
      watchTime: acc.watchTime + d.watchTime,
    }),
    { views: 0, likes: 0, comments: 0, shares: 0, subscribers: 0, watchTime: 0 }
  );
}

export function activeComments(video: AnalyticsVideo): number {
  return (video.comments || []).filter(c => !c?.isDeleted).length;
}

/** (likes + comments) / views as a percentage, one decimal. */
export function engagementRate(views: number, likes: number, comments: number): number {
  if (!views) return 0;
  return Math.round(((likes + comments) / views) * 1000) / 10;
}

export interface VideoAnalyticsResult {
  videoId: string;
  title: string;
  views: number;
  likes: number;
  dislikes: number;
  comments: number;
  shares: number;
  watchTime: number;
  avgViewDuration: number;
  clickThroughRate: number;
  engagementRate: number;
  dateCreated: string;
  thumbnailUrl?: string;
}

/**
 * Lifetime counters for a video plus watch time from the rollups provided.
 * Average view duration is watch time over the views that reported it (rollup views).
 */
/**
 * Lifetime counters, plus watch time and average view duration for `range`.
 * Rollups are whole months (legacy documents), so days outside the range are skipped.
 */
export function videoAnalytics(video: AnalyticsVideo, rollups: MonthlyRollup[] = [], range?: DateRange): VideoAnalyticsResult {
  const views = video.views || 0;
  const likes = video.likes?.length || 0;
  const comments = activeComments(video);
  const inRange = range ? new Set(daysInRange(range)) : null;
  let rollupViews = 0;
  let watchTime = 0;
  for (const rollup of rollups) {
    for (const [day, entry] of Object.entries(rollup?.days || {})) {
      if (inRange && !inRange.has(day)) continue;
      rollupViews += entry.views || 0;
      watchTime += entry.watchTime || 0;
    }
  }
  return {
    videoId: video.id,
    title: video.title || '',
    views,
    likes,
    dislikes: video.dislikes?.length || 0,
    comments,
    shares: 0,
    watchTime: Math.round(watchTime),
    avgViewDuration: rollupViews ? Math.round(watchTime / rollupViews) : 0,
    clickThroughRate: 0,
    engagementRate: engagementRate(views, likes, comments),
    dateCreated: video.dateCreated || '',
    thumbnailUrl: video.thumbnailUrl,
  };
}

export function rankTopVideos(videos: AnalyticsVideo[], limit = 5): VideoAnalyticsResult[] {
  return videos
    .map(video => videoAnalytics(video))
    .sort((a, b) => b.views - a.views || b.likes - a.likes)
    .slice(0, limit);
}

export interface SummaryResult {
  totalViews: number;
  totalLikes: number;
  totalComments: number;
  totalSubscribers: number;
  totalVideos: number;
  avgViewsPerVideo: number;
  engagementRate: number;
  topVideo: VideoAnalyticsResult | null;
}

export function buildSummary(videos: AnalyticsVideo[], channels: AnalyticsChannel[]): SummaryResult {
  const totalViews = videos.reduce((n, v) => n + (v.views || 0), 0);
  const totalLikes = videos.reduce((n, v) => n + (v.likes?.length || 0), 0);
  const totalComments = videos.reduce((n, v) => n + activeComments(v), 0);
  const totalSubscribers = channels.reduce((n, c) => n + (c.subscriberTotal ?? c.subscribers?.length ?? 0), 0);
  const top = rankTopVideos(videos, 1);
  return {
    totalViews,
    totalLikes,
    totalComments,
    totalSubscribers,
    totalVideos: videos.length,
    avgViewsPerVideo: videos.length ? Math.round(totalViews / videos.length) : 0,
    engagementRate: engagementRate(totalViews, totalLikes, totalComments),
    topVideo: top[0] || null,
  };
}

// ---------------------------------------------------------------------------
// R2 loaders
// ---------------------------------------------------------------------------

const SKIPPED_VIDEO_KEY_PREFIXES = ['index:', 'metadata:', 'livestream:'];

async function readJson<T>(bucket: R2Bucket, key: string): Promise<T | null> {
  try {
    const object = await bucket.get(key);
    return object ? await object.json<T>() : null;
  } catch (error) {
    logger.warn('[analytics] Unreadable object', { key, error });
    return null;
  }
}

/**
 * Where the loaders may read the ownership index instead of scanning a bucket:
 * the worker env (SEARCH_DB + buckets) and the request's waitUntil, used to
 * schedule a heal when the index cannot be trusted yet.
 */
export interface OwnershipLookup {
  env: OwnershipEnv;
  waitUntil: ((promise: Promise<unknown>) => void) | null;
}

/**
 * Ids the user owns from the ownership index, or null when the caller must
 * scan (no lookup given, index incomplete or unavailable; a heal is scheduled).
 */
async function indexedIds(
  lookup: OwnershipLookup | undefined,
  kind: 'video' | 'channel',
  userId: string,
  channelIds?: Set<string>
): Promise<string[] | null> {
  if (!lookup) return null;
  const ids = await ownerContentIds(lookup.env, kind, userId, channelIds && [...channelIds]);
  if (!ids) scheduleOwnershipHeal(lookup.env, lookup.waitUntil, kind);
  return ids;
}

/** All channels owned by the user. */
export async function loadOwnedChannels(bucket: R2Bucket, userId: string, lookup?: OwnershipLookup): Promise<AnalyticsChannel[]> {
  const isOwned = (channel: AnalyticsChannel | null): channel is AnalyticsChannel =>
    !!channel?.id && channel.userId === userId && !channel.isDeleted;
  const ids = await indexedIds(lookup, 'channel', userId);
  if (ids) {
    const channels = await Promise.all(ids.map(id => readJson<AnalyticsChannel>(bucket, id)));
    return channels.filter(isOwned);
  }
  // Fallback while the ownership index is incomplete: bounded (SCALABILITY-AUDIT AV-16)
  const owned: AnalyticsChannel[] = [];
  let cursor: string | undefined;
  let scanned = 0;
  do {
    const page = await bucket.list({ limit: 100, cursor });
    scanned += page.objects.length;
    const channels = await Promise.all(page.objects.map(o => readJson<AnalyticsChannel>(bucket, o.key)));
    owned.push(...channels.filter(isOwned));
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor && scanned < FALLBACK_SCAN_OBJECTS);
  return owned;
}

/**
 * Videos (any visibility) belonging to the given channels and owned by the user.
 * Reads only those videos when the ownership index is complete; otherwise
 * scans at most `maxObjects` keys.
 */
export async function loadOwnedVideos(
  bucket: R2Bucket,
  userId: string,
  channelIds: Set<string>,
  maxObjects = FALLBACK_SCAN_OBJECTS,
  lookup?: OwnershipLookup,
  /** Called when the fallback scan stopped at its bound, so the list may miss videos. */
  onIncomplete?: () => void
): Promise<AnalyticsVideo[]> {
  const isOwned = (video: AnalyticsVideo | null): video is AnalyticsVideo =>
    !!video?.id && !video.isDeleted && video.userId === userId && (!video.channelId || channelIds.has(video.channelId));
  const ids = await indexedIds(lookup, 'video', userId, channelIds);
  if (ids) {
    const videos = await Promise.all(ids.map(id => readJson<AnalyticsVideo>(bucket, id)));
    return videos.filter(isOwned);
  }
  const videos: AnalyticsVideo[] = [];
  let cursor: string | undefined;
  let scanned = 0;
  do {
    const page = await bucket.list({ limit: 100, cursor });
    const keys = page.objects
      .map(o => o.key)
      .filter(key => !SKIPPED_VIDEO_KEY_PREFIXES.some(prefix => key.startsWith(prefix)));
    scanned += keys.length;
    const items = await Promise.all(keys.map(key => readJson<AnalyticsVideo>(bucket, key)));
    videos.push(...items.filter(isOwned));
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor && scanned < maxObjects);
  if (cursor) onIncomplete?.();
  return videos;
}

export interface RollupSources {
  /** D1 daily counters written by the processor (table analytics_daily) */
  NOTIFICATIONS_DB?: D1Database;
  /** Legacy monthly documents, until the processor has imported them into D1 */
  analytics_rollups?: R2Bucket;
}

interface CounterRow {
  entity_id: string;
  day: string;
  metric: string;
  dim?: string;
  value: number;
}

/**
 * Daily views / watch time of some videos or channels over `range`, as
 * monthly rollups (one per entity and month; callers sum them).
 *
 * Source of truth is the processor's D1 counters (SCALABILITY-AUDIT PR-1).
 * Legacy R2 documents (analytics/rollups/...) that the processor has not
 * imported yet are added; imported ones are listed in
 * analytics_rollup_imports and skipped, so nothing is counted twice.
 */
export async function loadRollups(
  sources: RollupSources,
  entityType: 'video' | 'channel',
  entityIds: string[],
  range: DateRange
): Promise<MonthlyRollup[]> {
  if (entityIds.length === 0) return [];
  const days = daysInRange(range);
  const fromDay = days[0];
  const toDay = days[days.length - 1];
  const out: MonthlyRollup[] = [];
  const db = sources.NOTIFICATIONS_DB;

  let imported = new Set<string>();
  if (db) {
    const byEntityMonth = new Map<string, MonthlyRollup>();
    for (let i = 0; i < entityIds.length; i += 50) {
      const ids = entityIds.slice(i, i + 50);
      const result = await db
        .prepare(
          `SELECT entity_id, day, metric, dim, value FROM analytics_daily
           WHERE entity_type = ? AND entity_id IN (${ids.map(() => '?').join(', ')}) AND day >= ? AND day <= ? AND metric IN ('views', 'watch_time', 'traffic', 'external_host')`
        )
        .bind(entityType, ...ids, fromDay, toDay)
        .all<CounterRow>();
      for (const row of result.results ?? []) {
        const key = `${row.entity_id}/${row.day.slice(0, 7)}`;
        const doc = byEntityMonth.get(key) ?? { days: {} };
        byEntityMonth.set(key, doc);
        const entry = (doc.days[row.day] ??= { views: 0, watchTime: 0 });
        const dim = row.dim || 'unknown';
        if (row.metric === 'views') entry.views += row.value;
        else if (row.metric === 'watch_time') entry.watchTime += row.value;
        else if (row.metric === 'traffic') (entry.traffic ??= {})[dim] = (entry.traffic[dim] ?? 0) + row.value;
        else if (row.metric === 'external_host') (entry.externalHosts ??= {})[dim] = (entry.externalHosts[dim] ?? 0) + row.value;
      }
    }
    out.push(...byEntityMonth.values());
  }

  const bucket = sources.analytics_rollups;
  if (bucket) {
    const months = monthsInRange(range);
    const keys = entityIds.flatMap(id => months.map(month => `analytics/rollups/${entityType}/${id}/${month}.json`));
    if (db) {
      try {
        for (let i = 0; i < keys.length; i += 50) {
          const chunk = keys.slice(i, i + 50);
          const result = await db
            .prepare(`SELECT r2_key FROM analytics_rollup_imports WHERE r2_key IN (${chunk.map(() => '?').join(', ')})`)
            .bind(...chunk)
            .all<{ r2_key: string }>();
          for (const row of result.results ?? []) imported.add(row.r2_key);
        }
      } catch (error) {
        // Before the migration ran nothing is imported, so every document counts
        logger.warn('[analytics] could not read rollup imports', { error: String(error) });
        imported = new Set();
      }
    }
    const docs = await Promise.all(keys.filter(key => !imported.has(key)).map(key => readJson<MonthlyRollup>(bucket, key)));
    out.push(...docs.filter((doc): doc is MonthlyRollup => !!doc));
  }
  return out;
}

/** Below this many starts a curve would be noise, and could point at individual viewers. */
export const MIN_RETENTION_STARTS = 10;
/** External sites returned with the traffic sources. */
const MAX_EXTERNAL_HOSTS_SHOWN = 10;

export interface RetentionDay {
  starts: number;
  buckets: number[];
}

export interface RetentionDocument {
  days: Record<string, RetentionDay>;
}

export interface RetentionCurve {
  starts: number;
  /** Share of starts that reached each bucket; null below MIN_RETENTION_STARTS */
  points: Array<{ bucket: number; share: number }> | null;
}

/** A video's retention counters (processor: 'retention_start', 'retention' per bucket) over `range`, by day. */
export async function loadRetention(sources: RollupSources, videoId: string, range: DateRange): Promise<RetentionDocument[]> {
  const db = sources.NOTIFICATIONS_DB;
  if (!db) return [];
  const days = daysInRange(range);
  const { results } = await db
    .prepare(
      `SELECT day, metric, dim, value FROM analytics_daily
       WHERE entity_type = 'video' AND entity_id = ? AND day >= ? AND day <= ? AND metric IN ('retention_start', 'retention')`,
    )
    .bind(videoId, days[0], days[days.length - 1])
    .all<{ day: string; metric: string; dim: string; value: number }>();
  const doc: RetentionDocument = { days: {} };
  for (const row of results ?? []) {
    const entry = (doc.days[row.day] ??= { starts: 0, buckets: new Array<number>(RETENTION_BUCKET_COUNT).fill(0) });
    if (row.metric === 'retention_start') entry.starts += row.value;
    else {
      const bucket = Number(row.dim);
      if (Number.isInteger(bucket) && bucket >= 0 && bucket < RETENTION_BUCKET_COUNT) entry.buckets[bucket] = (entry.buckets[bucket] ?? 0) + row.value;
    }
  }
  return [doc];
}

export function buildRetentionCurve(docs: RetentionDocument[], range: DateRange): RetentionCurve {
  const inRange = new Set(daysInRange(range));
  let starts = 0;
  const reached = new Array<number>(RETENTION_BUCKET_COUNT).fill(0);
  for (const doc of docs) {
    for (const [day, entry] of Object.entries(doc?.days || {})) {
      if (!inRange.has(day)) continue;
      starts += entry.starts || 0;
      entry.buckets?.forEach((count, bucket) => {
        if (bucket < RETENTION_BUCKET_COUNT) reached[bucket] = (reached[bucket] ?? 0) + (count || 0);
      });
    }
  }
  if (starts < MIN_RETENTION_STARTS) return { starts, points: null };
  return {
    starts,
    points: reached.map((count, bucket) => ({ bucket, share: Math.min(1, Math.round((count / starts) * 10000) / 10000) })),
  };
}

export interface TrafficBreakdown {
  totalViews: number;
  /** Views per source. Views from before collection began count as unknown, so the rows add up. */
  sources: Record<string, number>;
  externalHosts: Array<{ host: string; views: number }>;
}

export function buildTraffic(rollups: MonthlyRollup[], range: DateRange): TrafficBreakdown {
  const inRange = new Set(daysInRange(range));
  const sources: Record<string, number> = {};
  const hosts: Record<string, number> = {};
  let totalViews = 0;
  for (const rollup of rollups) {
    for (const [day, entry] of Object.entries(rollup?.days || {})) {
      if (!inRange.has(day)) continue;
      totalViews += entry.views || 0;
      let counted = 0;
      for (const [source, views] of Object.entries(entry.traffic || {})) {
        sources[source] = (sources[source] || 0) + views;
        counted += views;
      }
      const uncounted = (entry.views || 0) - counted;
      if (uncounted > 0) sources.unknown = (sources.unknown || 0) + uncounted;
      for (const [host, views] of Object.entries(entry.externalHosts || {})) {
        hosts[host] = (hosts[host] || 0) + views;
      }
    }
  }
  const externalHosts = Object.entries(hosts)
    .map(([host, views]) => ({ host, views }))
    .sort((a, b) => b.views - a.views || a.host.localeCompare(b.host))
    .slice(0, MAX_EXTERNAL_HOSTS_SHOWN);
  return { totalViews, sources, externalHosts };
}

/**
 * Fills each channel's subscriber counts from the subscription store: new
 * subscribers per day in `range` and the current total. Members who subscribe
 * as themselves and channels both count, each identity once.
 */
export async function attachSubscriberStats(
  env: { NOTIFICATIONS_DB?: D1Database },
  channels: AnalyticsChannel[],
  range: DateRange,
): Promise<AnalyticsChannel[]> {
  if (channels.length === 0) return channels;
  const from = Date.UTC(range.from.getUTCFullYear(), range.from.getUTCMonth(), range.from.getUTCDate());
  const to = Date.UTC(range.to.getUTCFullYear(), range.to.getUTCMonth(), range.to.getUTCDate()) + DAY_MS - 1;
  try {
    const stats = await subscriberDailyStats(env.NOTIFICATIONS_DB, channels as never, from, to);
    return channels.map(channel => {
      const entry = stats.get(channel.id);
      return entry ? { ...channel, subscribersByDay: entry.byDay, subscriberTotal: entry.total } : channel;
    });
  } catch (error) {
    logger.warn('[Analytics] Subscriber stats unavailable', { channels: channels.length, error: error instanceof Error ? error.message : String(error) });
    return channels;
  }
}
