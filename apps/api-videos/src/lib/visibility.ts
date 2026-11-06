/**
 * Video visibility helpers
 *
 * Centralizes the rules that decide whether a stored video may appear in
 * public listings (search, sections, feeds, indexes). A video is excluded when
 * it is soft-deleted, hidden by moderation, or private.
 */

export interface VisibilityFields {
	isPublic?: boolean;
	isHidden?: boolean;
	isDeleted?: boolean;
}

/**
 * True when the video was removed from circulation (soft delete or moderation).
 * Applies to everyone, including the owner.
 */
export function isVideoRemoved(video: VisibilityFields | null | undefined): boolean {
	if (!video) return true;
	return video.isDeleted === true || video.isHidden === true;
}

/**
 * True when the video may be shown in public listings to any viewer.
 */
export function isVideoPubliclyVisible(video: VisibilityFields | null | undefined): boolean {
	if (!video) return false;
	return !isVideoRemoved(video) && video.isPublic !== false;
}
