import { findPostComment } from './post-comment-helpers';
import { addToCommentIndex, patchComment, removeFromCommentIndex } from '../../lib/community-comments';
import { bumpPostComments } from '../../lib/community-posts';
import { Str } from '../../lib/chanfana-params';
import { z } from 'zod';
import { AuthenticatedRoute, AppContext } from '../../base';
import { addAuthToSchema } from '../../lib/openapi-auth';
import Queue, { MessageType } from '../../lib/queue';
import { can, type PostComment, type CommunityPost } from '@al-ummah/shared-types';
import { roleOnChannel } from '../../lib/channelAccess';
import { executionCtxOf, indexPostComment } from '../../lib/channelComments';
import { moderatePostComment, moderationStatus } from '../../lib/channelComments/moderation';
import { logger } from '../../lib/logger';

const deleteCommentSchema = {
  tags: ['Community Posts - Comments'],
  summary: 'Delete a comment',
  description:
    "The author deletes their own comment (one with replies shows [deleted]). A comment moderator of the post's channel removes it instead: hidden with its replies and restorable from Studio for 90 days (`removed: true`).",
  request: {
    params: z.object({
      channelId: Str({ description: 'Channel ID that owns the post' }),
      postId: Str({ description: 'Post ID' }),
      commentId: Str({ description: 'Comment ID' }),
    }),
    headers: z.object({
      channelId: z.string().optional().nullable().describe('Actor channel ID (for authorization check); none: the comment author deletes their own comment'),
    }),
  },
  responses: {
    '200': {
      description: 'Comment deleted successfully',
      content: {
        'application/json': {
          schema: z.object({
            success: z.boolean(),
            message: z.string(),
            removed: z.boolean().optional(),
          }),
        },
      },
    },
    '403': {
      description: 'Forbidden - not authorized to delete',
      content: {
        'application/json': {
          schema: z.object({
            success: z.boolean(),
            error: z.string(),
          }),
        },
      },
    },
    '404': {
      description: 'Comment not found',
      content: {
        'application/json': {
          schema: z.object({
            success: z.boolean(),
            error: z.string(),
          }),
        },
      },
    },
  },
};

export class DeletePostComment extends AuthenticatedRoute {
  schema = addAuthToSchema(deleteCommentSchema, 'required');

  async handle(c: AppContext) {
    const userId = this.getUserId(c);

    const { channelId: postChannelId, postId, commentId } = c.req.param();
    const request: any = await this.getValidatedData<typeof this.schema>();
    // A missing header reaches the schema as null
    const userChannelId = request.headers?.channelId ?? undefined;

    const bucket = c.env.community_posts;

    // 1. Get post to check ownership (O(1) lookup)
    const postKey = `posts/${postChannelId}/${postId}.json`;
    const postObj = await bucket.get(postKey);
    if (!postObj) {
      return c.json(
        {
          success: false,
          error: 'Post not found',
        },
        404
      );
    }

    const post: CommunityPost = await postObj.json();

    // 2. Find comment
    const { comment, commentKey } = await findPostComment(bucket, postId, commentId);

    if (!comment) {
      return c.json(
        {
          success: false,
          error: 'Comment not found',
        },
        404
      );
    }

    // 3. Authorization: the author deletes their own comment (a hard delete,
    // shown as [deleted] while it has replies). Anyone else needs
    // `comment.moderate` on the post's channel (channel roles, never site
    // roles), and their delete is the channel's soft removal (#771): restorable
    // from Studio for 90 days, its replies hidden with it.
    const isCommentAuthor = comment.userId === userId;
    if (!isCommentAuthor) {
      const role = await roleOnChannel(c.env as never, post.channelId || postChannelId, userId).catch(() => null);
      if (!can(role, 'comment.moderate')) {
        return c.json(
          {
            success: false,
            error: 'You can only delete your own comments or comments on your channel\'s posts',
          },
          403
        );
      }
      const outcome = await moderatePostComment(c as never, postChannelId, postId, commentId, 'remove', userId, new Date(), comment.parentCommentId ?? null);
      if (outcome.ok === false) {
        return c.json({ success: false, error: outcome.error }, moderationStatus(outcome.error));
      }
      logger.info('[DeletePostComment] Removed by the channel', { postId, commentId, actorUserId: userId, changed: outcome.changed });
      return c.json({ success: true, message: 'Comment removed', removed: true });
    }

    // 4. Already deleted?
    if (comment.deletedAt) {
      return c.json(
        {
          success: true,
          message: 'Comment already deleted',
        }
      );
    }

    // 5. Soft delete on the fresh comment with a conditional write
    // (SCALABILITY-AUDIT AV-11). Only the request that sets deletedAt goes on
    // to adjust indexes and counters, so two deletes at once count once.
    const deletedAt = new Date().toISOString();
    // Only a public comment is in the post's count: a held or channel-removed one was already out of it
    let wasCounted = true;
    const { data: deleted, rejected } = await patchComment<'already'>(bucket, commentKey, (fresh) => {
      if (fresh.deletedAt) return { reject: 'already' };
      wasCounted = fresh.status !== 'held' && fresh.removedBy !== 'channel';
      fresh.deletedAt = deletedAt;
      return true;
    });
    if (!deleted || rejected) {
      return c.json(
        {
          success: true,
          message: 'Comment already deleted',
        }
      );
    }
    comment.deletedAt = deletedAt;

    // A comment with replies stays listed (shown as [deleted]); one without is
    // taken out of its index. A reply that lands meanwhile re-adds it (see
    // post-comment-create), and this re-check covers the other order.
    if ((deleted.repliesCount || 0) === 0) {
      if (comment.parentCommentId) {
        await removeFromCommentIndex(bucket, `comments/${postId}/replies/${comment.parentCommentId}/index.json`, commentId);
      } else {
        const indexKey = `comments/${postId}/top-level/index.json`;
        await removeFromCommentIndex(bucket, indexKey, commentId);
        const after = await bucket.get(commentKey);
        if (after && ((await after.json<PostComment>()).repliesCount || 0) > 0) {
          await addToCommentIndex(bucket, indexKey, postId, commentId, 'start');
        }
      }
    }

    // Studio's comment list drops it (lib/channelComments)
    await indexPostComment(c.env as never, executionCtxOf(c as never), postId, postChannelId, deleted);

    // 6. Decrement post's comments count
    // Conditional write of the counter only (SCALABILITY-AUDIT AV-9)
    if (wasCounted) await bumpPostComments(bucket, postKey, -1);

    // 7. Send queue event
    const queue = new Queue(c.env.queue);
    await queue.send(MessageType.PostCommentDeleted, {
      postId,
      commentId,
      channelId: postChannelId,
      actor: {
        userId,
        channelId: userChannelId,
      },
      timestamp: comment.deletedAt,
    });

    return c.json({
      success: true,
      message: 'Comment deleted successfully',
    });
  }
}
