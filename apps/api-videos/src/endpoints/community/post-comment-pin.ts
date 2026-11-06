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

async function readPinnedPointer(bucket: R2Bucket, postId: string): Promise<PinnedCommentPointer | null> {
  const obj = await bucket.get(pinnedPointerKey(postId));
  return obj ? obj.json<PinnedCommentPointer>() : null;
}

async function setCommentPinned(
  bucket: R2Bucket,
  postId: string,
  commentId: string,
  pinned: boolean
): Promise<PostComment | null> {
  const key = topLevelCommentKey(postId, commentId);
  const obj = await bucket.get(key);
  if (!obj) {
    return null;
  }
  const comment = await obj.json<PostComment>();
  comment.isPinned = pinned;
  await bucket.put(key, JSON.stringify(comment));
  return comment;
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

    const previous = await readPinnedPointer(bucket, postId);
    if (previous && previous.commentId !== commentId) {
      await setCommentPinned(bucket, postId, previous.commentId, false);
    }

    comment.isPinned = true;
    await bucket.put(topLevelCommentKey(postId, commentId), JSON.stringify(comment));
    const pointer: PinnedCommentPointer = { commentId, pinnedAt: new Date().toISOString() };
    await bucket.put(pinnedPointerKey(postId), JSON.stringify(pointer));

    logger.info('[PinPostComment] Comment pinned', { postId, commentId, previous: previous?.commentId, userId });

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

    const pointer = await readPinnedPointer(bucket, postId);
    if (pointer?.commentId === commentId) {
      await bucket.delete(pinnedPointerKey(postId));
    }

    logger.info('[UnpinPostComment] Comment unpinned', { postId, commentId, userId });

    const response: PostCommentPinResponse = { success: true, pinned: false, commentId };
    return c.json(response);
  }
}
