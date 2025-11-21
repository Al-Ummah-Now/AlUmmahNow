'use server';

import { LiveStream } from "@/interfaces";
import {
  ApiResponse,
  PaginationResponse,
  LiveStreamCreateRequest,
  LiveStreamUpdateRequest,
  LiveStreamQueryParams,
  ApiHeaders,
} from "./types";
import { getApiUrl } from "@/lib/runtime-config";
import { logger } from '@/lib/logger-server';


const baseUrl = getApiUrl();

/**
 * List Live Streams
 * GET /api/live-streams
 */
export async function listLiveStreams(
  params?: LiveStreamQueryParams,
  headers?: ApiHeaders
): Promise<ApiResponse<PaginationResponse<LiveStream>> | null> {
  try {
    const queryParams = new URLSearchParams();
    if (params?.limit) queryParams.append('limit', params.limit.toString());
    if (params?.cursor) queryParams.append('cursor', params.cursor);
    if (params?.status) queryParams.append('status', params.status);
    if (params?.channelId) queryParams.append('channelId', params.channelId);

    const response = await fetch(
      `${baseUrl}/api/live-streams?${queryParams.toString()}`,
      {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',

          ...(headers?.channelId && { 'channelId': headers.channelId }),
          ...(headers?.userId && { 'userId': headers.userId }),
        },
      }
    );

    if (!response.ok) {
      throw new Error(`Error fetching live streams: ${response.statusText}`);
    }

    return await response.json();
  } catch (error) {
    logger.error('listLiveStreams error:', error);
    return null;
  }
}

/**
 * Create a new Live Stream
 * POST /api/live-streams
 */
export async function createLiveStream(
  data: LiveStreamCreateRequest,
  authToken: string
): Promise<ApiResponse<{ stream: LiveStream }> | null> {
  // Input validation
  if (!authToken || authToken.trim() === '') {
    logger.error('createLiveStream: authToken is required');
    return null;
  }
  if (!data || typeof data !== 'object') {
    logger.error('createLiveStream: data is required and must be an object');
    return null;
  }

  try {
    const response = await fetch(
      `${baseUrl}/api/live-streams`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',

          'Authorization': `Bearer ${authToken}`,
        },
        body: JSON.stringify(data),
      }
    );

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({ error: 'Unknown error' }));
      throw new Error(errorData.error || `Error creating live stream: ${response.statusText}`);
    }

    return await response.json();
  } catch (error) {
    logger.error('createLiveStream error:', error);
    return null;
  }
}

/**
 * Update a Live Stream
 * PATCH /api/live-streams/{id}
 */
export async function updateLiveStream(
  streamId: string,
  data: LiveStreamUpdateRequest,
  authToken: string
): Promise<ApiResponse<{ stream: LiveStream }> | null> {
  // Input validation
  if (!streamId || streamId.trim() === '') {
    logger.error('updateLiveStream: streamId is required');
    return null;
  }
  if (!authToken || authToken.trim() === '') {
    logger.error('updateLiveStream: authToken is required');
    return null;
  }
  if (!data || typeof data !== 'object') {
    logger.error('updateLiveStream: data is required and must be an object');
    return null;
  }

  try {
    const response = await fetch(
      `${baseUrl}/api/live-streams/${streamId}`,
      {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',

          'Authorization': `Bearer ${authToken}`,
        },
        body: JSON.stringify(data),
      }
    );

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({ error: 'Unknown error' }));
      throw new Error(errorData.error || `Error updating live stream: ${response.statusText}`);
    }

    return await response.json();
  } catch (error) {
    logger.error('updateLiveStream error:', error);
    return null;
  }
}

/**
 * Go Live - Update stream status to 'live'
 */
export async function goLive(
  streamId: string,
  authToken: string
): Promise<ApiResponse<{ stream: LiveStream }> | null> {
  return updateLiveStream(
    streamId,
    { status: 'live', actualStartTime: new Date().toISOString() },
    authToken
  );
}

/**
 * End Live Stream - Update stream status to 'ended'
 */
export async function endLiveStream(
  streamId: string,
  authToken: string
): Promise<ApiResponse<{ stream: LiveStream }> | null> {
  return updateLiveStream(
    streamId,
    { status: 'ended', actualEndTime: new Date().toISOString() },
    authToken
  );
}

/**
 * Cancel Live Stream
 */
export async function cancelLiveStream(
  streamId: string,
  authToken: string
): Promise<ApiResponse<{ stream: LiveStream }> | null> {
  return updateLiveStream(
    streamId,
    { status: 'cancelled' },
    authToken
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

    if (!response || !response.success || !response.result) {
      return [];
    }

    return response.result.data || [];
  } catch (error) {
    logger.error('getLiveNow error:', error);
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

    if (!response || !response.success || !response.result) {
      return [];
    }

    return response.result.data || [];
  } catch (error) {
    logger.error('getScheduledStreams error:', error);
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
    logger.error('getStreamsByChannel: channelId is required');
    return [];
  }

  try {
    const response = await listLiveStreams({
      channelId,
      status,
      limit,
    });

    if (!response || !response.success || !response.result) {
      return [];
    }

    return response.result.data || [];
  } catch (error) {
    logger.error('getStreamsByChannel error:', error);
    return [];
  }
}
