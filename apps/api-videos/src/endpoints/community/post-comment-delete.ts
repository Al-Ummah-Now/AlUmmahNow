import { findPostComment } from './post-comment-helpers';
import { addToCommentIndex, patchComment, removeFromCommentIndex } from '../../lib/community-comments';
import { bumpPostComments } from '../../lib/community-posts';
import { Str } from 'chanfana';
import { z } from 'zod';
import { AuthenticatedRoute, AppContext } from '../../base';
import { addAuthToSchema } from '../../lib/openapi-auth';
import Queue, { MessageType } from '../../lib/queue';
import type { PostComment, CommunityPost, PostCommentIndex } from '@al-ummah/shared-types';

const deleteCommentSchema = {
  tags: ['Community Posts - Comments'],
  summary: 'Delete a comment',
  description:
    'Soft delete a comment. Comment author or post owner can delete. Comments with replies show [deleted] instead of being removed.',
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

    // 3. Check authorization (comment author OR post owner)
    const isCommentAuthor = comment.userId === userId;
    const isPostOwner = post.channelId === userChannelId;

    if (!isCommentAuthor && !isPostOwner) {
      return c.json(
        {
          success: false,
          error: 'You can only delete your own comments or comments on your posts',
        },
        403
      );
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
    const { data: deleted, rejected } = await patchComment<'already'>(bucket, commentKey, (fresh) => {
      if (fresh.deletedAt) return { reject: 'already' };
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

    // 6. Decrement post's comments count
    // Conditional write of the counter only (SCALABILITY-AUDIT AV-9)
    await bumpPostComments(bucket, postKey, -1);

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
