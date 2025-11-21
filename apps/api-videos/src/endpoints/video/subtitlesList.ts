/**
 * List all subtitle tracks for a video
 */

import { OpenAPIRoute, Str } from 'chanfana';
import { z } from 'zod';
import { SubtitleMetadata } from '@al-ummah/shared-types';
import { logger } from '../../lib/logger';

export class SubtitlesList extends OpenAPIRoute {
  schema = {
    tags: ['Subtitles'],
    summary: 'List subtitle tracks for a video',
    description: 'Get all available subtitle tracks for a video',
    request: {
      headers: z.object({
          userId: z.string().optional().nullable(),
          channelId: z.string().optional().nullable(),
        }),
        params: z.object({
        videoId: Str({ description: 'Video ID' }),
      }),
    },
    responses: {
      '200': {
        description: 'List of subtitle tracks',
        content: {
          'application/json': {
            schema: z.object({
              success: z.boolean(),
              data: z.object({
                tracks: z.array(z.any()), // SubtitleTrack[]
                defaultLanguage: z.string().optional(),
              }),
            }),
          },
        },
      },
      '404': {
        description: 'Video not found or no subtitles available',
        content: {
          'application/json': {
            schema: z.object({
              success: z.boolean(),
              error: z.string(),
            }),
          },
        },
      },
      '500': {
        description: 'Internal server error',
        content: {
          'application/json': {
            schema: z.object({
              success: z.boolean(),
              error: z.string(),
            }),
          },
        },
      },
    },
  };

  async handle(c: any) {
    try {
      // Get validated data
      const request = await this.getValidatedData<typeof this.schema>();
      const { videoId } = request.params;

      const subtitleBucket = c.env.subtitles;

      // Load subtitle metadata
      const metadataKey = `${videoId}/metadata.json`;
      const metadataObject = await subtitleBucket.get(metadataKey);

      if (!metadataObject) {
        return c.json(
          {
            success: false,
            error: 'No subtitles found for this video',
          },
          404
        );
      }

      const metadata = (await metadataObject.json()) as SubtitleMetadata;

      // Find default language
      const defaultTrack = metadata.tracks.find((t) => t.isDefault);
      const defaultLanguage = defaultTrack?.language;

      return c.json({
        success: true,
        data: {
          tracks: metadata.tracks,
          defaultLanguage,
        },
      });
    } catch (error: any) {
      logger.error('Failed to list subtitles:', error);
      return c.json(
        {
          success: false,
          error: error.message || 'Failed to list subtitles',
        },
        500
      );
    }
  }
}
