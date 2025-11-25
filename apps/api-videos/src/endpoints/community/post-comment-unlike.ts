import { OpenAPIRoute, Str } from 'chanfana';
import { z } from 'zod';
import { Context } from 'hono';
import { addAuthToSchema } from '../../lib/openapi-auth';
import type { PostComment, PostCommentLikeResponse } from '@al-ummah/shared-types';

const unlikeCommentSchema = {
  tags: ['Community Posts - Comments'],
  summary: 'Unlike a comment',
  description: 'Remove a like from a comment. Idempotent - unliking twice has no effect.',
  request: {
    params: z.object({
      postId: Str({ description: 'Post ID' }),
      commentId: Str({ description: 'Comment ID' }),
    }),
    headers: z.object({
      channelId: z.string().optional(),
    }),
  },
  responses: {
    '200': {
      description: 'Comment unliked successfully',
      content: {
        'application/json': {
          schema: z.object({
            success: z.boolean(),
            liked: z.boolean(),
            totalLikes: z.number(),
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

export class UnlikePostComment extends OpenAPIRoute {
  schema = addAuthToSchema(unlikeCommentSchema, 'required');

  async handle(c: Context) {
    const auth = c.get('auth');
    if (!auth) {
      return c.json({ success: false, error: 'Authentication required' }, 401);
    }
    const userId = auth.userId;

    const { postId, commentId } = c.req.param();
    const request: any = await this.getValidatedData<typeof this.schema>();
    const { channelId } = request.headers;

    const bucket = c.env.community_posts;

    // 1. Find comment
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

    // 2. Check if liked
    const likeKey = `comment-likes/${postId}/${commentId}/${userId}.json`;
    const existingLike = await bucket.get(likeKey);

    if (!existingLike) {
      // Not liked - return current state
      return c.json({
        success: true,
        liked: false,
        totalLikes: comment.likes,
      });
    }

    // 3. Delete like record
    await bucket.delete(likeKey);

    // 4. Decrement comment's likes count
    comment.likes = Math.max(0, comment.likes - 1);
    await bucket.put(commentKey, JSON.stringify(comment));

    const response: PostCommentLikeResponse = {
      success: true,
      liked: false,
      totalLikes: comment.likes,
    };

    return c.json(response);
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
