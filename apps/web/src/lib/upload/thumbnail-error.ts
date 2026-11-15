/**
 * The words shown when a thumbnail upload is refused, always in the page's language: never the
 * server's text (it is English; #1466 showed "You've reached the upload limit" on an Arabic page).
 */
import type { AppTranslations } from '@al-ummah/shared-types';
import { creatorRefusalMessage } from './friendly-error';

export interface ThumbnailRefusal {
  code?: string;
  status?: number;
  retryAfter?: number;
}

export function thumbnailRefusalMessage(t: Pick<AppTranslations, 'creator' | 'video'>, refusal: ThumbnailRefusal): string {
  if (refusal.code === 'thumbnail_shape') return t.video.thumbnailWrongShape;
  // Upload limit (with the wait), uploads paused, account pending deletion, ...
  const creator = creatorRefusalMessage(t, refusal);
  if (creator) return creator;
  // The server checks the image again: not a JPEG, PNG or WebP it can read
  if (refusal.status === 400 || refusal.status === 415) return t.video.thumbnailInvalidType;
  if (refusal.status === 413) return t.video.thumbnailTooLarge;
  return t.video.thumbnailUploadFailed ?? t.video.thumbnailInvalidType;
}
