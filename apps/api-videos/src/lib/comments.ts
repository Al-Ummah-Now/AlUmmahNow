/**
 * Video comment helpers
 *
 * Pure functions used by the comment endpoints. Comments are embedded in the
 * video object stored in R2, so listing/pagination happens in memory.
 */

import { PUBLIC_DISLIKES_COUNT } from './reactions';

export interface StoredReaction {
	id: string;
	userId: string;
	channelId: string;
}

export interface StoredComment {
	id: string;
	userId: string;
	channelId: string;
	videoId: string;
	text: string;
	dateCreated: string;
	dateModified?: string;
	likes?: StoredReaction[];
	dislikes?: StoredReaction[];
	replies?: unknown[];
	isEdited?: boolean;
	isDeleted?: boolean;
	isPinned?: boolean;
	isHidden?: boolean;
	/** Set on replies: id of the top-level comment (replies are one level deep) */
	parentCommentId?: string;
	/** 'held' while awaiting the video owner's review (comment settings = held) */
	status?: CommentStatus;
	/** 'moderation' when a moderator held it (Epic 28); the video owner cannot approve those */
	heldBy?: 'moderation';
}

export type CommentStatus = 'published' | 'held';

/** Per-video comment settings: on, held for review, off */
export const COMMENT_SETTINGS = ['on', 'held', 'off'] as const;
export type CommentSettings = typeof COMMENT_SETTINGS[number];

export function getCommentSettings(video: { commentSettings?: unknown } | null | undefined): CommentSettings {
	const value = video?.commentSettings;
	return value === 'held' || value === 'off' ? value : 'on';
}

export type CommentSort = 'top' | 'newest';

export function parseCommentSort(value: unknown): CommentSort {
	return value === 'top' ? 'top' : 'newest';
}

/** Who is looking at the comments: held comments are visible to their author and the video owner only. */
export interface CommentViewer {
	userId?: string | null;
	isVideoOwner?: boolean;
}

export interface CommentAuthor {
	userId: string;
	channelId: string;
	displayName: string;
	avatarUrl?: string;
}

export interface CommentListItem {
	id: string;
	userId: string;
	channelId: string;
	videoId: string;
	text: string;
	dateCreated: string;
	dateModified: string;
	likesCount: number;
	dislikesCount: number;
	repliesCount: number;
	isEdited: boolean;
	isDeleted: boolean;
	isPinned: boolean;
	isLiked: boolean;
	isDisliked: boolean;
	isHeld: boolean;
	parentCommentId: string | null;
	author: CommentAuthor;
}

export interface CommentPage<T> {
	items: T[];
	nextCursor: string | null;
	total: number;
}

export const DEFAULT_COMMENT_PAGE_SIZE = 20;
export const MAX_COMMENT_PAGE_SIZE = 100;

/** Comments that are soft-deleted or hidden by moderation are never listed. */
export function isCommentVisible(comment: StoredComment | null | undefined, viewer?: CommentViewer): boolean {
	if (!comment) return false;
	if (comment.isDeleted === true || comment.isHidden === true) return false;
	if (comment.status === 'held') {
		return !!viewer && (viewer.isVideoOwner === true || (!!viewer.userId && viewer.userId === comment.userId));
	}
	return true;
}

/** Ranking for `top`: likes only, since comment dislikes are hidden and not counted (2026-11-12). */
function score(comment: StoredComment): number {
	return comment.likes?.length || 0;
}

/**
 * Order comments: pinned first, then by sort (`top` = most likes, ties newest
 * first; `newest` = newest first).
 */
export function sortComments<T extends StoredComment>(comments: T[], sort: CommentSort = 'newest'): T[] {
	return comments.slice().sort((a, b) => {
		if ((a.isPinned === true) !== (b.isPinned === true)) {
			return a.isPinned ? -1 : 1;
		}
		if (sort === 'top') {
			const diff = score(b) - score(a);
			if (diff !== 0) return diff;
		}
		return new Date(b.dateCreated).getTime() - new Date(a.dateCreated).getTime();
	});
}

function clampPage(limit: number, cursor?: string | null): { safeLimit: number; offset: number } {
	const safeLimit = Math.min(Math.max(1, Math.floor(limit) || DEFAULT_COMMENT_PAGE_SIZE), MAX_COMMENT_PAGE_SIZE);
	const parsedOffset = cursor ? parseInt(cursor, 10) : 0;
	const offset = Number.isFinite(parsedOffset) && parsedOffset > 0 ? parsedOffset : 0;
	return { safeLimit, offset };
}

/**
 * Sort visible comments and return one page. The cursor is the numeric offset
 * encoded as a string.
 */
export function paginateComments<T extends StoredComment>(
	comments: T[] | null | undefined,
	limit: number = DEFAULT_COMMENT_PAGE_SIZE,
	cursor?: string | null,
	sort: CommentSort = 'newest',
	viewer?: CommentViewer,
): CommentPage<T> {
	const { safeLimit, offset } = clampPage(limit, cursor);
	const sorted = sortComments((comments || []).filter((c) => isCommentVisible(c, viewer)), sort);

	const items = sorted.slice(offset, offset + safeLimit);
	const nextOffset = offset + items.length;

	return {
		items,
		nextCursor: nextOffset < sorted.length ? String(nextOffset) : null,
		total: sorted.length,
	};
}

/** Visible replies of a comment, oldest first (conversation order), paginated. */
export function paginateReplies<T extends StoredComment>(
	parent: StoredComment,
	limit: number = DEFAULT_COMMENT_PAGE_SIZE,
	cursor?: string | null,
	viewer?: CommentViewer,
): CommentPage<T> {
	const { safeLimit, offset } = clampPage(limit, cursor);
	const visible = ((parent.replies || []) as T[])
		.filter((r) => isCommentVisible(r, viewer))
		.sort((a, b) => new Date(a.dateCreated).getTime() - new Date(b.dateCreated).getTime());
	const items = visible.slice(offset, offset + safeLimit);
	const nextOffset = offset + items.length;
	return { items, nextCursor: nextOffset < visible.length ? String(nextOffset) : null, total: visible.length };
}

/** Find a top-level comment or a reply by id. */
export function findStoredComment<T extends StoredComment>(
	comments: T[] | null | undefined,
	commentId: string,
): { comment: T; parent: T | null } | null {
	for (const comment of comments || []) {
		if (comment.id === commentId) return { comment, parent: null };
		const reply = ((comment.replies || []) as T[]).find((r) => r && r.id === commentId);
		if (reply) return { comment: reply, parent: comment };
	}
	return null;
}

/** Remove a top-level comment or a reply by id. Returns true when something was removed. */
export function removeStoredComment<T extends StoredComment>(comments: T[], commentId: string): { comments: T[]; removed: boolean } {
	const filtered = comments.filter((c) => c.id !== commentId);
	if (filtered.length !== comments.length) return { comments: filtered, removed: true };
	let removed = false;
	for (const comment of filtered) {
		const replies = (comment.replies || []) as T[];
		const kept = replies.filter((r) => r && r.id !== commentId);
		if (kept.length !== replies.length) {
			comment.replies = kept;
			removed = true;
		}
	}
	return { comments: filtered, removed };
}

/**
 * Resolve the author block for a comment from its channel (preferred, since
 * comments are posted as a channel) and fall back to the user's profile.
 */
export function resolveCommentAuthor(
	comment: Pick<StoredComment, 'userId' | 'channelId'>,
	channel: { name?: string; avatarUrl?: string } | null | undefined,
	profile: { displayName?: string; firstName?: string; lastName?: string; userName?: string; avatarUrl?: string } | null | undefined,
): CommentAuthor {
	const profileName = profile
		? profile.displayName
			|| [profile.firstName, profile.lastName].filter(Boolean).join(' ')
			|| profile.userName
		: undefined;

	return {
		userId: comment.userId,
		channelId: comment.channelId,
		displayName: channel?.name || profileName || '',
		avatarUrl: channel?.avatarUrl || profile?.avatarUrl || undefined,
	};
}

/**
 * A stored comment as it may leave the API in a public payload: its dislikes
 * (and its replies' dislikes) go out empty. Comment dislikes are hidden
 * (owner decision 2026-11-12); the stored data is not changed.
 */
export function withoutDislikes<T extends StoredComment>(comment: T): T {
	return {
		...comment,
		...(Array.isArray(comment.dislikes) ? { dislikes: [] } : {}),
		...(Array.isArray(comment.replies) ? { replies: (comment.replies as StoredComment[]).map(withoutDislikes) } : {}),
	};
}

/** Build the API representation of a comment for a given viewer channel. */
export function toCommentListItem(
	comment: StoredComment,
	author: CommentAuthor,
	viewerChannelId?: string | null,
	viewer?: CommentViewer,
): CommentListItem {
	const likes = comment.likes || [];
	return {
		id: comment.id,
		userId: comment.userId,
		channelId: comment.channelId,
		videoId: comment.videoId,
		text: comment.text,
		dateCreated: comment.dateCreated,
		dateModified: comment.dateModified || comment.dateCreated,
		likesCount: likes.length,
		// Comment dislikes are hidden (owner decision 2026-11-12): never shown or counted
		dislikesCount: PUBLIC_DISLIKES_COUNT,
		repliesCount: ((comment.replies || []) as StoredComment[]).filter((r) => isCommentVisible(r, viewer)).length,
		isEdited: comment.isEdited === true,
		isDeleted: comment.isDeleted === true,
		isPinned: comment.isPinned === true,
		isLiked: !!viewerChannelId && likes.some((l) => l.channelId === viewerChannelId),
		isDisliked: false,
		isHeld: comment.status === 'held',
		parentCommentId: comment.parentCommentId || null,
		author,
	};
}

/**
 * Toggle a reaction on a comment. Adding a like removes an existing dislike
 * from the same channel (and vice versa) so a channel holds at most one
 * reaction per comment. Returns whether the stored comment changed.
 * Comment dislikes are no longer added through the API (2026-11-12); liking
 * is how a member takes an old one back.
 */
export function applyCommentReaction(
	comment: StoredComment,
	reaction: 'like' | 'dislike',
	action: 'add' | 'remove',
	entry: StoredReaction & { entityId: string; dateCreated: string },
): boolean {
	comment.likes = comment.likes || [];
	comment.dislikes = comment.dislikes || [];
	const own = reaction === 'like' ? comment.likes : comment.dislikes;
	const opposite = reaction === 'like' ? comment.dislikes : comment.likes;
	const channelId = entry.channelId;

	if (action === 'remove') {
		const before = own.length;
		const filtered = own.filter((r) => r.channelId !== channelId);
		if (reaction === 'like') comment.likes = filtered; else comment.dislikes = filtered;
		return filtered.length !== before;
	}

	const oppositeFiltered = opposite.filter((r) => r.channelId !== channelId);
	const removedOpposite = oppositeFiltered.length !== opposite.length;
	if (reaction === 'like') comment.dislikes = oppositeFiltered; else comment.likes = oppositeFiltered;

	if (own.some((r) => r.channelId === channelId)) {
		return removedOpposite;
	}
	own.push(entry);
	return true;
}

/**
 * Accept both `text` (API schema) and `content` (shared-types
 * CommentCreateRequest used by the web client) and return trimmed text.
 */
export function normalizeCommentText(body: { text?: unknown; content?: unknown } | null | undefined): string {
	if (!body) return '';
	const raw = typeof body.text === 'string' && body.text.trim()
		? body.text
		: typeof body.content === 'string'
			? body.content
			: '';
	return raw.trim();
}

export const MAX_COMMENT_LENGTH = 10000;
