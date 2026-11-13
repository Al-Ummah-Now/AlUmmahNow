/**
 * Anonymous content loading for embeds, oEmbed and share metadata (server only).
 *
 * Every call goes to the videos API WITHOUT credentials (no Authorization, no
 * cookies), so the API answers only for public, published content: private,
 * scheduled, deleted and moderation-hidden items are 404 for anonymous callers.
 * Embeds never act as the viewer, even when the browser sent a session cookie
 * (same-site hosts such as www.alummahnow.net).
 */

import { cache } from 'react';
import { logger } from '@/lib/logger-server';
import { getLocalizedValue } from '@al-ummah/shared-types';
import { shareImagePath } from './share-image';

export interface EmbedVideo {
  id: string;
  title: string;
  titleLocalized?: Record<string, string>;
  description?: string;
  descriptionLocalized?: Record<string, string>;
  playUrl: string;
  /**
   * Poster for pages, meta tags and embeds: the stable same-origin share image
   * (/thumb/<id>.jpg, lib/embed/share-image.ts), never a signed CDN URL
   */
  poster?: string;
  /** The current thumbnail at its (signed, expiring) source: only the /thumb route fetches it */
  thumbnailSource?: string;
  duration?: number;
  channelId?: string | null;
  channelName?: string;
  /** The channel's name per language (lib/channel-name.ts) */
  channelNameLocalized?: Record<string, string>;
  channelHandle?: string | null;
  /** The API's flag: the video has chapters */
  hasChapters?: boolean;
  /** Which source the API chose for playUrl (a label; the player only plays playUrl) */
  delivery?: { source: 'bunny' | 'r2' };
  /** Encoded size (the player box and the declared card / oEmbed sizes follow its ratio) */
  width?: number;
  height?: number;
  isShort?: boolean;
  /** Inside a playlist: the item's place in the stored list (the watch URL's `index`) */
  listIndex?: number;
}

export interface EmbedPlaylist {
  id: string;
  title: string;
  channelName?: string;
  videos: EmbedVideo[];
}

/** Upload states in which a public video has nothing to play yet. */
const NOT_PLAYABLE_STATUSES = new Set(['initiated', 'uploading', 'processing', 'failed']);

interface ApiVideo {
  id?: string;
  title?: string;
  titleLocalized?: Record<string, string>;
  description?: string;
  descriptionLocalized?: Record<string, string>;
  playUrl?: string;
  thumbnailUrl?: string;
  duration?: number | string;
  channelId?: string | null;
  channelName?: string;
  channelNameLocalized?: Record<string, string>;
  channelHandle?: string | null;
  isPublic?: boolean;
  isDeleted?: boolean;
  isHidden?: boolean;
  uploadStatus?: string;
  hasChapters?: boolean;
  delivery?: { source?: string };
  width?: number;
  height?: number;
  isShort?: boolean;
}

function apiBase(): string {
  return (process.env.API_URL || process.env.NEXT_PUBLIC_API_URL || '').replace(/\/+$/, '');
}

/**
 * The thumbnail's current source: the API's thumbnailUrl (the chosen
 * source's, custom thumbnails included, freshly signed per response), else
 * Bunny's thumbnail next to the HLS playlist. Signed URLs expire: this is
 * fetched by the /thumb route and never put in a page.
 */
export function posterFor(playUrl: string | undefined, thumbnailUrl: string | undefined): string | undefined {
  if (thumbnailUrl) return /^https?:\/\//.test(thumbnailUrl) ? thumbnailUrl : `https://${thumbnailUrl}`;
  if (playUrl && /\/playlist\.m3u8$/.test(playUrl)) return playUrl.replace(/playlist\.m3u8$/, 'thumbnail.jpg');
  return undefined;
}

/**
 * Map an API video to an embeddable one, or null when it must not play:
 * not public, removed, or nothing to play yet. The API already hides
 * non-public videos from anonymous callers; this is defence in depth.
 */
const positiveSize = (v: unknown) => typeof v === 'number' && Number.isFinite(v) && v > 0;

export { videoAspect } from './aspect';

export function toEmbedVideo(video: ApiVideo | null | undefined): EmbedVideo | null {
  if (!video || !video.id || !video.playUrl) return null;
  if (video.isPublic === false || video.isDeleted === true || video.isHidden === true) return null;
  if (video.uploadStatus && NOT_PLAYABLE_STATUSES.has(video.uploadStatus)) return null;
  const duration = Number(video.duration);
  const thumbnailSource = posterFor(video.playUrl, video.thumbnailUrl);
  return {
    id: video.id,
    title: video.title || '',
    titleLocalized: video.titleLocalized,
    description: video.description,
    descriptionLocalized: video.descriptionLocalized,
    playUrl: video.playUrl,
    poster: thumbnailSource ? shareImagePath(video.id) : undefined,
    thumbnailSource,
    duration: Number.isFinite(duration) && duration > 0 ? duration : undefined,
    channelId: video.channelId ?? null,
    channelName: video.channelName,
    ...(video.channelNameLocalized ? { channelNameLocalized: video.channelNameLocalized } : {}),
    channelHandle: video.channelHandle ?? null,
    hasChapters: video.hasChapters === true || undefined,
    ...(positiveSize(video.width) && positiveSize(video.height) ? { width: Number(video.width), height: Number(video.height) } : {}),
    ...(video.isShort === true ? { isShort: true } : {}),
    ...(video.delivery?.source === 'r2' || video.delivery?.source === 'bunny' ? { delivery: { source: video.delivery.source } } : {}),
  };
}

async function anonymousGet<T>(path: string): Promise<T | null> {
  const base = apiBase();
  if (!base) {
    logger.error('[embed] API_URL is not configured');
    return null;
  }
  try {
    const response = await fetch(`${base}${path}`, {
      headers: { Accept: 'application/json' },
      credentials: 'omit',
      // Signed playback URLs expire: never serve a cached copy
      cache: 'no-store',
    });
    if (response.status === 404) return null;
    if (!response.ok) {
      logger.warn('[embed] API request failed', { path, status: response.status });
      return null;
    }
    return (await response.json()) as T;
  } catch (error) {
    logger.error('[embed] API request error', { path, error: error instanceof Error ? error.message : String(error) });
    return null;
  }
}

/** Per-request memoised: metadata and page share one API call. */
export const loadPublicVideo = cache(async (videoId: string): Promise<EmbedVideo | null> =>
  toEmbedVideo(await anonymousGet<ApiVideo>(`/api/videos/${encodeURIComponent(videoId)}`)));

interface ApiPlaylist {
  id?: string;
  name?: string;
  title?: string;
  isPublic?: boolean;
  channelName?: string;
  videoItems?: ApiVideo[];
}

interface ApiQueuePage {
  result?: {
    playlist?: { id?: string; title?: string; isPublic?: boolean; channelName?: string };
    total?: number;
    items?: Array<ApiVideo & { index?: number }>;
    nextOffset?: number | null;
  };
}

/** Longest list an embed loads (pages of QUEUE_PAGE). */
export const EMBED_PLAYLIST_MAX = 500;
const QUEUE_PAGE = 100;

/**
 * A public playlist's public videos in the playlist's saved order, from the playback queue API
 * (docs/specs/PLAYLIST-PLAYBACK.md section 3; the same order every player uses, no 200 cap).
 * Before that API is deployed the older expanded playlist read is used.
 */
export const loadPublicPlaylist = cache(async (playlistId: string): Promise<EmbedPlaylist | null> => {
  const id = encodeURIComponent(playlistId);
  const first = await anonymousGet<ApiQueuePage>(`/api/playlists/${id}/queue?offset=0&limit=${QUEUE_PAGE}`);
  if (first?.result?.playlist) {
    const summary = first.result.playlist;
    if (!summary.id || summary.isPublic === false) return null;
    const items = [...(first.result.items ?? [])];
    let next = first.result.nextOffset ?? null;
    while (next !== null && items.length < EMBED_PLAYLIST_MAX) {
      const page = await anonymousGet<ApiQueuePage>(`/api/playlists/${id}/queue?offset=${next}&limit=${QUEUE_PAGE}`);
      if (!page?.result) break;
      items.push(...(page.result.items ?? []));
      next = page.result.nextOffset ?? null;
    }
    const videos = items.slice(0, EMBED_PLAYLIST_MAX).flatMap((item) => {
      const video = toEmbedVideo({ ...item, channelName: item.channelName });
      return video ? [{ ...video, listIndex: item.index }] : [];
    });
    return { id: summary.id, title: summary.title || '', channelName: summary.channelName, videos };
  }

  const playlist = await anonymousGet<ApiPlaylist>(`/api/playlists/${id}?includeVideos=true`);
  if (!playlist || !playlist.id || playlist.isPublic === false) return null;
  const videos = (playlist.videoItems || []).map(toEmbedVideo).filter((v): v is EmbedVideo => v !== null);
  return {
    id: playlist.id,
    title: playlist.name || playlist.title || '',
    channelName: playlist.channelName,
    videos,
  };
});

export interface EmbedComment {
  id: string;
  text: string;
  dateCreated: string;
  likesCount: number;
  repliesCount: number;
  isPinned: boolean;
  authorName: string;
  authorAvatar?: string;
}

export interface EmbedCommentPage {
  comments: EmbedComment[];
  nextCursor: string | null;
  total: number;
}

interface ApiCommentList {
  result?: {
    comments?: Array<{
      id: string;
      text?: string;
      dateCreated?: string;
      likesCount?: number;
      repliesCount?: number;
      isPinned?: boolean;
      isDeleted?: boolean;
      isHeld?: boolean;
      author?: { displayName?: string; avatarUrl?: string };
    }>;
    nextCursor?: string | null;
    total?: number;
  };
}

/** Top-level public comments, newest first. Deleted and held comments are dropped. */
export async function loadPublicComments(videoId: string, cursor?: string | null, limit = 20): Promise<EmbedCommentPage> {
  const query = new URLSearchParams({ limit: String(limit), sort: 'newest' });
  if (cursor) query.set('cursor', cursor);
  const body = await anonymousGet<ApiCommentList>(`/api/videos/${encodeURIComponent(videoId)}/comments?${query}`);
  const comments = (body?.result?.comments || [])
    .filter((c) => !c.isDeleted && !c.isHeld && c.text)
    .map((c) => ({
      id: c.id,
      text: c.text || '',
      dateCreated: c.dateCreated || '',
      likesCount: c.likesCount || 0,
      repliesCount: c.repliesCount || 0,
      isPinned: !!c.isPinned,
      authorName: c.author?.displayName || '',
      authorAvatar: c.author?.avatarUrl,
    }));
  return { comments, nextCursor: body?.result?.nextCursor ?? null, total: body?.result?.total ?? comments.length };
}

export function localizedTitle(video: Pick<EmbedVideo, 'title' | 'titleLocalized'>, lang: string): string {
  return getLocalizedValue(video.titleLocalized, video.title, lang) || video.title;
}
