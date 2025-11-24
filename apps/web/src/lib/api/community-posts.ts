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
import { ApiHeaders } from "./types";

/**
 * List community posts for a channel
 * GET /api/community/posts?channelId={channelId}&page={page}&limit={limit}&type={type}
 */
export async function listCommunityPosts(
  params: ListCommunityPostsParams
): Promise<ListCommunityPostsResponse | null> {
  const queryString = buildQueryParams({
    channelId: params.channelId,
    page: params.page || 1,
    limit: params.limit || 20,
    type: params.type,
    status: params.status,
  });

  return apiRequestServer<ListCommunityPostsResponse>({
    method: 'GET',
    url: buildApiUrl(`/api/community/posts${queryString}`),
    functionName: 'listCommunityPosts'
  }, getServerAuthContext, false);
}

/**
 * Get a single community post by ID
 * GET /api/community/posts/{postId}
 */
export async function getCommunityPost(
  postId: string
): Promise<CommunityPost | null> {
  return apiRequestServer<CommunityPost>({
    method: 'GET',
    url: buildApiUrl(`/api/community/posts/${postId}`),
    functionName: 'getCommunityPost'
  }, getServerAuthContext, false);
}

/**
 * Create a new community post
 * POST /api/community/posts
 */
export async function createCommunityPost(
  data: CreateCommunityPostRequest,
  headers: Required<Pick<ApiHeaders, 'channelId' | 'userId'>>
): Promise<{ success: boolean; post: CommunityPost } | null> {
  return apiRequestServer<{ success: boolean; post: CommunityPost }>({
    method: 'POST',
    url: buildApiUrl('/api/community/posts'),
    body: data,
    functionName: 'createCommunityPost'
  }, async () => ({
    userId: headers.userId,
    channelId: headers.channelId,
    accessToken: (await getServerAuthContext())?.accessToken || '',
  }), true);
}

/**
 * Update a community post
 * PUT /api/community/posts/{postId}
 */
export async function updateCommunityPost(
  postId: string,
  data: UpdateCommunityPostRequest,
  headers: Required<Pick<ApiHeaders, 'channelId' | 'userId'>>
): Promise<{ success: boolean; post: CommunityPost } | null> {
  return apiRequestServer<{ success: boolean; post: CommunityPost }>({
    method: 'PUT',
    url: buildApiUrl(`/api/community/posts/${postId}`),
    body: data,
    functionName: 'updateCommunityPost'
  }, async () => ({
    userId: headers.userId,
    channelId: headers.channelId,
    accessToken: (await getServerAuthContext())?.accessToken || '',
  }), true);
}

/**
 * Delete a community post
 * DELETE /api/community/posts/{postId}
 */
export async function deleteCommunityPost(
  postId: string,
  headers: Required<Pick<ApiHeaders, 'channelId' | 'userId'>>
): Promise<{ success: boolean } | null> {
  return apiRequestServer<{ success: boolean }>({
    method: 'DELETE',
    url: buildApiUrl(`/api/community/posts/${postId}`),
    functionName: 'deleteCommunityPost'
  }, async () => ({
    userId: headers.userId,
    channelId: headers.channelId,
    accessToken: (await getServerAuthContext())?.accessToken || '',
  }), true);
}

/**
 * Like a community post
 * POST /api/community/posts/{postId}/like
 */
export async function likeCommunityPost(
  postId: string,
  headers: Required<Pick<ApiHeaders, 'channelId' | 'userId'>>
): Promise<LikePostResponse | null> {
  return apiRequestServer<LikePostResponse>({
    method: 'POST',
    url: buildApiUrl(`/api/community/posts/${postId}/like`),
    functionName: 'likeCommunityPost'
  }, async () => ({
    userId: headers.userId,
    channelId: headers.channelId,
    accessToken: (await getServerAuthContext())?.accessToken || '',
  }), true);
}

/**
 * Unlike a community post
 * DELETE /api/community/posts/{postId}/like
 */
export async function unlikeCommunityPost(
  postId: string,
  headers: Required<Pick<ApiHeaders, 'channelId' | 'userId'>>
): Promise<LikePostResponse | null> {
  return apiRequestServer<LikePostResponse>({
    method: 'DELETE',
    url: buildApiUrl(`/api/community/posts/${postId}/like`),
    functionName: 'unlikeCommunityPost'
  }, async () => ({
    userId: headers.userId,
    channelId: headers.channelId,
    accessToken: (await getServerAuthContext())?.accessToken || '',
  }), true);
}

/**
 * Vote on a poll post
 * POST /api/community/posts/{channelId}/{postId}/vote
 */
export async function voteOnPoll(
  channelId: string,
  postId: string,
  data: VoteOnPollRequest,
  headers: Required<Pick<ApiHeaders, 'channelId' | 'userId'>>
): Promise<VoteOnPollResponse | null> {
  return apiRequestServer<VoteOnPollResponse>({
    method: 'POST',
    url: buildApiUrl(`/api/community/posts/${channelId}/${postId}/vote`),
    body: data,
    functionName: 'voteOnPoll'
  }, async () => ({
    userId: headers.userId,
    channelId: headers.channelId,
    accessToken: (await getServerAuthContext())?.accessToken || '',
  }), true);
}

/**
 * Get poll results
 * GET /api/community/posts/{postId}/results
 */
export async function getPollResults(
  postId: string
): Promise<VoteOnPollResponse | null> {
  return apiRequestServer<VoteOnPollResponse>({
    method: 'GET',
    url: buildApiUrl(`/api/community/posts/${postId}/results`),
    functionName: 'getPollResults'
  }, getServerAuthContext, false);
}
