/**
 * Get specific subtitle track
 */

import { OpenAPIRoute, Str, Enumeration } from 'chanfana';
import { z } from 'zod';
import { logger } from '../../lib/logger';

export class SubtitlesGet extends OpenAPIRoute {
  schema = {
    tags: ['Subtitles'],
    summary: 'Get specific subtitle track',
    description: 'Get subtitle content for a specific language. Returns WebVTT format by default.',
    request: {
      headers: z.object({
          userId: z.string().optional().nullable(),
          channelId: z.string().optional().nullable(),
        }),
        params: z.object({
        videoId: Str({ description: 'Video ID' }),
        language: Str({ description: 'ISO 639-1 language code (e.g., en, ar, ur)' }),
      }),
      query: z.object({
        format: Enumeration({
          description: 'Output format',
          values: ['vtt', 'srt', 'sbv'],
          default: 'vtt',
        }),
      }),
    },
    responses: {
      '200': {
        description: 'Subtitle file content',
        content: {
          'text/vtt': {
            schema: z.string(),
          },
        },
      },
      '404': {
        description: 'Subtitle not found',
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
      const { videoId, language } = request.params;
      const { format } = request.query;

      const subtitleBucket = c.env.subtitles;

      // Determine which file to fetch
      let key: string;
      let contentType: string;

      if (format === 'vtt' || !format) {
        key = `${videoId}/${language}.vtt`;
        contentType = 'text/vtt';
      } else {
        // Try to get original format
        key = `${videoId}/original/${language}.${format}`;
        contentType = 'text/plain';
      }

      // Fetch subtitle file
      const subtitleObject = await subtitleBucket.get(key);

      if (!subtitleObject) {
        return c.json(
          {
            success: false,
            error: `Subtitle not found for language: ${language}`,
          },
          404
        );
      }

      const content = await subtitleObject.text();

      // Return raw subtitle content
      return new Response(content, {
        status: 200,
        headers: {
          'Content-Type': contentType,
          'Content-Disposition': `inline; filename="${videoId}-${language}.${format || 'vtt'}"`,
          'Cache-Control': 'public, max-age=31536000', // Cache for 1 year
        },
      });
    } catch (error: any) {
      logger.error('Failed to get subtitle:', error);
      return c.json(
        {
          success: false,
          error: error.message || 'Failed to get subtitle',
        },
        500
      );
    }
  }
}
