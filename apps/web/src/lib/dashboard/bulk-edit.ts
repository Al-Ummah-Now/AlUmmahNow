/**
 * Bulk edit form → POST /api/videos/bulk-update changes (Epic 5.3).
 */

export type VisibilityChoice = '' | 'public' | 'unlisted' | 'private';
/** '' no change, '__clear__' remove the category, otherwise a VideoCategory value */
export type CategoryChoice = string;
export const CLEAR_CATEGORY = '__clear__';

export interface BulkEditForm {
  visibility: VisibilityChoice;
  category: CategoryChoice;
  addTags: string;
  removeTags: string;
}

export interface BulkVideoChanges {
  isPublic?: boolean;
  /** public | unlisted | private (D-SEO-5) */
  visibility?: 'public' | 'unlisted' | 'private';
  category?: string | null;
  addTags?: string[];
  removeTags?: string[];
}

export const EMPTY_BULK_EDIT: BulkEditForm = { visibility: '', category: '', addTags: '', removeTags: '' };

/** "Tafsir, Seerah، رمضان" → ["Tafsir", "Seerah", "رمضان"] (Latin and Arabic commas, deduplicated). */
export function parseTags(input: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of input.split(/[,،]/)) {
    const tag = raw.trim().slice(0, 50);
    if (!tag || seen.has(tag.toLowerCase())) continue;
    seen.add(tag.toLowerCase());
    out.push(tag);
  }
  return out;
}

/** The API changes for the form, or null when nothing would change. */
export function buildBulkChanges(form: BulkEditForm): BulkVideoChanges | null {
  const changes: BulkVideoChanges = {};
  if (form.visibility) {
    changes.isPublic = form.visibility === 'public';
    changes.visibility = form.visibility;
  }
  if (form.category) changes.category = form.category === CLEAR_CATEGORY ? null : form.category;
  const add = parseTags(form.addTags);
  const remove = parseTags(form.removeTags);
  if (add.length) changes.addTags = add;
  if (remove.length) changes.removeTags = remove;
  return Object.keys(changes).length ? changes : null;
}

/** Applies successful changes to the dashboard's local copy of a video. */
export function applyChangesLocally<T extends { isPublic?: boolean; isUnlisted?: boolean; category?: string; tags?: string[] }>(video: T, changes: BulkVideoChanges): T {
  const next = { ...video };
  if (changes.isPublic !== undefined) next.isPublic = changes.isPublic;
  if (changes.visibility !== undefined) next.isUnlisted = changes.visibility === 'unlisted';
  if (changes.category !== undefined) next.category = changes.category ?? undefined;
  if (changes.addTags || changes.removeTags) {
    const remove = new Set((changes.removeTags ?? []).map((t) => t.toLowerCase()));
    const kept = (video.tags ?? []).filter((t) => !remove.has(t.toLowerCase()));
    const seen = new Set(kept.map((t) => t.toLowerCase()));
    next.tags = [...kept, ...(changes.addTags ?? []).filter((t) => !seen.has(t.toLowerCase()))];
  }
  return next;
}
