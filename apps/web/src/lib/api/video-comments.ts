'use server';

/**
 * Video comment server actions for Story 29.2: sort, replies, held-for-review
 * approval and structured create errors (comments off). Edit, delete and
 * reactions stay in lib/api/videos.ts.
 */

import type { Comments } from '@/interfaces';
import { apiRequestServer, buildApiUrl } from './api-client';
import { getServerAuthContext } from './server-auth';
import { logger } from '@/lib/logger-server';

export type CommentSort = 'top' | 'newest';
export type CommentSettings = 'on' | 'held' | 'off';

export interface CommentPageResult {
  comments: Comments[];
  nextCursor: string | null;
  total: number;
  sort: CommentSort;
  commentSettings: CommentSettings;
}

export interface ReplyPageResult {
  replies: Comments[];
  nextCursor: string | null;
  total: number;
}

export type CreateCommentResult =
  | { ok: true; comment: Comments }
  | { ok: false; error: 'comments_disabled' | 'not_found' | 'failed' };

async function viewerAuth() {
  const auth = await getServerAuthContext();
  // Anonymous viewers get a public listing without reaction flags
  return auth?.accessToken ? { channelId: auth.channelId || '', accessToken: auth.accessToken } : null;
}

/** GET /api/videos/:id/comments?sort= */
export async function listComments(
  videoId: string,
  params: { limit?: number; cursor?: string | null; sort?: CommentSort } = {},
): Promise<CommentPageResult | null> {
  const query = new URLSearchParams();
  if (params.limit) query.set('limit', String(params.limit));
  if (params.cursor) query.set('cursor', params.cursor);
  if (params.sort) query.set('sort', params.sort);
  const qs = query.toString();
  const response = await apiRequestServer<{ success: boolean; result?: Partial<CommentPageResult> & { comments: Comments[] } }>({
    method: 'GET',
    url: buildApiUrl(`/api/videos/${encodeURIComponent(videoId)}/comments${qs ? `?${qs}` : ''}`),
    functionName: 'listComments',
  }, viewerAuth, false);
  if (!response?.success || !response.result) return null;
  return {
    comments: response.result.comments,
    nextCursor: response.result.nextCursor ?? null,
    total: response.result.total ?? response.result.comments.length,
    sort: response.result.sort ?? params.sort ?? 'newest',
    commentSettings: response.result.commentSettings ?? 'on',
  };
}

/** GET /api/videos/:id/comments/:cid/replies */
export async function listReplies(
  videoId: string,
  commentId: string,
  params: { limit?: number; cursor?: string | null } = {},
): Promise<ReplyPageResult | null> {
  const query = new URLSearchParams();
  if (params.limit) query.set('limit', String(params.limit));
  if (params.cursor) query.set('cursor', params.cursor);
  const qs = query.toString();
  const response = await apiRequestServer<{ success: boolean; result?: ReplyPageResult }>({
    method: 'GET',
    url: buildApiUrl(`/api/videos/${encodeURIComponent(videoId)}/comments/${encodeURIComponent(commentId)}/replies${qs ? `?${qs}` : ''}`),
    functionName: 'listReplies',
  }, viewerAuth, false);
  return response?.success && response.result ? response.result : null;
}

/** POST /api/videos/:id/comments (top-level, or a reply with parentCommentId) */
export async function createComment(
  videoId: string,
  text: string,
  channelId: string,
  parentCommentId?: string,
): Promise<CreateCommentResult> {
  const auth = await getServerAuthContext();
  if (!auth?.accessToken) return { ok: false, error: 'failed' };
  try {
    const response = await fetch(buildApiUrl(`/api/videos/${encodeURIComponent(videoId)}/comments`), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${auth.accessToken}`,
        // No channel: no header, the member comments as themselves
        ...((auth.channelId || channelId) ? { channelId: auth.channelId || channelId } : {}),
      },
      body: JSON.stringify({ text, ...(parentCommentId ? { parentCommentId } : {}) }),
    });
    const json = (await response.json().catch(() => ({}))) as { success?: boolean; error?: string; result?: { comment?: Comments } };
    if (response.ok && json.result?.comment) {
      return { ok: true, comment: json.result.comment };
    }
    logger.warn('[createComment] Rejected', { videoId, status: response.status, error: json.error });
    if (response.status === 403 && json.error === 'comments_disabled') return { ok: false, error: 'comments_disabled' };
    if (response.status === 404) return { ok: false, error: 'not_found' };
    return { ok: false, error: 'failed' };
  } catch (error) {
    logger.error('[createComment] Failed', { videoId, error });
    return { ok: false, error: 'failed' };
  }
}

/** POST /api/videos/:id/comments/:cid/approve (video owner) */
export async function approveComment(videoId: string, commentId: string): Promise<boolean> {
  const response = await apiRequestServer<{ success: boolean }>({
    method: 'POST',
    url: buildApiUrl(`/api/videos/${encodeURIComponent(videoId)}/comments/${encodeURIComponent(commentId)}/approve`),
    functionName: 'approveComment',
  }, async () => {
    const auth = await getServerAuthContext();
    return auth?.accessToken ? { channelId: auth.channelId || '', accessToken: auth.accessToken } : null;
  }, true);
  return !!response?.success;
}
