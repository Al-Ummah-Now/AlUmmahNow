import { OpenAPIRoute, Str } from 'chanfana';
import { z } from 'zod';
import { Context } from 'hono';
import { addAuthToSchema } from '../../lib/openapi-auth';
import type {
  PostComment,
  PostCommentListResponse,
  PostCommentIndex,
} from '@al-ummah/shared-types';

const listCommentsSchema = {
  params: z.object({
    channelId: Str({ description: 'Channel ID that owns the post' }),
    postId: Str({ description: 'Post ID' }),
  }),
  query: z.object({
    limit: z.string().optional().describe('Number of comments to return (default: 20, max: 100)'),
    cursor: Str({ description: 'Pagination cursor (last comment ID)' }).optional(),
    sortBy: z
      .enum(['top', 'newest'])
      .optional()
      .default('top')
      .describe('Sort order: top (most liked) or newest'),
  }),
};

const responseSchema = z.object({
  success: z.boolean(),
  comments: z.array(z.any()),
  pagination: z.object({
    limit: z.number(),
    cursor: z.string().optional(),
    hasNext: z.boolean(),
  }),
});

export class ListPostComments extends OpenAPIRoute {
  schema = addAuthToSchema(
    {
      tags: ['Community Posts - Comments'],
      summary: 'List top-level comments for a post',
      description:
        'Returns paginated list of top-level comments. Use separate endpoint to fetch replies.',
      request: listCommentsSchema,
      responses: {
        '200': {
          description: 'Comments retrieved successfully',
          content: {
            'application/json': {
              schema: responseSchema,
            },
          },
        },
        '404': {
          description: 'Post not found',
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
    },
    'optional'
  );

  async handle(c: Context) {
    const { channelId: postChannelId, postId } = c.req.param();
    const query = c.req.query();
    const limit = Math.min(parseInt(query.limit || '20'), 100);
    const cursor = query.cursor;
    const sortBy = query.sortBy || 'top';

    const bucket = c.env.COMMUNITY_POSTS;

    // 1. Verify post exists (O(1) lookup)
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

    // 2. Get comment index
    const indexKey = `comments/${postId}/top-level/index.json`;
    const indexObj = await bucket.get(indexKey);

    let commentIds: string[] = [];
    if (indexObj) {
      const index: PostCommentIndex = await indexObj.json();
      commentIds = index.commentIds || [];
    }

    // 3. Apply cursor pagination
    let startIndex = 0;
    if (cursor) {
      const cursorIndex = commentIds.indexOf(cursor);
      if (cursorIndex !== -1) {
        startIndex = cursorIndex + 1;
      }
    }

    const paginatedIds = commentIds.slice(startIndex, startIndex + limit);
    const hasNext = startIndex + limit < commentIds.length;

    // 4. Fetch comment objects in parallel
    const comments: PostComment[] = [];
    const fetchPromises = paginatedIds.map(async (commentId) => {
      const commentKey = `comments/${postId}/top-level/${commentId}.json`;
      const commentObj = await bucket.get(commentKey);
      if (commentObj) {
        const comment: PostComment = await commentObj.json();

        // Filter out moderation-hidden comments completely
        if (comment.isHidden) {
          return null;
        }

        // Filter out soft-deleted comments without replies
        if ((comment.isDeleted || comment.deletedAt) && comment.repliesCount === 0) {
          return null;
        }

        // Mask deleted comments with replies
        if (comment.isDeleted || comment.deletedAt) {
          return {
            ...comment,
            content: '[deleted]',
            userDisplayName: '[deleted]',
            userAvatarUrl: undefined,
          };
        }
        return comment;
      }
      return null;
    });

    const fetchedComments = await Promise.all(fetchPromises);
    comments.push(...fetchedComments.filter((c): c is PostComment => c !== null));

    // 5. Sort comments based on sortBy
    if (sortBy === 'top') {
      // Sort by likes DESC, then by createdAt DESC
      comments.sort((a, b) => {
        if (b.likes !== a.likes) {
          return b.likes - a.likes;
        }
        return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
      });
    } else {
      // Sort by createdAt DESC (newest first)
      comments.sort(
        (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      );
    }

    // 6. Move pinned comment to top
    const pinnedIndex = comments.findIndex((c) => c.isPinned);
    if (pinnedIndex > 0) {
      const [pinnedComment] = comments.splice(pinnedIndex, 1);
      comments.unshift(pinnedComment);
    }

    const response: PostCommentListResponse = {
      success: true,
      comments,
      pagination: {
        limit,
        cursor: paginatedIds.length > 0 ? paginatedIds[paginatedIds.length - 1] : undefined,
        hasNext,
      },
    };

    return c.json(response);
  }

}
