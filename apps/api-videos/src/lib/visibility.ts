/**
 * Video visibility helpers
 *
 * The rule itself lives in @al-ummah/shared-types (video-visibility.ts), shared with the
 * scheduler, the processor's search projection and the web app, so every surface decides the
 * same way (#1241). This module re-exports it under the names api-videos already uses and adds
 * the api-only helpers below.
 */

import {
	isInternalVideoRecord,
	isVideoMediaPublic,
	isVideoOpenToAnyone,
	isVideoPubliclyVisible,
	isVideoReady,
	isVideoReleased,
	isVideoRemoved,
	visibilityFlags,
	type VideoVisibility,
	type VideoVisibilityFields,
} from '@al-ummah/shared-types';

export { isVideoMediaPublic, isVideoOpenToAnyone, isVideoPubliclyVisible, isVideoReady, isVideoReleased, isVideoRemoved };

export type VisibilityFields = VideoVisibilityFields;

/**
 * The videos bucket also stores internal records (section indexes such as
 * "index:recent-videos", live streams under "livestream:"). They are not
 * videos and must never appear in listings.
 */
export const isInternalRecord = isInternalVideoRecord;

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
