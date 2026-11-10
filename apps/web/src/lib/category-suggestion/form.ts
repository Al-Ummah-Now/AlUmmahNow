/**
 * Form-side rules for AI category suggestions ("AI suggests, uploader confirms").
 * Pure, so the upload and edit forms share them and they are unit-tested.
 */
import { VIDEO_CATEGORIES, type VideoCategory } from '@al-ummah/shared-types';

export interface CategoryScoreView {
  category: string;
  confidence: number;
}

/** api-videos GET/POST /api/videos/category-suggestions `result`. */
export interface CategorySuggestionView {
  status: 'pending' | 'done' | 'failed' | 'budget' | 'disabled' | 'empty';
  preselect: string | null;
  lowConfidence: boolean;
  category: string | null;
  confidence: number | null;
  options: CategoryScoreView[];
  model: string | null;
  outcome: 'pending' | 'accepted' | 'changed' | 'none';
  categorySource?: 'uploader' | 'ai' | 'admin' | null;
}

export interface CategoryFormText {
  title?: string;
  titleLocalized?: Record<string, string>;
  description?: string;
  descriptionLocalized?: Record<string, string>;
  tags?: string[];
}

/** The category part of a form: who put the current value there. */
export interface CategoryFormState {
  category?: VideoCategory;
  /** The current value is the AI's preselection (not confirmed by a person yet). */
  aiApplied: boolean;
  /** A person picked or cleared the category: suggestions never change it again. */
  touched: boolean;
}

export function isKnownCategory(value: unknown): value is VideoCategory {
  return typeof value === 'string' && VIDEO_CATEGORIES.some((c) => c.value === value);
}

/**
 * Apply a suggestion to the form. Only an empty or AI-filled category follows
 * the AI: a confident suggestion is preselected, a low-confidence one clears a
 * stale AI preselection (the options are offered instead). A category a person
 * chose (by hand or from a template) is never changed.
 */
export function applySuggestion(state: CategoryFormState, suggestion: CategorySuggestionView | null): CategoryFormState {
  if (!suggestion || suggestion.status !== 'done' || state.touched) return state;
  if (state.category && !state.aiApplied) return state;
  if (isKnownCategory(suggestion.preselect)) {
    return { ...state, category: suggestion.preselect, aiApplied: true };
  }
  return state.aiApplied ? { ...state, category: undefined, aiApplied: false } : state;
}

/** A person chose (or cleared) the category. */
export function pickCategory(category: VideoCategory | undefined): CategoryFormState {
  return { category, aiApplied: false, touched: true };
}

/** Options worth offering: known categories, best first, up to 3. */
export function suggestionOptions(suggestion: CategorySuggestionView | null): CategoryScoreView[] {
  if (!suggestion || suggestion.status !== 'done') return [];
  return suggestion.options.filter((o) => isKnownCategory(o.category)).slice(0, 3);
}

/** The text the AI reads, from the form's fields; null when there is nothing to read. */
export function formText(fields: { titleEn?: string; titleAr?: string; descriptionEn?: string; descriptionAr?: string; tags?: string[] }): CategoryFormText | null {
  const clean = (v: string | undefined) => (v ?? '').trim();
  const titleEn = clean(fields.titleEn);
  const titleAr = clean(fields.titleAr);
  const descriptionEn = clean(fields.descriptionEn);
  const descriptionAr = clean(fields.descriptionAr);
  const tags = (fields.tags ?? []).map((t) => t.trim()).filter(Boolean);
  if (!titleEn && !titleAr && !descriptionEn && !descriptionAr && !tags.length) return null;
  const localized = (en: string, ar: string) => {
    const out: Record<string, string> = {};
    if (en) out.en = en;
    if (ar) out.ar = ar;
    return Object.keys(out).length ? out : undefined;
  };
  return {
    ...(titleEn || titleAr ? { title: titleEn || titleAr } : {}),
    ...(localized(titleEn, titleAr) ? { titleLocalized: localized(titleEn, titleAr) } : {}),
    ...(descriptionEn || descriptionAr ? { description: descriptionEn || descriptionAr } : {}),
    ...(localized(descriptionEn, descriptionAr) ? { descriptionLocalized: localized(descriptionEn, descriptionAr) } : {}),
    ...(tags.length ? { tags } : {}),
  };
}

/** One key per form (8-80 chars of A-Z a-z 0-9 _ -). */
export function newDraftKey(prefix: 'upload' | 'edit'): string {
  const random = typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}`;
  return `${prefix}-${random}`.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 80);
}
