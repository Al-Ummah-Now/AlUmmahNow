/**
 * Channel moderation of one video comment (docs/specs/CREATOR-STUDIO.md §4.7,
 * #771), thin routes over lib/channelComments/moderation.ts:
 *
 *   POST /api/videos/:id/comments/:cid/restore  undo the channel's removal
 *   POST /api/videos/:id/comments/:cid/hold     hold a published comment for review
 *   POST /api/videos/:id/comments/:cid/pin      { pinned }  one pinned comment per video
 *   POST /api/videos/:id/comments/:cid/heart    { hearted }
 *
 * The video's owner, or a member whose channel role grants `comment.moderate`.
 */
import { Str } from '../../lib/chanfana-params';
import { z } from 'zod';
import type { StudioCommentAction } from '@al-ummah/shared-types';
import { AuthenticatedRoute, AppContext } from '../../base';
import { ResponseError } from '../../lib/types';
import { logger } from '../../lib/logger';
import { canOnVideo } from '../../lib/channelAccess';
import { isVideoRemoved } from '../../lib/visibility';
import { moderateVideoComment, moderationStatus } from '../../lib/channelComments/moderation';

const params = z.object({ id: Str({ description: 'Video id' }), cid: Str({ description: 'Comment or reply id' }) });

const responses = {
	'200': { description: 'Done (changed: false when it already was so)', content: { 'application/json': { schema: z.object({ success: z.boolean(), changed: z.boolean() }) } } },
	'400': { description: 'Not possible on this comment (a reply cannot be pinned; a held comment cannot be pinned)', content: { 'application/json': { schema: ResponseError } } },
	'403': { description: 'No comment moderation role on the video\'s channel, or held by platform moderation (`held_by_moderation`)', content: { 'application/json': { schema: ResponseError } } },
	'404': { description: 'Video or comment not found', content: { 'application/json': { schema: ResponseError } } },
	'409': { description: 'Not removed by the channel (`not_removed`), past the 90 days (`restore_expired`) or removed (`removed`)', content: { 'application/json': { schema: ResponseError } } },
};

async function runVideoAction(c: AppContext, userId: string, videoId: string, commentId: string, action: StudioCommentAction): Promise<Response> {
	const object = await c.env.videos.get(videoId);
	const video = object ? ((await object.json()) as { userId?: string | null; channelId?: string | null }) : null;
	if (!video || isVideoRemoved(video as never)) return c.json({ success: false, error: 'Object not found' }, 404);
	if (!(await canOnVideo(c.env as never, video, userId, 'comment.moderate'))) return c.json({ success: false, error: 'Forbidden' }, 403);
	const outcome = await moderateVideoComment(c as never, videoId, commentId, action, userId);
	if (outcome.ok === false) return c.json({ success: false, error: outcome.error }, moderationStatus(outcome.error));
	logger.info('[CommentModeration] Video comment', { videoId, commentId, action, actorUserId: userId, changed: outcome.changed });
	return c.json({ success: true, changed: outcome.changed });
}

export class CommentRestore extends AuthenticatedRoute {
	schema = {
		tags: ['Comments'],
		summary: "Restore a comment the video's channel removed",
		description: 'Puts back a comment (with its replies) removed by the channel in the last 90 days. Never a platform moderation removal.',
		request: { params },
		responses,
	};

	async handle(c: AppContext) {
		const { params: p } = await this.getValidatedData<typeof this.schema>();
		return runVideoAction(c, this.getUserId(c), p.id, p.cid, 'restore');
	}
}

export class CommentHold extends AuthenticatedRoute {
	schema = {
		tags: ['Comments'],
		summary: 'Hold a published comment for review',
		description: 'Hides a published comment from viewers (its author still sees it) until it is approved with POST .../approve.',
		request: { params },
		responses,
	};

	async handle(c: AppContext) {
		const { params: p } = await this.getValidatedData<typeof this.schema>();
		return runVideoAction(c, this.getUserId(c), p.id, p.cid, 'hold');
	}
}

export class CommentPin extends AuthenticatedRoute {
	schema = {
		tags: ['Comments'],
		summary: 'Pin or unpin a top-level comment',
		description: 'A video has at most one pinned comment: pinning one unpins the previous.',
		request: {
			params,
			body: { content: { 'application/json': { schema: z.object({ pinned: z.boolean() }) } } },
		},
		responses,
	};

	async handle(c: AppContext) {
		const { params: p, body } = await this.getValidatedData<typeof this.schema>();
		return runVideoAction(c, this.getUserId(c), p.id, p.cid, body.pinned ? 'pin' : 'unpin');
	}
}

export class CommentHeart extends AuthenticatedRoute {
	schema = {
		tags: ['Comments'],
		summary: "Heart or unheart a comment as the video's channel",
		request: {
			params,
			body: { content: { 'application/json': { schema: z.object({ hearted: z.boolean() }) } } },
		},
		responses,
	};

	async handle(c: AppContext) {
		const { params: p, body } = await this.getValidatedData<typeof this.schema>();
		return runVideoAction(c, this.getUserId(c), p.id, p.cid, body.hearted ? 'heart' : 'unheart');
	}
}
