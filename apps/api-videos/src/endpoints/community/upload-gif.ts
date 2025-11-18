import { OpenAPIRoute } from 'chanfana';
import { z } from 'zod';
import BunnyStorageClient from '../../lib/bunny/storage';
import { requireSecret, requireEnvVar } from '../../lib/env-helpers';
import { addAuthToSchema } from '../../lib/openapi-auth';

const MAX_GIF_SIZE = 10 * 1024 * 1024; // 10MB for GIFs

export class UploadCommunityPostGif extends OpenAPIRoute {
  schema = addAuthToSchema({
    tags: ['Community'],
    summary: 'Upload GIF for community post',
    description: 'Upload a single GIF for a community post. Returns URL for uploaded GIF.',
    request: {
      headers: z.object({
        channelId: z.string(),
        userId: z.string(),
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

  async handle(c: any): Promise<Response> {
    try {
      const auth = c.get('auth');
      const request = await this.getValidatedData<typeof this.schema>();
      const { channelId, userId } = request.headers;

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
      const file = formData.get('gif');

      if (!file || !(file instanceof File)) {
        return c.json({ error: 'No GIF file provided' }, 400);
      }

      // Validate file type
      if (file.type !== 'image/gif') {
        return c.json({ error: 'Invalid file type. Must be image/gif' }, 400);
      }

      // Validate file size
      if (file.size > MAX_GIF_SIZE) {
        return c.json({ error: 'GIF size exceeds 10MB' }, 400);
      }

      // Get Bunny.net credentials
      const key = await requireSecret(c.env.image_storage_key, 'image_storage_key');
      const zone = requireEnvVar(c.env, 'ZONE');
      const bunnyClient = new BunnyStorageClient(zone, key);

      // Generate unique filename
      const gifId = crypto.randomUUID();
      const path = `/community-posts/${channelId}/${gifId}.gif`;

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
      console.error('Error uploading community post GIF:', error);
      return c.json({
        error: error instanceof Error ? error.message : 'Failed to upload GIF',
      }, 500);
    }
  }
}
