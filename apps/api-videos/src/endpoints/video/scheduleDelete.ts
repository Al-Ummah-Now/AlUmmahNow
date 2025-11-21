import { OpenAPIRoute, Str } from 'chanfana';
import { z } from 'zod';
import { addAuthToSchema } from '../../lib/openapi-auth';
import { ResponseError } from '../../lib/types';
import { env } from 'cloudflare:workers';
import R2Repository from '../../lib/r2Repo';
import type { VideoObject } from '@al-ummah/shared-types';

const VideoScheduleCancelResponseSchema = z.object({
  videoId: Str({ description: 'Video ID' }),
  status: z.enum(['cancelled']),
  message: Str({ description: 'Cancellation message' }),
});

export class VideoScheduleDelete extends OpenAPIRoute {
  schema = addAuthToSchema(
    {
      tags: ['Videos - Scheduling'],
      summary: 'Cancel a scheduled video publication',
      description: 'Cancel the scheduled publication of a video. Video will remain in draft/private status.',
      request: {
        params: z.object({
          id: Str({ description: 'Video ID' }),
        }),
      },
      responses: {
        '200': {
          description: 'Schedule cancelled successfully',
          content: {
            'application/json': {
              schema: z.object({
                success: z.boolean(),
                result: VideoScheduleCancelResponseSchema,
              }),
            },
          },
        },
        '400': {
          description: 'Bad request',
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
          description: 'Conflict - cannot cancel (already published)',
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
      const { id: videoId } = request.params;

      // Fetch video from R2
      const videoRepo = new R2Repository<VideoObject>(env.videos);
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

      // Cannot cancel if already published
      if (video.scheduledPublishStatus === 'published') {
        return c.json(
          {
            success: false,
            error: 'Cannot cancel - video has already been published',
          },
          409
        );
      }

      const previousSchedule = video.scheduledPublishDate;

      // Update video status
      video.scheduledPublishStatus = 'cancelled';

      await videoRepo.putObject(videoId, video);

      // Remove from scheduled bucket
      if (previousSchedule) {
        const scheduledBucket = env.SCHEDULED_VIDEOS || env['scheduled-videos'];
        if (scheduledBucket) {
          const scheduledDate = new Date(previousSchedule);
          const key = buildScheduleKey(scheduledDate, videoId);
          await scheduledBucket.delete(key);
          console.log(`Removed scheduled entry for video ${videoId}: ${key}`);
        }
      }

      console.log(`Cancelled schedule for video ${videoId}`);

      return c.json({
        success: true,
        result: {
          videoId: video.id,
          status: 'cancelled',
          message: 'Scheduled publication cancelled',
        },
      });
    } catch (error) {
      console.error('Failed to cancel video schedule:', error);
      return c.json(
        {
          success: false,
          error: 'Failed to cancel schedule',
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
