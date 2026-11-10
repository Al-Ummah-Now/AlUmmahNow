/**
 * Discovery helpers: search suggestions, trending and recommendations.
 *
 * All scoring functions are pure so they can be reasoned about (and unit tested)
 * independently of R2. The loaders at the bottom read the stored video objects.
 *
 * Signals come only from data the platform actually stores:
 * - `views`: total view counter maintained by POST /api/videos/:id/view
 * - `likes[]` / `comments[]`: individual records carrying `dateCreated`, which
 *   lets us weight engagement by how recently it happened
 * - `dateCreated`, `category`, `tags`, `channelId`, `title` for relevance
 */

import { logger } from './logger';
import { isVideoPubliclyVisible } from './visibility';
import { detectTextLanguage } from '@al-ummah/shared-types';

export interface DiscoveryVideo {
  id: string;
  title?: string;
  description?: string;
  userId?: string;
  channelId?: string;
  channelName?: string;
  channelAvatarUrl?: string;
  thumbnailUrl?: string;
  videoUrl?: string;
  playUrl?: string;
  dateCreated?: string;
  dateModified?: string;
  views?: number;
  duration?: number;
  category?: string;
  tags?: string[];
  language?: string;
  likes?: Array<{ dateCreated?: string }>;
  /** Set instead of `likes` on index rows, which store only the count. */
  likesCount?: number;
  dislikes?: Array<{ dateCreated?: string }>;
  comments?: Array<{ dateCreated?: string; isDeleted?: boolean }>;
  isPublic?: boolean;
  isLive?: boolean;
  isDeleted?: boolean;
  isHidden?: boolean;
  markedForDeletion?: boolean;
  uploadStatus?: string;
  scheduledPublishStatus?: string;
}

export interface DiscoveryChannel {
  id: string;
  name?: string;
  avatarUrl?: string;
  isPrivate?: boolean;
  isDeleted?: boolean;
  isHidden?: boolean;
  subscribers?: unknown[];
}

export type SuggestionType = 'query' | 'channel' | 'category' | 'video';

export interface Suggestion {
  text: string;
  type: SuggestionType;
  count?: number;
  metadata?: Record<string, unknown>;
}

export type TrendingPeriod = 'hour' | 'day' | 'week' | 'month';

export const PERIOD_HOURS: Record<TrendingPeriod, number> = {
  hour: 1,
  day: 24,
  week: 24 * 7,
  month: 24 * 30,
};

const HOUR_MS = 60 * 60 * 1000;

/**
 * A video is discoverable when anyone may see it: public, not deleted/hidden,
 * not still uploading and not waiting for a scheduled publish.
 */
export function isDiscoverable(video: DiscoveryVideo | null | undefined): video is DiscoveryVideo {
  if (!video || typeof video !== 'object' || !video.id || typeof video.title !== 'string') return false;
  if (video.markedForDeletion) return false;
  // Public, ready, not removed, not scheduled: the shared listing rule
  return isVideoPubliclyVisible(video);
}

function normalize(text: string): string {
  return text.toLowerCase().normalize('NFKC').trim();
}

function tokenize(text: string): string[] {
  return normalize(text)
    .split(/[^\p{L}\p{N}]+/u)
    .filter(token => token.length > 1);
}

/**
 * Score how well `text` matches the typed `query`.
 * 3 = whole text starts with the query, 2 = a word starts with the query (or with
 * its last word), 1 = contains the query anywhere, 0 = no match.
 */
export function matchScore(text: string, query: string): number {
  const t = normalize(text);
  const q = normalize(query);
  if (!q || !t) return 0;
  if (t.startsWith(q)) return 3;

  const words = tokenize(t);
  const queryWords = tokenize(q);
  const lastWord = queryWords[queryWords.length - 1] || q;
  const leadingWords = queryWords.slice(0, -1);
  const hasLeading = leadingWords.every(word => words.includes(word));
  if (words.some(word => word.startsWith(q)) || (hasLeading && words.some(word => word.startsWith(lastWord)))) {
    return 2;
  }
  return t.includes(q) ? 1 : 0;
}

/**
 * Build typeahead suggestions from video titles, channel names, tags and categories.
 */
export function buildSuggestions(
  videos: DiscoveryVideo[],
  channels: DiscoveryChannel[],
  query: string,
  limit: number
): Suggestion[] {
  const q = normalize(query);
  if (q.length < 1) return [];

  type Candidate = Suggestion & { score: number; popularity: number };
  const candidates = new Map<string, Candidate>();
  const add = (candidate: Candidate) => {
    const key = normalize(candidate.text);
    const existing = candidates.get(key);
    if (!existing || candidate.score > existing.score ||
      (candidate.score === existing.score && candidate.popularity > existing.popularity)) {
      candidates.set(key, candidate);
    }
  };

  const tagCounts = new Map<string, { text: string; count: number }>();
  const categoryCounts = new Map<string, number>();

  for (const video of videos) {
    const title = video.title || '';
    const titleScore = matchScore(title, q);
    if (titleScore > 0) {
      add({
        text: title,
        type: 'video',
        score: titleScore,
        popularity: video.views || 0,
        metadata: { videoId: video.id, channelId: video.channelId },
      });
    }
    for (const tag of video.tags || []) {
      if (typeof tag !== 'string' || !tag.trim()) continue;
      const key = normalize(tag);
      const entry = tagCounts.get(key) || { text: tag.trim(), count: 0 };
      entry.count += 1;
      tagCounts.set(key, entry);
    }
    if (video.category) {
      categoryCounts.set(video.category, (categoryCounts.get(video.category) || 0) + 1);
    }
  }

  for (const { text, count } of tagCounts.values()) {
    const score = matchScore(text, q);
    if (score > 0) add({ text, type: 'query', count, score, popularity: count });
  }

  for (const [category, count] of categoryCounts) {
    const score = matchScore(category, q);
    if (score > 0) add({ text: category, type: 'category', count, score, popularity: count });
  }

  for (const channel of channels) {
    if (!channel?.name || channel.isPrivate || channel.isDeleted || channel.isHidden) continue;
    const score = matchScore(channel.name, q);
    if (score > 0) {
      add({
        text: channel.name,
        type: 'channel',
        score,
        popularity: Array.isArray(channel.subscribers) ? channel.subscribers.length : 0,
        metadata: { channelId: channel.id, avatarUrl: channel.avatarUrl },
      });
    }
  }

  return [...candidates.values()]
    .sort((a, b) => b.score - a.score || b.popularity - a.popularity || a.text.length - b.text.length)
    .slice(0, limit)
    .map(({ score: _score, popularity: _popularity, ...suggestion }) => suggestion);
}

function timeOf(date?: string): number {
  if (!date) return NaN;
  return new Date(date).getTime();
}

/**
 * Sum of events inside the window, each weighted by exponential decay so an
 * event that happened `halfLife` ago counts half as much as one happening now.
 */
export function decayedEventWeight(
  events: Array<{ dateCreated?: string; isDeleted?: boolean }> | undefined,
  now: number,
  windowHours: number
): number {
  if (!Array.isArray(events) || events.length === 0) return 0;
  const windowMs = windowHours * HOUR_MS;
  const halfLifeMs = windowMs / 2;
  let total = 0;
  for (const event of events) {
    if (event?.isDeleted) continue;
    const at = timeOf(event?.dateCreated);
    if (!Number.isFinite(at)) continue;
    const age = now - at;
    if (age < 0 || age > windowMs) continue;
    total += Math.pow(0.5, age / halfLifeMs);
  }
  return total;
}

export interface TrendingScore {
  score: number;
  recentLikes: number;
  recentComments: number;
  viewsVelocity: number;
}

/**
 * Trending score for a video within a period.
 *
 * - Recent likes (x3) and comments (x5) inside the window, decayed by recency.
 * - View velocity: total views divided by the video's age in hours. Because the
 *   view counter has no timestamps, velocity is only counted for videos created
 *   within the window (older videos trend through recent engagement instead),
 *   and is dampened logarithmically so a single huge counter can't dominate.
 */
export function trendingScore(video: DiscoveryVideo, now: number, period: TrendingPeriod): TrendingScore {
  const windowHours = PERIOD_HOURS[period];
  const recentLikes = decayedEventWeight(video.likes, now, windowHours);
  const recentComments = decayedEventWeight(video.comments, now, windowHours);

  const created = timeOf(video.dateCreated);
  const ageHours = Number.isFinite(created) ? Math.max((now - created) / HOUR_MS, 0) : Infinity;
  const views = Math.max(video.views || 0, 0);
  const viewsVelocity = Number.isFinite(ageHours) ? views / Math.max(ageHours, 1) : 0;
  const velocityScore = ageHours <= windowHours ? Math.log10(1 + viewsVelocity * windowHours) * 4 : 0;

  const score = recentLikes * 3 + recentComments * 5 + velocityScore;
  return {
    score: Math.round(score * 1000) / 1000,
    recentLikes: Math.round(recentLikes * 1000) / 1000,
    recentComments: Math.round(recentComments * 1000) / 1000,
    viewsVelocity: Math.round(viewsVelocity * 1000) / 1000,
  };
}

/**
 * Rank videos for the trending list. Videos with no activity in the window are
 * dropped so the list reflects genuine recent interest (empty state otherwise).
 */
export function rankTrending(
  videos: DiscoveryVideo[],
  options: { now: number; period: TrendingPeriod; category?: string; language?: string; limit: number }
): Array<{ video: DiscoveryVideo; trending: TrendingScore; rank: number }> {
  return videos
    .filter(video => !options.category || video.category === options.category)
    .filter(video => !options.language || (video.language || detectTextLanguage(`${video.title || ''} ${video.description || ''}`)) === options.language)
    .map(video => ({ video, trending: trendingScore(video, options.now, options.period) }))
    .filter(item => item.trending.score > 0)
    .sort((a, b) => b.trending.score - a.trending.score || (b.video.views || 0) - (a.video.views || 0))
    .slice(0, options.limit)
    .map((item, index) => ({ ...item, rank: index + 1 }));
}

export interface RecommendationProfile {
  channelIds: Map<string, number>;
  categories: Map<string, number>;
  tags: Map<string, number>;
  titleWords: Set<string>;
}

/**
 * Build a weighted interest profile from seed videos (the video being watched
 * and/or the user's recent watch history). Earlier seeds weigh more.
 */
export function buildProfile(seeds: DiscoveryVideo[]): RecommendationProfile {
  const profile: RecommendationProfile = {
    channelIds: new Map(),
    categories: new Map(),
    tags: new Map(),
    titleWords: new Set(),
  };
  seeds.forEach((seed, index) => {
    const weight = 1 / (1 + index * 0.25);
    const bump = (map: Map<string, number>, key?: string) => {
      if (!key) return;
      map.set(key, (map.get(key) || 0) + weight);
    };
    bump(profile.channelIds, seed.channelId);
    bump(profile.categories, seed.category);
    for (const tag of seed.tags || []) {
      if (typeof tag === 'string' && tag.trim()) bump(profile.tags, normalize(tag));
    }
    if (index === 0) {
      for (const word of tokenize(seed.title || '')) {
        if (word.length > 2) profile.titleWords.add(word);
      }
    }
  });
  return profile;
}

/**
 * Relevance of a candidate against the profile: same category (x4), same channel (x3),
 * shared tags (x2 each, up to 3), shared title words (x1 each, up to 3), plus a small
 * popularity/recency prior so ties resolve toward well-received, fresh videos.
 */
export function recommendationScore(candidate: DiscoveryVideo, profile: RecommendationProfile, now: number): number {
  let score = 0;
  if (candidate.category) score += (profile.categories.get(candidate.category) || 0) * 4;
  if (candidate.channelId) score += (profile.channelIds.get(candidate.channelId) || 0) * 3;

  let tagScore = 0;
  let tagMatches = 0;
  for (const tag of candidate.tags || []) {
    if (tagMatches >= 3 || typeof tag !== 'string') continue;
    const weight = profile.tags.get(normalize(tag));
    if (weight) {
      tagScore += weight * 2;
      tagMatches += 1;
    }
  }
  score += tagScore;

  let wordMatches = 0;
  for (const word of new Set(tokenize(candidate.title || ''))) {
    if (wordMatches >= 3) break;
    if (profile.titleWords.has(word)) wordMatches += 1;
  }
  score += wordMatches;

  const views = Math.max(candidate.views || 0, 0);
  const likes = Array.isArray(candidate.likes) ? candidate.likes.length : Math.max(candidate.likesCount || 0, 0);
  const created = timeOf(candidate.dateCreated);
  const ageDays = Number.isFinite(created) ? Math.max((now - created) / (24 * HOUR_MS), 0) : 365;
  const prior = Math.log10(1 + views) * 0.5 + Math.log10(1 + likes) * 0.5 + 1 / (1 + ageDays / 30);

  return Math.round((score + prior) * 1000) / 1000;
}

export function rankRecommendations(
  candidates: DiscoveryVideo[],
  options: { seeds: DiscoveryVideo[]; exclude: Set<string>; limit: number; now: number }
): Array<{ video: DiscoveryVideo; score: number }> {
  const profile = buildProfile(options.seeds);
  return candidates
    .filter(video => !options.exclude.has(video.id))
    .map(video => ({ video, score: recommendationScore(video, profile, options.now) }))
    .sort((a, b) => b.score - a.score || (b.video.views || 0) - (a.video.views || 0))
    .slice(0, options.limit);
}

/**
 * Load discoverable videos from the videos bucket.
 * The bucket also holds pre-computed index objects (`index:*`, `metadata:*`) and
 * live streams (`livestream:*`), which are skipped by key prefix.
 */
const NON_VIDEO_KEY_PREFIXES = ['index:', 'metadata:', 'livestream:'];

export async function loadDiscoverableVideos(bucket: R2Bucket, maxVideos = 500): Promise<DiscoveryVideo[]> {
  const videos: DiscoveryVideo[] = [];
  let cursor: string | undefined;
  let scanned = 0;
  do {
    const page = await bucket.list({ limit: 100, cursor });
    const keys = page.objects
      .map(object => object.key)
      .filter(key => key && !NON_VIDEO_KEY_PREFIXES.some(prefix => key.startsWith(prefix)));
    scanned += keys.length;
    const objects = await Promise.all(keys.map(async key => {
      try {
        const object = await bucket.get(key);
        return object ? await object.json<DiscoveryVideo>() : null;
      } catch (error) {
        logger.warn('[discovery] Skipping unreadable video object', { key, error });
        return null;
      }
    }));
    for (const video of objects) {
      if (isDiscoverable(video)) videos.push(video);
    }
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor && scanned < maxVideos);
  return videos;
}

export async function loadChannels(bucket: R2Bucket, maxChannels = 300): Promise<DiscoveryChannel[]> {
  const channels: DiscoveryChannel[] = [];
  let cursor: string | undefined;
  do {
    const page = await bucket.list({ limit: 100, cursor });
    const objects = await Promise.all(page.objects.map(async object => {
      try {
        const body = await bucket.get(object.key);
        return body ? await body.json<DiscoveryChannel>() : null;
      } catch (error) {
        logger.warn('[discovery] Skipping unreadable channel object', { key: object.key, error });
        return null;
      }
    }));
    for (const channel of objects) {
      if (channel?.id) channels.push(channel);
    }
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor && channels.length < maxChannels);
  return channels;
}

/**
 * Attach channel name/avatar and derived counters for API responses.
 */
export function toVideoResponse(video: DiscoveryVideo, channels: Map<string, DiscoveryChannel>) {
  const channel = video.channelId ? channels.get(video.channelId) : undefined;
  return {
    id: video.id,
    title: video.title || '',
    description: video.description,
    thumbnailUrl: video.thumbnailUrl,
    videoUrl: video.videoUrl,
    playUrl: video.playUrl,
    userId: video.userId,
    channelId: video.channelId || '',
    channel: channel?.name || video.channelName || '',
    channelName: channel?.name || video.channelName || '',
    channelAvatarUrl: channel?.avatarUrl || video.channelAvatarUrl,
    dateCreated: video.dateCreated,
    dateModified: video.dateModified,
    createdAt: video.dateCreated,
    updatedAt: video.dateModified,
    views: video.views || 0,
    likesCount: Array.isArray(video.likes) ? video.likes.length : 0,
    dislikesCount: Array.isArray(video.dislikes) ? video.dislikes.length : 0,
    commentsCount: Array.isArray(video.comments) ? video.comments.filter(c => !c?.isDeleted).length : 0,
    duration: video.duration,
    category: video.category,
    tags: video.tags || [],
    isPublic: video.isPublic !== false,
    isLive: video.isLive === true,
  };
}

export async function loadChannelMap(bucket: R2Bucket, channelIds: string[]): Promise<Map<string, DiscoveryChannel>> {
  const map = new Map<string, DiscoveryChannel>();
  await Promise.all([...new Set(channelIds.filter(Boolean))].map(async id => {
    try {
      const object = await bucket.get(id);
      if (object) map.set(id, await object.json<DiscoveryChannel>());
    } catch (error) {
      logger.warn('[discovery] Failed to load channel', { channelId: id, error });
    }
  }));
  return map;
}
