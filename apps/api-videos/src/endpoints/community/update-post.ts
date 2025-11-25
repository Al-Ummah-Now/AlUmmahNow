import { OpenAPIRoute } from 'chanfana';
import { z } from 'zod';
import {
  CommunityPost,
  PostVisibility,
  UpdateCommunityPostRequest,
} from '@al-ummah/shared-types';
import { getAuthContext } from '../../middleware/auth';
import { addAuthToSchema } from '../../lib/openapi-auth';
import { validateUpdatePost } from '../../validation/community-posts';
import { logger } from '../../lib/logger';

const updatePostSchema = z.object({
  content: z.string().max(5000).optional(),
  visibility: z.nativeEnum(PostVisibility).optional(),
  commentsEnabled: z.boolean().optional(),
  scheduledAt: z.string().datetime().optional(),
  pinned: z.boolean().optional(),
});

export class UpdateCommunityPost extends OpenAPIRoute {
  static schema = addAuthToSchema({
    tags: ['Community'],
    summary: 'Update a community post',
    request: {
      params: z.object({
        postId: z.string(),
      }),
      headers: z.object({
        channelId: z.string(),
      }),
      body: {
        content: {
          'application/json': {
            schema: updatePostSchema,
          },
        },
      },
    },
    responses: {
      200: {
        description: 'Post updated successfully',
        content: {
          'application/json': {
            schema: z.object({
              success: z.boolean(),
              post: z.any(),
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
      403: {
        description: 'Forbidden - not the post owner',
        content: {
          'application/json': {
            schema: z.object({
              error: z.string(),
            }),
          },
        },
      },
      404: {
        description: 'Post not found',
        content: {
          'application/json': {
            schema: z.object({
              error: z.string(),
            }),
          },
        },
      },
    },
  });

  async handle(c: any): Promise<Response> {
    const auth = c.get('auth');
    if (!auth) {
      return c.json({ error: 'Unauthorized' }, 401);
    }
    const userId = auth.userId;

    const { postId } = c.req.param();
    const request: any = await this.getValidatedData<typeof this.schema>();
    const body: any = request.body;
    const { channelId } = request.headers;

    if (!body) {
      return c.json({ error: 'Request body is required' }, 400);
    }

    if (!channelId) {
      return c.json({ error: 'channelId header is required for updating posts' }, 400);
    }

    const user = {
      ...auth,
      channelId,
      userId,
    };

    try {
      // Find and get the post
      let postKey: string | null = null;
      let post: CommunityPost | null = null;

      const listResult = await c.env.community_posts.list({ prefix: 'posts/' });

      for (const object of listResult.objects) {
        if (object.key.includes(`/${postId}.json`)) {
          postKey = object.key;
          const postData = await c.env.community_posts.get(object.key);
          if (postData) {
            post = await postData.json();
          }
          break;
        }
      }

      if (!post || !postKey) {
        return c.json({ error: 'Post not found' }, 404);
      }

      // Validate update
      const validation = await validateUpdatePost(body, post, user);
      if (!validation.valid) {
        return c.json({ error: validation.error }, 400);
      }

      // Update allowed fields
      if (body.content !== undefined) {
        post.content = body.content;
      }
      if (body.visibility !== undefined) {
        post.visibility = body.visibility;
      }
      if (body.commentsEnabled !== undefined) {
        post.commentsEnabled = body.commentsEnabled;
      }
      if (body.scheduledAt !== undefined) {
        post.scheduledAt = body.scheduledAt;
      }
      if (body.pinned !== undefined) {
        post.pinned = body.pinned;
      }

      post.updatedAt = new Date().toISOString();

      // Save updated post
      await c.env.community_posts.put(postKey, JSON.stringify(post));

      return c.json({ success: true, post });
    } catch (error) {
      logger.error('Error updating community post:', error);
      return c.json({ error: 'Failed to update post' }, 500);
    }
  }
}