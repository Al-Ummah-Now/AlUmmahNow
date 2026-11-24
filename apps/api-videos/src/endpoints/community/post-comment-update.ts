import { findPostComment } from './post-comment-helpers';
import { maySpeakAs } from '../../lib/channelAccess';
import { patchComment } from '../../lib/community-comments';
import { Str } from '../../lib/chanfana-params';
import { z } from 'zod';
import { AuthenticatedRoute, AppContext } from '../../base';
import { addAuthToSchema } from '../../lib/openapi-auth';
import Queue, { MessageType } from '../../lib/queue';
import type { PostComment } from '@al-ummah/shared-types';
import { scanInBackground } from '../../lib/moderation-scan';
import { executionCtxOf, indexPostComment } from '../../lib/channelComments';

const updateCommentRequestSchema = z.object({
  content: z
    .string()
    .min(1, 'Comment cannot be empty')
    .max(10000, 'Comment cannot exceed 10,000 characters')
    .transform((val) => val.trim()),
});

const updateCommentSchema = {
  tags: ['Community Posts - Comments'],
  summary: 'Update a comment',
  description: 'Update comment content. Only the comment author can update their comment.',
  request: {
    params: z.object({
      channelId: Str({ description: 'Channel ID that owns the post' }),
      postId: Str({ description: 'Post ID' }),
      commentId: Str({ description: 'Comment ID' }),
    }),
    headers: z.object({
      channelId: z.string().optional().nullable().describe('Actor channel ID; none: the comment author edits their own comment'),
    }),
    body: {
      content: {
        'application/json': {
          schema: updateCommentRequestSchema,
        },
      },
    },
  },
  responses: {
    '200': {
      description: 'Comment updated successfully',
      content: {
        'application/json': {
          schema: z.object({
            success: z.boolean(),
            comment: z.any(),
          }),
        },
      },
    },
    '403': {
      description: 'Forbidden - not comment author',
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

export class UpdatePostComment extends AuthenticatedRoute {
  schema = addAuthToSchema(updateCommentSchema, 'required');

  async handle(c: AppContext) {
    const userId = this.getUserId(c);

    const { channelId: postChannelId, postId, commentId } = c.req.param();
    const data: any = await this.getValidatedData<z.infer<typeof updateCommentRequestSchema>>();
    // A missing header reaches the schema as null
    const userChannelId = data.headers?.channelId ?? undefined;

    if (!data.body) {
      return c.json({ success: false, error: 'Request body is required' }, 400);
    }

    const requestBody = data.body as z.infer<typeof updateCommentRequestSchema>;
    const bucket = c.env.community_posts;

    // 1. Find comment (check both top-level and replies)
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

    // 2. Check authorization (only the comment author can update, while they may still speak as the channel it shows)
    if (comment.userId !== userId || !(await maySpeakAs(c.env as never, comment.channelId, userId))) {
      return c.json(
        {
          success: false,
          error: 'You can only update your own comments',
        },
        403
      );
    }

    // 3. Cannot update deleted comment
    if (comment.deletedAt) {
      return c.json(
        {
          success: false,
          error: 'Cannot update deleted comment',
        },
        400
      );
    }

    // 4. Update comment
    // On the fresh comment with a conditional write (SCALABILITY-AUDIT AV-11):
    // likes, replies or a heart that land meanwhile are kept, and a comment
    // deleted meanwhile is not edited
    const { data: saved, rejected } = await patchComment<'deleted'>(bucket, commentKey, (fresh) => {
      // A comment the channel removed is treated as deleted for its author too
      if (fresh.deletedAt || fresh.removedBy === 'channel') return { reject: 'deleted' };
      fresh.content = requestBody.content;
      fresh.isEdited = true;
      fresh.updatedAt = new Date().toISOString();
      return true;
    });
    if (!saved) {
      return c.json({ success: false, error: 'Comment not found' }, 404);
    }
    if (rejected) {
      return c.json({ success: false, error: 'Cannot update deleted comment' }, 400);
    }
    Object.assign(comment, saved);

    // Studio's comment list (has-link filter; lib/channelComments)
    await indexPostComment(c.env as never, executionCtxOf(c as never), postId, postChannelId, saved);

    // 5. Send queue event
    const queue = new Queue(c.env.queue);
    await queue.send(MessageType.PostCommentUpdated, {
      postId,
      commentId,
      channelId: postChannelId,
      actor: {
        userId,
        channelId: userChannelId,
      },
      timestamp: comment.updatedAt,
    });

    scanInBackground(c, { surface: 'post_comment', event: 'edit', subjectId: commentId, parentId: postId, authorId: userId, channelId: postChannelId, text: comment.content });

    return c.json({
      success: true,
      comment,
    });
  }
}
