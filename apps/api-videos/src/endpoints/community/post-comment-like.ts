import { recountCommentLikes } from '../../lib/community-comments';
import R2Repository from '../../lib/r2Repo';
import { Str } from 'chanfana';
import { z } from 'zod';
import { AuthenticatedRoute, AppContext } from '../../base';
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
      channelId: Str({ description: 'Channel ID that owns the post' }),
      postId: Str({ description: 'Post ID' }),
      commentId: Str({ description: 'Comment ID' }),
    }),
    headers: z.object({
      channelId: z.string().optional().describe('Actor channel ID (the channel performing the like)'),
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

export class LikePostComment extends AuthenticatedRoute {
  schema = addAuthToSchema(likeCommentSchema, 'required');

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

    // 3. Create the like record create-only (SCALABILITY-AUDIT AV-11): of two
    // likes by the same user (two tabs, double click) exactly one creates it
    const likeKey = `comment-likes/${postId}/${commentId}/${userId}.json`;
    const likeRecord: PostCommentLikeRecord = {
      userId: userId,
      postId,
      commentId,
      likedAt: new Date().toISOString(),
    };
    const created = await new R2Repository<PostCommentLikeRecord>(bucket).createObject(likeKey, likeRecord);

    // 4. The total is the number of like records, stored with a conditional
    // write of the comment (exact under concurrent likers; other fields kept)
    const totalLikes = await recountCommentLikes(bucket, postId, commentId, commentKey);
    if (totalLikes === null) {
      return c.json(
        {
          success: false,
          error: 'Comment not found',
        },
        404
      );
    }
    comment.likes = totalLikes;

    if (!created) {
      // Already liked - return current state
      return c.json({
        success: true,
        liked: true,
        totalLikes,
      });
    }

    // 6. Send queue event
    const queue = new Queue(c.env.queue);
    await queue.send(MessageType.PostCommentLiked, {
      postId,
      commentId,
      channelId: postChannelId,
      actor: {
        userId,
        channelId: userChannelId,
      },
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
