import { AuthenticatedRoute, AppContext } from '../../base';
import { Str } from 'chanfana';
import { z } from 'zod';
import { addAuthToSchema } from '../../lib/openapi-auth';
import { ResponseError } from '../../lib/types';
import R2Repository from '../../lib/r2Repo';
import Queue, { MessageType } from '../../lib/queue';
import type { VideoObject } from '@al-ummah/shared-types';
import { logger } from '../../lib/logger';
import { inBackground } from "../../lib/websocket-notify";
import { announceNewVideo } from "../../lib/notification-events";

export class VideoSchedulePublishNow extends AuthenticatedRoute {
  schema = addAuthToSchema(
    {
      tags: ['Videos - Scheduling'],
      summary: 'Publish a video immediately',
      description:
        'Immediately publish a scheduled or private video. Sets isPublic to true and updates scheduling status.',
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
          description: 'Video published successfully',
          content: {
            'application/json': {
              schema: z.object({
                success: z.boolean(),
                result: z.object({
                  message: z.string(),
                  videoId: z.string(),
                }),
              }),
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
        '403': {
          description: 'Not authorized to publish this video',
          content: {
            'application/json': {
              schema: ResponseError,
            },
          },
        },
        '409': {
          description: 'Conflict - video is already public',
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
    const data = await this.getValidatedData<typeof this.schema>();
    const { id } = data.params;
    const { channelId } = data.headers;
    const userId = this.getUserId(c);

    logger.info('[VideoSchedulePublishNow] Publishing video immediately', { videoId: id, userId, channelId });

    try {
      const videoRepository = new R2Repository<VideoObject>(c.env.videos);
      const video = await videoRepository.getObject(id);

      if (!video) {
        logger.warn('[VideoSchedulePublishNow] Video not found', { videoId: id });
        return c.json(
          {
            success: false,
            error: 'Video not found',
          },
          404
        );
      }

      // Authorization check - user must own the video
      if (video.userId !== userId) {
        logger.warn('[VideoSchedulePublishNow] Unauthorized - user does not own video', {
          videoId: id,
          videoOwner: video.userId,
          requestUser: userId,
        });
        return c.json(
          {
            success: false,
            error: 'Not authorized to publish this video',
          },
          403
        );
      }

      // Check if video is already public
      if (video.isPublic === true) {
        logger.info('[VideoSchedulePublishNow] Video is already public', { videoId: id });
        return c.json(
          {
            success: false,
            error: 'Video is already public',
          },
          409
        );
      }

      // Publish on the fresh video with a conditional write (SCALABILITY-AUDIT AV-3)
      const now = new Date().toISOString();
      let previousStatus = video.scheduledPublishStatus;
      const { data: updatedVideo, rejected } = await videoRepository.updateObjectOrReject<{ status: 403 | 409; error: string }>(id, (fresh) => {
        if (fresh.userId !== userId) return { reject: { status: 403, error: 'Not authorized to publish this video' } };
        if (fresh.isPublic === true) return { reject: { status: 409, error: 'Video is already public' } };
        previousStatus = fresh.scheduledPublishStatus;
        fresh.isPublic = true;
        fresh.dateModified = now;
        // Update scheduling status if video was scheduled
        if (fresh.scheduledPublishStatus) {
          fresh.scheduledPublishStatus = 'published';
          fresh.publishedViaSchedule = false; // Published manually, not via scheduler
        }
        return true;
      });
      if (!updatedVideo) {
        return c.json({ success: false, error: 'Video not found' }, 404);
      }
      if (rejected) {
        return c.json({ success: false, error: rejected.error }, rejected.status);
      }

      inBackground(c, 'video-published', () => announceNewVideo(c.env, { ...updatedVideo, id } as Parameters<typeof announceNewVideo>[1]));

      logger.info('[VideoSchedulePublishNow] Video published successfully', {
        videoId: id,
        wasScheduled: !!previousStatus,
        previousStatus,
      });

      // Queue notification event (using VideoEdit to track the visibility change)
      try {
        const queue = new Queue(c.env.queue);
        await queue.send(MessageType.VideoEdit, {
          videoId: id,
          userId,
          channelId: video.channelId || channelId,
          timestamp: now,
          action: 'publish_now',
          previousVisibility: 'private',
          newVisibility: 'public',
        });
      } catch (queueError) {
        logger.error('[VideoSchedulePublishNow] Failed to queue notification', { error: queueError });
        // Don't fail the request if queue fails
      }

      return c.json({
        success: true,
        result: {
          message: 'Video published successfully',
          videoId: id,
        },
      });
    } catch (error) {
      logger.error('[VideoSchedulePublishNow] Error publishing video', {
        error: error instanceof Error ? error.message : String(error),
        videoId: id,
      });
      return c.json(
        {
          success: false,
          error: 'Failed to publish video',
        },
        500
      );
    }
  }
}
