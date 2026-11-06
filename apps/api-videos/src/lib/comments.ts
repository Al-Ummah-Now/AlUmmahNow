/**
 * Video comment helpers
 *
 * Pure functions used by the comment endpoints. Comments are embedded in the
 * video object stored in R2, so listing/pagination happens in memory.
 */

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
export function isCommentVisible(comment: StoredComment | null | undefined): boolean {
	if (!comment) return false;
	return comment.isDeleted !== true && comment.isHidden !== true;
}

/**
 * Sort visible comments (pinned first, then newest first) and return one page.
 * The cursor is the numeric offset encoded as a string.
 */
export function paginateComments<T extends StoredComment>(
	comments: T[] | null | undefined,
	limit: number = DEFAULT_COMMENT_PAGE_SIZE,
	cursor?: string | null,
): CommentPage<T> {
	const safeLimit = Math.min(Math.max(1, Math.floor(limit) || DEFAULT_COMMENT_PAGE_SIZE), MAX_COMMENT_PAGE_SIZE);
	const parsedOffset = cursor ? parseInt(cursor, 10) : 0;
	const offset = Number.isFinite(parsedOffset) && parsedOffset > 0 ? parsedOffset : 0;

	const sorted = (comments || [])
		.filter(isCommentVisible)
		.slice()
		.sort((a, b) => {
			if ((a.isPinned === true) !== (b.isPinned === true)) {
				return a.isPinned ? -1 : 1;
			}
			return new Date(b.dateCreated).getTime() - new Date(a.dateCreated).getTime();
		});

	const items = sorted.slice(offset, offset + safeLimit);
	const nextOffset = offset + items.length;

	return {
		items,
		nextCursor: nextOffset < sorted.length ? String(nextOffset) : null,
		total: sorted.length,
	};
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

/** Build the API representation of a comment for a given viewer channel. */
export function toCommentListItem(
	comment: StoredComment,
	author: CommentAuthor,
	viewerChannelId?: string | null,
): CommentListItem {
	const likes = comment.likes || [];
	const dislikes = comment.dislikes || [];
	return {
		id: comment.id,
		userId: comment.userId,
		channelId: comment.channelId,
		videoId: comment.videoId,
		text: comment.text,
		dateCreated: comment.dateCreated,
		dateModified: comment.dateModified || comment.dateCreated,
		likesCount: likes.length,
		dislikesCount: dislikes.length,
		repliesCount: (comment.replies || []).length,
		isEdited: comment.isEdited === true,
		isDeleted: comment.isDeleted === true,
		isPinned: comment.isPinned === true,
		isLiked: !!viewerChannelId && likes.some((l) => l.channelId === viewerChannelId),
		isDisliked: !!viewerChannelId && dislikes.some((d) => d.channelId === viewerChannelId),
		author,
	};
}

/**
 * Toggle a reaction on a comment. Adding a like removes an existing dislike
 * from the same channel (and vice versa) so a channel holds at most one
 * reaction per comment. Returns whether the stored comment changed.
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
