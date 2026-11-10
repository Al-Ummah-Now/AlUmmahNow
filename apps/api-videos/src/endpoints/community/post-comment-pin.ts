import { patchComment } from '../../lib/community-comments';
import R2Repository from '../../lib/r2Repo';
import { Str } from 'chanfana';
import { z } from 'zod';
import { AuthenticatedRoute, AppContext } from '../../base';
import { addAuthToSchema } from '../../lib/openapi-auth';
import { logger } from '../../lib/logger';
import type { PostComment, PostCommentPinResponse } from '@al-ummah/shared-types';
import {
  PinnedCommentPointer,
  loadPostForChannelOwner,
  pinnedPointerKey,
  topLevelCommentKey,
} from './post-comment-helpers';

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
        '403': { description: 'Not the channel owner', content: { 'application/json': { schema: errorSchema } } },
        '404': { description: 'Post or comment not found', content: { 'application/json': { schema: errorSchema } } },
      },
    },
    'required'
  );
}

/**
 * The pinned pointer (`comments/<post>/pinned.json`) is the single source of
 * truth for which comment is pinned (SCALABILITY-AUDIT AV-12): it changes only
 * with a conditional write, and the comment list derives `isPinned` from it.
 * The comments' own `isPinned` flags are kept in step best-effort.
 * An empty `commentId` means nothing is pinned.
 */
async function swapPinnedPointer(
  bucket: R2Bucket,
  postId: string,
  next: (current: string) => string | false,
): Promise<{ previous: string; changed: boolean }> {
  let previous = '';
  let changed = false;
  await new R2Repository<PinnedCommentPointer>(bucket).updateObject(
    pinnedPointerKey(postId),
    (pointer) => {
      previous = pointer.commentId || '';
      const commentId = next(previous);
      changed = commentId !== false && commentId !== previous;
      if (!changed) return false;
      pointer.commentId = commentId as string;
      pointer.pinnedAt = new Date().toISOString();
      return true;
    },
    { initial: () => ({ commentId: '', pinnedAt: new Date().toISOString() }) },
  );
  return { previous, changed };
}

async function setCommentPinned(
  bucket: R2Bucket,
  postId: string,
  commentId: string,
  pinned: boolean
): Promise<PostComment | null> {
  const { data } = await patchComment<never>(bucket, topLevelCommentKey(postId, commentId), (comment) => {
    if (Boolean(comment.isPinned) === pinned) return false;
    comment.isPinned = pinned;
    return true;
  });
  return data;
}

/**
 * Pin a top-level comment. Only the owner of the post's channel may pin.
 * A post has at most one pinned comment: pinning a new one unpins the previous.
 * Replies cannot be pinned (they are only shown inside their thread).
 */
export class PinPostComment extends AuthenticatedRoute {
  schema = buildPinSchema(
    'Pin a comment (channel owner only)',
    'Pins a top-level comment to the top of the comment list. Replaces any previously pinned comment.'
  );

  async handle(c: AppContext) {
    const userId = this.getUserId(c);
    const { channelId: postChannelId, postId, commentId } = c.req.param();
    const bucket = c.env.community_posts;

    const ownerCheck = await loadPostForChannelOwner(c.env, postChannelId, postId, userId);
    if (ownerCheck.ok === false) {
      return c.json({ success: false, error: ownerCheck.error }, ownerCheck.status);
    }

    const commentObj = await bucket.get(topLevelCommentKey(postId, commentId));
    if (!commentObj) {
      return c.json({ success: false, error: 'Comment not found or is a reply (only top-level comments can be pinned)' }, 404);
    }
    const comment = await commentObj.json<PostComment>();
    if (comment.deletedAt || comment.isDeleted || comment.isHidden) {
      return c.json({ success: false, error: 'Cannot pin a deleted or hidden comment' }, 400);
    }

    // One conditional write of the pointer decides; the previous pin it
    // replaced is unpinned (two pins at once leave exactly one pinned)
    const { previous } = await swapPinnedPointer(bucket, postId, () => commentId);
    await setCommentPinned(bucket, postId, commentId, true);
    if (previous && previous !== commentId) {
      await setCommentPinned(bucket, postId, previous, false);
    }

    logger.info('[PinPostComment] Comment pinned', { postId, commentId, previous: previous || undefined, userId });

    const response: PostCommentPinResponse = { success: true, pinned: true, commentId };
    return c.json(response);
  }
}

/**
 * Unpin a comment. Only the owner of the post's channel may unpin. Idempotent.
 */
export class UnpinPostComment extends AuthenticatedRoute {
  schema = buildPinSchema('Unpin a comment (channel owner only)', 'Removes the pinned state from a comment.');

  async handle(c: AppContext) {
    const userId = this.getUserId(c);
    const { channelId: postChannelId, postId, commentId } = c.req.param();
    const bucket = c.env.community_posts;

    const ownerCheck = await loadPostForChannelOwner(c.env, postChannelId, postId, userId);
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

    logger.info('[UnpinPostComment] Comment unpinned', { postId, commentId, userId });

    const response: PostCommentPinResponse = { success: true, pinned: false, commentId };
    return c.json(response);
  }
}
