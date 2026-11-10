import { canOnVideo } from "../../lib/channelAccess";
import { AuthenticatedRoute, AppContext } from '../../base';
import { Str, Bool } from 'chanfana';
import { z } from 'zod';
import { addAuthToSchema } from '../../lib/openapi-auth';
import { ResponseError } from '../../lib/types';
import R2Repository, { rethrowBusy } from '../../lib/r2Repo';
import Queue, { MessageType } from '../../lib/queue';
import type { VideoObject, ScheduledVideoMetadata } from '@al-ummah/shared-types';
import { logger } from '../../lib/logger';

const VideoScheduleUpdateResponseSchema = z.object({
  videoId: Str({ description: 'Video ID' }),
  previousSchedule: Str({ description: 'Previous scheduled publish date (UTC)' }),
  newSchedule: Str({ description: 'New scheduled publish date (UTC)' }),
  status: z.enum(['rescheduled']),
});

export class VideoScheduleUpdate extends AuthenticatedRoute {
  schema = addAuthToSchema(
    {
      tags: ['Videos - Scheduling'],
      summary: 'Update (reschedule) a scheduled video publication',
      description: 'Reschedule a video to a new date and time. Cannot update if already publishing or published.',
      request: {
        headers: z.object({
          channelId: Str({ description: "User's selected channel ID" }).optional().nullable(),
        }),
        params: z.object({
          id: Str({ description: 'Video ID' }),
        }),
        body: {
          content: {
            'application/json': {
              schema: z.object({
                scheduledPublishDate: Str({
                  description: 'New scheduled publish date and time (ISO 8601 format, UTC)',
                  example: '2025-01-26T15:00:00Z',
                }).optional(),
                timezone: Str({
                  description: 'IANA timezone (e.g., America/New_York)',
                  example: 'America/New_York',
                }).optional(),
                notifyOnPublish: Bool({
                  description: 'Send notification when video is published',
                }).optional(),
              }),
            },
          },
        },
      },
      responses: {
        '200': {
          description: 'Schedule updated successfully',
          content: {
            'application/json': {
              schema: z.object({
                success: z.boolean(),
                result: VideoScheduleUpdateResponseSchema,
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
          description: 'Video not found or not scheduled',
          content: {
            'application/json': {
              schema: ResponseError,
            },
          },
        },
        '409': {
          description: 'Conflict - cannot update (already publishing or published)',
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
      const { scheduledPublishDate, timezone, notifyOnPublish } = request.body;

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
      if (!(await canOnVideo(c.env as never, video, userId, 'video.schedule'))) {
        return c.json(
          {
            success: false,
            error: 'Forbidden - you do not own this video',
          },
          403
        );
      }

      // Check if video is scheduled
      if (!video.scheduledPublishStatus || video.scheduledPublishStatus === 'cancelled') {
        return c.json(
          {
            success: false,
            error: 'Video is not scheduled for publication',
          },
          404
        );
      }

      // Cannot update if already publishing or published
      if (video.scheduledPublishStatus === 'publishing' || video.scheduledPublishStatus === 'published') {
        return c.json(
          {
            success: false,
            error: 'Cannot update schedule - video is already publishing or published',
          },
          409
        );
      }

      let previousSchedule = video.scheduledPublishDate;

      // Update scheduling information
      if (scheduledPublishDate) {
        const scheduledDate = new Date(scheduledPublishDate);
        const now = new Date();

        // Validate date
        if (isNaN(scheduledDate.getTime())) {
          return c.json(
            {
              success: false,
              error: 'Invalid scheduled date format',
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
            },
            400
          );
        }

        video.scheduledPublishDate = scheduledDate.toISOString();
      }

      if (timezone) {
        video.scheduledPublishTimezone = timezone;
      }

      // Save the new schedule on the fresh video with a conditional write
      // (SCALABILITY-AUDIT AV-3), re-checking the schedule state there: the
      // scheduler may have started publishing meanwhile.
      const newSchedule = { date: video.scheduledPublishDate, timezone: video.scheduledPublishTimezone };
      const { data: saved, rejected } = await videoRepo.updateObjectOrReject<{ status: 403 | 404 | 409; error: string }>(videoId, (fresh) => {
        if (fresh.userId !== video.userId) return { reject: { status: 403, error: 'Forbidden - you do not own this video' } };
        if (!fresh.scheduledPublishStatus || fresh.scheduledPublishStatus === 'cancelled') {
          return { reject: { status: 404, error: 'Video is not scheduled for publication' } };
        }
        if (fresh.scheduledPublishStatus === 'publishing' || fresh.scheduledPublishStatus === 'published') {
          return { reject: { status: 409, error: 'Cannot update schedule - video is already publishing or published' } };
        }
        previousSchedule = fresh.scheduledPublishDate;
        fresh.scheduledPublishDate = newSchedule.date;
        fresh.scheduledPublishTimezone = newSchedule.timezone;
        return true;
      });
      if (!saved) {
        return c.json({ success: false, error: 'Video not found' }, 404);
      }
      if (rejected) {
        return c.json({ success: false, error: rejected.error }, rejected.status);
      }

      // Update scheduled metadata in bucket
      const scheduledBucket = c.env.SCHEDULED_VIDEOS || c.env['scheduled-videos'];
      if (!scheduledBucket) {
        throw new Error('Scheduled videos bucket not configured');
      }

      // Remove old schedule entry
      if (previousSchedule) {
        const oldDate = new Date(previousSchedule);
        const oldKey = buildScheduleKey(oldDate, videoId);
        await scheduledBucket.delete(oldKey);
      }

      // Create new schedule entry
      const newDate = new Date(video.scheduledPublishDate!);
      const newKey = buildScheduleKey(newDate, videoId);

      // Get existing metadata or create new
      const existingObject = await scheduledBucket.get(newKey);
      let metadata: ScheduledVideoMetadata;

      if (existingObject) {
        metadata = JSON.parse(await existingObject.text());
      } else {
        metadata = {
          videoId: video.id,
          title: video.title,
          channelId: video.channelId || '',
          userId: video.userId,
          scheduledPublishDate: video.scheduledPublishDate!,
          timezone: video.scheduledPublishTimezone || 'UTC',
          localScheduledDate: formatLocalDate(newDate, video.scheduledPublishTimezone || 'UTC'),
          notifyOnPublish: true,
          retryCount: 0,
        };
      }

      // Update metadata
      metadata.scheduledPublishDate = video.scheduledPublishDate!;
      if (timezone) {
        metadata.timezone = timezone;
        metadata.localScheduledDate = formatLocalDate(newDate, timezone);
      }
      if (notifyOnPublish !== undefined) {
        metadata.notifyOnPublish = notifyOnPublish;
      }

      await scheduledBucket.put(newKey, JSON.stringify(metadata), {
        httpMetadata: {
          contentType: 'application/json',
        },
      });

      logger.debug(`Rescheduled video ${videoId} from ${previousSchedule} to ${video.scheduledPublishDate}`);

      // Send queue message for schedule update
      const queue = new Queue(c.env.queue);
      await queue.send(MessageType.VideoEdit, {
        videoId,
        userId,
        channelId: video.channelId,
        timestamp: new Date().toISOString(),
        action: 'reschedule',
        previousSchedule,
        newSchedule: video.scheduledPublishDate,
      });

      return c.json({
        success: true,
        result: {
          videoId: video.id,
          previousSchedule: previousSchedule!,
          newSchedule: video.scheduledPublishDate!,
          status: 'rescheduled',
        },
      });
    } catch (error) {
      rethrowBusy(error);
      logger.error('Failed to update video schedule:', error);
      return c.json(
        {
          success: false,
          error: 'Failed to update schedule',
        },
        500
      );
    }
  }
}

function buildScheduleKey(date: Date, videoId: string): string {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  const hour = String(date.getUTCHours()).padStart(2, '0');

  return `${year}-${month}-${day}/${hour}/${videoId}.json`;
}

function formatLocalDate(date: Date, timezone: string): string {
  try {
    return date.toLocaleString('en-US', { timeZone: timezone });
  } catch {
    return date.toISOString();
  }
}
