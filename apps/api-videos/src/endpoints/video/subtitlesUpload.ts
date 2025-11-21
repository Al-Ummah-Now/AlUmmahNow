/**
 * Upload subtitle track for a video
 */

import { OpenAPIRoute, Str, Bool } from 'chanfana';
import { z } from 'zod';
import { addAuthToSchema } from '../../lib/openapi-auth';
import R2Repository from '../../lib/r2Repo';
import { SubtitleService } from '../../lib/subtitles';
import { VideoObject, SubtitleTrack, SubtitleMetadata } from '@al-ummah/shared-types';

export class SubtitlesUpload extends OpenAPIRoute {
  schema = addAuthToSchema(
    {
      tags: ['Subtitles'],
      summary: 'Upload subtitle track for a video',
      description:
        'Upload a subtitle file (.srt, .vtt, .sbv) for a video. Converts to WebVTT format automatically.',
      request: {
        params: z.object({
          videoId: Str({ description: 'Video ID' }),
        }),
        body: {
          content: {
            'multipart/form-data': {
              schema: z.object({
                file: z.string({ description: 'Subtitle file content' }),
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
      const { videoId } = request.params;
      const { file, language, label, isDefault } = request.body;

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
      if (video.userId !== userId) {
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

      // Generate CDN URL for WebVTT file
      // Note: In production, this should use your CDN domain
      const cdnUrl = `${c.env.SUBTITLE_CDN_URL || 'https://subtitles.alummahnow.net'}/${vttKey}`;

      // Create complete track with URL
      const track: SubtitleTrack = {
        ...result.track,
        url: cdnUrl,
        label: label || result.track.label,
        isDefault: isDefault || false,
      };

      // Load or create subtitle metadata
      const metadataKey = `${videoId}/metadata.json`;
      const existingMetadata = await subtitleBucket.get(metadataKey);

      let metadata: SubtitleMetadata;
      if (existingMetadata) {
        const existingData = (await existingMetadata.json()) as SubtitleMetadata;
        metadata = subtitleService.addTrack(existingData, track);

        // Update default if requested
        if (isDefault) {
          metadata = subtitleService.setDefaultTrack(metadata, language);
        }
      } else {
        metadata = subtitleService.createMetadata(videoId, [track]);
      }

      // Save metadata
      await subtitleBucket.put(metadataKey, JSON.stringify(metadata), {
        httpMetadata: {
          contentType: 'application/json',
        },
      });

      // Update video object with subtitle info
      const updatedVideo: VideoObject = {
        ...video,
        subtitles: metadata.tracks,
        hasSubtitles: true,
        subtitleLanguages: metadata.tracks.map((t) => t.language),
        dateModified: new Date().toISOString(),
      };

      await videoRepo.putObject(videoId, updatedVideo);

      return c.json({
        success: true,
        data: {
          track,
          video: updatedVideo,
        },
      });
    } catch (error: any) {
      console.error('Subtitle upload failed:', error);
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
