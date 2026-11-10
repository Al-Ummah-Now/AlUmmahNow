import { recountCommentLikes } from '../../lib/community-comments';
import { Str } from 'chanfana';
import { z } from 'zod';
import { AuthenticatedRoute, AppContext } from '../../base';
import { addAuthToSchema } from '../../lib/openapi-auth';
import Queue, { MessageType } from '../../lib/queue';
import type { PostComment, PostCommentLikeResponse } from '@al-ummah/shared-types';

const unlikeCommentSchema = {
  tags: ['Community Posts - Comments'],
  summary: 'Unlike a comment',
  description: 'Remove a like from a comment. Idempotent - unliking twice has no effect.',
  request: {
    params: z.object({
      channelId: Str({ description: 'Channel ID that owns the post' }),
      postId: Str({ description: 'Post ID' }),
      commentId: Str({ description: 'Comment ID' }),
    }),
    headers: z.object({
      channelId: z.string().optional().describe('Actor channel ID (the channel removing the like)'),
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

export class UnlikePostComment extends AuthenticatedRoute {
  schema = addAuthToSchema(unlikeCommentSchema, 'required');

  async handle(c: AppContext) {
    const userId = this.getUserId(c);

    const { channelId: postChannelId, postId, commentId } = c.req.param();
    const request: any = await this.getValidatedData<typeof this.schema>();
    const userChannelId = request.headers?.channelId;

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

    // 3. Delete the like record, then store the total recounted from the
    // records with a conditional write of the comment (SCALABILITY-AUDIT
    // AV-11): two unlikes at once cannot both subtract
    if (existingLike) {
      await bucket.delete(likeKey);
    }
    const totalLikes = await recountCommentLikes(bucket, postId, commentId, commentKey);
    comment.likes = totalLikes ?? comment.likes;

    if (!existingLike) {
      // Not liked - return current state
      return c.json({
        success: true,
        liked: false,
        totalLikes: comment.likes,
      });
    }

    // 5. Send queue event
    const queue = new Queue(c.env.queue);
    await queue.send(MessageType.PostCommentUnliked, {
      postId,
      commentId,
      channelId: postChannelId,
      actor: {
        userId,
        channelId: userChannelId,
      },
      timestamp: new Date().toISOString(),
    });

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
