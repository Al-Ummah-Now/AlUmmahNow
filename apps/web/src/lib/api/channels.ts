'use server';

import {
  ApiResponse,
  ApiHeaders,
  ListQueryParams,
  ChannelCreateRequest,
  ChannelUpdateRequest,
  SubscriptionRequest,
  PaginationResponse
} from "./types";
import { apiRequestServer, buildApiUrl, buildQueryParams } from "./api-client";
import { getServerAuthContext } from "./server-auth";

/**
 * List channels
 * GET /api/channels
 */
export async function listChannels(
  params?: ListQueryParams,
  _headers?: ApiHeaders
): Promise<PaginationResponse<any> | null> {
  const queryString = buildQueryParams({
    limit: params?.limit,
    cursor: params?.cursor
  });

  return apiRequestServer<PaginationResponse<any>>({
    method: 'GET',
    url: buildApiUrl(`/api/channels${queryString}`),
    functionName: 'listChannels'
  }, getServerAuthContext, false);
}

/**
 * List channels for a specific user
 * GET /api/channels?userId={userId}
 */
export async function listUserChannels(
  userId: string,
  params?: ListQueryParams
): Promise<PaginationResponse<any> | null> {
  const queryString = buildQueryParams({
    userId,
    limit: params?.limit,
    cursor: params?.cursor
  });

  return apiRequestServer<PaginationResponse<any>>({
    method: 'GET',
    url: buildApiUrl(`/api/channels${queryString}`),
    functionName: 'listUserChannels'
  }, getServerAuthContext, false);
}

/**
 * Get a channel by id
 * GET /api/channels/{id}
 */
export async function getChannelById(
  id: string,
  _headers?: ApiHeaders
): Promise<any | null> {
  return apiRequestServer<any>({
    method: 'GET',
    url: buildApiUrl(`/api/channels/${id}`),
    functionName: 'getChannelById'
  }, getServerAuthContext, false);
}

/**
 * Create a new channel
 * POST /api/channels
 */
export async function createChannel(
  data: ChannelCreateRequest,
  headers: Required<Pick<ApiHeaders, 'channelId' | 'userId'>>
): Promise<ApiResponse<{ channel: any }> | null> {
  return apiRequestServer<ApiResponse<{ channel: any }>>({
    method: 'POST',
    url: buildApiUrl('/api/channels'),
    body: data,
    functionName: 'createChannel'
  }, async () => ({
    userId: headers.userId,
    channelId: headers.channelId,
    accessToken: (await getServerAuthContext())?.accessToken || '',
  }), true);
}

/**
 * Update a channel
 * PUT /api/channels/{id}
 */
export async function updateChannel(
  id: string,
  data: ChannelUpdateRequest,
  headers: Required<Pick<ApiHeaders, 'channelId' | 'userId'>>
): Promise<ApiResponse<{ channel: any }> | null> {
  return apiRequestServer<ApiResponse<{ channel: any }>>({
    method: 'PUT',
    url: buildApiUrl(`/api/channels/${id}`),
    body: data,
    functionName: 'updateChannel'
  }, async () => ({
    userId: headers.userId,
    channelId: headers.channelId,
    accessToken: (await getServerAuthContext())?.accessToken || '',
  }), true);
}

/**
 * Delete a channel
 * DELETE /api/channels/{id}
 */
export async function deleteChannel(
  id: string,
  headers: Required<Pick<ApiHeaders, 'channelId' | 'userId'>>
): Promise<{ success: boolean } | null> {
  return apiRequestServer<{ success: boolean }>({
    method: 'DELETE',
    url: buildApiUrl(`/api/channels/${id}`),
    functionName: 'deleteChannel'
  }, async () => ({
    userId: headers.userId,
    channelId: headers.channelId,
    accessToken: (await getServerAuthContext())?.accessToken || '',
  }), true);
}

/**
 * Subscribe to a channel
 * POST /api/channels/{id}/subscribe
 */
export async function subscribeToChannel(
  channelId: string,
  data: SubscriptionRequest,
  headers: Required<Pick<ApiHeaders, 'channelId' | 'userId'>>
): Promise<{ success: boolean } | null> {
  return apiRequestServer<{ success: boolean }>({
    method: 'POST',
    url: buildApiUrl(`/api/channels/${channelId}/subscribe`),
    body: data,
    functionName: 'subscribeToChannel'
  }, async () => ({
    userId: headers.userId,
    channelId: headers.channelId,
    accessToken: (await getServerAuthContext())?.accessToken || '',
  }), true);
}

/**
 * Unsubscribe from a channel
 * DELETE /api/channels/{id}/subscribe
 */
export async function unsubscribeFromChannel(
  channelId: string,
  headers: Required<Pick<ApiHeaders, 'channelId' | 'userId'>>
): Promise<{ success: boolean } | null> {
  return apiRequestServer<{ success: boolean }>({
    method: 'DELETE',
    url: buildApiUrl(`/api/channels/${channelId}/subscribe`),
    functionName: 'unsubscribeFromChannel'
  }, async () => ({
    userId: headers.userId,
    channelId: headers.channelId,
    accessToken: (await getServerAuthContext())?.accessToken || '',
  }), true);
}
