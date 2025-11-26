import { OpenAPIRoute } from 'chanfana';
import { z } from 'zod';
import { CommunityPost, LikePostResponse } from '@al-ummah/shared-types';
import { getAuthContext } from '../../middleware/auth';
import { addAuthToSchema } from '../../lib/openapi-auth';
import Queue, { MessageType } from '../../lib/queue';
import { logger } from '../../lib/logger';

export class UnlikeCommunityPost extends OpenAPIRoute {
  static schema = addAuthToSchema({
    tags: ['Community'],
    summary: 'Unlike a community post',
    request: {
      params: z.object({
        channelId: z.string().describe('Channel ID that owns the post'),
        postId: z.string().describe('Post ID to unlike'),
      }),
      headers: z.object({
        channelId: z.string().optional().describe('Actor channel ID (the channel removing the like)'),
      }),
    },
    responses: {
      200: {
        description: 'Post unliked successfully',
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

    const { channelId: postChannelId, postId } = c.req.param();
    const request: any = await this.getValidatedData<typeof this.schema>();
    const userChannelId = request.headers?.channelId;
    const userId = auth.userId;

    try {
      // Direct key lookup (O(1))
      const postKey = `posts/${postChannelId}/${postId}.json`;
      const postData = await c.env.community_posts.get(postKey);

      if (!postData) {
        return c.json({ error: 'Post not found' }, 404);
      }

      const post: CommunityPost = await postData.json();

      // Check if user liked
      const likeKey = `likes/${postId}/${userId}.json`;
      const existingLike = await c.env.community_posts.get(likeKey);

      if (existingLike) {
        // Remove like
        await c.env.community_posts.delete(likeKey);

        // Queue message for async counter update (fix race condition)
        const queue = new Queue(c.env.queue);
        await queue.send(MessageType.CommunityPostUnliked, {
          postId,
          channelId: post.channelId,
          actor: {
            userId,
            channelId: userChannelId,
          },
          timestamp: new Date().toISOString()
        });

        // Return current count without decrementing (processor will handle it)
        return c.json({
          success: true,
          liked: false,
          totalLikes: post.likes || 0,
        });
      } else {
        // Not liked
        return c.json({
          success: true,
          liked: false,
          totalLikes: post.likes || 0,
        });
      }
    } catch (error) {
      logger.error('Error unliking community post:', error);
      return c.json({ error: 'Failed to unlike post' }, 500);
    }
  }
}