'use server';

import {
  PostCommentListParams,
  PostCommentListResponse,
  PostCommentCreateRequest,
  PostCommentUpdateRequest,
  PostCommentCreateResponse,
  PostCommentLikeResponse,
  PostCommentPinResponse,
  PostCommentHeartResponse,
} from '@al-ummah/shared-types';
import { apiRequestServer, buildApiUrl, buildQueryParams } from './api-client';
import { getServerAuthContext } from './server-auth';
import { ApiHeaders } from './types';

/**
 * List top-level comments for a post
 * GET /api/community/channels/{channelId}/posts/{postId}/comments?limit={limit}&cursor={cursor}&sortBy={sortBy}
 */
export async function listPostComments(
  channelId: string,
  postId: string,
  params: PostCommentListParams = {},
  headers?: Pick<ApiHeaders, 'channelId'>
): Promise<PostCommentListResponse | null> {
  const queryString = buildQueryParams({
    limit: params.limit || 20,
    cursor: params.cursor,
    sortBy: params.sortBy || 'top',
  });

  return apiRequestServer<PostCommentListResponse>(
    {
      method: 'GET',
      url: buildApiUrl(`/api/community/channels/${channelId}/posts/${postId}/comments${queryString}`),
      functionName: 'listPostComments',
    },
    async () => ({
      channelId: headers?.channelId,
      accessToken: (await getServerAuthContext())?.accessToken || '',
    }),
    false
  );
}

/**
 * List replies to a specific comment
 * GET /api/community/channels/{channelId}/posts/{postId}/comments/{commentId}/replies?limit={limit}&cursor={cursor}
 */
export async function listCommentReplies(
  channelId: string,
  postId: string,
  commentId: string,
  params: PostCommentListParams = {},
  headers?: Pick<ApiHeaders, 'channelId'>
): Promise<PostCommentListResponse | null> {
  const queryString = buildQueryParams({
    limit: params.limit || 10,
    cursor: params.cursor,
  });

  return apiRequestServer<PostCommentListResponse>(
    {
      method: 'GET',
      url: buildApiUrl(`/api/community/channels/${channelId}/posts/${postId}/comments/${commentId}/replies${queryString}`),
      functionName: 'listCommentReplies',
    },
    async () => ({
      channelId: headers?.channelId,
      accessToken: (await getServerAuthContext())?.accessToken || '',
    }),
    false
  );
}

/**
 * Create a new comment or reply
 * POST /api/community/channels/{channelId}/posts/{postId}/comments
 */
export async function createPostComment(
  channelId: string,
  postId: string,
  data: PostCommentCreateRequest,
  headers: Pick<ApiHeaders, 'channelId'>,
  /** Turnstile token (hooks/useHumanCheck) when the account's first comment needs one */
  turnstileToken?: string
): Promise<PostCommentCreateResponse | null> {
  return apiRequestServer<PostCommentCreateResponse>(
    {
      method: 'POST',
      url: buildApiUrl(`/api/community/channels/${channelId}/posts/${postId}/comments`),
      body: data,
      ...(turnstileToken ? { headers: { 'X-Turnstile-Token': turnstileToken } } : {}),
      functionName: 'createPostComment',
    },
    async () => ({

      channelId: headers.channelId,
      accessToken: (await getServerAuthContext())?.accessToken || '',
    }),
    true
  );
}

/**
 * Update a comment
 * PUT /api/community/channels/{channelId}/posts/{postId}/comments/{commentId}
 */
export async function updatePostComment(
  channelId: string,
  postId: string,
  commentId: string,
  data: PostCommentUpdateRequest,
  headers: Pick<ApiHeaders, 'channelId'>
): Promise<PostCommentCreateResponse | null> {
  return apiRequestServer<PostCommentCreateResponse>(
    {
      method: 'PUT',
      url: buildApiUrl(`/api/community/channels/${channelId}/posts/${postId}/comments/${commentId}`),
      body: data,
      functionName: 'updatePostComment',
    },
    async () => ({

      channelId: headers.channelId,
      accessToken: (await getServerAuthContext())?.accessToken || '',
    }),
    true
  );
}

/**
 * Delete a comment
 * DELETE /api/community/channels/{channelId}/posts/{postId}/comments/{commentId}
 */
export async function deletePostComment(
  channelId: string,
  postId: string,
  commentId: string,
  headers: Pick<ApiHeaders, 'channelId'>
): Promise<{ success: boolean } | null> {
  return apiRequestServer<{ success: boolean }>(
    {
      method: 'DELETE',
      url: buildApiUrl(`/api/community/channels/${channelId}/posts/${postId}/comments/${commentId}`),
      functionName: 'deletePostComment',
    },
    async () => ({

      channelId: headers.channelId,
      accessToken: (await getServerAuthContext())?.accessToken || '',
    }),
    true
  );
}

/**
 * Like a comment
 * POST /api/community/channels/{channelId}/posts/{postId}/comments/{commentId}/like
 */
export async function likePostComment(
  channelId: string,
  postId: string,
  commentId: string,
  headers: Pick<ApiHeaders, 'channelId'>
): Promise<PostCommentLikeResponse | null> {
  return apiRequestServer<PostCommentLikeResponse>(
    {
      method: 'POST',
      url: buildApiUrl(`/api/community/channels/${channelId}/posts/${postId}/comments/${commentId}/like`),
      functionName: 'likePostComment',
    },
    async () => ({

      channelId: headers.channelId,
      accessToken: (await getServerAuthContext())?.accessToken || '',
    }),
    true
  );
}

/**
 * Unlike a comment
 * DELETE /api/community/channels/{channelId}/posts/{postId}/comments/{commentId}/like
 */
export async function unlikePostComment(
  channelId: string,
  postId: string,
  commentId: string,
  headers: Pick<ApiHeaders, 'channelId'>
): Promise<PostCommentLikeResponse | null> {
  return apiRequestServer<PostCommentLikeResponse>(
    {
      method: 'DELETE',
      url: buildApiUrl(`/api/community/channels/${channelId}/posts/${postId}/comments/${commentId}/like`),
      functionName: 'unlikePostComment',
    },
    async () => ({

      channelId: headers.channelId,
      accessToken: (await getServerAuthContext())?.accessToken || '',
    }),
    true
  );
}

type CommentModerationAction = 'pin' | 'heart';

function moderatePostComment<T>(
  method: 'POST' | 'DELETE',
  action: CommentModerationAction,
  functionName: string,
  channelId: string,
  postId: string,
  commentId: string,
  headers: Required<Pick<ApiHeaders, 'channelId'>>
): Promise<T | null> {
  return apiRequestServer<T>(
    {
      method,
      url: buildApiUrl(`/api/community/channels/${channelId}/posts/${postId}/comments/${commentId}/${action}`),
      functionName,
    },
    async () => ({
      channelId: headers.channelId,
      accessToken: (await getServerAuthContext())?.accessToken || '',
    }),
    true
  );
}

/**
 * Pin a top-level comment (channel owner only; replaces any existing pin)
 * POST /api/community/channels/{channelId}/posts/{postId}/comments/{commentId}/pin
 */
export async function pinPostComment(
  channelId: string,
  postId: string,
  commentId: string,
  headers: Required<Pick<ApiHeaders, 'channelId'>>
): Promise<PostCommentPinResponse | null> {
  return moderatePostComment<PostCommentPinResponse>('POST', 'pin', 'pinPostComment', channelId, postId, commentId, headers);
}

/**
 * Unpin a comment (channel owner only)
 * DELETE /api/community/channels/{channelId}/posts/{postId}/comments/{commentId}/pin
 */
export async function unpinPostComment(
  channelId: string,
  postId: string,
  commentId: string,
  headers: Required<Pick<ApiHeaders, 'channelId'>>
): Promise<PostCommentPinResponse | null> {
  return moderatePostComment<PostCommentPinResponse>('DELETE', 'pin', 'unpinPostComment', channelId, postId, commentId, headers);
}

/**
 * Heart a comment (channel owner only)
 * POST /api/community/channels/{channelId}/posts/{postId}/comments/{commentId}/heart
 */
export async function heartPostComment(
  channelId: string,
  postId: string,
  commentId: string,
  headers: Required<Pick<ApiHeaders, 'channelId'>>
): Promise<PostCommentHeartResponse | null> {
  return moderatePostComment<PostCommentHeartResponse>('POST', 'heart', 'heartPostComment', channelId, postId, commentId, headers);
}

/**
 * Remove the creator heart from a comment (channel owner only)
 * DELETE /api/community/channels/{channelId}/posts/{postId}/comments/{commentId}/heart
 */
export async function unheartPostComment(
  channelId: string,
  postId: string,
  commentId: string,
  headers: Required<Pick<ApiHeaders, 'channelId'>>
): Promise<PostCommentHeartResponse | null> {
  return moderatePostComment<PostCommentHeartResponse>('DELETE', 'heart', 'unheartPostComment', channelId, postId, commentId, headers);
}
