/**
 * Bulk metadata edit for a creator's videos (Epic 5.3): visibility, category
 * and tags across up to 50 videos at once. Pure so it can be unit tested.
 */

/** Same limits as the single-video update (VideoUpdateInput). */
export const MAX_TAGS = 30;
export const MAX_TAG_LENGTH = 50;
export const MAX_BULK_VIDEOS = 50;

export interface BulkVideoChanges {
  isPublic?: boolean;
  /** undefined keeps the category, null clears it */
  category?: string | null;
  addTags?: string[];
  removeTags?: string[];
}

interface Editable {
  isPublic?: boolean;
  category?: string;
  tags?: string[];
  dateModified?: string;
  scheduledPublishStatus?: string;
  isDraft?: boolean;
}

/** True when the request changes nothing. */
export function isEmptyChange(changes: BulkVideoChanges): boolean {
  return changes.isPublic === undefined
    && changes.category === undefined
    && !(changes.addTags?.length)
    && !(changes.removeTags?.length);
}

const cleanTags = (tags: string[] | undefined) =>
  (tags ?? []).map((t) => t.trim()).filter((t) => t.length > 0 && t.length <= MAX_TAG_LENGTH);

/**
 * The video with the changes applied, or an error code:
 * - `scheduled`: visibility of a scheduled video is managed by its schedule
 * - `too_many_tags`: the result would exceed MAX_TAGS
 * Tag matching for removal ignores case; added tags keep their spelling and
 * are not duplicated.
 */
export function applyBulkChanges<T extends Editable>(
  video: T,
  changes: BulkVideoChanges,
  now: string,
): { ok: true; video: T; changed: boolean } | { ok: false; error: 'scheduled' | 'too_many_tags' } {
  if (changes.isPublic !== undefined && video.scheduledPublishStatus === 'scheduled') {
    return { ok: false, error: 'scheduled' };
  }
  const remove = new Set(cleanTags(changes.removeTags).map((t) => t.toLowerCase()));
  const current = video.tags ?? [];
  const kept = current.filter((t) => !remove.has(t.toLowerCase()));
  const seen = new Set(kept.map((t) => t.toLowerCase()));
  const added: string[] = [];
  for (const tag of cleanTags(changes.addTags)) {
    if (seen.has(tag.toLowerCase())) continue;
    seen.add(tag.toLowerCase());
    added.push(tag);
  }
  const tags = [...kept, ...added];
  if (tags.length > MAX_TAGS) return { ok: false, error: 'too_many_tags' };

  const next: T = { ...video };
  if (changes.isPublic !== undefined) next.isPublic = changes.isPublic;
  if (next.isDraft && next.isPublic !== false) next.isDraft = false;
  if (changes.category !== undefined) next.category = changes.category ?? undefined;
  if (changes.addTags?.length || changes.removeTags?.length) next.tags = tags;

  const changed = next.isPublic !== video.isPublic
    || next.category !== video.category
    || JSON.stringify(next.tags ?? []) !== JSON.stringify(current);
  if (changed) next.dateModified = now;
  return { ok: true, video: next, changed };
}
