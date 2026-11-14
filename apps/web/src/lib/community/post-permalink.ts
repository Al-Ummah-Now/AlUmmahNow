/**
 * The post permalink's data (/{locale}/post/{id}, wiki AUN-SEO), read once per request for the page
 * and its metadata: where the post lives (GET /api/community/posts/{id}: published posts only), then
 * the post as the viewer (GET /api/community/channels/{channelId}/posts/{id}, which counts the view).
 */
import { cache } from 'react';
import type { CommunityPost } from '@al-ummah/shared-types';
import { buildApiUrl } from '@/lib/api/api-client';
import { getServerAuthContext } from '@/lib/api/server-auth';
import { logger } from '@/lib/logger-server';

export type PermalinkPost =
  | { status: 'ok'; post: CommunityPost }
  /** Nobody may see it here (never existed, draft, scheduled, held, hidden, deleted): 404 */
  | { status: 'missing' }
  /** The API could not answer: the page throws and the worker answers 503 */
  | { status: 'unavailable' };

export const isValidPostId = (id: string) => /^[A-Za-z0-9_-]{1,64}$/.test(id);

async function viewerToken(): Promise<string | undefined> {
  try {
    return (await getServerAuthContext())?.accessToken || undefined;
  } catch {
    return undefined;
  }
}

async function getJson(path: string, token?: string): Promise<{ status: number | null; body?: unknown }> {
  try {
    const response = await fetch(buildApiUrl(path), {
      headers: { Accept: 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      cache: 'no-store',
    });
    return { status: response.status, body: response.ok ? await response.json() : undefined };
  } catch (error) {
    logger.warn('[post-permalink] api unreachable', { path, error: error instanceof Error ? error.message : String(error) });
    return { status: null };
  }
}

const isDown = (status: number | null) => status === null || status >= 500 || status === 429;

export const loadPermalinkPost = cache(async (id: string): Promise<PermalinkPost> => {
  if (!isValidPostId(id)) return { status: 'missing' };
  const located = await getJson(`/api/community/posts/${encodeURIComponent(id)}`);
  if (isDown(located.status)) return { status: 'unavailable' };
  const channelId = (located.body as { channelId?: unknown } | undefined)?.channelId;
  if (located.status !== 200 || typeof channelId !== 'string') return { status: 'missing' };
  const read = await getJson(`/api/community/channels/${encodeURIComponent(channelId)}/posts/${encodeURIComponent(id)}`, await viewerToken());
  if (isDown(read.status)) return { status: 'unavailable' };
  const post = read.body as CommunityPost | undefined;
  if (read.status !== 200 || !post || post.id !== id) return { status: 'missing' };
  return { status: 'ok', post };
});
