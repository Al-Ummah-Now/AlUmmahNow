/**
 * Bulk rename and bulk text edits: one pure engine shared by the upload
 * queue ("Set for all": titles of files that become videos) and Studio's
 * bulk edit of existing videos, and by api-videos (description edits).
 *
 * Titles are bilingual. Each language field is renamed on its own: a rule
 * runs once per chosen language and reads only that language's values, so an
 * English title never leaks into the Arabic field or the other way round.
 *
 * Nothing is normalized behind the user's back: no Unicode normalization,
 * no trimming, no diacritic stripping, no digit conversion unless asked.
 */

export type TitleLanguage = 'en' | 'ar';
export const TITLE_LANGUAGES: readonly TitleLanguage[] = ['en', 'ar'];

/** Longest video title, in characters (code points). */
export const VIDEO_TITLE_MAX = 100;
/** Longest video description, in characters (code points). */
export const VIDEO_DESCRIPTION_MAX = 5000;

export type DigitStyle = 'latin' | 'arabic-indic';
export type CaseMode = 'upper' | 'lower' | 'title' | 'sentence';

export interface PatternRule {
  kind: 'pattern';
  /** Tokens: {n} {filename} {title} {date} {channel} */
  pattern: string;
  /** First number for {n} (default 1) */
  start?: number;
  /** Added per row (default 1) */
  step?: number;
  /** Minimum digits for {n}, zero padded (default 1 = no padding) */
  pad?: number;
}

export interface ReplaceRule {
  kind: 'replace';
  find: string;
  replace: string;
  ignoreCase?: boolean;
}

export interface AffixRule {
  kind: 'affix';
  prefix?: string;
  suffix?: string;
}

export interface CaseRule {
  kind: 'case';
  mode: CaseMode;
}

export type RenameRule = PatternRule | ReplaceRule | AffixRule | CaseRule;

/** One video, or one queued file, to rename. */
export interface RenameSubject {
  id: string;
  /** Current title per language ('' or missing: that field is empty) */
  title: Partial<Record<TitleLanguage, string>>;
  /** Original file name, with its extension (queued files; videos that kept it) */
  filename?: string;
  /** Upload or recording date (ISO string or Date) */
  date?: string | Date | null;
  /** Channel name per language */
  channel?: Partial<Record<TitleLanguage, string>>;
  /** For ordering (bulk-order.ts): position in the creator's list, dates, length in seconds */
  listIndex?: number;
  uploadedAt?: string | Date | null;
  publishedAt?: string | Date | null;
  duration?: number | null;
}

export interface RenameOptions {
  /** The rule for every chosen language (unless `rules` gives that language its own) */
  rule: RenameRule;
  /**
   * A rule per language: English and Arabic changed in one pass to different
   * values ("Lesson {n}" / "الدرس {n}"). A video gets the same {n} in both.
   */
  rules?: Partial<Record<TitleLanguage, RenameRule>>;
  /** Which title fields change; the others are left alone */
  languages: TitleLanguage[];
  /** Digits for {n} and {date} in the Arabic field. English always uses Latin digits. */
  arabicDigits?: DigitStyle;
  /** Rows the user left out: unchanged and not numbered */
  excluded?: ReadonlySet<string> | readonly string[];
  maxLength?: number;
}

export type RenameProblem = 'empty' | 'too_long' | 'duplicate';

export interface RenameRow {
  id: string;
  language: TitleLanguage;
  before: string;
  after: string;
  excluded: boolean;
  changed: boolean;
  problems: RenameProblem[];
  /**
   * Left as it is for this language: the pattern uses {title} and this
   * language has no title (renaming it would give "Series 3: " with nothing
   * after the colon). The video still takes its number.
   */
  skipped?: 'no_title';
}

/** Problems that stop a row from being applied (a duplicate is only a warning). */
export const BLOCKING_PROBLEMS: readonly RenameProblem[] = ['empty', 'too_long'];

const ARABIC_INDIC = ['٠', '١', '٢', '٣', '٤', '٥', '٦', '٧', '٨', '٩'];

/** Characters (code points), the way limits are counted. */
export function charCount(text: string): number {
  return Array.from(text).length;
}

/** Latin digits → Arabic-Indic (٠-٩). Other characters are kept. */
export function toArabicIndicDigits(text: string): string {
  return text.replace(/[0-9]/g, (d) => ARABIC_INDIC[Number(d)]);
}

/** "Lesson 03.final.mp4" → "Lesson 03.final" (only the last extension) */
export function stripExtension(filename: string): string {
  const dot = filename.lastIndexOf('.');
  return dot > 0 ? filename.slice(0, dot) : filename;
}

/** {n} for the row at `index` among the included rows. */
export function formatNumber(index: number, rule: Pick<PatternRule, 'start' | 'step' | 'pad'>, digits: DigitStyle = 'latin'): string {
  const start = Number.isFinite(rule.start) ? Math.trunc(rule.start as number) : 1;
  const step = Number.isFinite(rule.step) ? Math.trunc(rule.step as number) : 1;
  const pad = Math.min(Math.max(Math.trunc(rule.pad ?? 1), 1), 9);
  const value = start + index * step;
  const sign = value < 0 ? '-' : '';
  const text = sign + String(Math.abs(value)).padStart(pad, '0');
  return digits === 'arabic-indic' ? toArabicIndicDigits(text) : text;
}

/**
 * {date} in the field's language. Digits follow the choice explicitly
 * (Intl's default numbering for 'ar' differs between runtimes).
 */
export function formatTokenDate(date: string | Date | null | undefined, language: TitleLanguage, digits: DigitStyle = 'latin'): string {
  if (!date) return '';
  const value = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(value.getTime())) return '';
  const locale = language === 'ar' ? (digits === 'arabic-indic' ? 'ar-u-nu-arab' : 'ar-u-nu-latn') : 'en-GB-u-nu-latn';
  try {
    return new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }).format(value);
  } catch {
    return value.toISOString().slice(0, 10);
  }
}

const TOKEN = /\{(n|filename|title|date|channel)\}/g;

/** Marks where a token came out empty (removed by tidyEmptyTokens). */
const EMPTY = '\u0000';
/** Separator characters a vanished token takes with it. */
const SEP = '[\\s\\-\u2013\u2014:|\u00b7\u2022,\u060c/_.]*';
const AROUND_EMPTY = new RegExp(`(${SEP})${EMPTY}(${SEP})`, 'gu');

/**
 * Removes the tokens that came out empty with the separators left around
 * them: "Lesson 1 – {filename}" without a file name is "Lesson 1", not
 * "Lesson 1 – "; "A – {channel} – B" is "A – B"; empty brackets go too.
 * Text the creator typed is never touched.
 */
export function tidyEmptyTokens(text: string): string {
  if (!text.includes(EMPTY)) return text;
  let out = text.replace(AROUND_EMPTY, (_m, left: string, right: string, offset: number, whole: string) => {
    const atStart = offset === 0;
    const atEnd = offset + _m.length === whole.length;
    if (atStart || atEnd) return '';
    // Between two pieces of text: keep one separator (the more telling of the two)
    const keep = right.trim() ? right : left.trim() ? left : left || right;
    return keep || ' ';
  });
  out = out.replace(/\(\s*\)|\[\s*\]|\{\s*\}|«\s*»|"\s*"/gu, '').replace(/ {2,}/g, ' ');
  return out.replace(new RegExp(EMPTY, 'g'), '').trim();
}

function applyPattern(rule: PatternRule, subject: RenameSubject, language: TitleLanguage, index: number, digits: DigitStyle): string {
  const filled = rule.pattern.replace(TOKEN, (_match, token: string) => {
    const value = tokenValue(token, rule, subject, language, index, digits);
    return value === '' ? EMPTY : value;
  });
  return tidyEmptyTokens(filled);
}

function tokenValue(token: string, rule: PatternRule, subject: RenameSubject, language: TitleLanguage, index: number, digits: DigitStyle): string {
  {
    switch (token) {
      case 'n':
        return formatNumber(index, rule, digits);
      case 'filename':
        return subject.filename ? stripExtension(subject.filename) : '';
      case 'title':
        return subject.title[language] ?? '';
      case 'date':
        return formatTokenDate(subject.date, language, digits);
      case 'channel':
        return subject.channel?.[language] ?? '';
      default:
        return '';
    }
  }
}

/** Whether a rule needs this language's current title to say anything. */
export function needsTitle(rule: RenameRule): boolean {
  return rule.kind === 'pattern' && rule.pattern.includes('{title}');
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Plain-text find and replace (every occurrence); `$` in the replacement is literal. */
export function replaceText(text: string, find: string, replacement: string, ignoreCase = false): string {
  if (!find) return text;
  const pattern = new RegExp(escapeRegExp(find), ignoreCase ? 'giu' : 'gu');
  return text.replace(pattern, () => replacement);
}

/** Case change. Scripts without case (Arabic) come back unchanged. */
export function changeCase(text: string, mode: CaseMode, language: TitleLanguage): string {
  const locale = language === 'ar' ? 'ar' : 'en';
  switch (mode) {
    case 'upper':
      return text.toLocaleUpperCase(locale);
    case 'lower':
      return text.toLocaleLowerCase(locale);
    case 'title':
      return text.replace(/(^|\s)(\p{L})(\S*)/gu, (_m, space: string, first: string, rest: string) =>
        space + first.toLocaleUpperCase(locale) + rest.toLocaleLowerCase(locale));
    case 'sentence': {
      const lower = text.toLocaleLowerCase(locale);
      return lower.replace(/\p{L}/u, (first) => first.toLocaleUpperCase(locale));
    }
    default:
      return text;
  }
}

/** One title through one rule. `index` numbers the included rows from 0. */
export function renameOne(subject: RenameSubject, language: TitleLanguage, rule: RenameRule, index: number, digits: DigitStyle = 'latin'): string {
  const current = subject.title[language] ?? '';
  switch (rule.kind) {
    case 'pattern':
      return applyPattern(rule, subject, language, index, digits);
    case 'replace':
      return replaceText(current, rule.find, rule.replace, rule.ignoreCase);
    case 'affix':
      return `${rule.prefix ?? ''}${current}${rule.suffix ?? ''}`;
    case 'case':
      return changeCase(current, rule.mode, language);
    default:
      return current;
  }
}

/** Duplicate check key: the same text ignoring case and surrounding spaces (nothing else). */
function duplicateKey(text: string, language: TitleLanguage): string {
  return text.trim().toLocaleLowerCase(language);
}

/**
 * The preview table: one row per subject and chosen language, in the order
 * given, with the new title and its problems. Excluded rows keep their title
 * and take no number.
 */
export function previewRename(subjects: readonly RenameSubject[], options: RenameOptions): RenameRow[] {
  const excluded = new Set(options.excluded ?? []);
  const max = options.maxLength ?? VIDEO_TITLE_MAX;
  const rows: RenameRow[] = [];
  for (const language of TITLE_LANGUAGES) {
    if (!options.languages.includes(language)) continue;
    const digits: DigitStyle = language === 'ar' ? options.arabicDigits ?? 'latin' : 'latin';
    const rule = options.rules?.[language] ?? options.rule;
    // Every language counts the same included videos in the same order: one {n} per video
    let index = 0;
    for (const subject of subjects) {
      const before = subject.title[language] ?? '';
      const isExcluded = excluded.has(subject.id);
      if (isExcluded) {
        rows.push({ id: subject.id, language, before, after: before, excluded: true, changed: false, problems: [] });
        continue;
      }
      // A {title} pattern with no title in this language: left as it is (the video keeps its number)
      if (needsTitle(rule) && before.trim() === '') {
        index++;
        rows.push({ id: subject.id, language, before, after: before, excluded: false, changed: false, problems: [], skipped: 'no_title' });
        continue;
      }
      const after = renameOne(subject, language, rule, index++, digits);
      rows.push({ id: subject.id, language, before, after, excluded: false, changed: after !== before, problems: [] });
    }
  }
  // Problems are judged on the included rows only, per language
  const seen = new Map<string, number>();
  for (const row of rows) {
    if (row.excluded || row.skipped) continue;
    if (row.after.trim() === '') row.problems.push('empty');
    if (charCount(row.after) > max) row.problems.push('too_long');
    const key = `${row.language}\u0000${duplicateKey(row.after, row.language)}`;
    if (row.after.trim() !== '') seen.set(key, (seen.get(key) ?? 0) + 1);
  }
  for (const row of rows) {
    if (row.excluded || row.skipped || row.after.trim() === '') continue;
    if ((seen.get(`${row.language}\u0000${duplicateKey(row.after, row.language)}`) ?? 0) > 1) row.problems.push('duplicate');
  }
  return rows;
}

/** Whether a preview row will be written. */
export function rowApplies(row: RenameRow): boolean {
  return !row.excluded && row.changed && !row.problems.some((p) => BLOCKING_PROBLEMS.includes(p));
}

/** New titles to write, per subject id and language (rows that apply only). */
export function renamedTitles(rows: readonly RenameRow[]): Record<string, Partial<Record<TitleLanguage, string>>> {
  const out: Record<string, Partial<Record<TitleLanguage, string>>> = {};
  for (const row of rows) {
    if (!rowApplies(row)) continue;
    (out[row.id] ??= {})[row.language] = row.after;
  }
  return out;
}

/** Counts for the preview's summary line. */
export function renameSummary(rows: readonly RenameRow[]) {
  let applies = 0;
  let blocked = 0;
  let duplicates = 0;
  let unchanged = 0;
  let excluded = 0;
  let skipped = 0;
  for (const row of rows) {
    if (row.excluded) excluded++;
    else if (row.skipped) skipped++;
    else if (row.problems.some((p) => BLOCKING_PROBLEMS.includes(p))) blocked++;
    else if (!row.changed) unchanged++;
    else applies++;
    if (row.problems.includes('duplicate')) duplicates++;
  }
  return { applies, blocked, duplicates, unchanged, excluded, skipped };
}

// ---------------------------------------------------------------------------
// Descriptions: append, prepend or replace, per language
// ---------------------------------------------------------------------------

export type TextEditMode = 'append' | 'prepend' | 'replace';

export interface TextEdit {
  mode: TextEditMode;
  text: string;
}

/** Joins with a blank line when both sides have text; replace sets the text as given. */
export function applyTextEdit(current: string | null | undefined, edit: TextEdit): string {
  const base = current ?? '';
  if (edit.mode === 'replace') return edit.text;
  if (!base) return edit.text;
  if (!edit.text) return base;
  return edit.mode === 'append' ? `${base}\n\n${edit.text}` : `${edit.text}\n\n${base}`;
}

// ---------------------------------------------------------------------------
// Staggered publish times
// ---------------------------------------------------------------------------

export type StaggerUnit = 'hours' | 'days';

/**
 * Publish times for `count` videos: the first at `start`, then one every
 * `every` hours or days. `every` 0 gives every video the same time.
 */
export function staggeredTimes(start: Date | string, count: number, every = 0, unit: StaggerUnit = 'days'): string[] {
  const first = (start instanceof Date ? start : new Date(start)).getTime();
  if (Number.isNaN(first) || count <= 0) return [];
  const step = Math.max(0, every);
  return Array.from({ length: count }, (_, i) => {
    const at = new Date(first);
    // Days follow the calendar of the runtime's zone (the browser: the
    // creator's), so "every day at 18:00" stays at 18:00 across DST
    if (unit === 'days') at.setDate(at.getDate() + i * step);
    else at.setTime(first + i * step * 3_600_000);
    return at.toISOString();
  });
}
