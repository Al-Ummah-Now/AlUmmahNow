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

// Validation patterns
const CURSOR_PATTERN = /^[a-zA-Z0-9_-]+$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const VALID_STATUSES = ['live', 'scheduled', 'ended', 'cancelled'] as const;
const MAX_LIMIT = 100;

/**
 * Validate and sanitize livestream query parameters
 */
function validateQueryParams(params?: LiveStreamQueryParams): {
  limit?: number;
  cursor?: string;
  status?: string;
  channelId?: string;
} {
  const validated: {
    limit?: number;
    cursor?: string;
    status?: string;
    channelId?: string;
  } = {};

  if (params?.limit !== undefined) {
    const limitNum = typeof params.limit === 'string' ? parseInt(params.limit, 10) : params.limit;
    if (typeof limitNum === 'number' && !isNaN(limitNum) && limitNum > 0 && limitNum <= MAX_LIMIT) {
      validated.limit = limitNum;
    } else {
      logger.warn('[listLiveStreams] Invalid limit parameter, must be a positive number <= 100', {
        provided: params.limit
      });
    }
  }

  if (params?.cursor !== undefined) {
    if (typeof params.cursor === 'string' && CURSOR_PATTERN.test(params.cursor)) {
      validated.cursor = params.cursor;
    } else {
      logger.warn('[listLiveStreams] Invalid cursor parameter, must be alphanumeric', {
        provided: params.cursor
      });
    }
  }

  if (params?.status !== undefined) {
    if (typeof params.status === 'string' && VALID_STATUSES.includes(params.status as typeof VALID_STATUSES[number])) {
      validated.status = params.status;
    } else {
      logger.warn('[listLiveStreams] Invalid status parameter, must be one of: live, scheduled, ended, cancelled', {
        provided: params.status
      });
    }
  }

  if (params?.channelId !== undefined) {
    if (typeof params.channelId === 'string' && UUID_PATTERN.test(params.channelId)) {
      validated.channelId = params.channelId;
    } else {
      logger.warn('[listLiveStreams] Invalid channelId parameter, must be a valid UUID', {
        provided: params.channelId
      });
    }
  }

  return validated;
}

/**
 * List Live Streams
 * GET /api/live-streams
 */
export async function listLiveStreams(
  params?: LiveStreamQueryParams
): Promise<ApiResponse<PaginationResponse<LiveStream>> | null> {
  const validatedParams = validateQueryParams(params);

  const queryString = buildQueryParams({
    limit: validatedParams.limit,
    cursor: validatedParams.cursor,
    status: validatedParams.status,
    channelId: validatedParams.channelId
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
