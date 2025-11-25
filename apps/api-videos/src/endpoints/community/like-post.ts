import { OpenAPIRoute } from 'chanfana';
import { z } from 'zod';
import { CommunityPost, LikePostResponse } from '@al-ummah/shared-types';
import { getAuthContext } from '../../middleware/auth';
import { addAuthToSchema } from '../../lib/openapi-auth';
import Queue, { MessageType } from '../../lib/queue';
import { logger } from '../../lib/logger';

export class LikeCommunityPost extends OpenAPIRoute {
  static schema = addAuthToSchema({
    tags: ['Community'],
    summary: 'Like a community post',
    request: {
      params: z.object({
        postId: z.string(),
      }),
      headers: z.object({
        channelId: z.string().optional(),
      }),
    },
    responses: {
      200: {
        description: 'Post liked successfully',
        content: {
          'application/json': {
            schema: z.object({
              success: z.boolean(),
              liked: z.boolean(),
              totalLikes: z.number(),
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

    const { postId } = c.req.param();
    const request: any = await this.getValidatedData<typeof this.schema>();
    const { channelId } = request.headers;
    const userId = auth.userId;

    try {
      // Find the post - use direct lookup if channelId provided, otherwise scan
      let postKey: string | null = null;
      let post: CommunityPost | null = null;

      if (channelId) {
        // Direct key lookup when channelId is provided (O(1))
        postKey = `posts/${channelId}/${postId}.json`;
        const postData = await c.env.community_posts.get(postKey);
        if (postData) {
          post = await postData.json();
        }
      } else {
        // Fallback: scan all posts (N+1 query)
        // TODO: Implement postId → channelId mapping in KV for O(1) lookups
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
      }

      if (!post || !postKey) {
        return c.json({ error: 'Post not found' }, 404);
      }

      // Check if user already liked
      const likeKey = `likes/${postId}/${userId}.json`;
      const existingLike = await c.env.community_posts.get(likeKey);

      if (!existingLike) {
        // Add like
        const likeRecord = {
          userId: userId,
          channelId: channelId,
          postId,
          likedAt: new Date().toISOString(),
        };
        await c.env.community_posts.put(likeKey, JSON.stringify(likeRecord));

        // Queue message for async counter update (fix race condition)
        const queue = new Queue(c.env.queue);
        await queue.send(MessageType.CommunityPostLiked, {
          postId,
          channelId: post.channelId,
          userId: userId,
          likerChannelId: channelId,
          timestamp: new Date().toISOString()
        });

        // Return current count without incrementing (processor will handle it)
        return c.json({
          success: true,
          liked: true,
          totalLikes: post.likes || 0,
        });
      } else {
        // Already liked
        return c.json({
          success: true,
          liked: true,
          totalLikes: post.likes || 0,
        });
      }
    } catch (error) {
      logger.error('Error liking community post:', error);
      return c.json({ error: 'Failed to like post' }, 500);
    }
  }
}