/**
 * `publishedAt`: when a video first became visible to everyone (public, not a draft, ready, not
 * removed). Set once, at the first write that makes it so, and never overwritten: making a video
 * private and public again keeps its first publish date (YouTube's "Published on"). The web's
 * "Published on …" tooltip and the newest-first order read it, falling back to `dateCreated`
 * (the upload) for videos from before it existed (scripts/backfill-published-at.ts fills those).
 *
 * The scheduler sets it when it releases a scheduled video (apps/scheduler publisher.ts).
 */

export interface PublishableState {
  isPublic?: boolean | null;
  isDraft?: boolean | null;
  uploadStatus?: string | null;
  isDeleted?: boolean | null;
  isHidden?: boolean | null;
  publishedAt?: string | null;
}

/** Visible to everyone right now: public, not a draft, ready (legacy records without a status count), not removed. */
export function isPublishedState(video: PublishableState): boolean {
  const ready = video.uploadStatus === undefined || video.uploadStatus === null || video.uploadStatus === 'ready';
  return video.isPublic !== false && video.isDraft !== true && ready && video.isDeleted !== true && video.isHidden !== true;
}

/**
 * Sets `after.publishedAt` to `at` when this write publishes the video: it was not published before
 * (`before`) and is now, and has no publish date yet. Only the transition counts: an edit to a video
 * that was already public (from before publishedAt existed) does not stamp the edit's time; the
 * backfill gives those their date. True when it set it.
 */
export function markPublished(before: PublishableState | null | undefined, after: PublishableState, at: string): boolean {
  if (after.publishedAt || !isPublishedState(after)) return false;
  if (before && isPublishedState(before)) return false;
  after.publishedAt = at;
  return true;
}
