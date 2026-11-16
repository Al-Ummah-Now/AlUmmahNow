/** Labels for the automated findings shown on the review workspace (never raw codes). */
import { translateDynamic, type Translator } from '@/i18n/translate';

/** A finding's category in the admin's language: reason codes, then the AI categories, then the review-only ones; an unknown code shows as is. */
export function findingCategoryLabel(t: Translator, category: string): string {
  for (const prefix of ['review.reasonCodes', 'aiCategory', 'review.findingCategory']) {
    const label = translateDynamic(t, prefix, category);
    if (label !== category) return label;
  }
  return category;
}

/** Where a finding came from: title and description, thumbnail, frame, transcript or image. */
export function findingSourceLabel(t: Translator, source: string): string {
  return translateDynamic(t, 'review.findingSource', source);
}
