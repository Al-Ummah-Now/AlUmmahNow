/**
 * Inline title and description translation (AUN-CAPTIONS §3.4, §5.8, #810) and viewer-side
 * translated titles (§5.9, O6).
 *
 * - Inline: a Translate button beside each title and description fills the other language with a
 *   suggestion the creator reviews before saving. Free on every tier with a daily fair-use limit
 *   per user (O5); cache hits don't count. The inline-translation budget ($20/month in production)
 *   is the backstop, with an admin kill switch.
 * - Quran in titles: text inside {…} is never machine-translated. It stays as written and, when the
 *   Quran matcher finds it in exactly one place, the suggestion adds its reference.
 * - Viewer side: when a video has no title in the viewer's language, a cached machine translation
 *   may be shown, labelled, with "Show original". It is stored apart from creator text and never
 *   written into titleLocalized. Admin switch (off by default) plus a per-channel opt-out.
 */

export const INLINE_TRANSLATE_LIMITS = {
  /** Texts per request (bulk edit sends pages of 50) */
  texts: 50,
  /** Characters per request */
  chars: 20_000,
  /** Characters per text (a long description) */
  textChars: 5_000,
} as const;

export const INLINE_TRANSLATE_FIELDS = ['title', 'description', 'tag', 'playlist', 'post'] as const;
export type InlineTranslateField = (typeof INLINE_TRANSLATE_FIELDS)[number];

/** Code default of `translate.inline.dailyItems` (O5): the admin can change it. */
export const INLINE_TRANSLATE_DEFAULT_DAILY_ITEMS = 100;

export interface InlineTranslateItem {
  id: string;
  text: string;
}

export interface InlineTranslateResultItem {
  id: string;
  text: string;
  /** Quran quotations ({…}) found, with their reference */
  quran?: Array<{ range: string; label: string }>;
  cached: boolean;
}

/** api-videos → processor `/internal/translate` (synchronous, X-API-Key). */
export interface InternalTranslateRequest {
  items: InlineTranslateItem[];
  from: string;
  to: string;
  field: InlineTranslateField;
  provider: 'workers-ai' | 'deepl';
  /** The day's inline-translation budget (the monthly budget / 30) */
  dailyBudgetUsd: number;
  /** Budget/usage feature: inline or viewer-side */
  feature: 'inline_translate';
  context?: { title?: string; channel?: string };
  /**
   * 'admin_field': a staff-set site field (L10N rule): Workers AI only, the site's wording rules
   * («مرئي/مرئيات»), the CMS glossary, and Quran text refused instead of masked.
   */
  mode?: 'admin_field';
}

export interface InternalTranslateResponse {
  items: Array<{ id: string; text: string; quran?: Array<{ range: string; label: string }>; refused?: AdminFieldRefusal }>;
  provider: string;
  model: string;
  usd: number;
}

/** Payload of MessageType.MetadataTranslate (viewer-side titles, O6). */
export interface MetadataTranslatePayload {
  videoId: string;
  lang: string;
  /** sha256 of the source title and description: a later change invalidates the translation */
  sourceHash: string;
  from: string;
  title: string;
  description?: string;
  dailyBudgetUsd: number;
  requestedAt: string;
}

/** The spans of a title written inside {…} (Quran quotations by convention, §3.4). */
export function braceSpans(text: string): Array<{ start: number; end: number; inner: string }> {
  const out: Array<{ start: number; end: number; inner: string }> = [];
  const re = /\{([^{}]{2,600})\}/g;
  for (const m of text.matchAll(re)) out.push({ start: m.index!, end: m.index! + m[0].length, inner: m[1]!.trim() });
  return out;
}

/** The language of a short text: Arabic script → 'ar', otherwise 'en' (the pair en↔ar first). */
export function guessTitleLanguage(text: string): 'ar' | 'en' {
  const letters = (text.match(/\p{L}/gu) ?? []).length;
  const arabic = (text.match(/[؀-ۿ]/g) ?? []).length;
  return letters && arabic / letters >= 0.5 ? 'ar' : 'en';
}

// ---------------------------------------------------------------------------
// Staff-set site fields (L10N rule, 2026-11-16): every non-user-content field has en AND ar; the
// admin types one and the Translate button suggests the other. Staff-only, audited, capped per day.
// ---------------------------------------------------------------------------

/** The two languages every staff-set field has. */
export const ADMIN_FIELD_LANGUAGES = ['en', 'ar'] as const;
export type AdminFieldLanguage = (typeof ADMIN_FIELD_LANGUAGES)[number];

export const ADMIN_FIELD_TRANSLATE_LIMITS = {
  /** Texts per request (a list page's "Translate missing" sends pages of 50) */
  texts: 50,
  chars: 20_000,
  textChars: 5_000,
} as const;

/** Texts per staff member per UTC day (cache hits are not counted). */
export const ADMIN_FIELD_TRANSLATE_DAILY_ITEMS = 500;

/** The field being translated, for the audit and the prompt: `<feature>.<field>`, e.g. `categories.label`. */
export const ADMIN_FIELD_NAME = /^[a-z][a-z0-9_-]{0,39}(?:\.[a-z][a-z0-9_-]{0,39}){0,2}$/;

/** Why a text was not translated: it is (or quotes) Quran text, which is never machine-translated. */
export type AdminFieldRefusal = 'quran';

export interface AdminFieldTranslateRequest {
  from: AdminFieldLanguage;
  to: AdminFieldLanguage;
  texts: string[];
  field?: string;
}

export interface AdminFieldTranslateItem {
  /** The suggestion ('' when the source was empty or the text was refused) */
  text: string;
  refused?: AdminFieldRefusal;
  /** The Quran references found, so the admin can paste the official text */
  quran?: Array<{ range: string; label: string }>;
  cached: boolean;
}

export interface AdminFieldTranslateResponse {
  items: AdminFieldTranslateItem[];
  provider: string;
  machineTranslation: true;
  usage: { used: number; limit: number; resetsAt: string };
}

/**
 * Text that is visibly Quran as printed: the ornate parentheses ﴿ ﴾, the ayah-end sign ۝, or the
 * mushaf's small high annotation marks (U+06D6–U+06ED). The processor also runs the Quran matcher;
 * this catches pasted mushaf text before any model sees it.
 */
export function looksLikeMushafText(text: string): boolean {
  return /[\uFD3E\uFD3F\u06DD\u06DE]/.test(text) || (text.match(/[\u06D6-\u06ED]/g) ?? []).length >= 2;
}
