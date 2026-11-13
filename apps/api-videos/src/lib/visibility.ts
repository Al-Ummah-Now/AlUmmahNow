/**
 * Video visibility helpers
 *
 * Centralizes the rules that decide whether a stored video may appear in
 * public listings (search, sections, feeds, indexes). A video is excluded when
 * it is soft-deleted, hidden by moderation, or private.
 */

import { visibilityFlags, type VideoVisibility } from '@al-ummah/shared-types';

export interface VisibilityFields {
	id?: string;
	userId?: string;
	isPublic?: boolean;
	/** Not public, but open to anyone with the link (D-SEO-5) */
	isUnlisted?: boolean;
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

/**
 * Only the owner (and channel members allowed to see private videos) may open it: private, and
 * not unlisted. Single-video reads by id (fetch, playback, comments, views) use this; unlisted
 * videos are open to anyone with the link. Every list keeps requiring isPublic, so unlisted
 * videos are never listed (D-SEO-5).
 */
export function isRestrictedVideo(video: VisibilityFields | null | undefined): boolean {
	return !!video && video.isPublic === false && video.isUnlisted !== true;
}

export interface VisibilityInput {
	isPublic?: boolean;
	isUnlisted?: boolean;
	visibility?: VideoVisibility;
}

/**
 * Applies a create or update's visibility fields to the stored video and keeps the two flags
 * consistent: `visibility` wins; isUnlisted true makes it not public; a public video is never
 * unlisted. Fields the input leaves out keep their current value.
 */
export function applyVisibilityInput<T extends { isPublic?: boolean; isUnlisted?: boolean }>(target: T, input: VisibilityInput): T {
	if (input.visibility) {
		Object.assign(target, visibilityFlags(input.visibility));
	} else {
		if (input.isPublic !== undefined) target.isPublic = input.isPublic;
		if (input.isUnlisted === true) target.isPublic = false;
		if (input.isUnlisted !== undefined) target.isUnlisted = input.isUnlisted;
	}
	if (target.isPublic !== false) delete target.isUnlisted;
	else if (target.isUnlisted !== true) delete target.isUnlisted;
	return target;
}

/**
 * The stored flags for a new upload: a draft is always private; else `visibility` wins over
 * isPublic, and isPublic defaults to true. isUnlisted is only present when true.
 */
export function uploadVisibility(isDraft: boolean | undefined, visibility: VideoVisibility | undefined, isPublic: boolean | undefined): { isPublic: boolean; isUnlisted?: true } {
	if (isDraft) return { isPublic: false };
	if (visibility) return visibility === 'unlisted' ? { isPublic: false, isUnlisted: true } : { isPublic: visibility === 'public' };
	return { isPublic: isPublic ?? true };
}
