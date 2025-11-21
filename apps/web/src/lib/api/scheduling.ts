'use server';

import {
  VideoScheduleResponse,
  ScheduledVideoListResponse,
} from '@al-ummah/shared-types';
import { apiRequestServer, buildApiUrl } from './api-client';
import { getServerAuthContext } from './server-auth';
import { ApiHeaders } from './types';
import { logger } from '@/lib/logger-client';

/**
 * Schedule a video for automatic publication
 * POST /api/videos/:id/schedule
 */
export async function scheduleVideo(
  videoId: string,
  scheduledPublishDate: string,
  timezone: string,
  notifyOnPublish: boolean = true,
  headers: Required<Pick<ApiHeaders, 'channelId' | 'userId'>>
): Promise<{
  success: boolean;
  result?: VideoScheduleResponse;
  error?: string;
} | null> {
  try {
    logger.info('[scheduleVideo] Scheduling video', {
      videoId,
      scheduledPublishDate,
      timezone,
      notifyOnPublish,
    });

    return apiRequestServer<{
      success: boolean;
      result?: VideoScheduleResponse;
      error?: string;
    }>(
      {
        method: 'POST',
        url: buildApiUrl(`/api/videos/${videoId}/schedule`),
        body: {
          scheduledPublishDate,
          timezone,
          notifyOnPublish,
        },
        functionName: 'scheduleVideo',
      },
      async () => ({
        userId: headers.userId,
        channelId: headers.channelId,
        accessToken: (await getServerAuthContext())?.accessToken || '',
      }),
      true
    );
  } catch (error) {
    logger.error('[scheduleVideo] Error scheduling video', { error, videoId });
    return null;
  }
}

/**
 * Update scheduled publish date for a video
 * PUT /api/videos/:id/schedule
 */
export async function updateSchedule(
  videoId: string,
  scheduledPublishDate: string,
  timezone: string,
  headers: Required<Pick<ApiHeaders, 'channelId' | 'userId'>>,
  notifyOnPublish?: boolean
): Promise<{
  success: boolean;
  result?: VideoScheduleResponse;
  error?: string;
} | null> {
  try {
    logger.info('[updateSchedule] Updating video schedule', {
      videoId,
      scheduledPublishDate,
      timezone,
    });

    return apiRequestServer<{
      success: boolean;
      result?: VideoScheduleResponse;
      error?: string;
    }>(
      {
        method: 'PUT',
        url: buildApiUrl(`/api/videos/${videoId}/schedule`),
        body: {
          scheduledPublishDate,
          timezone,
          ...(notifyOnPublish !== undefined && { notifyOnPublish }),
        },
        functionName: 'updateSchedule',
      },
      async () => ({
        userId: headers.userId,
        channelId: headers.channelId,
        accessToken: (await getServerAuthContext())?.accessToken || '',
      }),
      true
    );
  } catch (error) {
    logger.error('[updateSchedule] Error updating schedule', { error, videoId });
    return null;
  }
}

/**
 * Cancel scheduled publication
 * DELETE /api/videos/:id/schedule
 */
export async function cancelSchedule(
  videoId: string,
  headers: Required<Pick<ApiHeaders, 'channelId' | 'userId'>>
): Promise<{
  success: boolean;
  result?: { message: string };
  error?: string;
} | null> {
  try {
    logger.info('[cancelSchedule] Canceling video schedule', { videoId });

    return apiRequestServer<{
      success: boolean;
      result?: { message: string };
      error?: string;
    }>(
      {
        method: 'DELETE',
        url: buildApiUrl(`/api/videos/${videoId}/schedule`),
        functionName: 'cancelSchedule',
      },
      async () => ({
        userId: headers.userId,
        channelId: headers.channelId,
        accessToken: (await getServerAuthContext())?.accessToken || '',
      }),
      true
    );
  } catch (error) {
    logger.error('[cancelSchedule] Error canceling schedule', { error, videoId });
    return null;
  }
}

/**
 * Publish a scheduled video immediately
 * POST /api/videos/:id/publish-now
 */
export async function publishNow(
  videoId: string,
  headers: Required<Pick<ApiHeaders, 'channelId' | 'userId'>>
): Promise<{
  success: boolean;
  result?: { message: string; videoId: string };
  error?: string;
} | null> {
  try {
    logger.info('[publishNow] Publishing video immediately', { videoId });

    return apiRequestServer<{
      success: boolean;
      result?: { message: string; videoId: string };
      error?: string;
    }>(
      {
        method: 'POST',
        url: buildApiUrl(`/api/videos/${videoId}/publish-now`),
        functionName: 'publishNow',
      },
      async () => ({
        userId: headers.userId,
        channelId: headers.channelId,
        accessToken: (await getServerAuthContext())?.accessToken || '',
      }),
      true
    );
  } catch (error) {
    logger.error('[publishNow] Error publishing video', { error, videoId });
    return null;
  }
}

/**
 * List all scheduled videos for the authenticated user
 * GET /api/videos/scheduled
 */
export async function listScheduledVideos(
  headers: Required<Pick<ApiHeaders, 'channelId' | 'userId'>>,
  params?: {
    limit?: number;
    cursor?: string;
    status?: 'scheduled' | 'publishing' | 'published' | 'failed' | 'cancelled';
  }
): Promise<{
  success: boolean;
  result?: ScheduledVideoListResponse;
  error?: string;
} | null> {
  try {
    logger.info('[listScheduledVideos] Fetching scheduled videos', params);

    const queryParams = new URLSearchParams();
    if (params?.limit) queryParams.append('limit', params.limit.toString());
    if (params?.cursor) queryParams.append('cursor', params.cursor);
    if (params?.status) queryParams.append('status', params.status);

    const url = buildApiUrl(
      `/api/videos/scheduled${queryParams.toString() ? `?${queryParams.toString()}` : ''}`
    );

    return apiRequestServer<{
      success: boolean;
      result?: ScheduledVideoListResponse;
      error?: string;
    }>(
      {
        method: 'GET',
        url,
        functionName: 'listScheduledVideos',
      },
      async () => ({
        userId: headers.userId,
        channelId: headers.channelId,
        accessToken: (await getServerAuthContext())?.accessToken || '',
      }),
      true
    );
  } catch (error) {
    logger.error('[listScheduledVideos] Error fetching scheduled videos', { error });
    return null;
  }
}

/**
 * Get schedule details for a specific video
 * GET /api/videos/:id/schedule
 */
export async function getVideoSchedule(
  videoId: string,
  headers: Required<Pick<ApiHeaders, 'channelId' | 'userId'>>
): Promise<{
  success: boolean;
  result?: VideoScheduleResponse;
  error?: string;
} | null> {
  try {
    logger.info('[getVideoSchedule] Fetching video schedule', { videoId });

    return apiRequestServer<{
      success: boolean;
      result?: VideoScheduleResponse;
      error?: string;
    }>(
      {
        method: 'GET',
        url: buildApiUrl(`/api/videos/${videoId}/schedule`),
        functionName: 'getVideoSchedule',
      },
      async () => ({
        userId: headers.userId,
        channelId: headers.channelId,
        accessToken: (await getServerAuthContext())?.accessToken || '',
      }),
      true
    );
  } catch (error) {
    logger.error('[getVideoSchedule] Error fetching schedule', { error, videoId });
    return null;
  }
}
