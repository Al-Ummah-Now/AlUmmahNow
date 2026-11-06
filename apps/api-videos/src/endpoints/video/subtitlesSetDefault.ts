/**
 * Set the default subtitle track for a video (owner only)
 *
 * PUT /api/videos/:videoId/subtitles/:language/default
 */

import { AuthenticatedRoute, AppContext } from '../../base';
import { Str } from 'chanfana';
import { z } from 'zod';
import { addAuthToSchema } from '../../lib/openapi-auth';
import R2Repository from '../../lib/r2Repo';
import { SubtitleService } from '../../lib/subtitles';
import Queue, { MessageType } from '../../lib/queue';
import { VideoObject, SubtitleMetadata } from '@al-ummah/shared-types';
import { logger } from '../../lib/logger';

const ErrorSchema = z.object({ success: z.boolean(), error: z.string() });

export class SubtitlesSetDefault extends AuthenticatedRoute {
  schema = addAuthToSchema(
    {
      tags: ['Subtitles'],
      summary: 'Set default subtitle track',
      description: 'Mark one subtitle track as the default; all other tracks for the video are un-marked.',
      request: {
        headers: z.object({
          channelId: z.string().optional().nullable(),
        }),
        params: z.object({
          videoId: Str({ description: 'Video ID' }),
          language: Str({ description: 'ISO 639-1 language code of the track to make default' }),
        }),
      },
      responses: {
        '200': {
          description: 'Default track updated',
          content: {
            'application/json': {
              schema: z.object({
                success: z.boolean(),
                data: z.object({
                  tracks: z.array(z.any()),
                  defaultLanguage: z.string(),
                }),
              }),
            },
          },
        },
        '403': { description: 'Not the video owner', content: { 'application/json': { schema: ErrorSchema } } },
        '404': { description: 'Video or subtitle track not found', content: { 'application/json': { schema: ErrorSchema } } },
        '500': { description: 'Internal server error', content: { 'application/json': { schema: ErrorSchema } } },
      },
    },
    'required'
  );

  async handle(c: AppContext) {
    const userId = this.getUserId(c);
    const request = await this.getValidatedData<typeof this.schema>();
    const { videoId, language } = request.params;

    try {
      const subtitleService = new SubtitleService();
      const videoRepo = new R2Repository<VideoObject>(c.env.videos);
      const subtitleBucket = c.env.subtitles;

      const video = await videoRepo.getObject(videoId);
      if (!video) {
        return c.json({ success: false, error: 'Video not found' }, 404);
      }

      if (video.userId !== userId) {
        return c.json({ success: false, error: 'You do not have permission to modify this video' }, 403);
      }

      const metadataKey = `${videoId}/metadata.json`;
      const metadataObject = await subtitleBucket.get(metadataKey);
      if (!metadataObject) {
        return c.json({ success: false, error: 'No subtitles found for this video' }, 404);
      }

      const metadata = (await metadataObject.json()) as SubtitleMetadata;
      if (!metadata.tracks.some((t) => t.language === language)) {
        return c.json({ success: false, error: `No subtitle found for language: ${language}` }, 404);
      }

      const updatedMetadata = subtitleService.setDefaultTrack(metadata, language);

      await subtitleBucket.put(metadataKey, JSON.stringify(updatedMetadata), {
        httpMetadata: { contentType: 'application/json' },
      });

      await videoRepo.putObject(videoId, {
        ...video,
        subtitles: updatedMetadata.tracks,
        dateModified: new Date().toISOString(),
      });

      const queue = new Queue(c.env.queue);
      await queue.send(MessageType.VideoEdit, {
        videoId,
        userId,
        channelId: video.channelId,
        timestamp: new Date().toISOString(),
        action: 'subtitle_set_default',
        language,
      });

      logger.info('[SubtitlesSetDefault] Default subtitle updated', { videoId, language, userId });

      return c.json({
        success: true,
        data: {
          tracks: updatedMetadata.tracks,
          defaultLanguage: language,
        },
      });
    } catch (error) {
      logger.error('[SubtitlesSetDefault] Failed', {
        videoId,
        language,
        error: error instanceof Error ? error.message : String(error),
      });
      return c.json({ success: false, error: 'Failed to set default subtitle' }, 500);
    }
  }
}
