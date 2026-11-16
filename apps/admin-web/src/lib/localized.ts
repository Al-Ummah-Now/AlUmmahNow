/**
 * Staff-set en/ar fields (L10N rule, docs/features/LOCALIZED-FIELDS.md): both languages are required,
 * legacy rows missing one are flagged, and Translate fills one from the other for review. Pure helpers
 * shared by LocalizedFieldPair, the "Translate missing" panel and the list badges/filters.
 */
import { ADMIN_FIELD_TRANSLATE_LIMITS, type AdminFieldTranslateItem } from '@al-ummah/shared-types';

export type FieldLang = 'en' | 'ar';
export interface LocalizedPair {
  en: string;
  ar: string;
}

export const otherLang = (lang: FieldLang): FieldLang => (lang === 'en' ? 'ar' : 'en');
const filled = (s: string | null | undefined) => !!s && s.trim().length > 0;

/** The language a pair lacks: null when both are set (or both are empty: nothing to translate from). */
export function missingLang(pair: Partial<LocalizedPair> | null | undefined): FieldLang | null {
  const en = filled(pair?.en);
  const ar = filled(pair?.ar);
  if (en === ar) return null;
  return en ? 'ar' : 'en';
}

/** Which languages are empty: the form's required check and the list badges. */
export function emptyLangs(pair: Partial<LocalizedPair>): FieldLang[] {
  return (['en', 'ar'] as const).filter((l) => !filled(pair[l]));
}

export type MissingFilter = 'all' | 'missing' | 'ar' | 'en';

/** Rows matching a list's "missing" filter ('missing': either language; 'ar'/'en': that one). */
export function filterMissing<T>(rows: T[], filter: MissingFilter, pairsOf: (row: T) => Array<Partial<LocalizedPair>>): T[] {
  if (filter === 'all') return rows;
  return rows.filter((row) => {
    const missing = new Set(pairsOf(row).flatMap(emptyLangs));
    return filter === 'missing' ? missing.size > 0 : missing.has(filter);
  });
}

/** One field of one row that can be filled by Translate. */
export interface MissingItem {
  key: string;
  rowId: string;
  field: string;
  from: FieldLang;
  to: FieldLang;
  source: string;
}

/** Every field with exactly one language set, for "Translate missing". */
export function missingItems<T>(rows: T[], idOf: (row: T) => string, fieldsOf: (row: T) => Record<string, Partial<LocalizedPair>>): MissingItem[] {
  const out: MissingItem[] = [];
  for (const row of rows) {
    for (const [field, pair] of Object.entries(fieldsOf(row))) {
      const to = missingLang(pair);
      if (!to) continue;
      const from = otherLang(to);
      out.push({ key: `${idOf(row)}::${field}`, rowId: idOf(row), field, from, to, source: (pair[from] ?? '').trim() });
    }
  }
  return out;
}

/** The requests for a set of items: one direction each, pages within the service's limits. */
export function translateBatches(items: MissingItem[]): Array<{ from: FieldLang; to: FieldLang; items: MissingItem[] }> {
  const batches: Array<{ from: FieldLang; to: FieldLang; items: MissingItem[] }> = [];
  for (const from of ['en', 'ar'] as const) {
    let page: MissingItem[] = [];
    let chars = 0;
    for (const item of items.filter((i) => i.from === from)) {
      const len = Math.min(item.source.length, ADMIN_FIELD_TRANSLATE_LIMITS.textChars);
      if (page.length && (page.length >= ADMIN_FIELD_TRANSLATE_LIMITS.texts || chars + len > ADMIN_FIELD_TRANSLATE_LIMITS.chars)) {
        batches.push({ from, to: otherLang(from), items: page });
        page = [];
        chars = 0;
      }
      page.push(item);
      chars += len;
    }
    if (page.length) batches.push({ from, to: otherLang(from), items: page });
  }
  return batches;
}

/** The suggestion of a Translate answer, or why there is none. */
export type Suggestion = { kind: 'text'; text: string } | { kind: 'quran'; refs: Array<{ range: string; label: string }> } | { kind: 'empty' };

export function suggestionOf(item: AdminFieldTranslateItem | undefined): Suggestion {
  if (!item) return { kind: 'empty' };
  if (item.refused === 'quran') return { kind: 'quran', refs: item.quran ?? [] };
  return item.text.trim() ? { kind: 'text', text: item.text } : { kind: 'empty' };
}

/** Error codes of POST /api/translate/fields the UI words itself. */
export const TRANSLATE_ERROR_CODES = ['daily_limit', 'translation_paused', 'budget_spent', 'forbidden', 'text_too_long', 'too_much_text'] as const;
export type TranslateErrorCode = (typeof TRANSLATE_ERROR_CODES)[number] | 'failed';
export const translateErrorCode = (code: string | undefined): TranslateErrorCode =>
  (TRANSLATE_ERROR_CODES as readonly string[]).includes(code ?? '') ? (code as TranslateErrorCode) : 'failed';
