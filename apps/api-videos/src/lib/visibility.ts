/**
 * Video visibility helpers
 *
 * Centralizes the rules that decide whether a stored video may appear in
 * public listings (search, sections, feeds, indexes). A video is excluded when
 * it is soft-deleted, hidden by moderation, or private.
 */

export interface VisibilityFields {
	id?: string;
	userId?: string;
	isPublic?: boolean;
	isHidden?: boolean;
	isDeleted?: boolean;
	/** Absent on older videos (treated as ready) */
	uploadStatus?: string;
	scheduledPublishStatus?: string;
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

/** Playable: no upload status (older videos) or ready (from the first encoded resolution). */
export function isVideoReady(video: VisibilityFields | null | undefined): boolean {
	return !!video && (!video.uploadStatus || video.uploadStatus === "ready");
}

/**
 * True when the video may be shown in public listings to any viewer (home
 * sections, latest, trending, channel lists, search, feeds, playlists): not
 * removed, public, ready and not waiting for a scheduled publish. One rule for
 * every list (2026-11-10: the home page listed a processing upload the channel
 * page hid; single and bulk uploads were listed differently).
 */
export function isVideoPubliclyVisible(video: VisibilityFields | null | undefined): boolean {
	if (!video || isVideoRemoved(video) || video.isPublic === false) return false;
	if (!isVideoReady(video)) return false;
	return video.scheduledPublishStatus !== "scheduled" && video.scheduledPublishStatus !== "publishing";
}

/**
 * Listing rule with the viewer: everyone sees publicly visible videos; the
 * owner also sees their own private, scheduled and not-yet-ready videos (shown
 * with their processing status). Removed videos are listed to no one.
 */
export function isVideoListedFor(video: VisibilityFields | null | undefined, viewerId: string | null | undefined): boolean {
	if (!video || isVideoRemoved(video)) return false;
	if (viewerId && video.userId === viewerId) return true;
	return isVideoPubliclyVisible(video);
}

/**
 * A channel an admin suspended stays visible to its owner (with the notice), as
 * long as nothing else hides it: not moderation, not a ban of the owner.
 */
export function ownerSeesSuspendedChannel(
	channel: { userId?: string; isSuspended?: boolean; isHidden?: boolean; isDeleted?: boolean; hiddenBeforeSuspension?: boolean; suspensionHolds?: unknown; id?: string } | null | undefined,
	userId: string | null | undefined,
): boolean {
	if (!channel || !userId || channel.userId !== userId || channel.isDeleted || channel.isSuspended !== true) return false;
	if (channel.hiddenBeforeSuspension === true) return false;
	const holds = Array.isArray(channel.suspensionHolds) ? channel.suspensionHolds : [];
	return holds.every((h) => h === `channel:${channel.id}`);
}
