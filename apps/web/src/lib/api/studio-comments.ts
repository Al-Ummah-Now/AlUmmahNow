'use server';

/**
 * Studio → Comments (docs/specs/CREATOR-STUDIO.md §4.7): one list of a
 * channel's video and post comments, read from the channel_comments index in
 * api-videos, with moderation actions and channel blocks. Every route checks
 * the caller's channel role (comment.moderate) again.
 */

import type { StudioComment, StudioCommentAction, StudioCommentKind, StudioCommentTab } from '@al-ummah/shared-types';
import { apiRequestServer, apiRequestServerResult, buildApiUrl } from './api-client';
import { getServerAuthContext } from './server-auth';

export type { StudioComment, StudioCommentAction, StudioCommentKind, StudioCommentTab };

export interface StudioCommentQuery {
  tab: StudioCommentTab;
  q?: string;
  /** `video:<id>` or `post:<id>` */
  target?: string;
  noReply?: boolean;
  hasLink?: boolean;
  cursor?: string;
  limit?: number;
}

export interface StudioCommentPage {
  items: StudioComment[];
  nextCursor: string | null;
  total: number;
  indexing?: boolean;
}

export interface StudioCommentSummary {
  inbox: number;
  held: number;
  removed: number;
  recent: StudioComment[];
  indexing?: boolean;
}

export interface BulkItem {
  kind: StudioCommentKind;
  targetId: string;
  commentId: string;
}

export interface BulkResult {
  commentId: string;
  ok: boolean;
  error?: string;
}

export interface ChannelBlock {
  userId: string;
  displayName: string;
  avatarUrl?: string;
  blockedAt: string;
}

const base = (channelId: string) => `/api/channels/${encodeURIComponent(channelId)}`;

/** GET /api/channels/:id/comments */
export async function listChannelComments(channelId: string, query: StudioCommentQuery): Promise<StudioCommentPage | null> {
  const params = new URLSearchParams({ tab: query.tab });
  if (query.q) params.set('q', query.q);
  if (query.target) params.set('target', query.target);
  if (query.noReply) params.set('noReply', '1');
  if (query.hasLink) params.set('hasLink', '1');
  if (query.cursor) params.set('cursor', query.cursor);
  if (query.limit) params.set('limit', String(query.limit));
  const response = await apiRequestServer<{ success: boolean } & StudioCommentPage>({
    method: 'GET',
    url: buildApiUrl(`${base(channelId)}/comments?${params}`),
    functionName: 'listChannelComments',
  }, getServerAuthContext, true);
  if (!response?.success) return null;
  return { items: response.items ?? [], nextCursor: response.nextCursor ?? null, total: response.total ?? 0, indexing: response.indexing };
}

/** GET /api/channels/:id/comments/summary */
export async function getChannelCommentSummary(channelId: string): Promise<StudioCommentSummary | null> {
  const response = await apiRequestServer<{ success: boolean } & StudioCommentSummary>({
    method: 'GET',
    url: buildApiUrl(`${base(channelId)}/comments/summary`),
    functionName: 'getChannelCommentSummary',
  }, getServerAuthContext, true);
  if (!response?.success) return null;
  return { inbox: response.inbox ?? 0, held: response.held ?? 0, removed: response.removed ?? 0, recent: response.recent ?? [], indexing: response.indexing };
}

/** POST /api/channels/:id/comments/bulk: one action on 1 to 50 comments. Null when the request failed. */
export async function actOnComments(channelId: string, action: StudioCommentAction, items: BulkItem[]): Promise<BulkResult[] | null> {
  const response = await apiRequestServer<{ success: boolean; results: BulkResult[] }>({
    method: 'POST',
    url: buildApiUrl(`${base(channelId)}/comments/bulk`),
    body: { action, items },
    functionName: 'actOnComments',
  }, getServerAuthContext, true);
  return response?.success ? response.results ?? [] : null;
}

/** GET /api/channels/:id/blocks */
export async function listChannelBlocks(channelId: string): Promise<ChannelBlock[] | null> {
  const response = await apiRequestServer<{ success: boolean; items: ChannelBlock[] }>({
    method: 'GET',
    url: buildApiUrl(`${base(channelId)}/blocks`),
    functionName: 'listChannelBlocks',
  }, getServerAuthContext, true);
  return response?.success ? response.items ?? [] : null;
}

/** POST /api/channels/:id/blocks */
export async function blockFromChannel(channelId: string, userId: string): Promise<boolean> {
  const result = await apiRequestServerResult<{ success: boolean }>({
    method: 'POST',
    url: buildApiUrl(`${base(channelId)}/blocks`),
    body: { userId },
    functionName: 'blockFromChannel',
  }, getServerAuthContext, true);
  return !!result.data?.success;
}

/** DELETE /api/channels/:id/blocks/:userId */
export async function unblockFromChannel(channelId: string, userId: string): Promise<boolean> {
  const result = await apiRequestServerResult<{ success: boolean }>({
    method: 'DELETE',
    url: buildApiUrl(`${base(channelId)}/blocks/${encodeURIComponent(userId)}`),
    functionName: 'unblockFromChannel',
  }, getServerAuthContext, true);
  return !!result.data?.success;
}

/**
 * GET /api/channels/:id/comments?tab=held: the comments held for the channel's review, newest
 * first, and how many are held in all (Dashboard "Comments awaiting review"). Needs
 * comment.moderate on the channel; null when the call did not succeed (403, 503 while the index
 * is unavailable, network).
 */
export async function listHeldComments(channelId: string, limit = 3): Promise<{ items: StudioComment[]; total: number } | null> {
  const response = await apiRequestServer<{ success: boolean; items: StudioComment[]; total?: number }>({
    method: 'GET',
    url: buildApiUrl(`/api/channels/${encodeURIComponent(channelId)}/comments?tab=held&limit=${limit}`),
    functionName: 'listHeldComments',
  }, getServerAuthContext, true);
  if (!response?.success || !Array.isArray(response.items)) return null;
  return { items: response.items, total: response.total ?? response.items.length };
}
