import { AuthenticatedRoute, AppContext } from '../../base';
import { Str, Bool } from 'chanfana';
import { z } from 'zod';
import { addAuthToSchema } from '../../lib/openapi-auth';
import { ResponseError } from '../../lib/types';
import R2Repository from '../../lib/r2Repo';
import Queue, { MessageType } from '../../lib/queue';
import type { VideoObject, ScheduledVideoMetadata, VideoScheduleResponse } from '@al-ummah/shared-types';
import { logger } from '../../lib/logger';

const VideoScheduleResponseSchema = z.object({
  videoId: Str({ description: 'Video ID' }),
  scheduledPublishDate: Str({ description: 'Scheduled publish date (UTC)' }),
  localScheduledDate: Str({ description: 'Scheduled publish date (local timezone)' }),
  timezone: Str({ description: 'IANA timezone' }),
  status: z.enum(['scheduled', 'publishing', 'published', 'failed', 'cancelled']),
});

export class VideoScheduleCreate extends AuthenticatedRoute {
  schema = addAuthToSchema(
    {
      tags: ['Videos - Scheduling'],
      summary: 'Schedule a video for automatic publication',
      description:
        'Schedule a video to be automatically published at a specified date and time. Video must be in draft/private status.',
      request: {
        headers: z.object({
          channelId: z.string().optional().nullable(),
        }),
        params: z.object({
          id: Str({ description: 'Video ID' }),
        }),
        body: {
          content: {
            'application/json': {
              schema: z.object({
                scheduledPublishDate: Str({
                  description: 'Scheduled publish date and time (ISO 8601 format, UTC)',
                  example: '2025-01-25T10:00:00Z',
                }),
                timezone: Str({
                  description: 'IANA timezone (e.g., America/New_York, Europe/London)',
                  example: 'America/New_York',
                }),
                notifyOnPublish: Bool({
                  description: 'Send notification when video is published',
                  default: true,
                }).optional(),
              }),
            },
          },
        },
      },
      responses: {
        '200': {
          description: 'Video scheduled successfully',
          content: {
            'application/json': {
              schema: z.object({
                success: z.boolean(),
                result: VideoScheduleResponseSchema,
              }),
            },
          },
        },
        '400': {
          description: 'Bad request - invalid input data',
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
        '409': {
          description: 'Conflict - video already scheduled or published',
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
      const { scheduledPublishDate, timezone, notifyOnPublish = true } = request.body;

      // Validate scheduled date
      const scheduledDate = new Date(scheduledPublishDate);
      const now = new Date();

      // Check if date is valid
      if (isNaN(scheduledDate.getTime())) {
        return c.json(
          {
            success: false,
            error: 'Invalid scheduled date format',
            code: 'SCH001',
          },
          400
        );
      }

      // Check if date is at least 5 minutes in the future
      const minDate = new Date(now.getTime() + 5 * 60 * 1000);
      if (scheduledDate < minDate) {
        return c.json(
          {
            success: false,
            error: 'Scheduled date must be at least 5 minutes in the future',
            code: 'SCH001',
          },
          400
        );
      }

      // Check if date is not more than 1 year in the future
      const maxDate = new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000);
      if (scheduledDate > maxDate) {
        return c.json(
          {
            success: false,
            error: 'Scheduled date cannot be more than 1 year in the future',
            code: 'SCH001',
          },
          400
        );
      }

      // Fetch video from R2
      const videoRepo = new R2Repository<VideoObject>(c.env.videos);
      const video = await videoRepo.getObject(videoId);

      if (!video) {
        return c.json(
          {
            success: false,
            error: 'Video not found',
            code: 'SCH002',
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
            code: 'SCH003',
          },
          403
        );
      }

      // Check if video is already published
      if (video.isPublic) {
        return c.json(
          {
            success: false,
            error: 'Cannot schedule a video that is already published',
            code: 'SCH005',
          },
          409
        );
      }

      // Check if video is already scheduled
      if (video.scheduledPublishStatus === 'scheduled' || video.scheduledPublishStatus === 'publishing') {
        return c.json(
          {
            success: false,
            error: 'Video is already scheduled for publication. Cancel existing schedule first.',
            code: 'SCH004',
          },
          409
        );
      }

      // Update video with scheduling information
      video.scheduledPublishDate = scheduledDate.toISOString();
      video.scheduledPublishTimezone = timezone;
      video.scheduledPublishStatus = 'scheduled';
      video.scheduledBy = userId;
      video.scheduledAt = now.toISOString();

      await videoRepo.putObject(videoId, video);

      // Create scheduled metadata for scheduler worker
      const scheduledMetadata: ScheduledVideoMetadata = {
        videoId: video.id,
        title: video.title,
        channelId: video.channelId || '',
        userId: video.userId,
        scheduledPublishDate: scheduledDate.toISOString(),
        timezone,
        localScheduledDate: formatLocalDate(scheduledDate, timezone),
        notifyOnPublish,
        retryCount: 0,
      };

      // Save to scheduled videos bucket
      const scheduledBucket = c.env.SCHEDULED_VIDEOS || c.env['scheduled-videos'];
      if (!scheduledBucket) {
        throw new Error('Scheduled videos bucket not configured');
      }

      const year = scheduledDate.getUTCFullYear();
      const month = String(scheduledDate.getUTCMonth() + 1).padStart(2, '0');
      const day = String(scheduledDate.getUTCDate()).padStart(2, '0');
      const hour = String(scheduledDate.getUTCHours()).padStart(2, '0');

      const scheduleKey = `${year}-${month}-${day}/${hour}/${videoId}.json`;

      await scheduledBucket.put(scheduleKey, JSON.stringify(scheduledMetadata), {
        httpMetadata: {
          contentType: 'application/json',
        },
      });

      logger.info(`Scheduled video ${videoId} for ${scheduledDate.toISOString()}`);

      // Send queue message for video scheduling
      const queue = new Queue(c.env.queue);
      await queue.send(MessageType.VideoEdit, {
        videoId,
        userId,
        channelId: video.channelId,
        timestamp: new Date().toISOString(),
        action: 'schedule',
        scheduledDate: scheduledDate.toISOString(),
      });

      // Return response
      const response: VideoScheduleResponse = {
        videoId: video.id,
        scheduledPublishDate: scheduledDate.toISOString(),
        localScheduledDate: formatLocalDate(scheduledDate, timezone),
        timezone,
        status: 'scheduled',
      };

      return c.json({
        success: true,
        result: response,
      });
    } catch (error) {
      logger.error('Failed to schedule video:', error);
      return c.json(
        {
          success: false,
          error: 'Failed to schedule video',
          code: 'SCH006',
        },
        500
      );
    }
  }
}

/**
 * Format date in local timezone
 * Note: This is a simplified implementation. In production, use a library like date-fns-tz
 */
function formatLocalDate(date: Date, timezone: string): string {
  try {
    return date.toLocaleString('en-US', { timeZone: timezone });
  } catch {
    return date.toISOString();
  }
}
