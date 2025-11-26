import { Str } from 'chanfana';
import { z } from 'zod';
import { AuthenticatedRoute, AppContext } from '../../base';
import { addAuthToSchema } from '../../lib/openapi-auth';
import Queue, { MessageType } from '../../lib/queue';
import type { PostComment } from '@al-ummah/shared-types';

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
      channelId: z.string().optional().describe('Actor channel ID'),
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
    const userChannelId = data.headers?.channelId;

    if (!data.body) {
      return c.json({ success: false, error: 'Request body is required' }, 400);
    }

    const requestBody = data.body as z.infer<typeof updateCommentRequestSchema>;
    const bucket = c.env.community_posts;

    // 1. Find comment (check both top-level and replies)
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

    // 2. Check authorization (only comment author can update)
    if (comment.userId !== userId) {
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
    comment.content = requestBody.content;
    comment.isEdited = true;
    comment.updatedAt = new Date().toISOString();

    await bucket.put(commentKey, JSON.stringify(comment));

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

    return c.json({
      success: true,
      comment,
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
}
