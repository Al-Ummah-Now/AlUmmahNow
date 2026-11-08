'use client';

/**
 * Library API client (Story 29.6): Watch later, liked videos, saved posts.
 *
 * Endpoints (api-videos, all authenticated):
 * - GET    /api/library/watch-later            ?limit&cursor
 * - POST   /api/library/watch-later            { videoId }
 * - DELETE /api/library/watch-later/:videoId
 * - GET    /api/library/watch-later/:videoId   { saved }
 * - PUT    /api/library/watch-later/order      { videoIds }
 * - GET    /api/library/liked                  ?limit&cursor
 * - GET    /api/library/saved-posts            ?limit&cursor
 * - POST   /api/library/saved-posts            { postId, channelId }
 * - DELETE /api/library/saved-posts/:postId
 * - GET    /api/library/saved-posts/:postId    { saved }
 */

import { logger } from '@/lib/logger-client';
import { getApiUrl } from '@/lib/runtime-config';
import { getClientAuthHeaders } from '@/lib/auth/client-token';
import type { VideoObject } from '@al-ummah/shared-types';

const apiBase = (): string => getApiUrl();

export interface LibraryVideo extends VideoObject {
  likedAt?: string;
}

export interface LibraryPage<T> {
  items: T[];
  nextCursor: string | null;
  total: number;
}

export interface WatchLaterPage extends LibraryPage<LibraryVideo> {
  playlistId: string;
  videoIds: string[];
}

export interface SavedPost {
  id: string;
  channelId: string;
  content?: string;
  type?: string;
  createdAt?: string;
  savedAt?: string;
  channelName?: string;
  [key: string]: unknown;
}

export type MutationResult = { ok: true; saved: boolean } | { ok: false; error: 'full' | 'failed' };

async function request<T>(path: string, init: RequestInit = {}, label: string): Promise<T | null> {
  try {
    const headers: Record<string, string> = { ...(await getClientAuthHeaders()) };
    if (init.body) headers['Content-Type'] = 'application/json';
    const response = await fetch(`${apiBase()}${path}`, { ...init, headers });
    if (!response.ok) {
      logger.warn(`[LibraryService] ${label} failed`, { status: response.status, path });
      return null;
    }
    const body = (await response.json()) as { result?: T };
    return (body.result ?? null) as T | null;
  } catch (error) {
    logger.error(`[LibraryService] ${label} error`, { path, error });
    return null;
  }
}

function pageQuery(params: { limit?: number; cursor?: string | null } = {}): string {
  const q = new URLSearchParams({ limit: String(params.limit ?? 20) });
  if (params.cursor) q.set('cursor', params.cursor);
  return q.toString();
}

export const LibraryService = {
  watchLater(params?: { limit?: number; cursor?: string | null }) {
    return request<WatchLaterPage>(`/api/library/watch-later?${pageQuery(params)}`, {}, 'List watch later');
  },

  async isInWatchLater(videoId: string): Promise<boolean | null> {
    const result = await request<{ saved: boolean }>(`/api/library/watch-later/${encodeURIComponent(videoId)}`, {}, 'Watch later status');
    return result ? result.saved : null;
  },

  async addToWatchLater(videoId: string): Promise<MutationResult> {
    try {
      const response = await fetch(`${apiBase()}/api/library/watch-later`, {
        method: 'POST',
        headers: { ...(await getClientAuthHeaders()), 'Content-Type': 'application/json' },
        body: JSON.stringify({ videoId }),
      });
      if (response.status === 409) return { ok: false, error: 'full' };
      if (!response.ok) {
        logger.warn('[LibraryService] Add to watch later failed', { videoId, status: response.status });
        return { ok: false, error: 'failed' };
      }
      logger.info('[LibraryService] Saved to watch later', { videoId });
      return { ok: true, saved: true };
    } catch (error) {
      logger.error('[LibraryService] Add to watch later error', { videoId, error });
      return { ok: false, error: 'failed' };
    }
  },

  async removeFromWatchLater(videoId: string): Promise<MutationResult> {
    const result = await request<{ saved: boolean }>(
      `/api/library/watch-later/${encodeURIComponent(videoId)}`,
      { method: 'DELETE' },
      'Remove from watch later',
    );
    return result ? { ok: true, saved: false } : { ok: false, error: 'failed' };
  },

  async reorderWatchLater(videoIds: string[]): Promise<boolean> {
    const result = await request<{ videoIds: string[] }>(
      '/api/library/watch-later/order',
      { method: 'PUT', body: JSON.stringify({ videoIds }) },
      'Reorder watch later',
    );
    return !!result;
  },

  liked(params?: { limit?: number; cursor?: string | null }) {
    return request<LibraryPage<LibraryVideo>>(`/api/library/liked?${pageQuery(params)}`, {}, 'List liked videos');
  },

  savedPosts(params?: { limit?: number; cursor?: string | null }) {
    return request<LibraryPage<SavedPost>>(`/api/library/saved-posts?${pageQuery(params)}`, {}, 'List saved posts');
  },

  async isPostSaved(postId: string): Promise<boolean | null> {
    const result = await request<{ saved: boolean }>(`/api/library/saved-posts/${encodeURIComponent(postId)}`, {}, 'Saved post status');
    return result ? result.saved : null;
  },

  async savePost(postId: string, channelId: string): Promise<boolean> {
    return !!(await request<{ saved: boolean }>(
      '/api/library/saved-posts',
      { method: 'POST', body: JSON.stringify({ postId, channelId }) },
      'Save post',
    ));
  },

  async unsavePost(postId: string): Promise<boolean> {
    return !!(await request<{ saved: boolean }>(`/api/library/saved-posts/${encodeURIComponent(postId)}`, { method: 'DELETE' }, 'Unsave post'));
  },
};
