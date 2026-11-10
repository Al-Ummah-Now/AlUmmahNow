/**
 * Search index documents (Story 29.9)
 *
 * Projects stored R2 objects (videos, channels, playlists, community posts)
 * into rows of the D1 FTS5 search index. Projection is pure so api-videos
 * (direct writes) and the processor (queue-driven writes) produce identical rows.
 *
 * Only content anyone may see is indexed: private, hidden, deleted, still
 * uploading or scheduled items project to `null` (remove from the index).
 * Channels are the exception: a non-public channel keeps a row with
 * `visible = false` so its videos, playlists and posts are filtered out too.
 */

import { VIDEO_CATEGORIES } from '../upload-defaults';
import { buildIndexText, detectTextLanguage } from './normalize';

export type SearchEntityType = 'video' | 'channel' | 'playlist' | 'post';

export const SEARCH_ENTITY_TYPES: ReadonlyArray<SearchEntityType> = ['video', 'channel', 'playlist', 'post'];

/** D1 base table and FTS5 table per entity type (see api-videos migrations/search). */
export const SEARCH_TABLES: Readonly<Record<SearchEntityType, { base: string; fts: string }>> = {
  video: { base: 'search_videos', fts: 'search_videos_fts' },
  channel: { base: 'search_channels', fts: 'search_channels_fts' },
  playlist: { base: 'search_playlists', fts: 'search_playlists_fts' },
  post: { base: 'search_posts', fts: 'search_posts_fts' },
};

export interface SearchVideoPayload {
  id: string;
  title: string;
  titleLocalized?: Record<string, string>;
  description?: string;
  thumbnailUrl?: string;
  duration?: number;
  views: number;
  likesCount: number;
  commentsCount: number;
  dislikesCount: number;
  category?: string;
  language?: string;
  tags: string[];
  isLive: boolean;
  channelId: string;
  channelName?: string;
  channelAvatarUrl?: string;
  dateCreated?: string;
}

export interface SearchChannelPayload {
  id: string;
  name: string;
  nameLocalized?: Record<string, string>;
  description?: string;
  descriptionLocalized?: Record<string, string>;
  avatarUrl?: string;
  coverUrl?: string;
  isVerified: boolean;
  subscribersCount: number;
  videosCount: number;
  category?: string;
  dateCreated?: string;
}

export interface SearchPlaylistPayload {
  id: string;
  name: string;
  description?: string;
  thumbnailUrl?: string;
  /** Set on search responses when there is no custom thumbnailUrl */
  cover?: { videoId: string; thumbnailUrl: string };
  /** Index-only: first video ids, used to derive `cover`; removed from API responses */
  coverVideoIds?: string[];
  videosCount: number;
  channelId?: string;
  userId?: string;
  dateCreated?: string;
}

export interface SearchPostPayload {
  id: string;
  channelId: string;
  channelName?: string;
  channelAvatar?: string;
  channelVerified: boolean;
  postType?: string;
  content: string;
  imageUrl?: string;
  likes: number;
  comments: number;
  createdAt?: string;
}

export interface SearchPayloadByType {
  video: SearchVideoPayload;
  channel: SearchChannelPayload;
  playlist: SearchPlaylistPayload;
  post: SearchPostPayload;
}

/** One row of a search base table plus the text that goes into its FTS table. */
export interface SearchRow<T extends SearchEntityType = SearchEntityType> {
  type: T;
  id: string;
  channelId: string | null;
  /** False keeps the row (channels only) but removes it from full-text results. */
  visible: boolean;
  language: string | null;
  category: string | null;
  /** Seconds (videos only). */
  duration: number | null;
  isVerified: boolean;
  isLive: boolean;
  views: number;
  /** Epoch milliseconds the item was published/created. */
  createdAt: number | null;
  /** Log-scaled popularity prior added to text relevance. */
  popularity: number;
  /** Normalised title text (FTS column `title`). */
  titleText: string;
  /** Normalised secondary text (FTS column `body`). */
  bodyText: string;
  payload: SearchPayloadByType[T];
}

type Raw = Record<string, unknown>;

const DESCRIPTION_LIMIT = 300;
const BODY_LIMIT = 4000;

function asRecord(value: unknown): Raw | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Raw) : null;
}

function str(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined;
}

function num(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function countOf(value: unknown, fallback?: unknown): number {
  if (Array.isArray(value)) return value.length;
  if (typeof value === 'number') return Math.max(value, 0);
  return Math.max(num(fallback), 0);
}

function localized(value: unknown): Record<string, string> | undefined {
  const rec = asRecord(value);
  if (!rec) return undefined;
  const out: Record<string, string> = {};
  for (const [lang, text] of Object.entries(rec)) {
    if (typeof text === 'string' && text.trim()) out[lang] = text;
  }
  return Object.keys(out).length ? out : undefined;
}

function truncate(text: string | undefined, max: number): string | undefined {
  if (!text) return undefined;
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function timeOf(...values: unknown[]): number | null {
  for (const value of values) {
    if (typeof value === 'string' || typeof value === 'number') {
      const t = new Date(value).getTime();
      if (Number.isFinite(t)) return t;
    }
  }
  return null;
}

function log10p(n: number): number {
  return Math.log10(1 + Math.max(n, 0));
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}

function categoryLabels(category: string | undefined): string[] {
  if (!category) return [];
  const def = VIDEO_CATEGORIES.find(c => c.value === category);
  return def ? [def.label.en, def.label.ar] : [category.replace(/_/g, ' ')];
}

function stringTags(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((t): t is string => typeof t === 'string' && !!t.trim()).slice(0, 30) : [];
}

function limitBody(text: string): string {
  return text.length > BODY_LIMIT ? text.slice(0, BODY_LIMIT) : text;
}

function isRemoved(obj: Raw): boolean {
  return obj.isDeleted === true || obj.isHidden === true || obj.markedForDeletion === true;
}

/** Same rules as api-videos `isDiscoverable` (lib/discovery.ts). */
export function isVideoSearchable(obj: Raw): boolean {
  const id = str(obj.id);
  if (!id || id.startsWith('index:') || id.startsWith('livestream:') || id.startsWith('metadata:')) return false;
  if (typeof obj.title !== 'string') return false;
  if (obj.isPublic === false || isRemoved(obj)) return false;
  if (typeof obj.uploadStatus === 'string' && obj.uploadStatus !== 'ready') return false;
  if (obj.scheduledPublishStatus === 'scheduled' || obj.scheduledPublishStatus === 'publishing') return false;
  return true;
}

export function projectVideo(raw: unknown): SearchRow<'video'> | null {
  const obj = asRecord(raw);
  if (!obj || !isVideoSearchable(obj)) return null;
  const id = String(obj.id);
  const title = String(obj.title);
  const titleLocalized = localized(obj.titleLocalized);
  const descriptionLocalized = localized(obj.descriptionLocalized);
  const description = str(obj.description);
  const tags = stringTags(obj.tags);
  const category = str(obj.category);
  const views = Math.max(num(obj.views), 0);
  const likesCount = countOf(obj.likes, obj.likesCount);
  const language = str(obj.language) ?? detectTextLanguage(`${title} ${description ?? ''}`) ?? null;
  const duration = num(obj.duration) > 0 ? Math.round(num(obj.duration)) : null;

  return {
    type: 'video',
    id,
    channelId: str(obj.channelId) ?? null,
    visible: true,
    language,
    category: category ?? null,
    duration,
    isVerified: false,
    isLive: obj.isLive === true,
    views,
    createdAt: timeOf(obj.publishedAt, obj.dateCreated, obj.createdAt),
    popularity: round(log10p(views) * 0.3 + log10p(likesCount) * 0.3),
    titleText: buildIndexText(title, Object.values(titleLocalized ?? {})),
    bodyText: limitBody(buildIndexText(
      description,
      Object.values(descriptionLocalized ?? {}),
      tags,
      categoryLabels(category),
    )),
    payload: {
      id,
      title,
      titleLocalized,
      description: truncate(description, DESCRIPTION_LIMIT),
      thumbnailUrl: str(obj.thumbnailUrl),
      duration: duration ?? undefined,
      views,
      likesCount,
      // Counters the home sections' trending score uses (api-videos lib/sections/sectionIndex.ts)
      commentsCount: countOf(obj.comments, obj.commentsCount),
      dislikesCount: countOf(obj.dislikes, obj.dislikesCount),
      category,
      language: language ?? undefined,
      tags: tags.slice(0, 10),
      isLive: obj.isLive === true,
      channelId: str(obj.channelId) ?? '',
      channelName: str(obj.channelName) ?? str(obj.channel),
      channelAvatarUrl: str(obj.channelAvatarUrl),
      dateCreated: str(obj.publishedAt) ?? str(obj.dateCreated),
    },
  };
}

export function projectChannel(raw: unknown): SearchRow<'channel'> | null {
  const obj = asRecord(raw);
  const id = obj && str(obj.id);
  if (!obj || !id || typeof obj.name !== 'string') return null;
  const name = obj.name;
  const nameLocalized = localized(obj.nameLocalized);
  const descriptionLocalized = localized(obj.descriptionLocalized);
  const description = str(obj.description);
  const tags = stringTags(obj.tags);
  const category = str(obj.category);
  const subscribersCount = countOf(obj.subscribers, obj.subscribersCount);
  const videosCount = Math.max(num(obj.videosCount), 0);
  const visible = !isRemoved(obj) && obj.isPrivate !== true;

  return {
    type: 'channel',
    id,
    channelId: id,
    visible,
    language: detectTextLanguage(`${name} ${description ?? ''}`) ?? null,
    category: category ?? null,
    duration: null,
    isVerified: obj.isVerified === true,
    isLive: false,
    views: Math.max(num(obj.totalViews), 0),
    createdAt: timeOf(obj.dateCreated, obj.createdAt),
    popularity: round(log10p(subscribersCount) * 0.4 + log10p(videosCount) * 0.2),
    titleText: buildIndexText(name, Object.values(nameLocalized ?? {}), str(obj.handle)),
    bodyText: limitBody(buildIndexText(description, Object.values(descriptionLocalized ?? {}), tags, categoryLabels(category))),
    payload: {
      id,
      name,
      nameLocalized,
      description: truncate(description, DESCRIPTION_LIMIT),
      descriptionLocalized,
      avatarUrl: str(obj.avatarUrl),
      coverUrl: str(obj.coverUrl),
      isVerified: obj.isVerified === true,
      subscribersCount,
      videosCount,
      category,
      dateCreated: str(obj.dateCreated),
    },
  };
}

/** Matches COVER_CANDIDATES in api-videos lib/playlistCovers.ts */
const COVER_VIDEO_IDS = 5;

export function projectPlaylist(raw: unknown): SearchRow<'playlist'> | null {
  const obj = asRecord(raw);
  const id = obj && str(obj.id);
  // Stored playlists carry `title`; `name` is the API view's alias.
  const name = str(obj?.name) ?? str(obj?.title);
  if (!obj || !id || !name) return null;
  // Only explicitly public playlists; system playlists (watch later, liked) are never searchable.
  if (obj.isPublic !== true || isRemoved(obj)) return null;
  if (obj.isSystem === true || str(obj.systemType) || (str(obj.visibility) && obj.visibility !== 'public')) return null;
  const description = str(obj.description);
  const videosCount = countOf(obj.videos, obj.videosCount);
  if (videosCount === 0) return null;
  const views = Math.max(num(obj.viewsCount), 0);

  return {
    type: 'playlist',
    id,
    channelId: str(obj.channelId) ?? null,
    visible: true,
    language: detectTextLanguage(`${name} ${description ?? ''}`) ?? null,
    category: null,
    duration: null,
    isVerified: false,
    isLive: false,
    views,
    createdAt: timeOf(obj.dateCreated, obj.createdAt),
    popularity: round(log10p(views) * 0.3 + log10p(videosCount) * 0.2),
    titleText: buildIndexText(name),
    bodyText: limitBody(buildIndexText(description)),
    payload: {
      id,
      name,
      description: truncate(description, DESCRIPTION_LIMIT),
      thumbnailUrl: str(obj.thumbnailUrl),
      coverVideoIds: Array.isArray(obj.videos)
        ? obj.videos.filter((video): video is string => typeof video === 'string').slice(0, COVER_VIDEO_IDS)
        : undefined,
      videosCount,
      channelId: str(obj.channelId),
      userId: str(obj.userId),
      dateCreated: str(obj.dateCreated),
    },
  };
}

/** Community post objects live at `posts/{channelId}/{postId}.json`. */
export const COMMUNITY_POST_KEY = /^posts\/([^/]+)\/([^/]+)\.json$/;

export function projectPost(raw: unknown): SearchRow<'post'> | null {
  const obj = asRecord(raw);
  const id = obj && str(obj.id);
  const channelId = obj && str(obj.channelId);
  if (!obj || !id || !channelId || isRemoved(obj)) return null;
  if (obj.status && obj.status !== 'published') return null;
  if (obj.visibility && obj.visibility !== 'public') return null;
  const content = typeof obj.content === 'string' ? obj.content : '';
  const poll = asRecord(obj.poll);
  const pollQuestion = poll ? str(poll.question) : undefined;
  const pollOptions = poll && Array.isArray(poll.options)
    ? poll.options.map(o => str(asRecord(o)?.text)).filter((t): t is string => !!t)
    : [];
  if (!content.trim() && !pollQuestion && pollOptions.length === 0) return null;
  const images = Array.isArray(obj.images) ? obj.images.map(asRecord).filter((i): i is Raw => !!i) : [];
  const likes = countOf(obj.likes);
  const comments = countOf(obj.comments);

  return {
    type: 'post',
    id,
    channelId,
    visible: true,
    language: detectTextLanguage(`${content} ${pollQuestion ?? ''}`) ?? null,
    category: null,
    duration: null,
    isVerified: obj.channelVerified === true,
    isLive: false,
    views: Math.max(num(obj.views), 0),
    createdAt: timeOf(obj.createdAt, obj.updatedAt),
    popularity: round(log10p(likes) * 0.3 + log10p(comments) * 0.3),
    titleText: limitBody(buildIndexText(content || pollQuestion)),
    bodyText: limitBody(buildIndexText(content ? pollQuestion : undefined, pollOptions)),
    payload: {
      id,
      channelId,
      channelName: str(obj.channelName),
      channelAvatar: str(obj.channelAvatar),
      channelVerified: obj.channelVerified === true,
      postType: str(obj.type),
      content: truncate(content || pollQuestion, 500) ?? '',
      imageUrl: images.length ? str(images[0].url) ?? str(images[0].thumbnailUrl) : undefined,
      likes,
      comments,
      createdAt: str(obj.createdAt),
    },
  };
}

export function projectSearchDocument(type: SearchEntityType, raw: unknown): SearchRow | null {
  switch (type) {
    case 'video': return projectVideo(raw);
    case 'channel': return projectChannel(raw);
    case 'playlist': return projectPlaylist(raw);
    case 'post': return projectPost(raw);
  }
}

/**
 * Stable content hash (FNV-1a, 32-bit) of what the full-text entry and the
 * filter columns depend on. Counters (views, likes → popularity) and the
 * display payload are left out: when only they change, upsertSearchRow
 * updates the base row in place instead of rewriting the full-text entry
 * (SCALABILITY-AUDIT AV-17).
 */
export function searchRowHash(row: SearchRow): string {
  const text = JSON.stringify([
    row.channelId, row.visible, row.language, row.category, row.duration, row.isVerified, row.isLive,
    row.createdAt, row.titleText, row.bodyText,
  ]);
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}
