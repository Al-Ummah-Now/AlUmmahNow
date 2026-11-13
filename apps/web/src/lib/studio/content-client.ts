'use client';

/**
 * The Studio Videos list, read straight from the browser (GET /api/channels/:id/content
 * and /content/summary), not through Server Actions: Next.js runs a page's Server
 * Actions one at a time, so the list waited behind the page's other actions
 * (~9 per load on QA) and every return to the list paid for all of them.
 * Cached with React Query (keys below): a return shows the cached rows at once
 * and revalidates in the background.
 */
import type { QueryClient } from '@tanstack/react-query';
import type { StudioVideoStatus } from '@al-ummah/shared-types';
import { fetchClientAuthInfo } from '@/lib/auth/client-token';
import { getApiUrl } from '@/lib/runtime-config';
import type { StudioVideo } from '@/lib/api/studio-content';

export class StudioFetchError extends Error {
  constructor(readonly status: number) {
    super(`Studio request failed (${status})`);
    this.name = 'StudioFetchError';
  }
}

async function getJson<T>(path: string, signal?: AbortSignal): Promise<T> {
  const call = async (force: boolean) => {
    const { accessToken } = await fetchClientAuthInfo(force);
    if (!accessToken) throw new StudioFetchError(401);
    return fetch(`${getApiUrl().replace(/\/$/, '')}${path}`, { headers: { Authorization: `Bearer ${accessToken}` }, cache: 'no-store', signal });
  };
  let res = await call(false);
  // The cached token expired between the two calls: one retry with a fresh one
  if (res.status === 401) res = await call(true);
  if (!res.ok) throw new StudioFetchError(res.status);
  return (await res.json()) as T;
}

export interface ContentPage {
  items: StudioVideo[];
  cursor: string | null;
  /** Live queue time for held videos (pre-publication review, VR6); null when unknown */
  reviewQueueMinutes?: number | null;
}

/** POST with the viewer's token (the same retry on an expired token as getJson). */
async function postJson(path: string, body?: unknown): Promise<boolean> {
  const call = async (force: boolean) => {
    const { accessToken } = await fetchClientAuthInfo(force);
    if (!accessToken) throw new StudioFetchError(401);
    return fetch(`${getApiUrl().replace(/\/$/, '')}${path}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      cache: 'no-store',
    });
  };
  let res = await call(false);
  if (res.status === 401) res = await call(true);
  return res.ok;
}

/** Pre-publication review: appeal a rejection once (VR10), or ask for a new check after editing. */
export function appealVideoReview(videoId: string, message: string): Promise<boolean> {
  return postJson(`/api/videos/${encodeURIComponent(videoId)}/review/appeal`, { message });
}

export function resubmitVideoReview(videoId: string): Promise<boolean> {
  return postJson(`/api/videos/${encodeURIComponent(videoId)}/review/resubmit`);
}

export function fetchContentPage(channelId: string, params: Record<string, string | number | undefined>, signal?: AbortSignal): Promise<ContentPage> {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== '' && value !== 'all') query.set(key, String(value));
  }
  return getJson<{ result: ContentPage }>(`/api/channels/${encodeURIComponent(channelId)}/content?${query}`, signal).then((body) => body.result);
}

export function fetchContentCounts(channelId: string, signal?: AbortSignal): Promise<Record<StudioVideoStatus, number>> {
  return getJson<{ result: { counts: Record<StudioVideoStatus, number> } }>(`/api/channels/${encodeURIComponent(channelId)}/content/summary`, signal).then((body) => body.result.counts);
}

/** Every cached list and count of a channel lives under this key. */
export const studioContentKey = (channelId: string) => ['studio-content', channelId] as const;
export const studioListKey = (channelId: string, query: string) => ['studio-content', channelId, 'list', query] as const;
export const studioCountsKey = (channelId: string) => ['studio-content', channelId, 'counts'] as const;

/** Lists are shown from cache at once on return, and revalidated when older than this. */
export const STUDIO_LIST_STALE_MS = 15_000;

/**
 * After a video was saved: patch that row wherever it is cached (title,
 * visibility…), and mark the channel's lists stale so the next view
 * revalidates in the background (a status change may move the row).
 */
export function applySavedVideo(client: QueryClient, channelId: string, video: Partial<StudioVideo> & { id: string }): void {
  client.setQueriesData<{ pages: ContentPage[]; pageParams: unknown[] }>({ queryKey: [...studioContentKey(channelId), 'list'] }, (data) =>
    data ? { ...data, pages: data.pages.map((page) => ({ ...page, items: page.items.map((row) => (row.id === video.id ? { ...row, ...video } : row)) })) } : data,
  );
  void client.invalidateQueries({ queryKey: studioContentKey(channelId), refetchType: 'none' });
}
