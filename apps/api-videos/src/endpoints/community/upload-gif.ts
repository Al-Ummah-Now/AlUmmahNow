import { z } from 'zod';
import type { Channel } from '@al-ummah/shared-types';
import { AuthenticatedRoute, AppContext } from '../../base';
import BunnyStorageClient from '../../lib/bunny/storage';
import { requireSecret, requireEnvVar } from '../../lib/env-helpers';
import { addAuthToSchema } from '../../lib/openapi-auth';
import { validateImageMagicBytes, readFileHeader } from '../../lib/security/magic-bytes';
import { generateUniqueFilename } from '../../lib/security/filename-sanitize';
import { logger } from '../../lib/logger';
import { getChannelObject } from './post-comment-helpers';

const MAX_GIF_SIZE = 10 * 1024 * 1024; // 10MB for GIFs

const Str = (opts: { description: string }) => z.string().openapi(opts);

export class UploadCommunityPostGif extends AuthenticatedRoute {
  schema = addAuthToSchema({
    tags: ['Community'],
    summary: 'Upload GIF for community post',
    description: 'Upload a single GIF for a community post. Returns URL for uploaded GIF.',
    request: {
      headers: z.object({
        channelId: Str({ description: "User's selected channel ID" }).optional().nullable(),
      }),
      body: {
        content: {
          'multipart/form-data': {
            schema: z.object({
              gif: z.any().describe('GIF file (max 10MB)'),
            }),
          },
        },
      },
    },
    responses: {
      200: {
        description: 'GIF uploaded successfully',
        content: {
          'application/json': {
            schema: z.object({
              success: z.boolean(),
              gif: z.object({
                url: z.string(),
                width: z.number(),
                height: z.number(),
                duration: z.number(),
              }),
            }),
          },
        },
      },
      400: {
        description: 'Invalid request',
        content: {
          'application/json': {
            schema: z.object({
              error: z.string(),
            }),
          },
        },
      },
    },
  }, 'required');

  async handle(c: AppContext): Promise<Response> {
    try {
      const userId = this.getUserId(c);

      const request = await this.getValidatedData<typeof this.schema>();
      const { channelId } = request.headers;

      // Verify channel ownership
      const channelData = await getChannelObject(c.env.channels, channelId);

      if (!channelData) {
        return c.json({ error: 'Channel not found' }, 404);
      }

      const channel = (await channelData.json()) as Channel;
      if (channel.userId !== userId) {
        return c.json({ error: 'User does not own this channel' }, 403);
      }

      // Parse multipart form data
      const formData = await c.req.formData();
      const file = formData.get('gif');

      if (!file || !(file instanceof File)) {
        return c.json({ error: 'No GIF file provided' }, 400);
      }

      // SECURITY: Validate file type using magic bytes (not just Content-Type header)
      try {
        const fileHeader = await readFileHeader(file, 12);
        const magicByteResult = validateImageMagicBytes(fileHeader, file.type);

        if (!magicByteResult.isValid) {
          logger.warn('[SECURITY] GIF upload rejected: invalid file signature', {
            userId,
            channelId,
            providedType: file.type,
            fileName: file.name,
            error: magicByteResult.error,
          });

          return c.json({
            error: magicByteResult.error || 'Invalid GIF file format'
          }, 400);
        }

        // Verify it's actually a GIF (not just any valid image)
        if (magicByteResult.detectedMimeType !== 'image/gif') {
          logger.warn('[SECURITY] GIF upload rejected: file is not a GIF', {
            userId,
            channelId,
            providedType: file.type,
            detectedType: magicByteResult.detectedMimeType,
            fileName: file.name,
          });

          return c.json({
            error: `Invalid file type. Expected GIF but detected ${magicByteResult.detectedFormat || 'unknown format'}`
          }, 400);
        }

        // Log if Content-Type header doesn't match
        if (magicByteResult.mimeTypeMismatch) {
          logger.warn('[SECURITY] GIF upload: MIME type mismatch', {
            userId,
            channelId,
            providedType: file.type,
            detectedType: magicByteResult.detectedMimeType,
            fileName: file.name,
          });
        }
      } catch (error) {
        logger.error('[SECURITY] GIF magic byte validation error', { error, userId, channelId });
        return c.json({
          error: 'Failed to validate GIF file'
        }, 500);
      }

      // Validate file size
      if (file.size > MAX_GIF_SIZE) {
        return c.json({ error: 'GIF size exceeds 10MB' }, 400);
      }

      // Get Bunny.net credentials
      const key = await requireSecret(c.env.image_storage_key, 'image_storage_key');
      const zone = requireEnvVar(c.env, 'ZONE');
      const bunnyClient = new BunnyStorageClient(zone, key);

      // SECURITY: Sanitize filename to prevent path traversal attacks
      const sanitizedFilename = generateUniqueFilename(file.name, {
        allowedExtensions: ['.gif'],
        toLowerCase: true,
      });

      const path = `/community-posts/${channelId}/${sanitizedFilename}`;

      logger.info('[SECURITY] GIF file validated and sanitized', {
        userId,
        channelId,
        originalName: file.name,
        sanitizedName: sanitizedFilename,
        fileSize: file.size,
      });

      // Upload to Bunny.net
      const stream = file.stream() as ReadableStream;
      const uploaded = await bunnyClient.putFile(path, stream);

      if (!uploaded) {
        return c.json({ error: 'Failed to upload GIF' }, 500);
      }

      // Note: GIF dimensions and duration should be provided by frontend
      // or extracted server-side using a GIF parsing library
      // For now, we use default values
      const width = 500;
      const height = 500;
      const duration = 5; // seconds

      return c.json({
        success: true,
        gif: {
          url: `https://images.alummahnow.net${path}`,
          width,
          height,
          duration,
        },
      });

    } catch (error) {
      logger.error('Error uploading community post GIF:', error);
      return c.json({
        error: error instanceof Error ? error.message : 'Failed to upload GIF',
      }, 500);
    }
  }
}
