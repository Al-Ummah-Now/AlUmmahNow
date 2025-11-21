/**
 * Video Chapters UPDATE Endpoint
 * Manually update chapters for a video (requires authentication and ownership)
 */

import { OpenAPIRoute, Str } from 'chanfana';
import { z } from 'zod';
import { env } from 'cloudflare:workers';
import R2Repository from '../../lib/r2Repo';
import { validateChapters } from '../../lib/chapters/parser';
import { VideoChapterSchema, VideoChapterDataSchema } from '@al-ummah/shared-types';
import { ResponseError } from '../../lib/types';
import { getAuthContext } from '../../middleware/auth';
import { addAuthToSchema } from '../../lib/openapi-auth';
import Queue, { MessageType } from '../../lib/queue';
import type { VideoObject } from '@al-ummah/shared-types';

export class VideoChaptersUpdate extends OpenAPIRoute {
  schema = addAuthToSchema({
    tags: ['Videos'],
    summary: 'Update video chapters (manual edit)',
    description: 'Manually update chapters for a video. Requires authentication and video ownership.',
    request: {
      headers: z.object({
          userId: z.string().optional().nullable(),
          channelId: z.string().optional().nullable(),
        }),
        params: z.object({
        id: Str({ description: 'Video ID' }),
      }),
      body: {
        content: {
          'application/json': {
            schema: z.object({
              chapters: z.array(VideoChapterSchema),
            }),
          },
        },
      },
    },
    responses: {
      '200': {
        description: 'Chapters updated successfully',
        content: {
          'application/json': {
            schema: z.object({
              success: z.boolean(),
              chapters: VideoChapterDataSchema,
            }),
          },
        },
      },
      '400': {
        description: 'Bad request - invalid chapters',
        content: {
          'application/json': {
            schema: ResponseError,
          },
        },
      },
      '401': {
        description: 'Unauthorized - missing or invalid token',
        content: {
          'application/json': {
            schema: ResponseError,
          },
        },
      },
      '403': {
        description: 'Forbidden - not authorized to edit this video',
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
  }, 'required');

  async handle(c) {
    try {
      // Get auth context
      const auth = getAuthContext(c);
      if (!auth) {
        return c.json(
          {
            success: false,
            error: 'Unauthorized',
          },
          401
        );
      }

      const request = await this.getValidatedData<typeof this.schema>();
      const { id: videoId } = request.params;
      const { chapters } = request.body;

      const bucket = env.videos;
      const videoRepo = new R2Repository<VideoObject>(bucket);

      // Fetch video and check ownership
      const video = await videoRepo.getObject(videoId);
      if (!video) {
        console.warn('Video not found for chapter update', { videoId });
        return c.json(
          {
            success: false,
            error: 'Video not found',
          },
          404
        );
      }

      if (video.userId !== auth.userId) {
        console.warn('User not authorized to edit video chapters', {
          videoId,
          userId: auth.userId,
          ownerId: video.userId,
        });
        return c.json(
          {
            success: false,
            error: 'Not authorized to edit this video',
          },
          403
        );
      }

      // Validate chapters
      const validation = validateChapters(chapters, video.duration || 0);
      if (!validation.valid) {
        console.warn('Invalid chapters provided', {
          videoId,
          errors: validation.errors,
        });
        return c.json(
          {
            success: false,
            error: 'Invalid chapters',
            details: validation.errors,
          },
          400
        );
      }

      // Update chapters
      const chapterData = {
        chapters,
        source: 'manual' as const,
        parsedAt: new Date().toISOString(),
        version: 1,
      };

      await videoRepo.putObject(videoId, {
        ...video,
        chapters: chapterData,
        hasChapters: true,
      });

      console.log('Chapters manually updated', {
        videoId,
        userId: auth.userId,
        chapterCount: chapters.length,
      });

      // Send queue message for chapter update
      const queue = new Queue();
      await queue.send(MessageType.VideoEdit, {
        videoId,
        userId: auth.userId,
        channelId: video.channelId,
        timestamp: new Date().toISOString(),
        action: 'chapters_update',
        chapterCount: chapters.length,
      });

      return c.json({
        success: true,
        chapters: chapterData,
      });
    } catch (error) {
      console.error('Error updating chapters', {
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      });
      return c.json(
        {
          success: false,
          error: 'Internal server error',
        },
        500
      );
    }
  }
}
