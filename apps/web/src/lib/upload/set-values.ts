/**
 * Batch upload queue: each file's own values (titles, description,
 * language, visibility, tags, comments, publish time) and the "Set values"
 * action that fills them for all files or the ticked ones.
 *
 * This is setting first values, not editing: a field the creator typed on a
 * row by hand is theirs and is kept unless they choose "overwrite my
 * changes". Category and playlists keep their own row hooks
 * (useBatchCategories, useBatchPlaylists); this model covers the rest.
 *
 * Values reach the video in two ways, never through the bulk edit API:
 * - files picked after values were set for all get them when their video is
 *   created (batch initiate, `initiateFields`);
 * - later changes are saved onto each row's video (PUT /api/videos/:id),
 *   whether its bytes are still uploading or not.
 * Resume is not affected: remembered uploads are keyed by the file (name,
 * size, date) and channel, never by its title (lib/upload/resume-store.ts).
 */
import { stripExtension, staggeredTimes, type RenameSubject, type TitleLanguage } from '@al-ummah/shared-types';
import { buildBulkRequest, parseTagList, readyFields, type BulkFormState, type CommentSetting, type ContentLanguage } from '@/lib/bulk-edit/form';

export type RowField = 'titleEn' | 'titleAr' | 'descriptionEn' | 'descriptionAr' | 'language' | 'visibility' | 'tags' | 'comments' | 'publishAt';

export interface RowValues {
  titleEn: string;
  titleAr: string;
  descriptionEn: string;
  descriptionAr: string;
  language?: ContentLanguage;
  isPublic?: boolean;
  tags?: string[];
  commentSettings?: CommentSetting;
  /** ISO time; set → the video is private until then */
  publishAt?: string;
}

export interface RowState {
  values: RowValues;
  /** Fields the creator typed on this row */
  touched: RowField[];
}

export interface QueueRowRef {
  /** Queue row id */
  id: string;
  fileName: string;
  /** When the file was picked (the {date} token) */
  addedAt?: string;
}

export function initialRow(fileName: string, defaults?: Partial<RowValues>): RowState {
  return {
    values: { titleEn: stripExtension(fileName), titleAr: '', descriptionEn: '', descriptionAr: '', ...defaults },
    touched: [],
  };
}

/** The row with one field typed by hand (kept by later "Set values"). */
export function editRow(row: RowState, field: RowField, values: Partial<RowValues>): RowState {
  return { values: { ...row.values, ...values }, touched: row.touched.includes(field) ? row.touched : [...row.touched, field] };
}

export function subjectOf(ref: QueueRowRef, row: RowState, channel?: Partial<Record<TitleLanguage, string>>): RenameSubject {
  return { id: ref.id, title: { en: row.values.titleEn, ar: row.values.titleAr }, filename: ref.fileName, date: ref.addedAt ?? null, channel };
}

export interface SetResult {
  rows: Record<string, RowState>;
  /** Rows whose values changed */
  changed: string[];
  /** Hand-typed values that were kept */
  skipped: number;
}

/**
 * "Set values" for `targets` (all files or the ticked ones, in queue order).
 * Only ticked fields are set; a hand-typed field is kept unless `overwrite`.
 * Setting a value marks nothing as hand-typed.
 */
export function applySetValues(
  rows: Record<string, RowState>,
  targets: readonly QueueRowRef[],
  form: BulkFormState,
  options: { overwrite: boolean; channel?: Partial<Record<TitleLanguage, string>> },
): SetResult {
  const next: Record<string, RowState> = { ...rows };
  const changed = new Set<string>();
  let skipped = 0;
  const ready = new Set(readyFields(form));
  const subjects = targets.map((ref) => subjectOf(ref, rows[ref.id] ?? initialRow(ref.fileName), options.channel));
  const request = buildBulkRequest(form, subjects);

  const put = (id: string, field: RowField, values: Partial<RowValues>) => {
    const row = next[id] ?? initialRow(targets.find((r) => r.id === id)?.fileName ?? '');
    if (row.touched.includes(field) && !options.overwrite) {
      skipped++;
      return;
    }
    const merged = { ...row.values, ...values };
    if (JSON.stringify(merged) === JSON.stringify(row.values)) return;
    next[id] = { values: merged, touched: options.overwrite ? row.touched.filter((f) => f !== field) : row.touched };
    changed.add(id);
  };

  for (const ref of targets) {
    const id = ref.id;
    const titles = request.titles[id];
    if (titles?.en !== undefined) put(id, 'titleEn', { titleEn: titles.en });
    if (titles?.ar !== undefined) put(id, 'titleAr', { titleAr: titles.ar });
    if (ready.has('description')) {
      // Setting a first value: the text is the description (no append)
      if (form.description.en.enabled) put(id, 'descriptionEn', { descriptionEn: form.description.en.text });
      if (form.description.ar.enabled) put(id, 'descriptionAr', { descriptionAr: form.description.ar.text });
    }
    if (ready.has('language')) put(id, 'language', { language: form.language });
    if (ready.has('visibility')) put(id, 'visibility', { isPublic: form.visibility === 'public' });
    if (ready.has('comments')) put(id, 'comments', { commentSettings: form.comments });
    if (ready.has('tags')) put(id, 'tags', { tags: parseTagList(form.tags) });
    if (request.publishAt[id]) put(id, 'publishAt', { publishAt: request.publishAt[id], isPublic: false });
  }
  return { rows: next, changed: Array.from(changed), skipped };
}

/**
 * Values a file gets when its video is created, from the values last set
 * for all files (`defaults`), numbered after the files already queued.
 */
export function defaultsForNewFiles(
  defaults: BulkFormState | null,
  files: readonly { name: string }[],
  alreadyQueued: number,
  channel?: Partial<Record<TitleLanguage, string>>,
  now = new Date(),
): RowValues[] {
  const base = files.map((f) => initialRow(f.name).values);
  if (!defaults) return base;
  // The numbering continues where the queue is: {n} of the k-th new file is start + (queued + k) × step
  const offset = { ...defaults, rename: { ...defaults.rename, start: defaults.rename.start + alreadyQueued * defaults.rename.step } };
  const refs = files.map((f, i) => ({ id: `new-${i}`, fileName: f.name, addedAt: now.toISOString() }));
  const rows = Object.fromEntries(refs.map((r, i) => [r.id, { values: base[i], touched: [] as RowField[] }]));
  const result = applySetValues(rows, refs, offset, { overwrite: true, channel });
  return refs.map((r) => result.rows[r.id].values);
}

/** The batch initiate fields of one file (see uploadBatchInitiate). */
export function initiateFields(values: RowValues, fileName: string) {
  return {
    title: values.titleEn || values.titleAr || stripExtension(fileName),
    titleLocalized: { en: values.titleEn, ar: values.titleAr },
    ...(values.descriptionEn || values.descriptionAr ? { description: values.descriptionEn || values.descriptionAr, descriptionLocalized: { en: values.descriptionEn, ar: values.descriptionAr } } : {}),
    ...(values.language ? { language: values.language } : {}),
    ...(values.commentSettings ? { commentSettings: values.commentSettings } : {}),
    ...(values.isPublic !== undefined ? { isPublic: values.isPublic } : {}),
    ...(values.tags?.length ? { tags: values.tags.join(',') } : {}),
    fileName,
  };
}

/** What changed between what the video has and the row, as a video update (null: nothing). */
export function updateFor(saved: RowValues, row: RowValues): Record<string, unknown> | null {
  const update: Record<string, unknown> = {};
  if (row.titleEn !== saved.titleEn || row.titleAr !== saved.titleAr) {
    update.titleLocalized = { en: row.titleEn, ar: row.titleAr };
    update.title = row.titleEn || row.titleAr;
  }
  if (row.descriptionEn !== saved.descriptionEn || row.descriptionAr !== saved.descriptionAr) {
    update.descriptionLocalized = { en: row.descriptionEn, ar: row.descriptionAr };
    update.description = row.descriptionEn || row.descriptionAr;
  }
  if (row.language !== saved.language && row.language) update.language = row.language;
  if (row.isPublic !== saved.isPublic && row.isPublic !== undefined) update.isPublic = row.isPublic;
  if (JSON.stringify(row.tags ?? []) !== JSON.stringify(saved.tags ?? []) && row.tags) update.tags = row.tags;
  if (row.commentSettings !== saved.commentSettings && row.commentSettings) update.commentSettings = row.commentSettings;
  return Object.keys(update).length ? update : null;
}

/** A row title the API would refuse (empty in both languages). */
export function rowTitleMissing(values: RowValues): boolean {
  return !values.titleEn.trim() && !values.titleAr.trim();
}

/** Staggered times as the set-values form would give `count` files (exported for the panel's hint). */
export function staggerPreview(form: BulkFormState, count: number): string[] {
  return form.scheduleStart ? staggeredTimes(new Date(form.scheduleStart), count, form.scheduleEvery, form.scheduleUnit) : [];
}
