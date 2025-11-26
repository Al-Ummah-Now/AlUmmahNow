import { Str } from 'chanfana';
import { z } from 'zod';
import sanitizeHtml from 'sanitize-html';
import { AuthenticatedRoute, AppContext } from '../../base';
import { addAuthToSchema } from '../../lib/openapi-auth';
import Queue, { MessageType } from '../../lib/queue';
import type {
  PostComment,
  PostCommentCreateRequest,
  PostCommentCreateResponse,
  PostCommentIndex,
  CommunityPost,
} from '@al-ummah/shared-types';

// Sanitization configuration for comments
// Allows basic formatting while preventing XSS attacks
const sanitizeOptions = {
  allowedTags: ['b', 'i', 'em', 'strong', 'a', 'p', 'br'],
  allowedAttributes: {
    'a': ['href']
  },
  allowedSchemes: ['http', 'https'],
  disallowedTagsMode: 'discard' as const
};

const createCommentRequestSchema = z.object({
  content: z
    .string()
    .min(1, 'Comment cannot be empty')
    .max(10000, 'Comment cannot exceed 10,000 characters')
    .transform((val) => val.trim()),
  parentCommentId: Str({ description: 'Parent comment ID for threaded replies' }).optional(),
});

const createCommentSchema = {
  tags: ['Community Posts - Comments'],
  summary: 'Create a comment on a post',
  description:
    'Create a new top-level comment or reply to an existing comment. Threading depth limited to 1 level.',
  request: {
    params: z.object({
      channelId: Str({ description: 'Channel ID that owns the post' }),
      postId: Str({ description: 'Post ID' }),
    }),
    headers: z.object({
      channelId: z.string().optional().describe('Actor channel ID (the channel posting the comment)'),
    }),
    body: {
      content: {
        'application/json': {
          schema: createCommentRequestSchema,
        },
      },
    },
  },
  responses: {
    '201': {
      description: 'Comment created successfully',
      content: {
        'application/json': {
          schema: z.object({
            success: z.boolean(),
            comment: z.any(),
          }),
        },
      },
    },
    '400': {
      description: 'Bad request (validation error)',
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
      description: 'Post or parent comment not found',
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

export class CreatePostComment extends AuthenticatedRoute {
  schema = addAuthToSchema(createCommentSchema, 'required');

  async handle(c: AppContext) {
    const userId = this.getUserId(c);

    const { channelId: postChannelId, postId } = c.req.param();
    const data: any = await this.getValidatedData<z.infer<typeof createCommentRequestSchema>>();
    const userChannelId = data.headers?.channelId;

    if (!data.body) {
      return c.json({ success: false, error: 'Request body is required' }, 400);
    }

    const requestBody = data.body as z.infer<typeof createCommentRequestSchema>;
    const bucket = c.env.community_posts;

    // 1. Validate post exists and comments are enabled (O(1) lookup)
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

    if (!post.commentsEnabled) {
      return c.json(
        {
          success: false,
          error: 'Comments are disabled on this post',
        },
        400
      );
    }

    // 2. If reply, validate parent comment exists and is top-level
    let parentComment: PostComment | null = null;
    if (requestBody.parentCommentId) {
      const parentKey = `comments/${postId}/top-level/${requestBody.parentCommentId}.json`;
      const parentObj = await bucket.get(parentKey);

      if (!parentObj) {
        return c.json(
          {
            success: false,
            error: 'Parent comment not found',
          },
          404
        );
      }

      parentComment = await parentObj.json();

      // Cannot reply to a reply (max depth = 1)
      if (parentComment.parentCommentId) {
        return c.json(
          {
            success: false,
            error: 'Cannot reply to a reply. Maximum thread depth is 1 level.',
          },
          400
        );
      }

      // Cannot reply to deleted comment
      if (parentComment.deletedAt) {
        return c.json(
          {
            success: false,
            error: 'Cannot reply to deleted comment',
          },
          400
        );
      }
    }

    // 3. Create comment object with sanitized content
    const auth = this.getAuth(c);
    const comment: PostComment = {
      id: crypto.randomUUID(),
      postId,
      channelId: userChannelId || userId,
      userId: userId,
      parentCommentId: requestBody.parentCommentId,
      content: sanitizeHtml(requestBody.content, sanitizeOptions),
      userDisplayName: (auth?.payload as any)?.email || 'Anonymous',
      userAvatarUrl: undefined,
      channelVerified: false,
      likes: 0,
      repliesCount: 0,
      isPinned: false,
      isEdited: false,
      isHeartedByCreator: false,
      createdAt: new Date().toISOString(),
    };

    // 4. Store comment
    if (requestBody.parentCommentId) {
      // Store as reply
      const replyKey = `comments/${postId}/replies/${requestBody.parentCommentId}/${comment.id}.json`;
      await bucket.put(replyKey, JSON.stringify(comment));

      // Update parent's replies index
      await this.updateRepliesIndex(
        bucket,
        postId,
        requestBody.parentCommentId,
        comment.id
      );

      // Increment parent's repliesCount
      if (parentComment) {
        parentComment.repliesCount++;
        const parentKey = `comments/${postId}/top-level/${requestBody.parentCommentId}.json`;
        await bucket.put(parentKey, JSON.stringify(parentComment));
      }
    } else {
      // Store as top-level comment
      const commentKey = `comments/${postId}/top-level/${comment.id}.json`;
      await bucket.put(commentKey, JSON.stringify(comment));

      // Update top-level comments index
      await this.updateTopLevelIndex(bucket, postId, comment.id);
    }

    // 5. Increment post's comments count
    post.comments++;
    await bucket.put(postKey, JSON.stringify(post));

    // 6. Send queue event for notification
    const queue = new Queue(c.env.queue);
    await queue.send(MessageType.PostCommentCreated, {
      postId,
      commentId: comment.id,
      channelId: postChannelId,
      actor: {
        userId,
        channelId: userChannelId,
      },
      parentCommentId: requestBody.parentCommentId,
      timestamp: comment.createdAt,
    });

    const response: PostCommentCreateResponse = {
      success: true,
      comment,
    };

    return c.json(response, 201);
  }

  private async updateTopLevelIndex(
    bucket: R2Bucket,
    postId: string,
    commentId: string
  ): Promise<void> {
    const indexKey = `comments/${postId}/top-level/index.json`;
    const existing = await bucket.get(indexKey);

    let index: PostCommentIndex = {
      postId,
      commentIds: [],
      lastUpdated: new Date().toISOString(),
    };

    if (existing) {
      index = await existing.json();
    }

    // Add to beginning (newest first)
    index.commentIds.unshift(commentId);
    index.lastUpdated = new Date().toISOString();

    await bucket.put(indexKey, JSON.stringify(index));
  }

  private async updateRepliesIndex(
    bucket: R2Bucket,
    postId: string,
    parentCommentId: string,
    replyId: string
  ): Promise<void> {
    const indexKey = `comments/${postId}/replies/${parentCommentId}/index.json`;
    const existing = await bucket.get(indexKey);

    let index: PostCommentIndex = {
      postId,
      commentIds: [],
      lastUpdated: new Date().toISOString(),
    };

    if (existing) {
      index = await existing.json();
    }

    // Add to end (chronological order for replies)
    index.commentIds.push(replyId);
    index.lastUpdated = new Date().toISOString();

    await bucket.put(indexKey, JSON.stringify(index));
  }
}
