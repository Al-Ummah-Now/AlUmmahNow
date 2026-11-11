/**
 * Order of a bulk rename (owner, 2026-11-11: "i can't order the videos in
 * the list to allow for proper renaming with numbers"). {n} numbers the
 * videos in the order shown, and that order is chosen here: a quick sort or
 * moves by hand. Shared by Studio's bulk edit and the upload queue's "Set
 * values" (where it is also the upload order).
 */
import type { RenameSubject, TitleLanguage } from './bulk-rename';

export type OrderKey = 'list' | 'title' | 'filename' | 'uploaded' | 'published' | 'duration';
export const ORDER_KEYS: readonly OrderKey[] = ['list', 'title', 'filename', 'uploaded', 'published', 'duration'];
export type OrderDirection = 'asc' | 'desc';

const ARABIC_INDIC = /[٠-٩]/g;
const EXTENDED_ARABIC_INDIC = /[۰-۹]/g;

/** Arabic-Indic (٠-٩) and extended (۰-۹) digits as Latin, for comparing and parsing only. */
export function toLatinDigits(text: string): string {
  return text
    .replace(ARABIC_INDIC, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(EXTENDED_ARABIC_INDIC, (d) => String(d.charCodeAt(0) - 0x06f0));
}

const collators = new Map<string, Intl.Collator>();
function collator(locale: string): Intl.Collator {
  let c = collators.get(locale);
  if (!c) {
    c = new Intl.Collator(locale, { numeric: true, sensitivity: 'base' });
    collators.set(locale, c);
  }
  return c;
}

/**
 * Natural order: "Lesson 2" before "Lesson 10", whatever digits the title
 * uses (٢ = 2), letters compared the way the language sorts them.
 */
export function naturalCompare(a: string, b: string, locale: string = 'en'): number {
  return collator(locale === 'ar' ? 'ar' : 'en').compare(toLatinDigits(a), toLatinDigits(b));
}

function timeOf(value: string | Date | null | undefined): number | null {
  if (!value) return null;
  const t = (value instanceof Date ? value : new Date(value)).getTime();
  return Number.isNaN(t) ? null : t;
}

/**
 * The subjects' ids sorted by `key`. The language picks which title is
 * compared (falling back to the other one). Missing values go last in both
 * directions; ties keep the list order.
 */
export function sortIds(subjects: readonly RenameSubject[], key: OrderKey, direction: OrderDirection = 'asc', language: TitleLanguage = 'en'): string[] {
  const indexed = subjects.map((s, i) => ({ s, i: s.listIndex ?? i }));
  const sign = direction === 'desc' ? -1 : 1;
  const textOf = (s: RenameSubject): string | null => {
    if (key === 'title') return (s.title[language] || s.title[language === 'en' ? 'ar' : 'en'] || '') || null;
    if (key === 'filename') return s.filename || null;
    return null;
  };
  const numberOf = (s: RenameSubject): number | null => {
    if (key === 'uploaded') return timeOf(s.uploadedAt ?? s.date);
    if (key === 'published') return timeOf(s.publishedAt);
    if (key === 'duration') return typeof s.duration === 'number' && Number.isFinite(s.duration) ? s.duration : null;
    return null;
  };
  indexed.sort((x, y) => {
    if (key === 'list') return sign * (x.i - y.i);
    let cmp = 0;
    if (key === 'title' || key === 'filename') {
      const a = textOf(x.s);
      const b = textOf(y.s);
      if (a === null || b === null) return a === b ? x.i - y.i : a === null ? 1 : -1;
      cmp = naturalCompare(a, b, language);
    } else {
      const a = numberOf(x.s);
      const b = numberOf(y.s);
      if (a === null || b === null) return a === b ? x.i - y.i : a === null ? 1 : -1;
      cmp = a - b;
    }
    return cmp !== 0 ? sign * cmp : x.i - y.i;
  });
  return indexed.map(({ s }) => s.id);
}

export type OrderAction =
  | { type: 'set'; ids: readonly string[] }
  | { type: 'move'; id: string; to: number }
  | { type: 'moveBy'; id: string; delta: number };

/** The reorder reducer. Returns the same array when nothing moves. */
export function orderReducer(order: readonly string[], action: OrderAction): string[] {
  if (action.type === 'set') return [...action.ids];
  const from = order.indexOf(action.id);
  if (from < 0) return order as string[];
  const target = action.type === 'move' ? action.to : from + action.delta;
  const to = Math.min(Math.max(Math.trunc(target), 0), order.length - 1);
  if (to === from) return order as string[];
  const next = order.filter((id) => id !== action.id);
  next.splice(to, 0, action.id);
  return next;
}

/** The subjects in `order`; subjects it doesn't name follow in their list order. */
export function orderedSubjects<T extends { id: string }>(subjects: readonly T[], order: readonly string[] | null | undefined): T[] {
  if (!order || order.length === 0) return [...subjects];
  const byId = new Map(subjects.map((s) => [s.id, s]));
  const placed = order.filter((id) => byId.has(id)).map((id) => byId.get(id) as T);
  const seen = new Set(placed.map((s) => s.id));
  return [...placed, ...subjects.filter((s) => !seen.has(s.id))];
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * The highest {n} among existing titles that fit `pattern` ("Lesson {n}"
 * fits "Lesson 36" and "Lesson ٣٦"), or null when none fits or the pattern
 * has no {n}. Other tokens match anything.
 */
export function highestNumber(pattern: string, titles: Iterable<string>): number | null {
  if (!pattern.includes('{n}')) return null;
  const source = pattern
    .split(/(\{n\}|\{filename\}|\{title\}|\{date\}|\{channel\})/)
    .map((part) => (part === '{n}' ? '([0-9٠-٩۰-۹]+)' : /^\{\w+\}$/.test(part) ? '.*?' : escapeRegExp(part)))
    .join('');
  const re = new RegExp(`^\\s*${source}\\s*$`, 'iu');
  let best: number | null = null;
  for (const title of titles) {
    const m = re.exec(title);
    if (!m) continue;
    for (const group of m.slice(1)) {
      if (group === undefined) continue;
      const n = Number.parseInt(toLatinDigits(group), 10);
      if (Number.isFinite(n) && (best === null || n > best)) best = n;
    }
  }
  return best;
}

/**
 * A playlist's order with `selection` placed together, in its order, where
 * the first of them was (or at the end when none was in the playlist).
 */
export function placeInOrder(current: readonly string[], selection: readonly string[]): string[] {
  const chosen = new Set(selection);
  const firstAt = current.findIndex((id) => chosen.has(id));
  const rest = current.filter((id) => !chosen.has(id));
  const at = firstAt < 0 ? rest.length : current.slice(0, firstAt).filter((id) => !chosen.has(id)).length;
  return [...rest.slice(0, at), ...selection, ...rest.slice(at)];
}
