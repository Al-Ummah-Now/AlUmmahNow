/**
 * List all subtitle tracks for a video
 */

import { Str } from '../../lib/chanfana-params';
import { z } from 'zod';
import { SubtitleMetadata } from '@al-ummah/shared-types';
import { logger } from '../../lib/logger';
import { OptionalAuthRoute, AppContext } from '../../base';
import { loadVideoRecord, videoReadAccess, VIDEO_NOT_FOUND } from '../../lib/videoReadAccess';

export class SubtitlesList extends OptionalAuthRoute {
  schema = {
    tags: ['Subtitles'],
    summary: 'List subtitle tracks for a video',
    description: 'Get all available subtitle tracks for a video',
    request: {
      headers: z.object({
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
                restricted: z.boolean().describe('True when the video is not open to anyone: each track must be fetched with the viewer\'s token'),
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

  async handle(c: AppContext) {
    try {
      // Get validated data
      const request = await this.getValidatedData<typeof this.schema>();
      const { videoId } = request.params;

      // The video's own read rule (GET /api/videos/:id): hidden from this viewer → the same 404
      const video = await loadVideoRecord(c.env as never, videoId);
      const access = await videoReadAccess(c.env, video as never, this.getUserId(c));
      if (!access) return c.json(VIDEO_NOT_FOUND, 404);
      // Not open to anyone: only this signed-in viewer may read the tracks, so players must fetch
      // each one with the viewer's token (a <track> URL alone gets the 404)
      const restricted = access === 'viewer';
      if (restricted) c.header('Cache-Control', 'private, no-store');

      const subtitleBucket = c.env.subtitles;

      // Load subtitle metadata
      const metadataKey = `${videoId}/metadata.json`;
      const metadataObject = await subtitleBucket.get(metadataKey);

      // No subtitles is a normal state for a video - return an empty list so
      // players can request this unconditionally without error noise.
      if (!metadataObject) {
        return c.json({
          success: true,
          data: {
            tracks: [],
            defaultLanguage: undefined,
            restricted,
          },
        });
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
          restricted,
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
