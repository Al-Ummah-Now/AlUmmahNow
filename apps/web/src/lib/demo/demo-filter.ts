/**
 * Prototype only: content filter for the theme demo builds.
 *
 * Demo builds (NEXT_PUBLIC_DEMO_CONTENT=1) read the shared QA API, which also
 * holds automated test data. This module answers list requests from the demo
 * set alone, or filters what the API returned, so the demos never show that
 * test data. Pure logic only; demo-fetch.ts wires it to fetch().
 *
 * The pool comes from the index-backed channelId listing, one call per demo
 * channel, merged and sorted, because the unfiltered GET /api/videos scan
 * returns short pages on QA (#465).
 */

export interface DemoSet {
  /** Channels whose videos make up the demo */
  channels: string[];
  /** Every video allowed to appear in a list */
  videos: string[];
  /** Subset of `videos` that are vertical and belong on the Shorts shelf */
  shorts: string[];
  /** Allowed videos that live on a channel outside `channels` */
  extraVideos: string[];
  playlists: string[];
}

export interface DemoVideo {
  id: string;
  title?: string;
  titleLocalized?: Record<string, string>;
  description?: string;
  channelId?: string;
  channelName?: string;
  channelAvatarUrl?: string;
  thumbnailUrl?: string;
  duration?: number;
  views?: number;
  likesCount?: number;
  category?: string;
  language?: string;
  tags?: string[];
  isLive?: boolean;
  dateCreated?: string;
}

export interface DemoChannel {
  id: string;
  [key: string]: unknown;
}

export interface DemoPool {
  videos: DemoVideo[];
  channels: DemoChannel[];
}

export interface DemoRequest {
  method: string;
  /** API path without any proxy prefix, e.g. /api/videos */
  pathname: string;
  search: URLSearchParams;
  authenticated: boolean;
  /** channelId request header (owner views such as the dashboard send one) */
  channelHeader: boolean;
}

export type DemoRoute =
  | { kind: 'none' }
  | { kind: 'replace'; respond: (pool: DemoPool) => unknown }
  | { kind: 'filter'; transform: (body: unknown, pool: DemoPool) => unknown };

const TEST_COMMENT =
  /(^|[^a-z])(ws probe|release (live )?comment|e2e|qa[- ]?seed|test comment|smoke[- ]test|playwright|automated test)([^a-z]|$)/i;

const KEYBOARD_TEST = /^\s*(test|tres|asdf|abc|hello)\s*\d*\s*$/i;

/** True for comments left behind by automated test runs or typed to try the form. */
export function isTestComment(text: unknown): boolean {
  return typeof text === 'string' && (TEST_COMMENT.test(text) || KEYBOARD_TEST.test(text));
}

/** A set with no videos means the demo has not been seeded: leave the API alone. */
export function isUsableDemoSet(set: DemoSet): boolean {
  return set.videos.length > 0;
}

function byNewest(a: DemoVideo, b: DemoVideo): number {
  return new Date(b.dateCreated ?? 0).getTime() - new Date(a.dateCreated ?? 0).getTime();
}

/** Allow-listed, de-duplicated videos, newest first. */
export function buildPoolVideos(set: DemoSet, lists: DemoVideo[][]): DemoVideo[] {
  const allowed = new Set(set.videos);
  const seen = new Set<string>();
  const merged: DemoVideo[] = [];
  for (const video of lists.flat()) {
    if (!video?.id || !allowed.has(video.id) || seen.has(video.id)) continue;
    seen.add(video.id);
    merged.push(video);
  }
  return merged.sort(byNewest);
}

function page<T>(items: T[], search: URLSearchParams, fallbackLimit: number) {
  const limit = Math.max(1, Number(search.get('limit')) || fallbackLimit);
  const match = /^demo-(\d+)$/.exec(search.get('cursor') ?? '');
  const start = match ? Number(match[1]) : 0;
  const end = start + limit;
  return { items: items.slice(start, end), limit, cursor: end < items.length ? `demo-${end}` : '' };
}

function sorted(videos: DemoVideo[], search: URLSearchParams): DemoVideo[] {
  const sort = search.get('sort') ?? search.get('sortBy');
  if (sort === 'views' || sort === 'popular') return [...videos].sort((a, b) => (b.views ?? 0) - (a.views ?? 0));
  return videos;
}

function listBody(videos: DemoVideo[], search: URLSearchParams, fallbackLimit: number) {
  const { items, limit, cursor } = page(sorted(videos, search), search, fallbackLimit);
  return { cursor, limit, data: items };
}

function searchable(video: DemoVideo): string {
  return [video.title, video.description, video.channelName, ...Object.values(video.titleLocalized ?? {}), ...(video.tags ?? [])]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
}

function matches(video: DemoVideo, words: string[]): boolean {
  const text = searchable(video);
  return words.every((word) => text.includes(word));
}

function searchWords(search: URLSearchParams): string[] {
  return (search.get('q') ?? '').trim().toLowerCase().split(/\s+/).filter(Boolean);
}

function searchResponse(pool: DemoPool, search: URLSearchParams) {
  const type = search.get('type') ?? 'all';
  const words = searchWords(search);
  const category = search.get('category');
  const channelId = search.get('channelId');
  const found = pool.videos.filter(
    (video) =>
      matches(video, words) && (!category || video.category === category) && (!channelId || video.channelId === channelId),
  );
  const videos =
    type === 'all' || type === 'video'
      ? found.map((video) => ({
          type: 'video' as const,
          id: video.id,
          score: 1,
          video: { views: 0, likesCount: 0, tags: [], isLive: false, ...video },
          channel: { id: video.channelId, name: video.channelName, avatarUrl: video.channelAvatarUrl, isVerified: false },
        }))
      : [];
  const channels =
    type === 'all' || type === 'channel'
      ? pool.channels
          .filter((channel) => words.every((word) => String(channel.name ?? '').toLowerCase().includes(word)))
          .map((channel) => ({ type: 'channel' as const, id: channel.id, score: 1, channel }))
      : [];
  const { items, cursor } = page([...channels, ...videos], search, 20);
  return {
    success: true,
    query: search.get('q') ?? '',
    type,
    results: items,
    nextCursor: cursor || null,
    hasMore: Boolean(cursor),
    relaxed: false,
    searchTime: 0,
  };
}

function related(pool: DemoPool, search: URLSearchParams, set: DemoSet): DemoVideo[] {
  const currentId = search.get('videoId');
  const current = pool.videos.find((video) => video.id === currentId);
  const shorts = new Set(set.shorts);
  const score = (video: DemoVideo) =>
    (video.channelId === current?.channelId ? 2 : 0) + (video.category && video.category === current?.category ? 1 : 0);
  return pool.videos
    .filter((video) => video.id !== currentId && !shorts.has(video.id))
    .map((video, index) => ({ video, index }))
    .sort((a, b) => score(b.video) - score(a.video) || a.index - b.index)
    .map(({ video }) => video);
}

function keepVideos(items: unknown, allowed: Set<string>, idOf: (item: Record<string, unknown>) => unknown): unknown {
  if (!Array.isArray(items)) return items;
  return items.filter((item) => allowed.has(String(idOf(item as Record<string, unknown>))));
}

const asRecord = (body: unknown): Record<string, unknown> =>
  body && typeof body === 'object' ? (body as Record<string, unknown>) : {};

function filterField(key: string, allowed: Set<string>, idOf: (item: Record<string, unknown>) => unknown = (item) => item.id) {
  return (body: unknown) => {
    const record = asRecord(body);
    return key in record ? { ...record, [key]: keepVideos(record[key], allowed, idOf) } : body;
  };
}

function filterComments(body: unknown): unknown {
  const record = asRecord(body);
  const result = asRecord(record.result);
  for (const key of ['comments', 'replies']) {
    const items = result[key];
    if (!Array.isArray(items)) continue;
    const kept = items.filter((comment) => !isTestComment((comment as { text?: unknown })?.text));
    const removed = items.length - kept.length;
    const total = typeof result.total === 'number' ? { total: Math.max(0, result.total - removed) } : {};
    return { ...record, result: { ...result, [key]: kept, ...total } };
  }
  return body;
}

/** Decides how one API request is served on a demo build. */
export function routeDemoRequest(set: DemoSet, req: DemoRequest): DemoRoute {
  if (req.method !== 'GET' || !isUsableDemoSet(set)) return { kind: 'none' };
  const { pathname: path, search } = req;
  const allowedVideos = new Set(set.videos);
  const allowedChannels = new Set(set.channels);
  const allowedPlaylists = new Set(set.playlists);
  const shorts = new Set(set.shorts);

  if (path === '/api/videos') {
    if (search.get('channelId')) return { kind: 'filter', transform: filterField('data', allowedVideos) };
    if (req.channelHeader) return { kind: 'none' };
    return {
      kind: 'replace',
      respond: (pool) => {
        const category = search.get('category');
        return listBody(category ? pool.videos.filter((v) => v.category === category) : pool.videos, search, 15);
      },
    };
  }
  if (path === '/api/search') return { kind: 'replace', respond: (pool) => searchResponse(pool, search) };
  if (path === '/api/search/suggestions') {
    return {
      kind: 'replace',
      respond: (pool) => {
        const words = searchWords(search);
        const limit = Number(search.get('limit')) || 8;
        return { data: pool.videos.filter((v) => matches(v, words)).slice(0, limit).map((v) => ({ text: v.title, type: 'video', videoId: v.id })) };
      },
    };
  }
  if (path === '/api/trending') {
    return {
      kind: 'replace',
      respond: (pool) => {
        const limit = Number(search.get('limit')) || 20;
        const videos = [...pool.videos].sort((a, b) => (b.views ?? 0) - (a.views ?? 0)).slice(0, limit);
        return { success: true, period: search.get('period') ?? 'day', data: videos, videos };
      },
    };
  }
  if (path === '/api/recommendations') {
    return {
      kind: 'replace',
      respond: (pool) => {
        const videos = related(pool, search, set).slice(0, Number(search.get('limit')) || 15);
        return { success: true, data: videos, videos };
      },
    };
  }
  if (path === '/api/explore') {
    return {
      kind: 'filter',
      transform: (body, pool) => {
        const record = asRecord(body);
        const counts = new Map<string, number>();
        for (const video of pool.videos) if (video.category) counts.set(video.category, (counts.get(video.category) ?? 0) + 1);
        const categories = Array.isArray(record.categories)
          ? record.categories.map((c) => ({ ...(c as object), count: counts.get(String((c as { value?: unknown }).value)) ?? 0 }))
          : record.categories;
        return { ...record, categories, newChannels: pool.channels, seasonal: [] };
      },
    };
  }

  const channelList = /^\/api\/channels\/([^/]+)\/(videos|shorts|playlists)$/.exec(path);
  if (channelList) {
    const [, channelId, tab] = channelList;
    if (tab === 'playlists') return { kind: 'filter', transform: filterField('data', allowedPlaylists) };
    return {
      kind: 'replace',
      respond: (pool) => {
        const own = pool.videos.filter((video) => video.channelId === channelId);
        return listBody(own.filter((video) => shorts.has(video.id) === (tab === 'shorts')), search, 20);
      },
    };
  }
  if (path === '/api/channels' && !req.authenticated) return { kind: 'filter', transform: filterField('data', allowedChannels) };
  if (path === '/api/playlists' && !req.authenticated) return { kind: 'filter', transform: filterField('data', allowedPlaylists) };
  if (path === '/api/profile/subscriptions/feed') return { kind: 'filter', transform: filterField('data', allowedVideos) };
  if (path === '/api/profile/subscriptions') {
    return { kind: 'filter', transform: filterField('data', allowedChannels, (item) => item.channelId ?? item.id) };
  }
  if (path === '/api/watch-history' || path === '/api/profiles/watch-history') {
    return { kind: 'filter', transform: filterField('entries', allowedVideos, (item) => item.videoId) };
  }
  if (/^\/api\/videos\/[^/]+\/comments(\/[^/]+\/replies)?$/.test(path)) return { kind: 'filter', transform: filterComments };
  return { kind: 'none' };
}
