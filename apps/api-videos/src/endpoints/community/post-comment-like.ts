import { OpenAPIRoute, Str } from 'chanfana';
import { z } from 'zod';
import { Context } from 'hono';
import { addAuthToSchema } from '../../lib/openapi-auth';
import Queue, { MessageType } from '../../lib/queue';
import type {
  PostComment,
  PostCommentLikeResponse,
  PostCommentLikeRecord,
} from '@al-ummah/shared-types';

const likeCommentSchema = {
  tags: ['Community Posts - Comments'],
  summary: 'Like a comment',
  description: 'Add a like to a comment. Idempotent - liking twice has no effect.',
  request: {
    params: z.object({
      postId: Str({ description: 'Post ID' }),
      commentId: Str({ description: 'Comment ID' }),
    }),
  },
  responses: {
    '200': {
      description: 'Comment liked successfully',
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

export class LikePostComment extends OpenAPIRoute {
  schema = addAuthToSchema(likeCommentSchema, 'required');

  async handle(c: Context) {
    const auth = c.get('auth');
    if (!auth) {
      return c.json({ success: false, error: 'Authentication required' }, 401);
    }

    const { postId, commentId } = c.req.param();

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

    // 2. Cannot like deleted comment
    if (comment.deletedAt) {
      return c.json(
        {
          success: false,
          error: 'Cannot like deleted comment',
        },
        400
      );
    }

    // 3. Check if already liked
    const likeKey = `comment-likes/${postId}/${commentId}/${auth.userId}.json`;
    const existingLike = await bucket.get(likeKey);

    if (existingLike) {
      // Already liked - return current state
      return c.json({
        success: true,
        liked: true,
        totalLikes: comment.likes,
      });
    }

    // 4. Create like record
    const likeRecord: PostCommentLikeRecord = {
      userId: auth.userId,
      postId,
      commentId,
      likedAt: new Date().toISOString(),
    };

    await bucket.put(likeKey, JSON.stringify(likeRecord));

    // 5. Increment comment's likes count
    comment.likes++;
    await bucket.put(commentKey, JSON.stringify(comment));

    // 6. Send queue event
    const queue = new Queue();
    await queue.send(MessageType.PostCommentLiked, {
      postId,
      commentId,
      likerChannelId: auth.userId,
      likerUserId: auth.userId,
      timestamp: likeRecord.likedAt,
    });

    const response: PostCommentLikeResponse = {
      success: true,
      liked: true,
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
