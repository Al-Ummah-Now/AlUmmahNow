/**
 * Delete subtitle track
 */

import { OpenAPIRoute, Str } from 'chanfana';
import { z } from 'zod';
import { addAuthToSchema } from '../../lib/openapi-auth';
import R2Repository from '../../lib/r2Repo';
import { SubtitleService } from '../../lib/subtitles';
import Queue, { MessageType } from '../../lib/queue';
import { VideoObject, SubtitleMetadata } from '@al-ummah/shared-types';
import { logger } from '../../lib/logger';

export class SubtitlesDelete extends OpenAPIRoute {
  schema = addAuthToSchema(
    {
      tags: ['Subtitles'],
      summary: 'Delete subtitle track',
      description: 'Delete a subtitle track for a specific language',
      request: {
        headers: z.object({
          channelId: z.string().optional().nullable(),
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

  async handle(c: any) {
    try {
      // Auth check
      const auth = c.get('auth');
      if (!auth) {
        return c.json(
          {
            success: false,
            error: 'Unauthorized',
          },
          401
        );
      }

      const userId = auth.userId;

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

      // Check if language exists
      const trackExists = metadata.tracks.some((t) => t.language === language);
      if (!trackExists) {
        return c.json(
          {
            success: false,
            error: `No subtitle found for language: ${language}`,
          },
          404
        );
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

      // Update metadata
      const updatedMetadata = subtitleService.removeTrack(metadata, language);

      // Save or delete metadata
      if (updatedMetadata.tracks.length === 0) {
        // No more subtitles - delete metadata file
        await subtitleBucket.delete(metadataKey);

        // Update video object
        const updatedVideo: VideoObject = {
          ...video,
          subtitles: [],
          hasSubtitles: false,
          subtitleLanguages: [],
          dateModified: new Date().toISOString(),
        };

        await videoRepo.putObject(videoId, updatedVideo);
      } else {
        // Save updated metadata
        await subtitleBucket.put(metadataKey, JSON.stringify(updatedMetadata), {
          httpMetadata: {
            contentType: 'application/json',
          },
        });

        // Update video object
        const updatedVideo: VideoObject = {
          ...video,
          subtitles: updatedMetadata.tracks,
          hasSubtitles: true,
          subtitleLanguages: updatedMetadata.tracks.map((t) => t.language),
          dateModified: new Date().toISOString(),
        };

        await videoRepo.putObject(videoId, updatedVideo);
      }

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
