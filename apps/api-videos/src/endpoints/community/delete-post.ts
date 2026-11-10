import { z } from 'zod';
import { CommunityPost, PostStatus } from '@al-ummah/shared-types';
import { AuthenticatedRoute, AppContext } from '../../base';
import { addAuthToSchema } from '../../lib/openapi-auth';
import Queue, { MessageType } from '../../lib/queue';
import { logger } from '../../lib/logger';
import R2Repository, { rethrowBusy } from '../../lib/r2Repo';

export class DeleteCommunityPost extends AuthenticatedRoute {
  schema = addAuthToSchema({
    tags: ['Community'],
    summary: 'Delete a community post',
    request: {
      params: z.object({
        channelId: z.string().describe('Channel ID that owns the post'),
        postId: z.string().describe('Post ID to delete'),
      }),
      headers: z.object({
        channelId: z.string().describe('Actor channel ID (must own the post)'),
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

  async handle(c: AppContext): Promise<Response> {
    const userId = this.getUserId(c);

    const { channelId: postChannelId, postId } = c.req.param();
    const request: any = await this.getValidatedData<typeof this.schema>();
    const userChannelId = request.headers?.channelId;

    // Verify user owns the channel they're trying to delete from
    if (userChannelId !== postChannelId) {
      return c.json({ error: 'You can only delete posts from your own channel' }, 403);
    }

    try {
      // Direct key lookup (O(1))
      const postKey = `posts/${postChannelId}/${postId}.json`;
      const postData = await c.env.community_posts.get(postKey);

      if (!postData) {
        return c.json({ error: 'Post not found' }, 404);
      }

      const post: CommunityPost = await postData.json();

      // Check ownership
      if (post.channelId !== postChannelId) {
        return c.json({ error: 'You can only delete your own posts' }, 403);
      }

      // Soft delete - mark as deleted but preserve data. Conditional write on
      // the fresh post (SCALABILITY-AUDIT AV-9) so no concurrent writer's
      // stale copy can bring it back, and nothing they stored is lost.
      const deleted = await new R2Repository<CommunityPost>(c.env.community_posts).updateObject(postKey, (fresh) => {
        if (fresh.status === PostStatus.DELETED) return false;
        fresh.status = PostStatus.DELETED;
        fresh.updatedAt = new Date().toISOString();
        return true;
      });
      if (!deleted) {
        return c.json({ error: 'Post not found' }, 404);
      }

      // Remove from channel index
      await this.removeFromChannelIndex(c, postChannelId, postId);

      // Send deletion event to queue
      const queue = new Queue(c.env.queue);
      await queue.send(MessageType.CommunityPostDeleted, {
        postId: postId,
        channelId: postChannelId,
        actor: {
          userId,
          channelId: userChannelId,
        },
        timestamp: new Date().toISOString()
      });

      return c.json({
        success: true,
        message: 'Post deleted successfully'
      });
    } catch (error) {
      rethrowBusy(error);
      logger.error('Error deleting community post:', error);
      return c.json({ error: 'Failed to delete post' }, 500);
    }
  }

  private async removeFromChannelIndex(c: any, channelId: string, postId: string) {
    type PostIndex = { postIds: string[]; lastUpdated: string };
    // Conditional write: concurrent creates/deletes must not overwrite each other's index change
    await new R2Repository<PostIndex>(c.env.community_posts).updateObject(`posts/${channelId}/index.json`, (index) => {
      if (!index.postIds.includes(postId)) return false;
      index.postIds = index.postIds.filter((id) => id !== postId);
      index.lastUpdated = new Date().toISOString();
      return true;
    });
  }
}