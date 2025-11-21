import { OpenAPIRoute } from 'chanfana';
import { z } from 'zod';
import { CommunityPost, PostStatus } from '@al-ummah/shared-types';
import { logger } from '../../lib/logger';

export class GetCommunityPost extends OpenAPIRoute {
  static schema = {
    tags: ['Community'],
    summary: 'Get a single community post',
    request: {
      headers: z.object({
          userId: z.string().optional().nullable(),
          channelId: z.string().optional().nullable(),
        }),
        params: z.object({
        postId: z.string(),
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
    const { postId } = c.req.param();

    try {
      // Search for the post across all channels
      // In production, you might want to maintain a global post index
      const listResult = await c.env.community_posts.list({ prefix: 'posts/' });

      for (const object of listResult.objects) {
        if (object.key.includes(`/${postId}.json`)) {
          const postData = await c.env.community_posts.get(object.key);

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
          c.env.community_posts.put(object.key, JSON.stringify(post));

          return c.json(post);
        }
      }

      return c.json({ error: 'Post not found' }, 404);
    } catch (error) {
      logger.error('Error getting community post:', error);
      return c.json({ error: 'Failed to get post' }, 500);
    }
  }
}