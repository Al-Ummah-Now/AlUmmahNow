/**
 * A platform moderator's decision to hide a reported comment (admin-api POST /internal/admin/comment-moderation).
 * The same hold AI review's Hide puts on a comment (`heldBy: 'moderation'`): only its author and the channel still
 * see it, and the channel cannot release it. Written through the comment moderation library, so the comment
 * indexes, the public count and open pages follow.
 */
import { moderatePostComment, moderateVideoComment, type ModerationContext, type ModerationOutcome } from '../channelComments/moderation';
import { postChannelId } from '../community-posts';

export interface CommentHold {
	on: 'video' | 'post';
	parentId: string;
	commentId: string;
	actorId: string;
}

/** What was done; `changed: false` when it was already hidden. */
export async function holdComment(env: ModerationContext['env'], input: CommentHold, executionCtx?: ModerationContext['executionCtx']): Promise<{ found: boolean; changed: boolean }> {
	const c: ModerationContext = { env, executionCtx, platform: true };
	let outcome: ModerationOutcome;
	if (input.on === 'video') {
		outcome = await moderateVideoComment(c, input.parentId, input.commentId, 'hold', input.actorId);
	} else {
		const channelId = await postChannelId({ community_posts: env.community_posts, SEARCH_DB: env.SEARCH_DB as D1Database | undefined }, input.parentId);
		outcome = channelId ? await moderatePostComment(c, channelId, input.parentId, input.commentId, 'hold', input.actorId) : { ok: false, error: 'not_found' };
	}
	if (outcome.ok === true) return { found: true, changed: outcome.changed };
	const { error } = outcome as Extract<ModerationOutcome, { ok: false }>;
	// Held by moderation or removed by its channel: nobody sees it already
	if (error === 'held_by_moderation' || error === 'removed') return { found: true, changed: false };
	if (error === 'not_found') return { found: false, changed: false };
	throw new Error(`The comment could not be held: ${error}`);
}
