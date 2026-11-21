/**
 * Channel moderation of one post comment (docs/specs/CREATOR-STUDIO.md §4.7,
 * #771), thin routes over lib/channelComments/moderation.ts:
 *
 *   POST /api/community/channels/:channelId/posts/:postId/comments/:commentId/approve
 *   POST .../hold
 *   POST .../restore
 *
 * Those who moderate the channel's comments (owner, admin, moderator).
 */
import { Str } from '../../lib/chanfana-params';
import { z } from 'zod';
import type { StudioCommentAction } from '@al-ummah/shared-types';
import { AuthenticatedRoute, AppContext } from '../../base';
import { addAuthToSchema } from '../../lib/openapi-auth';
import { logger } from '../../lib/logger';
import { moderatePostComment, moderationStatus } from '../../lib/channelComments/moderation';
import { loadPostForModeration } from './post-comment-helpers';

const errorSchema = z.object({ success: z.boolean(), error: z.string() });

function buildSchema(summary: string, description: string) {
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
        '200': { description: 'Done (changed: false when it already was so)', content: { 'application/json': { schema: z.object({ success: z.boolean(), changed: z.boolean() }) } } },
        '403': { description: 'No comment moderation role on this channel, or held by platform moderation (`held_by_moderation`)', content: { 'application/json': { schema: errorSchema } } },
        '404': { description: 'Post or comment not found', content: { 'application/json': { schema: errorSchema } } },
        '409': { description: 'Not removed by the channel (`not_removed`), past the 90 days (`restore_expired`) or removed (`removed`)', content: { 'application/json': { schema: errorSchema } } },
      },
    },
    'required'
  );
}

abstract class PostCommentModerationRoute extends AuthenticatedRoute {
  protected abstract readonly action: StudioCommentAction;

  async handle(c: AppContext) {
    const userId = this.getUserId(c);
    const { channelId: postChannelId, postId, commentId } = c.req.param();
    const check = await loadPostForModeration(c.env, postChannelId, postId, userId);
    if (check.ok === false) {
      return c.json({ success: false, error: check.error }, check.status);
    }
    const outcome = await moderatePostComment(c as never, postChannelId, postId, commentId, this.action, userId);
    if (outcome.ok === false) {
      return c.json({ success: false, error: outcome.error }, moderationStatus(outcome.error));
    }
    logger.info('[CommentModeration] Post comment', { postId, commentId, action: this.action, actorUserId: userId, changed: outcome.changed });
    return c.json({ success: true, changed: outcome.changed });
  }
}

export class ApprovePostComment extends PostCommentModerationRoute {
  protected readonly action = 'approve' as const;
  schema = buildSchema('Approve a held comment (comment moderators)', 'Publishes a comment held for review. A comment held by platform moderation answers `held_by_moderation`.');
}

export class HoldPostComment extends PostCommentModerationRoute {
  protected readonly action = 'hold' as const;
  schema = buildSchema('Hold a published comment for review (comment moderators)', 'Hides a published comment from viewers (its author still sees it) until it is approved.');
}

export class RestorePostComment extends PostCommentModerationRoute {
  protected readonly action = 'restore' as const;
  schema = buildSchema("Restore a comment the post's channel removed (comment moderators)", 'Puts back a comment (with its replies) removed by the channel in the last 90 days.');
}
