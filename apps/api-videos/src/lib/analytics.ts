/**
 * Owner-scoped analytics built from data the platform actually stores.
 *
 * Sources:
 * - Video objects (videos bucket): lifetime `views` counter, `likes[]`,
 *   `dislikes[]` and `comments[]` records (each with `dateCreated`).
 * - Channel objects (channels bucket): `subscribers[]` records with `dateCreated`.
 * - Daily view/watch-time rollups written by the processor for every tracked view
 *   (analytics bucket, `analytics/rollups/{video|channel}/<id>/<YYYY-MM>.json`).
 *
 * Nothing is estimated or randomized. Metrics the platform does not record
 * (shares, impressions/click-through) are reported as 0.
 */

import { logger } from './logger';

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
  isDeleted?: boolean;
}

export interface DailyRollupEntry {
  views: number;
  watchTime: number;
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
  for (const channel of channels) countByDay(series, channel.subscribers, 'subscribers');
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
export function videoAnalytics(video: AnalyticsVideo, rollups: MonthlyRollup[] = []): VideoAnalyticsResult {
  const views = video.views || 0;
  const likes = video.likes?.length || 0;
  const comments = activeComments(video);
  let rollupViews = 0;
  let watchTime = 0;
  for (const rollup of rollups) {
    for (const entry of Object.values(rollup?.days || {})) {
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
  const totalSubscribers = channels.reduce((n, c) => n + (c.subscribers?.length || 0), 0);
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

/** All channels owned by the user. */
export async function loadOwnedChannels(bucket: R2Bucket, userId: string): Promise<AnalyticsChannel[]> {
  const owned: AnalyticsChannel[] = [];
  let cursor: string | undefined;
  do {
    const page = await bucket.list({ limit: 100, cursor });
    const channels = await Promise.all(page.objects.map(o => readJson<AnalyticsChannel>(bucket, o.key)));
    for (const channel of channels) {
      if (channel?.id && channel.userId === userId && !channel.isDeleted) owned.push(channel);
    }
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
  return owned;
}

/**
 * Videos (any visibility) belonging to the given channels and owned by the user.
 * Scans at most `maxObjects` keys.
 */
export async function loadOwnedVideos(
  bucket: R2Bucket,
  userId: string,
  channelIds: Set<string>,
  maxObjects = 2000
): Promise<AnalyticsVideo[]> {
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
    for (const video of items) {
      if (!video?.id || video.isDeleted) continue;
      if (video.userId === userId && (!video.channelId || channelIds.has(video.channelId))) videos.push(video);
    }
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor && scanned < maxObjects);
  return videos;
}

export async function loadRollups(
  bucket: R2Bucket | undefined,
  entityType: 'video' | 'channel',
  entityIds: string[],
  range: DateRange
): Promise<MonthlyRollup[]> {
  if (!bucket) return [];
  const months = monthsInRange(range);
  const keys = entityIds.flatMap(id => months.map(month => `analytics/rollups/${entityType}/${id}/${month}.json`));
  const docs = await Promise.all(keys.map(key => readJson<MonthlyRollup>(bucket, key)));
  return docs.filter((doc): doc is MonthlyRollup => !!doc);
}
