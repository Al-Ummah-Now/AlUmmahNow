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
      channelId: z.string().optional().describe('Actor channel ID (for authorization check)'),
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
    const userChannelId = request.headers?.channelId;

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
    const { comment, commentKey } = await this.findComment(bucket, postId, commentId);

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

    // 5. Soft delete
    comment.deletedAt = new Date().toISOString();

    // If has replies, keep the comment but mask content
    if (comment.repliesCount > 0) {
      await bucket.put(commentKey, JSON.stringify(comment));
    } else {
      // No replies: mark as deleted but also remove from index
      await bucket.put(commentKey, JSON.stringify(comment));

      // Remove from index
      if (comment.parentCommentId) {
        // Remove from replies index
        await this.removeFromRepliesIndex(bucket, postId, comment.parentCommentId, commentId);
      } else {
        // Remove from top-level index
        await this.removeFromTopLevelIndex(bucket, postId, commentId);
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

  private async findComment(
    bucket: R2Bucket,
    postId: string,
    commentId: string
  ): Promise<{ comment: PostComment | null; commentKey: string }> {
    // Try top-level first
    let commentKey = `comments/${postId}/top-level/${commentId}.json`;
    let commentObj = await bucket.get(commentKey);

    if (commentObj) {
      const comment: PostComment = await commentObj.json();
      return { comment, commentKey };
    }

    // Search in replies
    const repliesList = await bucket.list({ prefix: `comments/${postId}/replies/` });
    for (const object of repliesList.objects) {
      if (object.key.endsWith(`/${commentId}.json`)) {
        commentObj = await bucket.get(object.key);
        if (commentObj) {
          const comment: PostComment = await commentObj.json();
          return { comment, commentKey: object.key };
        }
      }
    }

    return { comment: null, commentKey: '' };
  }

  private async removeFromTopLevelIndex(
    bucket: R2Bucket,
    postId: string,
    commentId: string
  ): Promise<void> {
    const indexKey = `comments/${postId}/top-level/index.json`;
    const existing = await bucket.get(indexKey);

    if (!existing) return;

    const index: PostCommentIndex = await existing.json();
    index.commentIds = index.commentIds.filter((id) => id !== commentId);
    index.lastUpdated = new Date().toISOString();

    await bucket.put(indexKey, JSON.stringify(index));
  }

  private async removeFromRepliesIndex(
    bucket: R2Bucket,
    postId: string,
    parentCommentId: string,
    commentId: string
  ): Promise<void> {
    const indexKey = `comments/${postId}/replies/${parentCommentId}/index.json`;
    const existing = await bucket.get(indexKey);

    if (!existing) return;

    const index: PostCommentIndex = await existing.json();
    index.commentIds = index.commentIds.filter((id) => id !== commentId);
    index.lastUpdated = new Date().toISOString();

    await bucket.put(indexKey, JSON.stringify(index));
  }
}
