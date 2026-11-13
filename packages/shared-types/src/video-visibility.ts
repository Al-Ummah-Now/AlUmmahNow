/**
 * Video visibility (owner decision D-SEO-5, wiki AUN-SEO):
 *
 * - public:   listed everywhere (home, search, channel, feeds, sitemaps) and indexable
 * - unlisted: anyone with the link can watch, comment and share it, but it is never listed
 *             (lists, search, feeds, recommendations, sitemaps) and its page is noindex
 * - private:  only the owner and channel members allowed to see private videos
 *
 * Stored as two flags so that every list keeps working unchanged: `isPublic` stays the
 * "listed and public" flag every list, index and feed already requires, and `isUnlisted`
 * marks a not-public video that is still open to anyone with its link.
 */

import type { VideoVisibility } from './upload-defaults';
import { isReviewCleared, type VideoReviewState } from './video-review';

/** Every visibility (the type is upload-defaults' VideoVisibility). */
export const VIDEO_VISIBILITIES = ['public', 'unlisted', 'private'] as const satisfies readonly VideoVisibility[];

export interface VisibilityFlags {
  isPublic?: boolean;
  isUnlisted?: boolean;
}

/** The visibility a stored video has. */
export function videoVisibility(video: VisibilityFlags | null | undefined): VideoVisibility {
  if (!video || video.isPublic !== false) return 'public';
  return video.isUnlisted === true ? 'unlisted' : 'private';
}

/** The stored flags for a visibility. */
export function visibilityFlags(visibility: VideoVisibility): { isPublic: boolean; isUnlisted: boolean } {
  return { isPublic: visibility === 'public', isUnlisted: visibility === 'unlisted' };
}

/** True when anyone with the link may open the video (public or unlisted). */
export function isOpenByLink(video: VisibilityFlags | null | undefined): boolean {
  return videoVisibility(video) !== 'private';
}

// ---------------------------------------------------------------------------
// Who may see a stored video right now (AlUmmahNow#1241).
//
// ONE rule for every surface: api-videos lists, sections, channel pages,
// playlists, discovery, the search projection (search, sitemap, IndexNow, the
// subscription feed), the www timeline and Shorts (public-play), the web watch
// page and embed, single-video reads (fetch, playback, short links),
// subscriber notifications, R2 public access and the scheduler. Before this,
// each kept its own copy with different conditions (drafts, markedForDeletion,
// readiness), and the watch and playback reads served a public video that was
// still processing.
//
// The pre-publication review state (wiki AUN-VIDEO-REVIEW) plugs into
// `isVideoReady`: a video waiting for review is "not ready" for everyone but
// its owner.
// ---------------------------------------------------------------------------

/** The stored fields the visibility rule reads (a subset of every video shape). */
export interface VideoVisibilityFields extends VisibilityFlags {
  id?: string;
  userId?: string;
  isHidden?: boolean;
  isDeleted?: boolean;
  /** Set with isDeleted when a channel is deleted (api-videos channelDeletion.ts) */
  markedForDeletion?: boolean;
  /** Saved but not published (always stored private) */
  isDraft?: boolean;
  /** Absent on older videos, which count as ready */
  uploadStatus?: string;
  scheduledPublishStatus?: string;
  /** Pre-publication review (video-review.ts); absent = never reviewed */
  review?: { status?: VideoReviewState['status'] | string } | null;
}

/**
 * The videos bucket also stores records that are not videos (section indexes
 * such as "index:recent-videos", live streams under "livestream:", "metadata:"
 * rows). They never appear anywhere.
 */
export function isInternalVideoRecord(video: Pick<VideoVisibilityFields, 'id'> | null | undefined): boolean {
  const id = video?.id;
  return typeof id === 'string' && (id.startsWith('index:') || id.startsWith('livestream:') || id.startsWith('metadata:'));
}

/** Removed from circulation (soft delete, moderation, a deleted channel): for everyone, the owner included. */
export function isVideoRemoved(video: VideoVisibilityFields | null | undefined): boolean {
  if (!video || isInternalVideoRecord(video)) return true;
  return video.isDeleted === true || video.isHidden === true || video.markedForDeletion === true;
}

/**
 * Ready for everyone but its owner: no upload status (older videos) or ready (from the first
 * encoded resolution), and cleared by pre-publication review (never reviewed, approved, or a
 * trusted channel's post-hoc review; wiki AUN-VIDEO-REVIEW). A video being checked, held for a
 * person, rejected or appealed is "not ready" on every surface, like one still processing.
 */
export function isVideoReady(video: VideoVisibilityFields | null | undefined): boolean {
  if (!video || (video.uploadStatus && video.uploadStatus !== 'ready')) return false;
  return isReviewCleared(video.review);
}

/** Released by its owner: not a draft and not waiting for (or in the middle of) a scheduled publish. */
export function isVideoReleased(video: VideoVisibilityFields | null | undefined): boolean {
  if (!video || video.isDraft === true) return false;
  return video.scheduledPublishStatus !== 'scheduled' && video.scheduledPublishStatus !== 'publishing';
}

/**
 * Listed for everyone (home, channel pages, search, sitemap, feeds, playlists,
 * notifications): not removed, public, released and ready. Unlisted videos are
 * never listed (D-SEO-5).
 */
export function isVideoPubliclyVisible(video: VideoVisibilityFields | null | undefined): boolean {
  if (!video || isVideoRemoved(video) || video.isPublic === false) return false;
  return isVideoReleased(video) && isVideoReady(video);
}

/**
 * Anyone with the link may open it (watch page, playback, embed, oEmbed, short
 * links): public or unlisted, not removed, released and ready. The owner and
 * channel members allowed to see private videos open more than this (api-videos
 * channelAccess.ts); this is the rule for everyone else.
 */
export function isVideoOpenToAnyone(video: VideoVisibilityFields | null | undefined): boolean {
  if (!video || isVideoRemoved(video) || !isOpenByLink(video)) return false;
  return isVideoReleased(video) && isVideoReady(video);
}

/**
 * Its media may sit under the public R2 prefix (served with no Worker): public,
 * released and not removed. Readiness is left out on purpose: the R2 transcode
 * is queued while the upload is still processing, and a rendition URL is only
 * handed out by the API, which applies isVideoOpenToAnyone. Requiring it here
 * would move every upload's renditions once more when it turns ready.
 */
export function isVideoMediaPublic(video: VideoVisibilityFields | null | undefined): boolean {
  if (!video || isVideoRemoved(video) || video.isPublic === false) return false;
  // Held by review (in review, rejected, appealed): renditions move under the private prefix, so a
  // published video pulled back (VR2) stops being served from cached public URLs. A video still
  // in its first automated check stays where it is, like one still processing.
  if (video.review && video.review.status !== 'checking' && !isReviewCleared(video.review)) return false;
  return isVideoReleased(video);
}
