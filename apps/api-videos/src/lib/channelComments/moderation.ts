/**
 * Channel comment moderation (docs/specs/CREATOR-STUDIO.md §4.7, #771): one
 * library behind the Studio bulk route and the per-comment routes, for video
 * comments (inside the video's R2 object) and post comments (one R2 object
 * each). Every action changes the fresh record with a conditional write.
 *
 * - remove: by a moderator who is not the author, a soft removal
 *   (`isDeleted`, `removedBy: 'channel'`, `removedAt`, `removedByUserId`); the
 *   comment and its replies stay on record for 90 days and leave the public
 *   count. The author removing their own comment is a real deletion.
 * - restore: undoes a channel removal (never a platform moderation one).
 * - approve / hold: publish a held comment, or hold a published one. A comment
 *   held by platform moderation is refused with `held_by_moderation`.
 * - pin / unpin: one pinned top-level comment per video or post.
 * - heart / unheart: the channel's heart.
 *
 * Callers check the capability (`comment.moderate` through the channel role)
 * first; each change records who did it (`moderation`) for the audit trail.
 */
import { mayDeleteOwn } from '../channelAccess';
import type { CommentModerationRecord, CommunityPost, PostComment, StudioCommentAction } from '@al-ummah/shared-types';
import { STUDIO_REMOVED_RETENTION_DAYS } from '@al-ummah/shared-types';
import R2Repository from '../r2Repo';
import { findStoredComment, removeStoredComment, type StoredComment } from '../comments';
import { patchComment, removeFromCommentIndex, setCommentPinned, swapPinnedPointer } from '../community-comments';
import { bumpPostComments } from '../community-posts';
import { broadcastInBackground } from '../websocket-notify';
import { executionCtxOf, indexPostComment, type IndexEnv } from './index';

export type ModerationError =
	| 'not_found'
	| 'forbidden'
	| 'held_by_moderation'
	| 'not_removed'
	| 'restore_expired'
	| 'not_top_level'
	| 'not_published'
	| 'removed'
	| 'not_in_channel'
	| 'failed';

export type ModerationOutcome = { ok: true; changed: boolean; hardDeleted?: boolean } | { ok: false; error: ModerationError };

/** HTTP status of a refusal. */
export function moderationStatus(error: ModerationError): 400 | 403 | 404 | 409 {
	if (error === 'not_found' || error === 'not_in_channel') return 404;
	if (error === 'forbidden' || error === 'held_by_moderation') return 403;
	if (error === 'not_top_level' || error === 'not_published') return 400;
	return 409;
}

export interface ModerationContext {
	env: IndexEnv & { videos: R2Bucket; community_posts: R2Bucket; [binding: string]: unknown };
	executionCtx?: { waitUntil(promise: Promise<unknown>): void };
}

const RETENTION_MS = STUDIO_REMOVED_RETENTION_DAYS * 24 * 60 * 60 * 1000;

function record(action: string, userId: string, at: string): CommentModerationRecord {
	return { action, userId, at };
}

/** Whether platform moderation holds the comment (the channel cannot release or remove it). */
function heldByPlatform(comment: { heldBy?: unknown; isHidden?: unknown }): boolean {
	return comment.heldBy === 'moderation' || comment.isHidden === true;
}

// ---------- video comments ----------

type VideoRecord = { id?: string; userId?: string | null; channelId?: string | null; comments?: unknown[] };

/**
 * Runs `action` on a video comment. `actorUserId` must already be allowed to
 * moderate the video's comments. `remove` by the comment's author is a real
 * deletion (as the DELETE route does for anyone deleting their own comment);
 * one written as a channel they no longer speak for is removed like anyone else's.
 */
export async function moderateVideoComment(c: ModerationContext, videoId: string, commentId: string, action: StudioCommentAction, actorUserId: string, now = new Date()): Promise<ModerationOutcome> {
	const repository = new R2Repository<VideoRecord>(c.env.videos);
	const at = now.toISOString();
	let changed = false;
	let hardDeleted = false;
	let parentId: string | null = null;
	let after: StoredComment | null = null;
	let wasVisible = false;
	const stored = action === 'remove' ? findStoredComment(((await repository.getObject(videoId))?.comments ?? []) as StoredComment[], commentId)?.comment : undefined;
	const own = stored?.userId === actorUserId && (await mayDeleteOwn(c.env as never, stored.channelId, actorUserId));

	const { data, rejected } = await repository.updateObjectOrReject<ModerationError>(videoId, (fresh) => {
		changed = false;
		hardDeleted = false;
		const comments = (fresh.comments ?? []) as StoredComment[];
		const found = findStoredComment(comments, commentId);
		if (!found) return { reject: 'not_found' };
		const { comment, parent } = found;
		parentId = parent?.id ?? null;
		wasVisible = comment.isDeleted !== true && comment.status !== 'held' && comment.isHidden !== true;
		const removedByChannel = comment.removedBy === 'channel' && comment.isDeleted === true;
		// Gone for everyone but the record (an author's delete, an erasure): nothing to act on
		if (comment.isDeleted === true && !removedByChannel) return { reject: 'not_found' };

		switch (action) {
			case 'approve': {
				if (removedByChannel) return { reject: 'removed' };
				if (heldByPlatform(comment)) return { reject: 'held_by_moderation' };
				if (comment.status !== 'held') return false;
				comment.status = 'published';
				delete comment.heldBy;
				break;
			}
			case 'hold': {
				if (removedByChannel) return { reject: 'removed' };
				if (heldByPlatform(comment)) return { reject: 'held_by_moderation' };
				if (comment.status === 'held') return false;
				comment.status = 'held';
				delete comment.heldBy;
				comment.isPinned = false;
				break;
			}
			case 'remove': {
				if (removedByChannel) return false;
				if (heldByPlatform(comment)) return { reject: 'held_by_moderation' };
				if (own && comment.userId === actorUserId) {
					fresh.comments = removeStoredComment(comments, commentId).comments;
					hardDeleted = true;
					changed = true;
					return true;
				}
				comment.isDeleted = true;
				comment.removedBy = 'channel';
				comment.removedAt = at;
				comment.removedByUserId = actorUserId;
				comment.isPinned = false;
				break;
			}
			case 'restore': {
				if (!removedByChannel) return { reject: 'not_removed' };
				if (comment.removedAt && now.getTime() - new Date(comment.removedAt).getTime() > RETENTION_MS) return { reject: 'restore_expired' };
				comment.isDeleted = false;
				delete comment.removedBy;
				delete comment.removedAt;
				delete comment.removedByUserId;
				break;
			}
			case 'pin':
			case 'unpin': {
				if (parent) return { reject: 'not_top_level' };
				const pinned = action === 'pin';
				if (pinned && removedByChannel) return { reject: 'removed' };
				if (pinned && (comment.status === 'held' || comment.isHidden === true)) return { reject: 'not_published' };
				if ((comment.isPinned === true) === pinned) return false;
				// One pinned comment per video: pinning replaces the previous one
				if (pinned) for (const other of comments) if (other.isPinned) other.isPinned = false;
				comment.isPinned = pinned;
				break;
			}
			case 'heart':
			case 'unheart': {
				const hearted = action === 'heart';
				if (hearted && removedByChannel) return { reject: 'removed' };
				if ((comment.isHearted === true) === hearted) return false;
				comment.isHearted = hearted;
				break;
			}
		}
		comment.moderation = record(action, actorUserId, at);
		after = comment;
		changed = true;
		return true;
	});
	if (!data) return { ok: false, error: 'not_found' };
	if (rejected) return { ok: false, error: rejected };

	// Realtime: viewers of the watch page see the change
	if (changed) {
		const nowVisible = !hardDeleted && !!after && (after as StoredComment).isDeleted !== true && (after as StoredComment).status !== 'held';
		if (wasVisible && !nowVisible) {
			broadcastInBackground(c as never, `video:${videoId}`, 'comment_deleted', { videoId, commentId, parentCommentId: parentId });
		} else if (!wasVisible && nowVisible) {
			broadcastInBackground(c as never, `video:${videoId}`, 'comment_added', { videoId, commentId, parentCommentId: parentId });
		}
	}
	return { ok: true, changed, ...(hardDeleted ? { hardDeleted } : {}) };
}

// ---------- post comments ----------

const topKey = (postId: string, commentId: string) => `comments/${postId}/top-level/${commentId}.json`;
const replyKey = (postId: string, parentId: string, replyId: string) => `comments/${postId}/replies/${parentId}/${replyId}.json`;

/** A post comment's key from its id: the top-level key, else the reply-parent pointer. */
async function locatePostComment(bucket: R2Bucket, postId: string, commentId: string, parentHint?: string | null): Promise<{ key: string; comment: PostComment } | null> {
	const candidates = parentHint ? [replyKey(postId, parentHint, commentId), topKey(postId, commentId)] : [topKey(postId, commentId)];
	for (const key of candidates) {
		const object = await bucket.get(key);
		if (object) return { key, comment: await object.json<PostComment>() };
	}
	if (!parentHint) {
		const pointer = await bucket.get(`comments/${postId}/reply-parents/${commentId}.json`);
		const parent = pointer ? (await pointer.json<{ parentCommentId?: string }>()).parentCommentId : undefined;
		if (parent) {
			const object = await bucket.get(replyKey(postId, parent, commentId));
			if (object) return { key: replyKey(postId, parent, commentId), comment: await object.json<PostComment>() };
		}
	}
	return null;
}

const isLive = (comment: PostComment) => !comment.deletedAt && comment.isDeleted !== true && comment.status !== 'held' && comment.isHidden !== true;

/** Live replies of a top-level post comment (they leave the public count with it). */
async function liveReplies(bucket: R2Bucket, postId: string, parentId: string): Promise<number> {
	const index = await bucket.get(`comments/${postId}/replies/${parentId}/index.json`);
	const ids = index ? ((await index.json<{ commentIds?: string[] }>()).commentIds ?? []) : [];
	const replies = await Promise.all(ids.map(async (id) => {
		const object = await bucket.get(replyKey(postId, parentId, id));
		return object ? object.json<PostComment>() : null;
	}));
	return replies.filter((r): r is PostComment => !!r && isLive(r)).length;
}

/**
 * Runs `action` on a post comment. `postChannelId` is the post's channel (the
 * caller checked `comment.moderate` on it); the post must exist there.
 */
export async function moderatePostComment(c: ModerationContext, postChannelId: string, postId: string, commentId: string, action: StudioCommentAction, actorUserId: string, now = new Date(), parentHint?: string | null): Promise<ModerationOutcome> {
	const bucket = c.env.community_posts;
	const postKey = `posts/${postChannelId}/${postId}.json`;
	const postObject = await bucket.get(postKey);
	if (!postObject) return { ok: false, error: 'not_found' };
	const post = await postObject.json<CommunityPost>();
	if ((post.status as string) === 'deleted') return { ok: false, error: 'not_found' };
	const located = await locatePostComment(bucket, postId, commentId, parentHint);
	if (!located) return { ok: false, error: 'not_found' };
	const at = now.toISOString();
	const isReply = !!located.comment.parentCommentId;

	if (action === 'pin' || action === 'unpin') {
		if (isReply) return { ok: false, error: 'not_top_level' };
		const pinned = action === 'pin';
		const c0 = located.comment;
		if (pinned && (c0.removedBy === 'channel' || c0.deletedAt || c0.isDeleted)) return { ok: false, error: c0.removedBy === 'channel' ? 'removed' : 'not_found' };
		if (pinned && (c0.status === 'held' || c0.isHidden)) return { ok: false, error: 'not_published' };
		if (pinned) {
			const { previous, changed } = await swapPinnedPointer(bucket, postId, () => commentId);
			await setCommentPinned(bucket, postId, commentId, true);
			if (previous && previous !== commentId) await setCommentPinned(bucket, postId, previous, false);
			await patchComment<never>(bucket, located.key, (fresh) => void (fresh.moderation = record(action, actorUserId, at)));
			return { ok: true, changed };
		}
		const updated = await setCommentPinned(bucket, postId, commentId, false);
		const { changed } = await swapPinnedPointer(bucket, postId, (current) => (current === commentId ? '' : false));
		if (updated) await patchComment<never>(bucket, located.key, (fresh) => void (fresh.moderation = record(action, actorUserId, at)));
		return { ok: true, changed: changed || Boolean(updated) };
	}

	// Counted before the write: the replies that leave (or come back to) the count with a top-level comment
	const own = action === 'remove' && located.comment.userId === actorUserId && (await mayDeleteOwn(c.env as never, located.comment.channelId, actorUserId));
	const repliesLive = action === 'remove' && !isReply ? await liveReplies(bucket, postId, commentId) : 0;
	let countDelta = 0;
	let hardDeleted = false;
	let wasPinned = false;
	let wrote = false;

	const { data, rejected } = await patchComment<ModerationError>(bucket, located.key, (fresh) => {
		wrote = false;
		countDelta = 0;
		hardDeleted = false;
		wasPinned = fresh.isPinned === true;
		const removedByChannel = fresh.removedBy === 'channel';
		if (!removedByChannel && (fresh.deletedAt || fresh.isDeleted)) return { reject: 'not_found' };
		switch (action) {
			case 'approve':
				if (removedByChannel) return { reject: 'removed' };
				if (heldByPlatform(fresh)) return { reject: 'held_by_moderation' };
				if (fresh.status !== 'held') return false;
				delete fresh.status;
				delete fresh.heldBy;
				countDelta = 1;
				break;
			case 'hold':
				if (removedByChannel) return { reject: 'removed' };
				if (heldByPlatform(fresh)) return { reject: 'held_by_moderation' };
				if (fresh.status === 'held') return false;
				fresh.status = 'held';
				delete fresh.heldBy;
				countDelta = -1;
				break;
			case 'remove': {
				if (removedByChannel) return false;
				if (heldByPlatform(fresh)) return { reject: 'held_by_moderation' };
				const counted = isLive(fresh) ? 1 + repliesLive : 0;
				if (own && fresh.userId === actorUserId) {
					// The author's own comment: deleted as the DELETE route deletes it
					fresh.deletedAt = at;
					countDelta = -counted;
					hardDeleted = true;
					break;
				}
				fresh.isDeleted = true;
				fresh.removedBy = 'channel';
				fresh.removedAt = at;
				fresh.removedByUserId = actorUserId;
				fresh.removedCount = counted;
				fresh.isPinned = false;
				countDelta = -counted;
				break;
			}
			case 'restore':
				if (!removedByChannel) return { reject: 'not_removed' };
				if (fresh.removedAt && now.getTime() - new Date(fresh.removedAt).getTime() > RETENTION_MS) return { reject: 'restore_expired' };
				countDelta = fresh.removedCount ?? 0;
				fresh.isDeleted = false;
				delete fresh.removedBy;
				delete fresh.removedAt;
				delete fresh.removedByUserId;
				delete fresh.removedCount;
				break;
			case 'heart':
			case 'unheart': {
				const hearted = action === 'heart';
				if (hearted && removedByChannel) return { reject: 'removed' };
				if (Boolean(fresh.isHeartedByCreator) === hearted) return false;
				fresh.isHeartedByCreator = hearted;
				break;
			}
		}
		fresh.moderation = record(action, actorUserId, at);
		wrote = true;
		return true;
	});
	if (!data) return { ok: false, error: 'not_found' };
	if (rejected) return { ok: false, error: rejected };
	if (!wrote) return { ok: true, changed: false };

	if (countDelta !== 0) await bumpPostComments(bucket, postKey, countDelta);
	if (wasPinned && (action === 'remove' || action === 'hold')) {
		await swapPinnedPointer(bucket, postId, (current) => (current === commentId ? '' : false));
	}
	// An author's own delete leaves the thread as [deleted] when it has replies, as before
	if (hardDeleted && !(data.repliesCount || 0)) {
		const indexKey = isReply ? `comments/${postId}/replies/${data.parentCommentId}/index.json` : `comments/${postId}/top-level/index.json`;
		await removeFromCommentIndex(bucket, indexKey, commentId);
	}
	await indexPostComment(c.env, executionCtxOf(c), postId, postChannelId, data);
	return { ok: true, changed: true, ...(hardDeleted ? { hardDeleted } : {}) };
}
