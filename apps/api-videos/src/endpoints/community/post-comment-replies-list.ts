import { Str } from 'chanfana';
import { z } from 'zod';
import { OptionalAuthRoute, AppContext } from '../../base';
import { addAuthToSchema } from '../../lib/openapi-auth';
import type { PostComment, PostCommentIndex, PostCommentListResponse } from '@al-ummah/shared-types';
import {
  presentComment,
  replyCommentKey,
  repliesIndexKey,
  topLevelCommentKey,
  withViewerLikes,
} from './post-comment-helpers';

const MAX_REPLIES_LIMIT = 50;
const DEFAULT_REPLIES_LIMIT = 10;

const errorSchema = z.object({ success: z.boolean(), error: z.string() });

/**
 * List replies to a top-level comment, oldest first (chronological).
 * Threads are one level deep, so replies never have replies of their own.
 */
export class ListPostCommentReplies extends OptionalAuthRoute {
  schema = addAuthToSchema(
    {
      tags: ['Community Posts - Comments'],
      summary: 'List replies to a comment',
      description: 'Returns paginated replies to a top-level comment in chronological order.',
      request: {
        params: z.object({
          channelId: Str({ description: 'Channel ID that owns the post' }),
          postId: Str({ description: 'Post ID' }),
          commentId: Str({ description: 'Top-level comment ID' }),
        }),
        query: z.object({
          limit: z.string().optional().describe(`Number of replies (default ${DEFAULT_REPLIES_LIMIT}, max ${MAX_REPLIES_LIMIT})`),
          cursor: Str({ description: 'Pagination cursor (last reply ID)' }).optional(),
        }),
      },
      responses: {
        '200': {
          description: 'Replies retrieved successfully',
          content: {
            'application/json': {
              schema: z.object({
                success: z.boolean(),
                comments: z.array(z.any()),
                pagination: z.object({
                  limit: z.number(),
                  cursor: z.string().optional(),
                  hasNext: z.boolean(),
                }),
              }),
            },
          },
        },
        '404': { description: 'Post or comment not found', content: { 'application/json': { schema: errorSchema } } },
      },
    },
    'optional'
  );

  async handle(c: AppContext) {
    const { channelId: postChannelId, postId, commentId } = c.req.param();
    const query = c.req.query();
    const parsedLimit = parseInt(query.limit || `${DEFAULT_REPLIES_LIMIT}`, 10);
    const limit = Math.min(Math.max(Number.isNaN(parsedLimit) ? DEFAULT_REPLIES_LIMIT : parsedLimit, 1), MAX_REPLIES_LIMIT);
    const cursor = query.cursor;
    const bucket = c.env.community_posts;

    const postObj = await bucket.head(`posts/${postChannelId}/${postId}.json`);
    if (!postObj) {
      return c.json({ success: false, error: 'Post not found' }, 404);
    }

    const parentObj = await bucket.head(topLevelCommentKey(postId, commentId));
    if (!parentObj) {
      return c.json({ success: false, error: 'Comment not found' }, 404);
    }

    const indexObj = await bucket.get(repliesIndexKey(postId, commentId));
    const replyIds: string[] = indexObj ? (await indexObj.json<PostCommentIndex>()).commentIds || [] : [];

    let startIndex = 0;
    if (cursor) {
      const cursorIndex = replyIds.indexOf(cursor);
      if (cursorIndex !== -1) {
        startIndex = cursorIndex + 1;
      }
    }

    const pageIds = replyIds.slice(startIndex, startIndex + limit);
    const hasNext = startIndex + limit < replyIds.length;

    const fetched = await Promise.all(
      pageIds.map(async (replyId) => {
        const replyObj = await bucket.get(replyCommentKey(postId, commentId, replyId));
        return replyObj ? presentComment(await replyObj.json<PostComment>()) : null;
      })
    );
    const replies = fetched.filter((reply): reply is PostComment => reply !== null);

    const response: PostCommentListResponse = {
      success: true,
      comments: await withViewerLikes(bucket, postId, replies, this.getUserId(c)),
      pagination: {
        limit,
        cursor: pageIds.length > 0 ? pageIds[pageIds.length - 1] : undefined,
        hasNext,
      },
    };

    return c.json(response);
  }
}
