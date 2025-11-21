import { OpenAPIRoute, Str, Num } from 'chanfana';
import { z } from 'zod';
import { addAuthToSchema } from '../../lib/openapi-auth';
import { ResponseError } from '../../lib/types';
import R2Repository from '../../lib/r2Repo';
import type { VideoObject, ScheduledVideoInfo } from '@al-ummah/shared-types';
import { logger } from '../../lib/logger';

const ScheduledVideoInfoSchema = z.object({
  videoId: Str(),
  title: Str(),
  thumbnailUrl: Str(),
  scheduledPublishDate: Str(),
  localScheduledDate: Str(),
  timezone: Str(),
  status: z.enum(['scheduled', 'publishing', 'published', 'failed', 'cancelled']),
  timeRemaining: Str().optional(),
  canEdit: z.boolean(),
  canCancel: z.boolean(),
});

const ScheduledVideoListResponseSchema = z.object({
  videos: z.array(ScheduledVideoInfoSchema),
  cursor: Str().optional(),
  hasMore: z.boolean(),
});

export class VideoScheduleList extends OpenAPIRoute {
  schema = addAuthToSchema(
    {
      tags: ['Videos - Scheduling'],
      summary: 'List scheduled videos',
      description: 'Get a list of all videos scheduled for publication by the authenticated user.',
      request: {
        headers: z.object({
          userId: z.string().optional().nullable(),
          channelId: z.string().optional().nullable(),
        }),
        query: z.object({
          channelId: Str({ description: 'Filter by channel ID' }).optional(),
          startDate: Str({ description: 'Filter by start date (ISO 8601)' }).optional(),
          endDate: Str({ description: 'Filter by end date (ISO 8601)' }).optional(),
          status: z.enum(['scheduled', 'publishing', 'published', 'failed', 'cancelled']).optional(),
          limit: Num({ description: 'Maximum number of videos to return (max 100)', default: 20 }).optional(),
          cursor: Str({ description: 'Pagination cursor' }).optional(),
        }),
      },
      responses: {
        '200': {
          description: 'Scheduled videos retrieved successfully',
          content: {
            'application/json': {
              schema: z.object({
                success: z.boolean(),
                result: ScheduledVideoListResponseSchema,
              }),
            },
          },
        },
        '400': {
          description: 'Bad request - invalid parameters',
          content: {
            'application/json': {
              schema: ResponseError,
            },
          },
        },
        '401': {
          description: 'Unauthorized - authentication required',
          content: {
            'application/json': {
              schema: ResponseError,
            },
          },
        },
        '500': {
          description: 'Internal server error',
          content: {
            'application/json': {
              schema: ResponseError,
            },
          },
        },
      },
    },
    'required'
  );

  async handle(c) {
    try {
      // Get auth context
      const auth = c.get('auth');
      if (!auth) {
        return c.json(
          {
            success: false,
            error: 'Unauthorized',
          },
          401
        );
      }

      const userId = auth.userId;

      // Get validated data
      const request = await this.getValidatedData<typeof this.schema>();
      const { channelId, startDate, endDate, status, limit = 20, cursor } = request.query;

      // Validate limit
      const validLimit = Math.min(Math.max(1, limit), 100);

      // Fetch all videos for user
      const videoRepo = new R2Repository<VideoObject>(c.env.videos);
      const allVideos = await videoRepo.listObjects(1000); // Get up to 1000 videos

      // Filter videos
      let scheduledVideos: VideoObject[] = allVideos.items.filter((video) => {
        // Must belong to user
        if (video.userId !== userId) return false;

        // Must have scheduling info
        if (!video.scheduledPublishStatus || !video.scheduledPublishDate) return false;

        // Filter by channel if specified
        if (channelId && video.channelId !== channelId) return false;

        // Filter by status if specified
        if (status && video.scheduledPublishStatus !== status) return false;

        // Filter by date range if specified
        if (startDate || endDate) {
          const scheduledDate = new Date(video.scheduledPublishDate);

          if (startDate) {
            const start = new Date(startDate);
            if (scheduledDate < start) return false;
          }

          if (endDate) {
            const end = new Date(endDate);
            if (scheduledDate > end) return false;
          }
        }

        return true;
      });

      // Sort by scheduled date (earliest first)
      scheduledVideos.sort((a, b) => {
        const dateA = new Date(a.scheduledPublishDate!).getTime();
        const dateB = new Date(b.scheduledPublishDate!).getTime();
        return dateA - dateB;
      });

      // Apply cursor-based pagination
      let startIndex = 0;
      if (cursor) {
        const cursorIndex = parseInt(cursor, 10);
        if (!isNaN(cursorIndex)) {
          startIndex = cursorIndex;
        }
      }

      const paginatedVideos = scheduledVideos.slice(startIndex, startIndex + validLimit);
      const hasMore = startIndex + validLimit < scheduledVideos.length;
      const nextCursor = hasMore ? String(startIndex + validLimit) : undefined;

      // Transform to response format
      const now = new Date();
      const result: ScheduledVideoInfo[] = paginatedVideos.map((video) => {
        const scheduledDate = new Date(video.scheduledPublishDate!);
        const timezone = video.scheduledPublishTimezone || 'UTC';
        const isScheduled = video.scheduledPublishStatus === 'scheduled' || video.scheduledPublishStatus === 'publishing';

        const info: ScheduledVideoInfo = {
          videoId: video.id,
          title: video.title,
          thumbnailUrl: video.thumbnailUrl,
          scheduledPublishDate: video.scheduledPublishDate!,
          localScheduledDate: formatLocalDate(scheduledDate, timezone),
          timezone,
          status: video.scheduledPublishStatus!,
          canEdit: isScheduled,
          canCancel: isScheduled,
        };

        // Add time remaining if scheduled
        if (isScheduled) {
          const diff = scheduledDate.getTime() - now.getTime();
          if (diff > 0) {
            info.timeRemaining = formatTimeRemaining(diff);
          } else {
            info.timeRemaining = 'Publishing soon';
          }
        }

        return info;
      });

      return c.json({
        success: true,
        result: {
          videos: result,
          cursor: nextCursor,
          hasMore,
        },
      });
    } catch (error) {
      logger.error('Failed to list scheduled videos:', error);
      return c.json(
        {
          success: false,
          error: 'Failed to list scheduled videos',
        },
        500
      );
    }
  }
}

function formatLocalDate(date: Date, timezone: string): string {
  try {
    return date.toLocaleString('en-US', { timeZone: timezone });
  } catch {
    return date.toISOString();
  }
}

function formatTimeRemaining(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) {
    const remainingHours = hours % 24;
    return `${days} day${days > 1 ? 's' : ''}${remainingHours > 0 ? ` ${remainingHours} hour${remainingHours > 1 ? 's' : ''}` : ''}`;
  } else if (hours > 0) {
    const remainingMinutes = minutes % 60;
    return `${hours} hour${hours > 1 ? 's' : ''}${remainingMinutes > 0 ? ` ${remainingMinutes} minute${remainingMinutes > 1 ? 's' : ''}` : ''}`;
  } else if (minutes > 0) {
    return `${minutes} minute${minutes > 1 ? 's' : ''}`;
  } else {
    return 'Less than 1 minute';
  }
}
