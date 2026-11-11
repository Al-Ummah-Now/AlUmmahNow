/**
 * The bulk panel's form: which fields are ticked, the rename rule, and the
 * values. One model for Studio's "Edit selected" (changes to existing
 * videos, PATCH /api/videos/bulk) and the upload queue's "Set values"
 * (initial values of queued files). Only ticked fields ever leave the form.
 */
import {
  orderedSubjects,
  previewRename,
  renamedTitles,
  staggeredTimes,
  type DigitStyle,
  type OrderDirection,
  type OrderKey,
  type RenameRule,
  type RenameRow,
  type RenameSubject,
  type StaggerUnit,
  type TextEditMode,
  type TitleLanguage,
} from '@al-ummah/shared-types';

export type BulkField = 'title' | 'description' | 'category' | 'language' | 'visibility' | 'playlists' | 'tags' | 'schedule' | 'comments';
export const BULK_FIELDS: readonly BulkField[] = ['title', 'description', 'category', 'language', 'visibility', 'playlists', 'tags', 'schedule', 'comments'];

export type RenameMode = 'pattern' | 'replace' | 'affix' | 'case';
export type ContentLanguage = 'en' | 'ar' | 'ur' | 'fr';
export const CONTENT_LANGUAGES: readonly ContentLanguage[] = ['en', 'ar', 'ur', 'fr'];
export type CommentSetting = 'on' | 'held' | 'off';
export type TagsMode = 'add' | 'remove' | 'replace';

export interface RenameState {
  mode: RenameMode;
  pattern: string;
  start: number;
  step: number;
  pad: number;
  find: string;
  replace: string;
  ignoreCase: boolean;
  prefix: string;
  suffix: string;
  caseMode: 'upper' | 'lower' | 'title' | 'sentence';
  languages: TitleLanguage[];
  arabicDigits: DigitStyle;
  /** Rows left out of the rename (subject ids) */
  excluded: string[];
  /** The order {n} follows: the last quick sort chosen, and the ids in order (empty: list order) */
  orderKey: OrderKey;
  orderDir: OrderDirection;
  order: string[];
  /** Moved by hand since the last quick sort */
  orderCustom: boolean;
}

export interface DescriptionState {
  enabled: boolean;
  mode: TextEditMode;
  text: string;
}

export interface BulkFormState {
  ticked: BulkField[];
  rename: RenameState;
  description: Record<TitleLanguage, DescriptionState>;
  category: string;
  language: ContentLanguage;
  visibility: 'public' | 'private';
  playlistsAdd: string[];
  playlistsRemove: string[];
  /** Also put the selection, in the rename order, together in the playlists it is added to */
  playlistOrder: boolean;
  tagsMode: TagsMode;
  tags: string;
  /** datetime-local value (the creator's zone) */
  scheduleStart: string;
  scheduleEvery: number;
  scheduleUnit: StaggerUnit;
  comments: CommentSetting;
}

export const EMPTY_RENAME: RenameState = {
  mode: 'pattern',
  pattern: '{filename}',
  start: 1,
  step: 1,
  pad: 1,
  find: '',
  replace: '',
  ignoreCase: false,
  prefix: '',
  suffix: '',
  caseMode: 'title',
  languages: ['en'],
  arabicDigits: 'latin',
  excluded: [],
  orderKey: 'list',
  orderDir: 'asc',
  order: [],
  orderCustom: false,
};

export function emptyBulkForm(uiLanguage: TitleLanguage = 'en'): BulkFormState {
  return {
    ticked: [],
    rename: { ...EMPTY_RENAME, languages: [uiLanguage] },
    description: {
      en: { enabled: uiLanguage === 'en', mode: 'append', text: '' },
      ar: { enabled: uiLanguage === 'ar', mode: 'append', text: '' },
    },
    category: '',
    language: uiLanguage,
    visibility: 'private',
    playlistsAdd: [],
    playlistsRemove: [],
    playlistOrder: false,
    tagsMode: 'add',
    tags: '',
    scheduleStart: '',
    scheduleEvery: 1,
    scheduleUnit: 'days',
    comments: 'on',
  };
}

export function ruleOf(rename: RenameState): RenameRule {
  switch (rename.mode) {
    case 'pattern':
      return { kind: 'pattern', pattern: rename.pattern, start: rename.start, step: rename.step, pad: rename.pad };
    case 'replace':
      return { kind: 'replace', find: rename.find, replace: rename.replace, ignoreCase: rename.ignoreCase };
    case 'affix':
      return { kind: 'affix', prefix: rename.prefix, suffix: rename.suffix };
    case 'case':
    default:
      return { kind: 'case', mode: rename.caseMode };
  }
}

/** The subjects in the order the rename numbers them. */
export function orderedForRename<T extends RenameSubject>(form: BulkFormState, subjects: readonly T[]): T[] {
  return orderedSubjects(subjects, form.rename.order);
}

/** The rename preview rows for the subjects, in the chosen order. */
export function renamePreview(form: BulkFormState, subjects: readonly RenameSubject[]): RenameRow[] {
  return previewRename(orderedForRename(form, subjects), {
    rule: ruleOf(form.rename),
    languages: form.rename.languages,
    arabicDigits: form.rename.arabicDigits,
    excluded: form.rename.excluded,
  });
}

/** "Tafsir, Seerah، رمضان" → ["Tafsir", "Seerah", "رمضان"] (Latin and Arabic commas, deduplicated). */
export function parseTagList(input: string): string[] {
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

/** Why a ticked field can't be applied yet ('' when it can). */
export type FieldProblem = '' | 'rename_empty' | 'no_titles' | 'description_empty' | 'category_empty' | 'playlists_empty' | 'tags_empty' | 'schedule_empty';

export function fieldProblem(form: BulkFormState, field: BulkField, preview?: RenameRow[]): FieldProblem {
  switch (field) {
    case 'title': {
      if (form.rename.languages.length === 0) return 'rename_empty';
      if (form.rename.mode === 'pattern' && !form.rename.pattern) return 'rename_empty';
      if (form.rename.mode === 'replace' && !form.rename.find) return 'rename_empty';
      if (form.rename.mode === 'affix' && !form.rename.prefix && !form.rename.suffix) return 'rename_empty';
      if (preview && Object.keys(renamedTitles(preview)).length === 0) return 'no_titles';
      return '';
    }
    case 'description': {
      const langs = (['en', 'ar'] as TitleLanguage[]).filter((l) => form.description[l].enabled);
      if (langs.length === 0) return 'description_empty';
      // Replacing with nothing clears it on purpose; adding nothing changes nothing
      return langs.some((l) => form.description[l].mode === 'replace' || form.description[l].text) ? '' : 'description_empty';
    }
    case 'category':
      return form.category ? '' : 'category_empty';
    case 'playlists':
      return form.playlistsAdd.length + form.playlistsRemove.length > 0 ? '' : 'playlists_empty';
    case 'tags':
      return form.tagsMode === 'replace' || parseTagList(form.tags).length > 0 ? '' : 'tags_empty';
    case 'schedule':
      return form.scheduleStart && !Number.isNaN(new Date(form.scheduleStart).getTime()) ? '' : 'schedule_empty';
    default:
      return '';
  }
}

/** Ticked fields that can be applied. */
export function readyFields(form: BulkFormState, preview?: RenameRow[]): BulkField[] {
  return form.ticked.filter((f) => fieldProblem(form, f, preview) === '');
}

export interface BulkEditChanges {
  isPublic?: boolean;
  category?: string | null;
  addTags?: string[];
  removeTags?: string[];
  replaceTags?: string[];
  language?: ContentLanguage;
  commentSettings?: CommentSetting;
  description?: Partial<Record<TitleLanguage, { mode: TextEditMode; text: string }>>;
  addPlaylists?: string[];
  removePlaylists?: string[];
}

export interface BulkEditRequest {
  changes: BulkEditChanges;
  /** New titles per video and language (from the preview) */
  titles: Record<string, Partial<Record<TitleLanguage, string>>>;
  /** Publish time per video (ISO), in the subjects' order */
  publishAt: Record<string, string>;
}

/**
 * What the form asks for, from the ticked fields only. `subjects` are in
 * the order the creator sees them (numbering and staggering follow it).
 */
export function buildBulkRequest(form: BulkFormState, subjects: readonly RenameSubject[]): BulkEditRequest {
  const ready = new Set(readyFields(form));
  const changes: BulkEditChanges = {};
  let titles: BulkEditRequest['titles'] = {};
  const publishAt: Record<string, string> = {};

  if (ready.has('title')) titles = renamedTitles(renamePreview(form, subjects));
  if (ready.has('description')) {
    const description: BulkEditChanges['description'] = {};
    for (const lang of ['en', 'ar'] as TitleLanguage[]) {
      const d = form.description[lang];
      if (d.enabled && (d.mode === 'replace' || d.text)) description[lang] = { mode: d.mode, text: d.text };
    }
    changes.description = description;
  }
  if (ready.has('category')) changes.category = form.category;
  if (ready.has('language')) changes.language = form.language;
  if (ready.has('visibility')) changes.isPublic = form.visibility === 'public';
  if (ready.has('comments')) changes.commentSettings = form.comments;
  if (ready.has('playlists')) {
    if (form.playlistsAdd.length) changes.addPlaylists = [...form.playlistsAdd];
    if (form.playlistsRemove.length) changes.removePlaylists = [...form.playlistsRemove];
  }
  if (ready.has('tags')) {
    const tags = parseTagList(form.tags);
    if (form.tagsMode === 'add') changes.addTags = tags;
    else if (form.tagsMode === 'remove') changes.removeTags = tags;
    else changes.replaceTags = tags;
  }
  if (ready.has('schedule')) {
    // Staggered in the same order the titles are numbered
    const ordered = orderedForRename(form, subjects);
    const times = staggeredTimes(new Date(form.scheduleStart), ordered.length, form.scheduleEvery, form.scheduleUnit);
    ordered.forEach((s, i) => {
      publishAt[s.id] = times[i];
    });
  }
  return { changes, titles, publishAt };
}

/** Whether the request would change anything. */
export function isEmptyRequest(request: BulkEditRequest): boolean {
  return Object.keys(request.changes).length === 0 && Object.keys(request.titles).length === 0 && Object.keys(request.publishAt).length === 0;
}
