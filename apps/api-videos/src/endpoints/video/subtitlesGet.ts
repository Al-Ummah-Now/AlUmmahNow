/**
 * Get specific subtitle track
 */

import { Str, Enumeration } from 'chanfana';
import { z } from 'zod';
import { logger } from '../../lib/logger';
import { PublicRoute, AppContext } from '../../base';

export class SubtitlesGet extends PublicRoute {
  schema = {
    tags: ['Subtitles'],
    summary: 'Get specific subtitle track',
    description: 'Get subtitle content for a specific language. Returns WebVTT format by default.',
    request: {
      headers: z.object({
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

  async handle(c: AppContext) {
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
        contentType = 'text/vtt; charset=utf-8';
      } else {
        // Try to get original format
        key = `${videoId}/original/${language}.${format}`;
        contentType = 'text/plain; charset=utf-8';
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

      // Get ETag from R2 object for cache validation
      const etag = subtitleObject.etag;

      // Check If-None-Match header for conditional request
      const ifNoneMatch = c.req.header('If-None-Match');
      if (ifNoneMatch && ifNoneMatch === etag) {
        // Content hasn't changed, return 304 Not Modified
        return new Response(null, {
          status: 304,
          headers: {
            'ETag': etag,
            'Cache-Control': 'public, max-age=3600, stale-while-revalidate=86400',
          },
        });
      }

      const content = await subtitleObject.text();

      // Return raw subtitle content with ETag for cache validation
      return new Response(content, {
        status: 200,
        headers: {
          'Content-Type': contentType,
          'Content-Disposition': `inline; filename="${videoId}-${language}.${format || 'vtt'}"`,
          'Cache-Control': 'public, max-age=3600, stale-while-revalidate=86400',
          'ETag': etag,
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
