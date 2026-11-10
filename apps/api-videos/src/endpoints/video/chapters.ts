/**
 * Video Chapters GET Endpoint
 * Retrieves or generates chapters for a video
 */

import { Str, Bool } from 'chanfana';
import { z } from 'zod';
import R2Repository from '../../lib/r2Repo';
import { parseChapters } from '../../lib/chapters/parser';
import { VideoChapterDataSchema } from '@al-ummah/shared-types';
import { ResponseError } from '../../lib/types';
import type { VideoObject } from '@al-ummah/shared-types';
import { logger } from '../../lib/logger';
import { PublicRoute, AppContext } from '../../base';

export class VideoChaptersGet extends PublicRoute {
  schema = {
    tags: ['Videos'],
    summary: 'Get video chapters',
    description: 'Retrieve parsed chapters for a video. If chapters are not cached, they will be parsed from the description.',
    request: {
      headers: z.object({
          channelId: z.string().optional().nullable(),
        }),
        params: z.object({
        id: Str({ description: 'Video ID' }),
      }),
      query: z.object({
        regenerate: Bool({ description: 'Force regenerate chapters from description' }).optional(),
      }),
    },
    responses: {
      '200': {
        description: 'Video chapters retrieved successfully',
        content: {
          'application/json': {
            schema: z.object({
              success: z.boolean(),
              chapters: VideoChapterDataSchema.optional(),
              message: z.string().optional(),
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
      '400': {
        description: 'Bad request - no description to parse',
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
  };

  async handle(c: AppContext) {
    try {
      const request = await this.getValidatedData<typeof this.schema>();
      const { id: videoId } = request.params;
      const { regenerate } = request.query;

      const bucket = c.env.videos;
      const videoRepo = new R2Repository<VideoObject>(bucket);

      // Fetch video
      const video = await videoRepo.getObject(videoId);
      if (!video) {
        logger.debug('Video not found for chapters', { videoId });
        return c.json(
          {
            success: false,
            error: 'Video not found',
          },
          404
        );
      }

      // Check if chapters exist and not regenerating
      if (video.chapters && !regenerate) {
        logger.debug('Returning cached chapters', {
          videoId,
          chapterCount: video.chapters.chapters.length,
        });
        return c.json({
          success: true,
          chapters: video.chapters,
        });
      }

      // Parse chapters from description
      if (!video.description) {
        // Not an error: most videos have no chapters. A 400 here logged a failed
        // request in the browser console on every such watch page.
        logger.debug('No description to parse chapters from', { videoId });
        return c.json({
          success: true,
          chapters: null,
          message: 'No chapters',
        });
      }

      const parseResult = parseChapters(
        video.description,
        video.duration || 0
      );

      if (!parseResult.success || parseResult.chapters.length === 0) {
        logger.debug('No valid chapters found in description', {
          videoId,
          errors: parseResult.errors,
        });
        return c.json({
          success: false,
          message: 'No valid chapters found',
          errors: parseResult.errors,
        });
      }

      // Chapters parsed from the description are returned, not stored: this is a
      // public read, and writing the video JSON on read traffic overwrote
      // concurrent changes (SCALABILITY-AUDIT AV-3). Owners store chapters
      // with PUT /:id/chapters.
      const chapterData = {
        chapters: parseResult.chapters,
        source: 'automatic' as const,
        parsedAt: new Date().toISOString(),
        version: 1,
      };

      logger.debug('Chapters parsed from the description', {
        videoId,
        chapterCount: parseResult.chapters.length,
      });

      return c.json({
        success: true,
        chapters: chapterData,
      });
    } catch (error) {
      logger.error('Error fetching/parsing chapters', {
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
