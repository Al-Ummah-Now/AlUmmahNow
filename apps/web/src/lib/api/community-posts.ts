'use server';

import {
  CommunityPost,
  ListCommunityPostsParams,
  ListCommunityPostsResponse,
  VoteOnPollRequest,
  VoteOnPollResponse,
  LikePostResponse,
  CreateCommunityPostRequest,
  UpdateCommunityPostRequest,
} from "@al-ummah/shared-types";
import { apiRequestServer, buildApiUrl, buildQueryParams } from "./api-client";
import { getServerAuthContext } from "./server-auth";
import { logger } from "@/lib/logger-server";
import { ApiHeaders } from "./types";

/**
 * List community posts for a channel
 * GET /api/community/channels/{channelId}/posts?page={page}&limit={limit}&type={type}
 */
export async function listCommunityPosts(
  params: ListCommunityPostsParams,
  headers?: Pick<ApiHeaders, 'channelId'>
): Promise<ListCommunityPostsResponse | null> {
  const queryString = buildQueryParams({
    page: params.page || 1,
    limit: params.limit || 20,
    type: params.type,
    status: params.status,
  });

  return apiRequestServer<ListCommunityPostsResponse>({
    method: 'GET',
    url: buildApiUrl(`/api/community/channels/${params.channelId}/posts${queryString}`),
    functionName: 'listCommunityPosts'
  }, async () => ({
    channelId: headers?.channelId,
    accessToken: (await getServerAuthContext())?.accessToken || '',
  }), false);
}

/**
 * Get a single community post by ID
 * GET /api/community/channels/{channelId}/posts/{postId}
 */
export async function getCommunityPost(
  channelId: string,
  postId: string,
  headers?: Pick<ApiHeaders, 'channelId'>
): Promise<CommunityPost | null> {
  return apiRequestServer<CommunityPost>({
    method: 'GET',
    url: buildApiUrl(`/api/community/channels/${channelId}/posts/${postId}`),
    functionName: 'getCommunityPost'
  }, async () => ({
    channelId: headers?.channelId,
    accessToken: (await getServerAuthContext())?.accessToken || '',
  }), false);
}

/**
 * Create a new community post
 * POST /api/community/channels/{channelId}/posts
 */
export async function createCommunityPost(
  channelId: string,
  data: CreateCommunityPostRequest,
  headers: Required<Pick<ApiHeaders, 'channelId'>>
): Promise<{ success: boolean; post: CommunityPost } | null> {
  return apiRequestServer<{ success: boolean; post: CommunityPost }>({
    method: 'POST',
    url: buildApiUrl(`/api/community/channels/${channelId}/posts`),
    body: data,
    functionName: 'createCommunityPost'
  }, async () => ({
    channelId: headers.channelId,
    accessToken: (await getServerAuthContext())?.accessToken || '',
  }), true);
}

/**
 * Update a community post
 * PUT /api/community/channels/{channelId}/posts/{postId}
 */
export async function updateCommunityPost(
  channelId: string,
  postId: string,
  data: UpdateCommunityPostRequest,
  headers: Required<Pick<ApiHeaders, 'channelId'>>
): Promise<{ success: boolean; post: CommunityPost } | null> {
  return apiRequestServer<{ success: boolean; post: CommunityPost }>({
    method: 'PUT',
    url: buildApiUrl(`/api/community/channels/${channelId}/posts/${postId}`),
    body: data,
    functionName: 'updateCommunityPost'
  }, async () => ({

    channelId: headers.channelId,
    accessToken: (await getServerAuthContext())?.accessToken || '',
  }), true);
}

/**
 * Delete a community post
 * DELETE /api/community/channels/{channelId}/posts/{postId}
 */
export async function deleteCommunityPost(
  channelId: string,
  postId: string,
  headers: Required<Pick<ApiHeaders, 'channelId'>>
): Promise<{ success: boolean } | null> {
  return apiRequestServer<{ success: boolean }>({
    method: 'DELETE',
    url: buildApiUrl(`/api/community/channels/${channelId}/posts/${postId}`),
    functionName: 'deleteCommunityPost'
  }, async () => ({

    channelId: headers.channelId,
    accessToken: (await getServerAuthContext())?.accessToken || '',
  }), true);
}

/**
 * Like a community post
 * POST /api/community/channels/{channelId}/posts/{postId}/like
 */
export async function likeCommunityPost(
  channelId: string,
  postId: string,
  headers: Required<Pick<ApiHeaders, 'channelId'>>
): Promise<LikePostResponse | null> {
  return apiRequestServer<LikePostResponse>({
    method: 'POST',
    url: buildApiUrl(`/api/community/channels/${channelId}/posts/${postId}/like`),
    functionName: 'likeCommunityPost'
  }, async () => ({

    channelId: headers.channelId,
    accessToken: (await getServerAuthContext())?.accessToken || '',
  }), true);
}

/**
 * Unlike a community post
 * DELETE /api/community/channels/{channelId}/posts/{postId}/like
 */
export async function unlikeCommunityPost(
  channelId: string,
  postId: string,
  headers: Required<Pick<ApiHeaders, 'channelId'>>
): Promise<LikePostResponse | null> {
  return apiRequestServer<LikePostResponse>({
    method: 'DELETE',
    url: buildApiUrl(`/api/community/channels/${channelId}/posts/${postId}/like`),
    functionName: 'unlikeCommunityPost'
  }, async () => ({

    channelId: headers.channelId,
    accessToken: (await getServerAuthContext())?.accessToken || '',
  }), true);
}

/**
 * Vote on a poll post
 * POST /api/community/channels/{channelId}/posts/{postId}/vote
 */
export async function voteOnPoll(
  channelId: string,
  postId: string,
  data: VoteOnPollRequest,
  headers: Required<Pick<ApiHeaders, 'channelId'>>
): Promise<VoteOnPollResponse | null> {
  return apiRequestServer<VoteOnPollResponse>({
    method: 'POST',
    url: buildApiUrl(`/api/community/channels/${channelId}/posts/${postId}/vote`),
    body: data,
    functionName: 'voteOnPoll'
  }, async () => ({

    channelId: headers.channelId,
    accessToken: (await getServerAuthContext())?.accessToken || '',
  }), true);
}

/**
 * Get poll results
 * GET /api/community/channels/{channelId}/posts/{postId}/results
 */
export async function getPollResults(
  channelId: string,
  postId: string,
  headers?: Pick<ApiHeaders, 'channelId'>
): Promise<VoteOnPollResponse | null> {
  return apiRequestServer<VoteOnPollResponse>({
    method: 'GET',
    url: buildApiUrl(`/api/community/channels/${channelId}/posts/${postId}/results`),
    functionName: 'getPollResults'
  }, async () => ({
    channelId: headers?.channelId,
    accessToken: (await getServerAuthContext())?.accessToken || '',
  }), false);
}

/** One uploaded community image (POST /api/community/media/upload/images). */
export interface UploadedCommunityImage {
  url: string;
  width: number;
  height: number;
  size: number;
  mimeType: string;
}

/**
 * Upload images for a post (covers, cards, image posts). `formData` carries the files under
 * `images`. Resolves to their URLs, or null when the upload failed (the caller shows its own text).
 */
export async function uploadCommunityImages(
  channelId: string,
  formData: FormData
): Promise<UploadedCommunityImage[] | null> {
  const authContext = await getServerAuthContext();
  try {
    const response = await fetch(buildApiUrl('/api/community/media/upload/images'), {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${authContext?.accessToken || ''}`,
        channelId,
      },
      body: formData,
    });
    if (!response.ok) {
      logger.warn('[uploadCommunityImages] upload refused', { channelId, status: response.status });
      return null;
    }
    const body = (await response.json()) as { images?: UploadedCommunityImage[] };
    return Array.isArray(body.images) ? body.images : null;
  } catch (error) {
    logger.error('[uploadCommunityImages] upload failed', { channelId, error });
    return null;
  }
}
