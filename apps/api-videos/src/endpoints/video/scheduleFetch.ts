import { OptionalAuthRoute, AppContext } from '../../base';
import { Str } from 'chanfana';
import { z } from 'zod';
import { addAuthToSchema } from '../../lib/openapi-auth';
import { ResponseError } from '../../lib/types';
import R2Repository from '../../lib/r2Repo';
import type { VideoObject } from '@al-ummah/shared-types';
import { logger } from '../../lib/logger';

const VideoScheduleStatusResponseSchema = z.object({
  isScheduled: z.boolean(),
  scheduledPublishDate: Str({ description: 'Scheduled publish date (UTC)' }).optional(),
  localScheduledDate: Str({ description: 'Scheduled publish date (local timezone)' }).optional(),
  timezone: Str({ description: 'IANA timezone' }).optional(),
  status: z.enum(['scheduled', 'publishing', 'published', 'failed', 'cancelled']).optional(),
  timeRemaining: Str({ description: 'Human-readable time remaining' }).optional(),
  canEdit: z.boolean(),
  canCancel: z.boolean(),
});

export class VideoScheduleFetch extends OptionalAuthRoute {
  schema = addAuthToSchema(
    {
      tags: ['Videos - Scheduling'],
      summary: 'Get schedule status for a video',
      description: 'Retrieve the scheduling information and status for a video.',
      request: {
        headers: z.object({
          channelId: z.string().optional().nullable(),
        }),
        params: z.object({
          id: Str({ description: 'Video ID' }),
        }),
      },
      responses: {
        '200': {
          description: 'Schedule status retrieved successfully',
          content: {
            'application/json': {
              schema: z.object({
                success: z.boolean(),
                result: VideoScheduleStatusResponseSchema,
              }),
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
        '403': {
          description: 'Forbidden - user does not own this video',
          content: {
            'application/json': {
              schema: ResponseError,
            },
          },
        },
        '404': {
          description: 'Video not found',
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

  async handle(c: AppContext) {
    try {
      const userId = this.getUserId(c);

      // Get validated data
      const request = await this.getValidatedData<typeof this.schema>();
      const { id: videoId } = request.params;

      // Fetch video from R2
      const videoRepo = new R2Repository<VideoObject>(c.env.videos);
      const video = await videoRepo.getObject(videoId);

      if (!video) {
        return c.json(
          {
            success: false,
            error: 'Video not found',
          },
          404
        );
      }

      // Check if user owns the video
      if (video.userId !== userId) {
        return c.json(
          {
            success: false,
            error: 'Forbidden - you do not own this video',
          },
          403
        );
      }

      const isScheduled =
        video.scheduledPublishStatus === 'scheduled' || video.scheduledPublishStatus === 'publishing';

      const response: any = {
        isScheduled,
        canEdit: isScheduled,
        canCancel: isScheduled,
      };

      if (video.scheduledPublishDate && video.scheduledPublishStatus) {
        response.scheduledPublishDate = video.scheduledPublishDate;
        response.timezone = video.scheduledPublishTimezone || 'UTC';
        response.localScheduledDate = formatLocalDate(
          new Date(video.scheduledPublishDate),
          response.timezone
        );
        response.status = video.scheduledPublishStatus;

        // Calculate time remaining
        if (isScheduled) {
          const now = new Date();
          const scheduled = new Date(video.scheduledPublishDate);
          const diff = scheduled.getTime() - now.getTime();

          if (diff > 0) {
            response.timeRemaining = formatTimeRemaining(diff);
          } else {
            response.timeRemaining = 'Publishing soon';
          }
        }
      }

      return c.json({
        success: true,
        result: response,
      });
    } catch (error) {
      logger.error('Failed to fetch video schedule:', error);
      return c.json(
        {
          success: false,
          error: 'Failed to fetch schedule',
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
