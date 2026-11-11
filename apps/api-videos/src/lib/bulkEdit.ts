/**
 * Bulk metadata edit of a creator's videos (Epic 5.3; PATCH /api/videos/bulk).
 * Pure so it can be unit tested: the endpoint loads, authorizes and writes.
 *
 * Only the fields a request names are touched. Every edit records the
 * previous and new value of each field it touched, so an undo can put back
 * exactly those fields, and only while nobody changed them since.
 */
import { applyTextEdit, charCount, VIDEO_DESCRIPTION_MAX, VIDEO_TITLE_MAX, type TextEdit, type TitleLanguage } from '@al-ummah/shared-types';

/** Same limits as the single-video update (VideoUpdateInput). */
export const MAX_TAGS = 30;
export const MAX_TAG_LENGTH = 50;
/** Videos per request; the studio sends larger selections in batches. */
export const MAX_BULK_VIDEOS = 50;
/** Playlists one request may add to or remove from. */
export const MAX_BULK_PLAYLISTS = 10;

export type ContentLanguage = 'en' | 'ar' | 'ur' | 'fr';
export type CommentSetting = 'on' | 'held' | 'off';

export interface BulkVideoChanges {
  isPublic?: boolean;
  /** undefined keeps the category, null clears it */
  category?: string | null;
  addTags?: string[];
  removeTags?: string[];
  /** The whole tag list (not with addTags/removeTags) */
  replaceTags?: string[];
  language?: ContentLanguage;
  commentSettings?: CommentSetting;
  /** Per language: append, prepend or replace the description */
  description?: Partial<Record<TitleLanguage, TextEdit>>;
  /** Playlist membership (applied by the endpoint, not here) */
  addPlaylists?: string[];
  removePlaylists?: string[];
}

/** Values that differ per video (computed by the client's rename engine). */
export interface PerVideoChanges {
  title?: Partial<Record<TitleLanguage, string>>;
}

/** The fields a bulk edit may touch, and so the fields an undo restores. */
export const EDITABLE_FIELDS = [
  'isPublic',
  'category',
  'categorySource',
  'tags',
  'language',
  'commentSettings',
  'title',
  'titleLocalized',
  'description',
  'descriptionLocalized',
] as const;
export type EditableField = (typeof EDITABLE_FIELDS)[number];

interface Editable {
  isPublic?: boolean;
  category?: string;
  categorySource?: 'uploader' | 'ai' | 'admin';
  tags?: string[];
  language?: ContentLanguage;
  commentSettings?: CommentSetting;
  title?: string;
  titleLocalized?: Record<string, string>;
  description?: string;
  descriptionLocalized?: Record<string, string>;
  dateModified?: string;
  scheduledPublishStatus?: string;
  isDraft?: boolean;
}

export type BulkEditError = 'scheduled' | 'too_many_tags' | 'title_empty' | 'title_too_long' | 'description_too_long';

/** True when the request changes nothing. */
export function isEmptyChange(changes: BulkVideoChanges, perVideo?: Record<string, PerVideoChanges>): boolean {
  const hasTitles = !!perVideo && Object.values(perVideo).some((v) => v.title && Object.keys(v.title).length > 0);
  const hasDescription = !!changes.description && Object.keys(changes.description).length > 0;
  return changes.isPublic === undefined
    && changes.category === undefined
    && !(changes.addTags?.length)
    && !(changes.removeTags?.length)
    && changes.replaceTags === undefined
    && changes.language === undefined
    && changes.commentSettings === undefined
    && !hasDescription
    && !(changes.addPlaylists?.length)
    && !(changes.removePlaylists?.length)
    && !hasTitles;
}

const cleanTags = (tags: string[] | undefined) =>
  (tags ?? []).map((t) => t.trim()).filter((t) => t.length > 0 && t.length <= MAX_TAG_LENGTH);

function dedupe(tags: string[], seen = new Set<string>()): string[] {
  const out: string[] = [];
  for (const tag of tags) {
    if (seen.has(tag.toLowerCase())) continue;
    seen.add(tag.toLowerCase());
    out.push(tag);
  }
  return out;
}

/** The English title as the edit form reads it (the legacy `title` is English). */
const englishTitle = (v: Editable) => v.titleLocalized?.en || v.title || '';
const englishDescription = (v: Editable) => v.descriptionLocalized?.en || v.description || '';

/** Deep copy of the touched fields (undefined when the video has none). */
export function pickFields<T extends Editable>(video: T, fields: readonly EditableField[]): Partial<Record<EditableField, unknown>> {
  const out: Partial<Record<EditableField, unknown>> = {};
  for (const field of fields) {
    const value = (video as Record<string, unknown>)[field];
    out[field] = value === undefined ? undefined : JSON.parse(JSON.stringify(value));
  }
  return out;
}

/** Fields whose value differs between two copies. */
export function changedFields<T extends Editable>(before: T, after: T): EditableField[] {
  return EDITABLE_FIELDS.filter((f) => JSON.stringify((before as Record<string, unknown>)[f] ?? null) !== JSON.stringify((after as Record<string, unknown>)[f] ?? null));
}

/**
 * The video with the changes applied, or an error code:
 * - `scheduled`: visibility of a scheduled video is managed by its schedule
 * - `too_many_tags`: the result would exceed MAX_TAGS
 * - `title_empty` / `title_too_long`, `description_too_long`
 * Tag matching for removal ignores case; added tags keep their spelling and
 * are not duplicated. `fields` lists what actually changed.
 */
export function applyBulkChanges<T extends Editable>(
  video: T,
  changes: BulkVideoChanges,
  now: string,
  perVideo: PerVideoChanges = {},
): { ok: true; video: T; changed: boolean; fields: EditableField[] } | { ok: false; error: BulkEditError } {
  if (changes.isPublic !== undefined && video.scheduledPublishStatus === 'scheduled') {
    return { ok: false, error: 'scheduled' };
  }

  const current = video.tags ?? [];
  let tags = current;
  if (changes.replaceTags !== undefined) {
    tags = dedupe(cleanTags(changes.replaceTags));
  } else if (changes.addTags?.length || changes.removeTags?.length) {
    const remove = new Set(cleanTags(changes.removeTags).map((t) => t.toLowerCase()));
    const kept = current.filter((t) => !remove.has(t.toLowerCase()));
    tags = [...kept, ...dedupe(cleanTags(changes.addTags), new Set(kept.map((t) => t.toLowerCase())))];
  }
  if (tags.length > MAX_TAGS) return { ok: false, error: 'too_many_tags' };

  const next: T = { ...video };
  if (changes.isPublic !== undefined) next.isPublic = changes.isPublic;
  if (next.isDraft && next.isPublic !== false) next.isDraft = false;
  if (changes.category !== undefined) {
    // The owner chose it: no longer an AI suggestion (null clears both)
    next.category = changes.category ?? undefined;
    next.categorySource = changes.category ? 'uploader' : undefined;
  }
  if (tags !== current) next.tags = tags;
  if (changes.language !== undefined) next.language = changes.language;
  if (changes.commentSettings !== undefined) next.commentSettings = changes.commentSettings;

  // Titles: each language on its own; the legacy `title` follows English
  const titles = perVideo.title ?? {};
  if (Object.keys(titles).length > 0) {
    const localized = { ...(video.titleLocalized ?? {}), en: englishTitle(video) } as Record<string, string>;
    for (const [lang, value] of Object.entries(titles) as [TitleLanguage, string | undefined][]) {
      if (value === undefined) continue;
      if (value.trim() === '') return { ok: false, error: 'title_empty' };
      if (charCount(value) > VIDEO_TITLE_MAX) return { ok: false, error: 'title_too_long' };
      localized[lang] = value;
    }
    next.titleLocalized = localized;
    next.title = localized.en || localized.ar || video.title;
  }

  // Descriptions: append, prepend or replace per language
  const edits = changes.description ?? {};
  if (Object.keys(edits).length > 0) {
    const localized = { ...(video.descriptionLocalized ?? {}), en: englishDescription(video) } as Record<string, string>;
    for (const [lang, edit] of Object.entries(edits) as [TitleLanguage, TextEdit | undefined][]) {
      if (!edit) continue;
      const value = applyTextEdit(lang === 'en' ? englishDescription(video) : localized[lang], edit);
      if (charCount(value) > VIDEO_DESCRIPTION_MAX) return { ok: false, error: 'description_too_long' };
      localized[lang] = value;
    }
    next.descriptionLocalized = localized;
    next.description = localized.en || localized.ar || '';
  }

  const fields = changedFields(video, next);
  const changed = fields.length > 0;
  if (changed) next.dateModified = now;
  return { ok: true, video: changed ? next : video, changed, fields };
}

/**
 * The undo of one video: the touched fields go back to `before`, but only
 * the fields that still hold what the bulk edit wrote (`after`). A field
 * changed since keeps its newer value and is reported as `kept`.
 */
export function revertFields<T extends Editable>(
  video: T,
  before: Partial<Record<EditableField, unknown>>,
  after: Partial<Record<EditableField, unknown>>,
  now: string,
): { video: T; restored: EditableField[]; kept: EditableField[] } {
  const next = { ...video } as Record<string, unknown>;
  const restored: EditableField[] = [];
  const kept: EditableField[] = [];
  for (const field of Object.keys(after) as EditableField[]) {
    if (!EDITABLE_FIELDS.includes(field)) continue;
    if (JSON.stringify(next[field] ?? null) !== JSON.stringify(after[field] ?? null)) {
      kept.push(field);
      continue;
    }
    if (before[field] === undefined) delete next[field];
    else next[field] = before[field];
    restored.push(field);
  }
  if (restored.length > 0) next.dateModified = now;
  return { video: next as T, restored, kept };
}
