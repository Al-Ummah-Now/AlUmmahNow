/**
 * Get specific subtitle track
 */

import { RecordId, SubtitleLanguage } from '../../validation/identifiers';
import { Enumeration } from '../../lib/chanfana-params';
import { z } from 'zod';
import { captionMarkerRanges, featureGate } from '@al-ummah/shared-types';
import { fillServedTrack, quranCopyTag } from '../../lib/captions/drafts';
import { editionFor } from '../../lib/quran/translations';
import { logger } from '../../lib/logger';
import { OptionalAuthRoute, AppContext } from '../../base';
import { loadVideoRecord, videoReadAccess, VIDEO_NOT_FOUND } from '../../lib/videoReadAccess';

export class SubtitlesGet extends OptionalAuthRoute {
  schema = {
    tags: ['Subtitles'],
    summary: 'Get specific subtitle track',
    description: 'Get subtitle content for a specific language. Returns WebVTT format by default.',
    request: {
      headers: z.object({
          channelId: z.string().optional().nullable(),
        }),
        params: z.object({
        videoId: RecordId.describe('Video ID'),
        language: SubtitleLanguage.describe('ISO 639-1 language code (e.g., en, ar, ur)'),
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

      // The video's own read rule (GET /api/videos/:id): a removed video, or one not open to
      // anyone that this viewer may not see, answers the same 404 as a missing video
      const video = await loadVideoRecord<{ channelId?: string; userId?: string }>(c.env as never, videoId);
      const access = await videoReadAccess(c.env, video as never, this.getUserId(c));
      if (!access) return c.json(VIDEO_NOT_FOUND, 404);
      // Only a video open to anyone may be cached publicly or revalidated (304); the owner's or a
      // channel member's read of a private, scheduled or held video is never stored anywhere
      let cacheControl = access === 'anyone' ? 'public, max-age=3600, stale-while-revalidate=86400' : 'private, no-store';

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

      // A published caption draft carries Quran markers (AUN-CAPTIONS), filled from our Quran
      // Foundation copy as it is served: the copy version is part of the ETag
      const quranTrack = key.endsWith('.vtt') && subtitleObject.customMetadata?.quran === '1';
      const quranOn = quranTrack && (await featureGate(c.env, 'quranText')).on;
      // A translated track (customMetadata.qtr) shows the official translation of the channel's
      // edition for its language, fetched live (O7): the edition is part of the ETag too
      const translatedTrack = quranTrack && subtitleObject.customMetadata?.qtr === '1';
      let edition: Awaited<ReturnType<typeof editionFor>> = null;
      if (quranTrack) cacheControl = 'private, no-cache';
      if (quranOn && translatedTrack) {
        edition = await editionFor(c.env as never, video?.channelId ?? null, language);
      }
      const etag = quranTrack
        ? `"${subtitleObject.etag.replace(/"/g, '')}-${quranOn ? await quranCopyTag(c.env.MEDIA_PRIVATE) : 'references'}${quranOn && translatedTrack ? `-e${edition?.id ?? 0}` : ''}"`
        : subtitleObject.etag;

      // Check If-None-Match header for conditional request
      const ifNoneMatch = c.req.header('If-None-Match');
      if (access === 'anyone' && ifNoneMatch && ifNoneMatch === etag) {
        // Content hasn't changed, return 304 Not Modified
        return new Response(null, {
          status: 304,
          headers: {
            'ETag': etag,
            'Cache-Control': cacheControl,
          },
        });
      }

      const raw = await subtitleObject.text();
      const content = quranTrack
        ? await fillServedTrack(raw, language, c.env.MEDIA_PRIVATE, quranOn && translatedTrack && captionMarkerRanges(raw).translation.length ? { env: c.env as never, edition } : undefined, quranOn)
        : raw;

      // Return raw subtitle content with ETag for cache validation
      return new Response(content, {
        status: 200,
        headers: {
          'Content-Type': contentType,
          'Content-Disposition': `inline; filename="${videoId}-${language}.${format || 'vtt'}"`,
          'Cache-Control': cacheControl,
          ...(access === 'anyone' ? { 'ETag': etag } : {}),
        },
      });
    } catch (error: any) {
      logger.error('Failed to get subtitle:', error);
      return c.json(
        {
          success: false,
          error: 'Failed to get subtitle',
        },
        500
      );
    }
  }
}
