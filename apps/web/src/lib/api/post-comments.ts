'use server';

import {
  PostCommentListParams,
  PostCommentListResponse,
  PostCommentCreateRequest,
  PostCommentUpdateRequest,
  PostCommentCreateResponse,
  PostCommentLikeResponse,
} from '@al-ummah/shared-types';
import { apiRequestServer, buildApiUrl, buildQueryParams } from './api-client';
import { getServerAuthContext } from './server-auth';
import { ApiHeaders } from './types';

/**
 * List top-level comments for a post
 * GET /api/community/posts/{postId}/comments?limit={limit}&cursor={cursor}&sortBy={sortBy}
 */
export async function listPostComments(
  postId: string,
  params: PostCommentListParams = {}
): Promise<PostCommentListResponse | null> {
  const queryString = buildQueryParams({
    limit: params.limit || 20,
    cursor: params.cursor,
    sortBy: params.sortBy || 'top',
  });

  return apiRequestServer<PostCommentListResponse>(
    {
      method: 'GET',
      url: buildApiUrl(`/api/community/posts/${postId}/comments${queryString}`),
      functionName: 'listPostComments',
    },
    getServerAuthContext,
    false
  );
}

/**
 * List replies to a specific comment
 * GET /api/community/posts/{postId}/comments/{commentId}/replies?limit={limit}&cursor={cursor}
 */
export async function listCommentReplies(
  postId: string,
  commentId: string,
  params: PostCommentListParams = {}
): Promise<PostCommentListResponse | null> {
  const queryString = buildQueryParams({
    limit: params.limit || 10,
    cursor: params.cursor,
  });

  return apiRequestServer<PostCommentListResponse>(
    {
      method: 'GET',
      url: buildApiUrl(`/api/community/posts/${postId}/comments/${commentId}/replies${queryString}`),
      functionName: 'listCommentReplies',
    },
    getServerAuthContext,
    false
  );
}

/**
 * Create a new comment or reply
 * POST /api/community/posts/{postId}/comments
 */
export async function createPostComment(
  postId: string,
  data: PostCommentCreateRequest,
  headers: Required<Pick<ApiHeaders, 'channelId'>>
): Promise<PostCommentCreateResponse | null> {
  return apiRequestServer<PostCommentCreateResponse>(
    {
      method: 'POST',
      url: buildApiUrl(`/api/community/posts/${postId}/comments`),
      body: data,
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
 * PUT /api/community/posts/{postId}/comments/{commentId}
 */
export async function updatePostComment(
  postId: string,
  commentId: string,
  data: PostCommentUpdateRequest,
  headers: Required<Pick<ApiHeaders, 'channelId'>>
): Promise<PostCommentCreateResponse | null> {
  return apiRequestServer<PostCommentCreateResponse>(
    {
      method: 'PUT',
      url: buildApiUrl(`/api/community/posts/${postId}/comments/${commentId}`),
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
 * DELETE /api/community/posts/{postId}/comments/{commentId}
 */
export async function deletePostComment(
  postId: string,
  commentId: string,
  headers: Required<Pick<ApiHeaders, 'channelId'>>
): Promise<{ success: boolean } | null> {
  return apiRequestServer<{ success: boolean }>(
    {
      method: 'DELETE',
      url: buildApiUrl(`/api/community/posts/${postId}/comments/${commentId}`),
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
 * POST /api/community/posts/{postId}/comments/{commentId}/like
 */
export async function likePostComment(
  postId: string,
  commentId: string,
  headers: Required<Pick<ApiHeaders, 'channelId'>>
): Promise<PostCommentLikeResponse | null> {
  return apiRequestServer<PostCommentLikeResponse>(
    {
      method: 'POST',
      url: buildApiUrl(`/api/community/posts/${postId}/comments/${commentId}/like`),
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
 * DELETE /api/community/posts/{postId}/comments/{commentId}/like
 */
export async function unlikePostComment(
  postId: string,
  commentId: string,
  headers: Required<Pick<ApiHeaders, 'channelId'>>
): Promise<PostCommentLikeResponse | null> {
  return apiRequestServer<PostCommentLikeResponse>(
    {
      method: 'DELETE',
      url: buildApiUrl(`/api/community/posts/${postId}/comments/${commentId}/like`),
      functionName: 'unlikePostComment',
    },
    async () => ({
      
      channelId: headers.channelId,
      accessToken: (await getServerAuthContext())?.accessToken || '',
    }),
    true
  );
}

/**
 * Pin a comment (post owner only)
 * POST /api/community/posts/{postId}/comments/{commentId}/pin
 */
export async function pinPostComment(
  postId: string,
  commentId: string,
  headers: Required<Pick<ApiHeaders, 'channelId'>>
): Promise<{ success: boolean } | null> {
  return apiRequestServer<{ success: boolean }>(
    {
      method: 'POST',
      url: buildApiUrl(`/api/community/posts/${postId}/comments/${commentId}/pin`),
      functionName: 'pinPostComment',
    },
    async () => ({
      
      channelId: headers.channelId,
      accessToken: (await getServerAuthContext())?.accessToken || '',
    }),
    true
  );
}

/**
 * Heart a comment (post owner only)
 * POST /api/community/posts/{postId}/comments/{commentId}/heart
 */
export async function heartPostComment(
  postId: string,
  commentId: string,
  headers: Required<Pick<ApiHeaders, 'channelId'>>
): Promise<{ success: boolean; hearted: boolean } | null> {
  return apiRequestServer<{ success: boolean; hearted: boolean }>(
    {
      method: 'POST',
      url: buildApiUrl(`/api/community/posts/${postId}/comments/${commentId}/heart`),
      functionName: 'heartPostComment',
    },
    async () => ({
      
      channelId: headers.channelId,
      accessToken: (await getServerAuthContext())?.accessToken || '',
    }),
    true
  );
}
