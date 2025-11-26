import { OpenAPIRoute } from 'chanfana';
import { z } from 'zod';
import { CommunityPost, PostStatus } from '@al-ummah/shared-types';
import { logger } from '../../lib/logger';

export class GetCommunityPost extends OpenAPIRoute {
  static schema = {
    tags: ['Community'],
    summary: 'Get a single community post',
    request: {
      params: z.object({
        channelId: z.string().describe('Channel ID that owns the post'),
        postId: z.string().describe('Post ID'),
      }),
    },
    responses: {
      200: {
        description: 'Community post details',
        content: {
          'application/json': {
            schema: z.any(), // CommunityPost schema
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
  };

  async handle(c: any): Promise<Response> {
    const { channelId: postChannelId, postId } = c.req.param();

    try {
      // Direct key lookup (O(1))
      const postKey = `posts/${postChannelId}/${postId}.json`;
      const postData = await c.env.community_posts.get(postKey);

      if (!postData) {
        return c.json({ error: 'Post not found' }, 404);
      }

      const post = await postData.json();

      // Don't show deleted posts
      if (post.status === PostStatus.DELETED) {
        return c.json({ error: 'Post not found' }, 404);
      }

      // Check if poll/quiz has ended
      if (post.poll?.votingEndsAt) {
        const endTime = new Date(post.poll.votingEndsAt);
        if (endTime < new Date()) {
          post.poll.showResults = true;
        }
      }

      // Increment view count
      post.views = (post.views || 0) + 1;

      // Save updated view count (async, don't wait)
      c.env.community_posts.put(postKey, JSON.stringify(post));

      return c.json(post);
    } catch (error) {
      logger.error('Error getting community post:', error);
      return c.json({ error: 'Failed to get post' }, 500);
    }
  }
}