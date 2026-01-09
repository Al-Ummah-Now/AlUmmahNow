'use server';

import { LiveStream } from "@al-ummah/shared-types";
import {
  ApiResponse,
  PaginationResponse,
  LiveStreamCreateRequest,
  LiveStreamUpdateRequest,
  LiveStreamQueryParams,
} from "./types";
import { apiRequestServer, buildApiUrl, buildQueryParams } from "./api-client";
import { getServerAuthContext } from "./server-auth";
import { logger } from '@/lib/logger-server';


/**
 * List Live Streams
 * GET /api/live-streams
 */
export async function listLiveStreams(
  params?: LiveStreamQueryParams
): Promise<ApiResponse<PaginationResponse<LiveStream>> | null> {
  const queryString = buildQueryParams({
    limit: params?.limit,
    cursor: params?.cursor,
    status: params?.status,
    channelId: params?.channelId
  });

  return apiRequestServer<ApiResponse<PaginationResponse<LiveStream>>>({
    method: 'GET',
    url: buildApiUrl(`/api/live-streams${queryString}`),
    functionName: 'listLiveStreams'
  }, getServerAuthContext, false);
}

/**
 * Create a new Live Stream
 * POST /api/live-streams
 */
export async function createLiveStream(
  data: LiveStreamCreateRequest
): Promise<ApiResponse<{ stream: LiveStream }> | null> {
  // Input validation
  if (!data || typeof data !== 'object') {
    logger.error('[createLiveStream] data is required and must be an object');
    return null;
  }

  return apiRequestServer<ApiResponse<{ stream: LiveStream }>>({
    method: 'POST',
    url: buildApiUrl('/api/live-streams'),
    body: data,
    functionName: 'createLiveStream'
  }, getServerAuthContext, true);
}

/**
 * Update a Live Stream
 * PATCH /api/live-streams/{id}
 */
export async function updateLiveStream(
  streamId: string,
  data: LiveStreamUpdateRequest
): Promise<ApiResponse<{ stream: LiveStream }> | null> {
  // Input validation
  if (!streamId || streamId.trim() === '') {
    logger.error('[updateLiveStream] streamId is required');
    return null;
  }
  if (!data || typeof data !== 'object') {
    logger.error('[updateLiveStream] data is required and must be an object');
    return null;
  }

  return apiRequestServer<ApiResponse<{ stream: LiveStream }>>({
    method: 'PATCH',
    url: buildApiUrl(`/api/live-streams/${streamId}`),
    body: data,
    functionName: 'updateLiveStream'
  }, getServerAuthContext, true);
}

/**
 * Go Live - Update stream status to 'live'
 */
export async function goLive(
  streamId: string
): Promise<ApiResponse<{ stream: LiveStream }> | null> {
  return updateLiveStream(
    streamId,
    { status: 'live', actualStartTime: new Date().toISOString() }
  );
}

/**
 * End Live Stream - Update stream status to 'ended'
 */
export async function endLiveStream(
  streamId: string
): Promise<ApiResponse<{ stream: LiveStream }> | null> {
  return updateLiveStream(
    streamId,
    { status: 'ended', actualEndTime: new Date().toISOString() }
  );
}

/**
 * Cancel Live Stream
 */
export async function cancelLiveStream(
  streamId: string
): Promise<ApiResponse<{ stream: LiveStream }> | null> {
  return updateLiveStream(
    streamId,
    { status: 'cancelled' }
  );
}

/**
 * Get currently live streams
 */
export async function getLiveNow(
  limit: number = 12
): Promise<LiveStream[]> {
  try {
    const response = await listLiveStreams({
      status: 'live',
      limit,
    });

    if (!response || !response.success || !response.data) {
      return [];
    }

    return response.data.data || [];
  } catch (error) {
    logger.error('[getLiveNow] Error:', error);
    return [];
  }
}

/**
 * Get scheduled streams
 */
export async function getScheduledStreams(
  limit: number = 12
): Promise<LiveStream[]> {
  try {
    const response = await listLiveStreams({
      status: 'scheduled',
      limit,
    });

    if (!response || !response.success || !response.data) {
      return [];
    }

    return response.data.data || [];
  } catch (error) {
    logger.error('[getScheduledStreams] Error:', error);
    return [];
  }
}

/**
 * Get streams by channel
 */
export async function getStreamsByChannel(
  channelId: string,
  status?: 'scheduled' | 'live' | 'ended' | 'cancelled',
  limit: number = 20
): Promise<LiveStream[]> {
  // Input validation
  if (!channelId || channelId.trim() === '') {
    logger.error('[getStreamsByChannel] channelId is required');
    return [];
  }

  try {
    const response = await listLiveStreams({
      channelId,
      status,
      limit,
    });

    if (!response || !response.success || !response.data) {
      return [];
    }

    return response.data.data || [];
  } catch (error) {
    logger.error('[getStreamsByChannel] Error:', error);
    return [];
  }
}
