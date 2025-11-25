import { OpenAPIRoute } from 'chanfana';
import { z } from 'zod';
import { CommunityPost, PostStatus } from '@al-ummah/shared-types';
import { getAuthContext } from '../../middleware/auth';
import { addAuthToSchema } from '../../lib/openapi-auth';
import Queue, { MessageType } from '../../lib/queue';
import { logger } from '../../lib/logger';

export class DeleteCommunityPost extends OpenAPIRoute {
  static schema = addAuthToSchema({
    tags: ['Community'],
    summary: 'Delete a community post',
    request: {
      params: z.object({
        postId: z.string(),
      }),
      headers: z.object({
        channelId: z.string(),
      }),
    },
    responses: {
      200: {
        description: 'Post deleted successfully',
        content: {
          'application/json': {
            schema: z.object({
              success: z.boolean(),
              message: z.string(),
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
    const { channelId } = request.headers;

    if (!channelId) {
      return c.json({ error: 'channelId header is required for deleting posts' }, 400);
    }

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

      // Check ownership
      if (post.channelId !== channelId) {
        return c.json({ error: 'You can only delete your own posts' }, 403);
      }

      // Soft delete - mark as deleted but preserve data
      post.status = PostStatus.DELETED;
      post.updatedAt = new Date().toISOString();

      await c.env.community_posts.put(postKey, JSON.stringify(post));

      // Remove from channel index
      await this.removeFromChannelIndex(c, channelId, postId);

      // Send deletion event to queue
      const queue = new Queue(c.env.queue);
      await queue.send(MessageType.CommunityPostDeleted, {
        postId: postId,
        channelId: channelId,
        timestamp: new Date().toISOString()
      });

      return c.json({
        success: true,
        message: 'Post deleted successfully'
      });
    } catch (error) {
      logger.error('Error deleting community post:', error);
      return c.json({ error: 'Failed to delete post' }, 500);
    }
  }

  private async removeFromChannelIndex(c: any, channelId: string, postId: string) {
    const indexKey = `posts/${channelId}/index.json`;
    const existing = await c.env.community_posts.get(indexKey);

    if (existing) {
      const index = await existing.json();

      // Remove post ID from index
      index.postIds = index.postIds.filter(id => id !== postId);
      index.lastUpdated = new Date().toISOString();

      await c.env.community_posts.put(indexKey, JSON.stringify(index));
    }
  }
}