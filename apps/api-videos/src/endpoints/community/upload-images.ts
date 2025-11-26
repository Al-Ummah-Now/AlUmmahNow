import { z } from 'zod';
import { AuthenticatedRoute, AppContext } from '../../base';
import BunnyStorageClient from '../../lib/bunny/storage';
import { requireSecret, requireEnvVar } from '../../lib/env-helpers';
import { addAuthToSchema } from '../../lib/openapi-auth';
import { validateImageMagicBytes, readFileHeader } from '../../lib/security/magic-bytes';
import { generateUniqueFilename } from '../../lib/security/filename-sanitize';
import { logger } from '../../lib/logger';

const MAX_IMAGES = 10;
const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB per image
const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];

const Str = (opts: { description: string }) => z.string().openapi(opts);

export class UploadCommunityPostImages extends AuthenticatedRoute {
  schema = addAuthToSchema({
    tags: ['Community'],
    summary: 'Upload images for community posts',
    description: 'Upload up to 10 images for a community post. Returns URLs for uploaded images.',
    request: {
      headers: z.object({
        channelId: Str({ description: "User's selected channel ID" }).optional(),
      }),
      body: {
        content: {
          'multipart/form-data': {
            schema: z.object({
              images: z.any().describe('Image files (up to 10, max 5MB each)'),
            }),
          },
        },
      },
    },
    responses: {
      200: {
        description: 'Images uploaded successfully',
        content: {
          'application/json': {
            schema: z.object({
              success: z.boolean(),
              images: z.array(z.object({
                url: z.string(),
                width: z.number(),
                height: z.number(),
                size: z.number(),
                mimeType: z.string(),
              })),
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
      const channelKey = `${channelId}/channel.json`;
      const channelData = await c.env.channels.get(channelKey);

      if (!channelData) {
        return c.json({ error: 'Channel not found' }, 404);
      }

      const channel = await channelData.json();
      if (channel.userId !== userId) {
        return c.json({ error: 'User does not own this channel' }, 403);
      }

      // Parse multipart form data
      const formData = await c.req.formData();
      const files: File[] = [];

      // Collect all image files
      for (const [key, value] of formData.entries()) {
        if (key === 'images' || key.startsWith('images[')) {
          if (value instanceof File) {
            files.push(value);
          }
        }
      }

      // Validate number of files
      if (files.length === 0) {
        return c.json({ error: 'No images provided' }, 400);
      }
      if (files.length > MAX_IMAGES) {
        return c.json({ error: `Maximum ${MAX_IMAGES} images allowed` }, 400);
      }

      // Get Bunny.net credentials
      const key = await requireSecret(c.env.image_storage_key, 'image_storage_key');
      const zone = requireEnvVar(c.env, 'ZONE');
      const bunnyClient = new BunnyStorageClient(zone, key);

      const uploadedImages: Array<{
        url: string;
        width: number;
        height: number;
        size: number;
        mimeType: string;
      }> = [];

      // Upload each image
      for (const file of files) {
        // SECURITY: Validate file type using magic bytes
        try {
          const fileHeader = await readFileHeader(file, 12);
          const magicByteResult = validateImageMagicBytes(fileHeader, file.type);

          if (!magicByteResult.isValid) {
            logger.warn('[SECURITY] Image upload rejected: invalid file signature', {
              userId,
              channelId,
              providedType: file.type,
              fileName: file.name,
              error: magicByteResult.error,
            });

            return c.json({
              error: magicByteResult.error || 'Invalid image file format'
            }, 400);
          }

          // Log if Content-Type header doesn't match detected format
          if (magicByteResult.mimeTypeMismatch) {
            logger.warn('[SECURITY] Image upload: MIME type mismatch', {
              userId,
              channelId,
              providedType: file.type,
              detectedType: magicByteResult.detectedMimeType,
              fileName: file.name,
            });
          }
        } catch (error) {
          logger.error('[SECURITY] Magic byte validation error', { error, userId, channelId });
          return c.json({
            error: 'Failed to validate image file'
          }, 500);
        }

        // Validate file size
        if (file.size > MAX_FILE_SIZE) {
          return c.json({
            error: `File size exceeds 5MB: ${file.name}`
          }, 400);
        }

        // SECURITY: Sanitize filename to prevent path traversal attacks
        const sanitizedFilename = generateUniqueFilename(file.name, {
          allowedExtensions: ['.jpg', '.jpeg', '.png', '.gif', '.webp'],
          toLowerCase: true,
        });

        const path = `/community-posts/${channelId}/${sanitizedFilename}`;

        logger.info('[SECURITY] Image file validated and sanitized', {
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
          return c.json({ error: `Failed to upload image: ${file.name}` }, 500);
        }

        // Get image dimensions (if available from browser)
        let width = 0;
        let height = 0;

        // Try to get dimensions from Image API (if available)
        try {
          // Create image from file data
          const arrayBuffer = await file.arrayBuffer();
          const blob = new Blob([arrayBuffer], { type: file.type });

          // Note: In Workers environment, we don't have Image API
          // Dimensions should be provided by frontend or extracted server-side
          // For now, we'll set default values and let frontend provide them
          width = 1200;
          height = 800;
        } catch (err) {
          // Fallback dimensions
          width = 1200;
          height = 800;
        }

        uploadedImages.push({
          url: `https://images.alummahnow.net${path}`,
          width,
          height,
          size: file.size,
          mimeType: file.type,
        });
      }

      return c.json({
        success: true,
        images: uploadedImages,
      });

    } catch (error) {
      logger.error('Error uploading community post images:', error);
      return c.json({
        error: error instanceof Error ? error.message : 'Failed to upload images',
      }, 500);
    }
  }
}
