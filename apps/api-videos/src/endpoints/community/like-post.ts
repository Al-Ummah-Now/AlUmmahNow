import { z } from 'zod';
import { CommunityPost, LikePostResponse } from '@al-ummah/shared-types';
import { AuthenticatedRoute, AppContext } from '../../base';
import { addAuthToSchema } from '../../lib/openapi-auth';
import Queue, { MessageType } from '../../lib/queue';
import { logger } from '../../lib/logger';

export class LikeCommunityPost extends AuthenticatedRoute {
  schema = addAuthToSchema({
    tags: ['Community'],
    summary: 'Like a community post',
    request: {
      params: z.object({
        channelId: z.string().describe('Channel ID that owns the post'),
        postId: z.string().describe('Post ID to like'),
      }),
      headers: z.object({
        channelId: z.string().optional().describe('Actor channel ID (the channel performing the like)'),
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

  async handle(c: AppContext): Promise<Response> {
    const userId = this.getUserId(c);
    const { channelId: postChannelId, postId } = c.req.param();
    const request: any = await this.getValidatedData<typeof this.schema>();
    const userChannelId = request.headers?.channelId;

    try {
      // Direct key lookup (O(1))
      const postKey = `posts/${postChannelId}/${postId}.json`;
      const postData = await c.env.community_posts.get(postKey);

      if (!postData) {
        return c.json({ error: 'Post not found' }, 404);
      }

      const post: CommunityPost = await postData.json();

      // Check if user already liked
      const likeKey = `likes/${postId}/${userId}.json`;
      const existingLike = await c.env.community_posts.get(likeKey);

      if (!existingLike) {
        // Add like
        const likeRecord = {
          userId: userId,
          userChannelId: userChannelId,
          postId,
          likedAt: new Date().toISOString(),
        };
        await c.env.community_posts.put(likeKey, JSON.stringify(likeRecord));

        // Queue message for async counter update (fix race condition)
        const queue = new Queue(c.env.queue);
        await queue.send(MessageType.CommunityPostLiked, {
          postId,
          channelId: post.channelId,
          actor: {
            userId,
            channelId: userChannelId,
          },
          timestamp: new Date().toISOString()
        });

        // The stored counter is updated by the processor; return the projected
        // count so clients do not roll back their optimistic increment.
        return c.json({
          success: true,
          liked: true,
          totalLikes: (post.likes || 0) + 1,
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