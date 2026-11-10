/**
 * Upload subtitle track for a video
 */

import { canOnVideo } from "../../lib/channelAccess";
import { AuthenticatedRoute, AppContext } from '../../base';
import { Str, Bool } from 'chanfana';
import { z } from 'zod';
import { addAuthToSchema } from '../../lib/openapi-auth';
import R2Repository from '../../lib/r2Repo';
import { patchVideo } from '../../lib/videoWrites';
import { SubtitleService } from '../../lib/subtitles';
import Queue, { MessageType } from '../../lib/queue';
import { VideoObject, SubtitleTrack, SubtitleMetadata } from '@al-ummah/shared-types';
import { logger } from '../../lib/logger';

export class SubtitlesUpload extends AuthenticatedRoute {
  schema = addAuthToSchema(
    {
      tags: ['Subtitles'],
      summary: 'Upload subtitle track for a video',
      description:
        'Upload a subtitle file (.srt, .vtt, .sbv) for a video. Converts to WebVTT format automatically.',
      request: {
        headers: z.object({
          channelId: z.string().optional().nullable(),
        }),
        params: z.object({
          videoId: Str({ description: 'Video ID' }),
        }),
        body: {
          content: {
            'multipart/form-data': {
              schema: z.object({
                subtitle: z.string({ description: "Subtitle file (.srt, .vtt, .sbv); 'file' is accepted as an alias" }),
                language: Str({
                  description: 'ISO 639-1 language code (e.g., en, ar, ur)',
                }),
                label: Str({ description: 'Display label for language' }).optional(),
                isDefault: Bool({ description: 'Set as default subtitle track' }).optional(),
              }),
            },
          },
        },
      },
      responses: {
        '200': {
          description: 'Subtitle uploaded successfully',
          content: {
            'application/json': {
              schema: z.object({
                success: z.boolean(),
                data: z.object({
                  track: z.any(), // SubtitleTrack
                  video: z.any(), // VideoObject with updated subtitles
                }),
              }),
            },
          },
        },
        '400': {
          description: 'Bad request - invalid input or file format',
          content: {
            'application/json': {
              schema: z.object({
                success: z.boolean(),
                error: z.string(),
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
        '404': {
          description: 'Video not found',
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

      // Get validated data (params/headers only - chanfana does not parse multipart bodies)
      const request = await this.getValidatedData<typeof this.schema>();
      const { videoId } = request.params;

      const form = await c.req.parseBody();
      const rawFile = form['subtitle'] ?? form['file'];
      const file = typeof rawFile === 'string'
        ? rawFile
        : rawFile instanceof File
          ? await rawFile.text()
          : '';
      const language = typeof form['language'] === 'string' ? form['language'].trim() : '';
      const label = typeof form['label'] === 'string' && form['label'].trim() ? form['label'].trim() : undefined;
      const isDefault = form['isDefault'] === 'true' || form['isDefault'] === '1';

      if (!file || !language) {
        return c.json(
          {
            success: false,
            error: "Both a subtitle file (field 'subtitle') and 'language' are required",
          },
          400
        );
      }

      // Initialize services
      const subtitleService = new SubtitleService();
      const videoRepo = new R2Repository<VideoObject>(c.env.videos);
      const subtitleBucket = c.env.subtitles;

      // Validate language
      if (!subtitleService.validateLanguage(language)) {
        return c.json(
          {
            success: false,
            error: `Unsupported language: ${language}. Supported languages: ar, en, ur, fr, id, tr, ms, bn, de, es`,
          },
          400
        );
      }

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
      if (!(await canOnVideo(c.env as never, video, userId, 'video.edit'))) {
        return c.json(
          {
            success: false,
            error: 'You do not have permission to modify this video',
          },
          403
        );
      }

      // Process subtitle file
      const result = await subtitleService.processSubtitle(file, language, userId);

      // Store WebVTT file in R2
      const vttKey = `${videoId}/${language}.vtt`;
      await subtitleBucket.put(vttKey, result.webvttContent, {
        httpMetadata: {
          contentType: 'text/vtt',
        },
      });

      // Store original file as backup
      const originalKey = `${videoId}/original/${language}.${result.originalFormat}`;
      await subtitleBucket.put(originalKey, file, {
        httpMetadata: {
          contentType: 'text/plain',
        },
      });

      // Generate API URL for WebVTT file
      // Subtitles are served directly via the API endpoint (no separate CDN needed)
      const apiBaseUrl = c.env.Audience || new URL(c.req.url).origin;
      const subtitleUrl = `${apiBaseUrl}/api/videos/${videoId}/subtitles/${language}`;

      // Create complete track with URL
      const track: SubtitleTrack = {
        ...result.track,
        url: subtitleUrl,
        label: label || result.track.label,
        isDefault: isDefault || false,
      };

      // Add the track to the subtitle metadata and the video with conditional
      // writes (SCALABILITY-AUDIT AV-3): two languages uploaded at once both
      // stay, and concurrent changes to the video are not overwritten.
      const metadataKey = `${videoId}/metadata.json`;
      const metadata = await new R2Repository<SubtitleMetadata>(subtitleBucket).updateObject(metadataKey, (current) => {
        let next = subtitleService.addTrack(current, track);
        // Update default if requested
        if (isDefault) {
          next = subtitleService.setDefaultTrack(next, language);
        }
        Object.assign(current, next);
      }, { initial: () => subtitleService.createMetadata(videoId, []) });

      const saved = await patchVideo(videoRepo, videoId, {
        subtitles: metadata.tracks,
        hasSubtitles: true,
        subtitleLanguages: metadata.tracks.map((t) => t.language),
        dateModified: new Date().toISOString(),
      }, { ownerId: video.userId });
      if (saved.status === 'missing') {
        return c.json({ success: false, error: 'Video not found' }, 404);
      }
      if (saved.status === 'forbidden') {
        return c.json({ success: false, error: 'You do not have permission to modify this video' }, 403);
      }
      const updatedVideo = saved.video;

      // Send queue message for subtitle upload
      const queue = new Queue(c.env.queue);
      await queue.send(MessageType.VideoEdit, {
        videoId,
        userId,
        channelId: video.channelId,
        timestamp: new Date().toISOString(),
        action: 'subtitle_upload',
        language,
      });

      return c.json({
        success: true,
        data: {
          track,
          video: updatedVideo,
        },
      });
    } catch (error: any) {
      logger.error('Subtitle upload failed:', error);
      return c.json(
        {
          success: false,
          error: error.message || 'Failed to upload subtitle',
        },
        500
      );
    }
  }
}
