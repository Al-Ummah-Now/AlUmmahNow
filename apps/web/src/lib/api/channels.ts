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
import { Channel, VideoObject, Playlist } from "@al-ummah/shared-types";
import { logger } from '@/lib/logger-server';


/**
 * List channels
 * GET /api/channels
 */
export async function listChannels(
  params?: ListQueryParams,
  _headers?: ApiHeaders
): Promise<PaginationResponse<Channel> | null> {
  const queryString = buildQueryParams({
    limit: params?.limit,
    cursor: params?.cursor
  });

  return apiRequestServer<PaginationResponse<Channel>>({
    method: 'GET',
    url: buildApiUrl(`/api/channels${queryString}`),
    functionName: 'listChannels'
  }, getServerAuthContext, false);
}

/**
 * List channels for the authenticated user
 * GET /api/channels (userId extracted from JWT token)
 */
export async function listUserChannels(
  params?: ListQueryParams
): Promise<PaginationResponse<Channel> | null> {
  const queryString = buildQueryParams({
    limit: params?.limit,
    cursor: params?.cursor
  });

  return apiRequestServer<PaginationResponse<Channel>>({
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
): Promise<Channel | null> {
  return apiRequestServer<Channel>({
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
  headers: Required<Pick<ApiHeaders, 'channelId'>>
): Promise<ApiResponse<{ channel: Channel }> | null> {
  return apiRequestServer<ApiResponse<{ channel: Channel }>>({
    method: 'POST',
    url: buildApiUrl('/api/channels'),
    body: data,
    functionName: 'createChannel'
  }, async () => ({
    
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
  headers: Required<Pick<ApiHeaders, 'channelId'>>
): Promise<ApiResponse<{ channel: Channel }> | null> {
  return apiRequestServer<ApiResponse<{ channel: Channel }>>({
    method: 'PUT',
    url: buildApiUrl(`/api/channels/${id}`),
    body: data,
    functionName: 'updateChannel'
  }, async () => ({
    
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
  headers: Required<Pick<ApiHeaders, 'channelId'>>
): Promise<{ success: boolean } | null> {
  return apiRequestServer<{ success: boolean }>({
    method: 'DELETE',
    url: buildApiUrl(`/api/channels/${id}`),
    functionName: 'deleteChannel'
  }, async () => ({
    
    channelId: headers.channelId,
    accessToken: (await getServerAuthContext())?.accessToken || '',
  }), true);
}

export interface SubscriptionStatusResponse {
  success: boolean;
  result?: {
    channelId: string;
    isSubscribed: boolean;
    subscriberCount: number;
  };
  error?: string;
}

/**
 * Resolve the subscriber channel: the session's active channel wins over a
 * caller-supplied id (which may be stale), so the API's channel ownership
 * check passes.
 */
async function subscriberAuthContext(fallbackChannelId?: string) {
  const auth = await getServerAuthContext();
  return {
    channelId: auth?.channelId || fallbackChannelId || '',
    accessToken: auth?.accessToken || '',
  };
}

/**
 * Subscribe to a channel
 * POST /api/channels/{id}/subscriptions
 */
export async function subscribeToChannel(
  channelId: string,
  data: SubscriptionRequest,
  headers?: Pick<ApiHeaders, 'channelId'>
): Promise<SubscriptionStatusResponse | null> {
  return apiRequestServer<SubscriptionStatusResponse>({
    method: 'POST',
    url: buildApiUrl(`/api/channels/${channelId}/subscriptions`),
    body: data,
    functionName: 'subscribeToChannel'
  }, () => subscriberAuthContext(headers?.channelId), true);
}

/**
 * Unsubscribe from a channel
 * DELETE /api/channels/{id}/subscriptions
 */
export async function unsubscribeFromChannel(
  channelId: string,
  headers?: Pick<ApiHeaders, 'channelId'>
): Promise<SubscriptionStatusResponse | null> {
  return apiRequestServer<SubscriptionStatusResponse>({
    method: 'DELETE',
    url: buildApiUrl(`/api/channels/${channelId}/subscriptions`),
    functionName: 'unsubscribeFromChannel'
  }, () => subscriberAuthContext(headers?.channelId), true);
}

/**
 * Subscription status of the active account for a channel
 * GET /api/channels/{id}/subscriptions/status
 */
export async function getChannelSubscriptionStatus(
  channelId: string
): Promise<SubscriptionStatusResponse | null> {
  return apiRequestServer<SubscriptionStatusResponse>({
    method: 'GET',
    url: buildApiUrl(`/api/channels/${channelId}/subscriptions/status`),
    functionName: 'getChannelSubscriptionStatus'
  }, () => subscriberAuthContext(), false);
}

export interface SubscriptionFeedResponse {
  success: boolean;
  data: VideoObject[];
  cursor: string | null;
  total: number;
}

/**
 * Videos from channels the active account is subscribed to (newest first)
 * GET /api/profile/subscriptions/feed
 */
export async function getSubscriptionFeed(
  params?: { limit?: number; cursor?: string | null }
): Promise<SubscriptionFeedResponse | null> {
  const queryString = buildQueryParams({
    limit: params?.limit,
    cursor: params?.cursor || undefined,
  });

  return apiRequestServer<SubscriptionFeedResponse>({
    method: 'GET',
    url: buildApiUrl(`/api/profile/subscriptions/feed${queryString}`),
    functionName: 'getSubscriptionFeed'
  }, getServerAuthContext, true);
}

/**
 * Update channel avatar
 * PUT /api/channels/{id}/avatar
 */
export async function updateChannelAvatar(
  channelId: string,
  file: File,
  headers: Required<Pick<ApiHeaders, 'channelId'>>
): Promise<Channel | null> {
  const formData = new FormData();
  formData.append('photo', file);

  const authContext = await getServerAuthContext();

  logger.info('[updateChannelAvatar] Auth context', {
    hasToken: !!authContext?.accessToken,
    tokenLength: authContext?.accessToken?.length,

    channelId: authContext?.channelId,
    headersChannelId: headers.channelId,
  });

  const requestHeaders = {
    'Authorization': `Bearer ${authContext?.accessToken || ''}`,
    'channelId': headers.channelId,
  };

  logger.info('[updateChannelAvatar] Request headers', {
    hasAuth: requestHeaders.Authorization.length > 10,
    channelId: requestHeaders.channelId,
    
  });

  const response = await fetch(buildApiUrl(`/api/channels/${channelId}/avatar`), {
    method: 'PUT',
    headers: requestHeaders,
    body: formData,
  });

  logger.info('[updateChannelAvatar] Response', {
    status: response.status,
    statusText: response.statusText,
    ok: response.ok,
  });

  if (!response.ok) {
    const errorText = await response.text();
    logger.error('[updateChannelAvatar] Failed', {
      status: response.status,
      statusText: response.statusText,
      errorBody: errorText,
    });
    return null;
  }

  return response.json();
}

/**
 * Update channel cover
 * PUT /api/channels/{id}/cover
 */
export async function updateChannelCover(
  channelId: string,
  file: File,
  headers: Required<Pick<ApiHeaders, 'channelId'>>
): Promise<Channel | null> {
  const formData = new FormData();
  formData.append('photo', file);

  const authContext = await getServerAuthContext();

  logger.info('[updateChannelCover] Auth context', {
    hasToken: !!authContext?.accessToken,
    tokenLength: authContext?.accessToken?.length,

    channelId: authContext?.channelId,
    headersChannelId: headers.channelId,
  });

  const requestHeaders = {
    'Authorization': `Bearer ${authContext?.accessToken || ''}`,
    'channelId': headers.channelId,
  };

  logger.info('[updateChannelCover] Request headers', {
    hasAuth: requestHeaders.Authorization.length > 10,
    channelId: requestHeaders.channelId,
    
  });

  const response = await fetch(buildApiUrl(`/api/channels/${channelId}/cover`), {
    method: 'PUT',
    headers: requestHeaders,
    body: formData,
  });

  logger.info('[updateChannelCover] Response', {
    status: response.status,
    statusText: response.statusText,
    ok: response.ok,
  });

  if (!response.ok) {
    const errorText = await response.text();
    logger.error('[updateChannelCover] Failed', {
      status: response.status,
      statusText: response.statusText,
      errorBody: errorText,
    });
    return null;
  }

  return response.json();
}

/**
 * Get channel videos
 * GET /api/channels/{id}/videos
 */
export async function getChannelVideos(
  channelId: string,
  params?: ListQueryParams
): Promise<PaginationResponse<VideoObject> | null> {
  const queryString = buildQueryParams({
    limit: params?.limit,
    cursor: params?.cursor
  });

  return apiRequestServer<PaginationResponse<VideoObject>>({
    method: 'GET',
    url: buildApiUrl(`/api/channels/${channelId}/videos${queryString}`),
    functionName: 'getChannelVideos'
  }, getServerAuthContext, false);
}

/**
 * Get channel shorts
 * GET /api/channels/{id}/shorts
 */
export async function getChannelShorts(
  channelId: string,
  params?: ListQueryParams
): Promise<PaginationResponse<VideoObject> | null> {
  const queryString = buildQueryParams({
    limit: params?.limit,
    cursor: params?.cursor
  });

  return apiRequestServer<PaginationResponse<VideoObject>>({
    method: 'GET',
    url: buildApiUrl(`/api/channels/${channelId}/shorts${queryString}`),
    functionName: 'getChannelShorts'
  }, getServerAuthContext, false);
}

/**
 * Get channel live streams
 * GET /api/channels/{id}/live
 */
export async function getChannelLiveStreams(
  channelId: string,
  params?: ListQueryParams & { active?: boolean }
): Promise<PaginationResponse<VideoObject> | null> {
  const queryString = buildQueryParams({
    limit: params?.limit,
    cursor: params?.cursor,
    active: params?.active
  });

  return apiRequestServer<PaginationResponse<VideoObject>>({
    method: 'GET',
    url: buildApiUrl(`/api/channels/${channelId}/live${queryString}`),
    functionName: 'getChannelLiveStreams'
  }, getServerAuthContext, false);
}

/**
 * Get channel playlists
 * GET /api/channels/{id}/playlists
 */
export async function getChannelPlaylists(
  channelId: string,
  params?: ListQueryParams
): Promise<PaginationResponse<Playlist> | null> {
  const queryString = buildQueryParams({
    limit: params?.limit,
    cursor: params?.cursor
  });

  return apiRequestServer<PaginationResponse<Playlist>>({
    method: 'GET',
    url: buildApiUrl(`/api/channels/${channelId}/playlists${queryString}`),
    functionName: 'getChannelPlaylists'
  }, getServerAuthContext, false);
}

/**
 * Get user's subscriptions (channels they're subscribed to)
 * GET /api/profile/subscriptions
 */
export async function getUserSubscriptions(
  params?: { page?: number; pageSize?: number }
): Promise<{
  success: boolean;
  data: Channel[];
  total: number;
  page: number;
  pageSize: number;
} | null> {
  const queryString = buildQueryParams({
    page: params?.page,
    pageSize: params?.pageSize
  });

  return apiRequestServer<{
    success: boolean;
    data: Channel[];
    total: number;
    page: number;
    pageSize: number;
  }>({
    method: 'GET',
    url: buildApiUrl(`/api/profile/subscriptions${queryString}`),
    functionName: 'getUserSubscriptions'
  }, getServerAuthContext, true);
}
