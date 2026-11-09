/**
 * Delete subtitle track
 */

import { AuthenticatedRoute, AppContext } from '../../base';
import { Str } from 'chanfana';
import { z } from 'zod';
import { addAuthToSchema } from '../../lib/openapi-auth';
import R2Repository from '../../lib/r2Repo';
import { patchVideo } from '../../lib/videoWrites';
import { SubtitleService } from '../../lib/subtitles';
import Queue, { MessageType } from '../../lib/queue';
import { VideoObject, SubtitleMetadata } from '@al-ummah/shared-types';
import { logger } from '../../lib/logger';

export class SubtitlesDelete extends AuthenticatedRoute {
  schema = addAuthToSchema(
    {
      tags: ['Subtitles'],
      summary: 'Delete subtitle track',
      description: 'Delete a subtitle track for a specific language',
      request: {
        headers: z.object({
          channelId: Str({ description: "User's selected channel ID" }).optional().nullable(),
        }),
        params: z.object({
          videoId: Str({ description: 'Video ID' }),
          language: Str({ description: 'ISO 639-1 language code (e.g., en, ar, ur)' }),
        }),
      },
      responses: {
        '200': {
          description: 'Subtitle deleted successfully',
          content: {
            'application/json': {
              schema: z.object({
                success: z.boolean(),
                message: z.string(),
              }),
            },
          },
        },
        '401': {
          description: 'Unauthorized',
          content: {
            'application/json': {
              schema: z.object({
                success: z.boolean(),
                error: z.string(),
              }),
            },
          },
        },
        '403': {
          description: 'Forbidden - not video owner',
          content: {
            'application/json': {
              schema: z.object({
                success: z.boolean(),
                error: z.string(),
              }),
            },
          },
        },
        '404': {
          description: 'Video or subtitle not found',
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
    },
    'required'
  );

  async handle(c: AppContext) {
    try {
      const userId = this.getUserId(c);

      // Get validated data
      const request = await this.getValidatedData<typeof this.schema>();
      const { videoId, language } = request.params;

      // Initialize services
      const subtitleService = new SubtitleService();
      const videoRepo = new R2Repository<VideoObject>(c.env.videos);
      const subtitleBucket = c.env.subtitles;

      // Get video
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

      // Check ownership
      if (video.userId !== userId) {
        return c.json(
          {
            success: false,
            error: 'You do not have permission to modify this video',
          },
          403
        );
      }

      // Remove the track with a conditional write (SCALABILITY-AUDIT AV-3). An
      // emptied metadata file is kept (with no tracks), not deleted, so a
      // concurrent upload of another language cannot be lost; the list
      // endpoint answers the same for both.
      const metadataKey = `${videoId}/metadata.json`;
      const { data: metadata, rejected } = await new R2Repository<SubtitleMetadata>(subtitleBucket).updateObjectOrReject<true>(metadataKey, (current) => {
        if (!current.tracks.some((t) => t.language === language)) return { reject: true };
        Object.assign(current, subtitleService.removeTrack(current, language));
        return true;
      });
      if (!metadata) {
        return c.json({ success: false, error: 'No subtitles found for this video' }, 404);
      }
      if (rejected) {
        return c.json({ success: false, error: `No subtitle found for language: ${language}` }, 404);
      }

      // Delete subtitle files
      const vttKey = `${videoId}/${language}.vtt`;
      await subtitleBucket.delete(vttKey);

      // Try to delete original file (may not exist)
      const formats = ['srt', 'vtt', 'sbv'];
      for (const format of formats) {
        try {
          await subtitleBucket.delete(`${videoId}/original/${language}.${format}`);
        } catch (error) {
          // Ignore errors - file may not exist
        }
      }

      await patchVideo(videoRepo, videoId, {
        subtitles: metadata.tracks,
        hasSubtitles: metadata.tracks.length > 0,
        subtitleLanguages: metadata.tracks.map((t) => t.language),
        dateModified: new Date().toISOString(),
      }, { ownerId: userId });

      // Send queue message for subtitle deletion
      const queue = new Queue(c.env.queue);
      await queue.send(MessageType.VideoEdit, {
        videoId,
        userId,
        channelId: video.channelId,
        timestamp: new Date().toISOString(),
        action: 'subtitle_delete',
        language,
      });

      return c.json({
        success: true,
        message: `Subtitle for language ${language} deleted successfully`,
      });
    } catch (error: any) {
      logger.error('Failed to delete subtitle:', error);
      return c.json(
        {
          success: false,
          error: error.message || 'Failed to delete subtitle',
        },
        500
      );
    }
  }
}
