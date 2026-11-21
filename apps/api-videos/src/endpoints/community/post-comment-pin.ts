import { setCommentPinned, swapPinnedPointer } from '../../lib/community-comments';
import { Str } from '../../lib/chanfana-params';
import { z } from 'zod';
import { AuthenticatedRoute, AppContext } from '../../base';
import { addAuthToSchema } from '../../lib/openapi-auth';
import { logger } from '../../lib/logger';
import type { PostComment, PostCommentPinResponse } from '@al-ummah/shared-types';
import { loadPostForModeration, topLevelCommentKey } from './post-comment-helpers';

const errorSchema = z.object({ success: z.boolean(), error: z.string() });

function buildPinSchema(summary: string, description: string) {
  return addAuthToSchema(
    {
      tags: ['Community Posts - Comments'],
      summary,
      description,
      request: {
        params: z.object({
          channelId: Str({ description: 'Channel ID that owns the post' }),
          postId: Str({ description: 'Post ID' }),
          commentId: Str({ description: 'Top-level comment ID' }),
        }),
      },
      responses: {
        '200': {
          description: 'Pin state updated',
          content: {
            'application/json': {
              schema: z.object({
                success: z.boolean(),
                pinned: z.boolean(),
                commentId: z.string(),
              }),
            },
          },
        },
        '400': { description: 'Comment cannot be pinned', content: { 'application/json': { schema: errorSchema } } },
        '403': { description: 'No comment moderation role on this channel', content: { 'application/json': { schema: errorSchema } } },
        '404': { description: 'Post or comment not found', content: { 'application/json': { schema: errorSchema } } },
      },
    },
    'required'
  );
}

/**
 * Pin a top-level comment. Only those who moderate the channel's comments may pin.
 * A post has at most one pinned comment: pinning a new one unpins the previous.
 * Replies cannot be pinned (they are only shown inside their thread).
 */
export class PinPostComment extends AuthenticatedRoute {
  schema = buildPinSchema(
    'Pin a comment (comment moderators)',
    'Pins a top-level comment to the top of the comment list. Replaces any previously pinned comment.'
  );

  async handle(c: AppContext) {
    const userId = this.getUserId(c);
    const { channelId: postChannelId, postId, commentId } = c.req.param();
    const bucket = c.env.community_posts;

    const ownerCheck = await loadPostForModeration(c.env, postChannelId, postId, userId);
    if (ownerCheck.ok === false) {
      return c.json({ success: false, error: ownerCheck.error }, ownerCheck.status);
    }

    const commentObj = await bucket.get(topLevelCommentKey(postId, commentId));
    if (!commentObj) {
      return c.json({ success: false, error: 'Comment not found or is a reply (only top-level comments can be pinned)' }, 404);
    }
    const comment = await commentObj.json<PostComment>();
    if (comment.deletedAt || comment.isDeleted || comment.isHidden || comment.removedBy === 'channel' || comment.status === 'held') {
      return c.json({ success: false, error: 'Cannot pin a deleted or hidden comment' }, 400);
    }

    // One conditional write of the pointer decides; the previous pin it
    // replaced is unpinned (two pins at once leave exactly one pinned)
    const { previous } = await swapPinnedPointer(bucket, postId, () => commentId);
    await setCommentPinned(bucket, postId, commentId, true);
    if (previous && previous !== commentId) {
      await setCommentPinned(bucket, postId, previous, false);
    }

    logger.debug('[PinPostComment] Comment pinned', { postId, commentId, previous: previous || undefined, userId });

    const response: PostCommentPinResponse = { success: true, pinned: true, commentId };
    return c.json(response);
  }
}

/**
 * Unpin a comment. Only those who moderate the channel's comments may unpin. Idempotent.
 */
export class UnpinPostComment extends AuthenticatedRoute {
  schema = buildPinSchema('Unpin a comment (comment moderators)', 'Removes the pinned state from a comment.');

  async handle(c: AppContext) {
    const userId = this.getUserId(c);
    const { channelId: postChannelId, postId, commentId } = c.req.param();
    const bucket = c.env.community_posts;

    const ownerCheck = await loadPostForModeration(c.env, postChannelId, postId, userId);
    if (ownerCheck.ok === false) {
      return c.json({ success: false, error: ownerCheck.error }, ownerCheck.status);
    }

    const updated = await setCommentPinned(bucket, postId, commentId, false);
    if (!updated) {
      return c.json({ success: false, error: 'Comment not found' }, 404);
    }

    // Clear the pointer only if it still points at this comment (a pin of
    // another comment that landed meanwhile stays)
    await swapPinnedPointer(bucket, postId, (current) => (current === commentId ? '' : false));

    logger.debug('[UnpinPostComment] Comment unpinned', { postId, commentId, userId });

    const response: PostCommentPinResponse = { success: true, pinned: false, commentId };
    return c.json(response);
  }
}
