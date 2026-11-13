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
