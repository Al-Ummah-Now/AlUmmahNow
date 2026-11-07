/**
 * Video visibility helpers
 *
 * Centralizes the rules that decide whether a stored video may appear in
 * public listings (search, sections, feeds, indexes). A video is excluded when
 * it is soft-deleted, hidden by moderation, or private.
 */

export interface VisibilityFields {
	id?: string;
	isPublic?: boolean;
	isHidden?: boolean;
	isDeleted?: boolean;
}

/**
 * True when the video was removed from circulation (soft delete or moderation).
 * Applies to everyone, including the owner.
 */
/**
 * The videos bucket also stores internal records (section indexes such as
 * "index:recent-videos", live streams under "livestream:"). They are not
 * videos and must never appear in listings.
 */
export function isInternalRecord(video: VisibilityFields | null | undefined): boolean {
	const id = video?.id;
	return typeof id === "string" && (id.startsWith("index:") || id.startsWith("livestream:"));
}

export function isVideoRemoved(video: VisibilityFields | null | undefined): boolean {
	if (!video || isInternalRecord(video)) return true;
	return video.isDeleted === true || video.isHidden === true;
}

/**
 * True when the video may be shown in public listings to any viewer.
 */
export function isVideoPubliclyVisible(video: VisibilityFields | null | undefined): boolean {
	if (!video) return false;
	return !isVideoRemoved(video) && video.isPublic !== false;
}
