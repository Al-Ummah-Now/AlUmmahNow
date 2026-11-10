import { patchComment } from '../../lib/community-comments';
import { Str } from 'chanfana';
import { z } from 'zod';
import { AuthenticatedRoute, AppContext } from '../../base';
import { addAuthToSchema } from '../../lib/openapi-auth';
import { logger } from '../../lib/logger';
import type { PostCommentHeartResponse } from '@al-ummah/shared-types';
import { findPostComment, loadPostForChannelOwner } from './post-comment-helpers';

const errorSchema = z.object({ success: z.boolean(), error: z.string() });

function buildHeartSchema(summary: string, description: string) {
  return addAuthToSchema(
    {
      tags: ['Community Posts - Comments'],
      summary,
      description,
      request: {
        params: z.object({
          channelId: Str({ description: 'Channel ID that owns the post' }),
          postId: Str({ description: 'Post ID' }),
          commentId: Str({ description: 'Comment or reply ID' }),
        }),
      },
      responses: {
        '200': {
          description: 'Heart state updated',
          content: {
            'application/json': {
              schema: z.object({
                success: z.boolean(),
                hearted: z.boolean(),
                commentId: z.string(),
              }),
            },
          },
        },
        '400': { description: 'Comment cannot be hearted', content: { 'application/json': { schema: errorSchema } } },
        '403': { description: 'Not the channel owner', content: { 'application/json': { schema: errorSchema } } },
        '404': { description: 'Post or comment not found', content: { 'application/json': { schema: errorSchema } } },
      },
    },
    'required'
  );
}

abstract class SetCommentHeartRoute extends AuthenticatedRoute {
  protected abstract readonly hearted: boolean;

  async handle(c: AppContext) {
    const userId = this.getUserId(c);
    const { channelId: postChannelId, postId, commentId } = c.req.param();
    const bucket = c.env.community_posts;

    const ownerCheck = await loadPostForChannelOwner(c.env, postChannelId, postId, userId);
    if (ownerCheck.ok === false) {
      return c.json({ success: false, error: ownerCheck.error }, ownerCheck.status);
    }

    const { comment, commentKey } = await findPostComment(bucket, postId, commentId);
    if (!comment) {
      return c.json({ success: false, error: 'Comment not found' }, 404);
    }
    if (this.hearted && (comment.deletedAt || comment.isDeleted)) {
      return c.json({ success: false, error: 'Cannot heart a deleted comment' }, 400);
    }

    // On the fresh comment with a conditional write (SCALABILITY-AUDIT AV-11):
    // never resets likes / replies that land meanwhile
    const { rejected } = await patchComment<'deleted'>(bucket, commentKey, (fresh) => {
      if (this.hearted && (fresh.deletedAt || fresh.isDeleted)) return { reject: 'deleted' };
      if (Boolean(fresh.isHeartedByCreator) === this.hearted) return false;
      fresh.isHeartedByCreator = this.hearted;
      return true;
    });
    if (rejected) {
      return c.json({ success: false, error: 'Cannot heart a deleted comment' }, 400);
    }

    logger.info('[PostCommentHeart] Heart state updated', { postId, commentId, hearted: this.hearted, userId });

    const response: PostCommentHeartResponse = { success: true, hearted: this.hearted, commentId };
    return c.json(response);
  }
}

/**
 * Heart a comment or reply ("loved by creator"). Channel owner only. Idempotent.
 */
export class HeartPostComment extends SetCommentHeartRoute {
  protected readonly hearted = true;
  schema = buildHeartSchema('Heart a comment (channel owner only)', 'Marks a comment as hearted by the post creator.');
}

/**
 * Remove the creator heart from a comment or reply. Channel owner only. Idempotent.
 */
export class UnheartPostComment extends SetCommentHeartRoute {
  protected readonly hearted = false;
  schema = buildHeartSchema('Remove heart from a comment (channel owner only)', 'Removes the creator heart from a comment.');
}
