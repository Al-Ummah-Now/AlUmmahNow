import { z } from 'zod';
import { can, CommunityPost, PostStatus } from '@al-ummah/shared-types';
import { roleOnChannel } from '../../lib/channelAccess';
import { deletePostCommentRows, executionCtxOf, reportIndexFailure } from '../../lib/channelComments';
import { AuthenticatedRoute, AppContext } from '../../base';
import { addAuthToSchema } from '../../lib/openapi-auth';
import Queue, { MessageType } from '../../lib/queue';
import { logger } from '../../lib/logger';
import { recordDeletion } from '../../lib/admin/deletions';
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
        channelId: z.string().describe('Actor channel ID (the channel, as its owner or a member with post.manage)'),
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

    // The owner, or a member whose channel role grants post.manage (admin, editor); never a site role
    if (!can(await roleOnChannel(c.env as never, postChannelId, userId).catch(() => null), 'post.manage')) {
      return c.json({ error: 'You may not delete posts on this channel' }, 403);
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
      const at = new Date().toISOString();
      let changed = false;
      const deleted = await new R2Repository<CommunityPost & { ownerDeletion?: unknown }>(c.env.community_posts).updateObject(postKey, (fresh) => {
        if (fresh.status === PostStatus.DELETED) return false;
        // What a restore (admin "Recently deleted") puts back
        fresh.ownerDeletion = { at, by: userId, previousStatus: fresh.status ?? PostStatus.PUBLISHED };
        fresh.status = PostStatus.DELETED;
        fresh.updatedAt = at;
        changed = true;
        return true;
      });
      if (!deleted) {
        return c.json({ error: 'Post not found' }, 404);
      }

      // The hourly cleanup erases it, with its images, after 30 days (lib/admin/deletions.ts; #699)
      if (changed && c.env.SEARCH_DB) {
        await recordDeletion(c.env.SEARCH_DB as never, {
          kind: 'post',
          id: postId,
          parentId: postChannelId,
          title: typeof deleted.content === 'string' ? deleted.content : '',
          ownerId: (deleted as { userId?: string }).userId ?? userId,
          channelId: postChannelId,
          deletedBy: userId,
          deletedAt: at,
        });
      }

      // Remove from channel index
      await this.removeFromChannelIndex(c, postChannelId, postId);

      // Its comments leave Studio's comment list (lib/channelComments)
      if (c.env.SEARCH_DB) {
        await deletePostCommentRows(c.env.SEARCH_DB as never, postId).catch((error) =>
          reportIndexFailure(c.env as never, executionCtxOf(c as never), error, { channelId: postChannelId, targetKind: 'post', targetId: postId }),
        );
      }

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