/**
 * Category value → label in the admin's language. A plain module (not
 * 'use client') so Server Components such as /category-suggestions can call it.
 */
import { VIDEO_CATEGORIES } from '@al-ummah/shared-types';
import type { Locale } from '@/i18n/config';

export function categoryLabel(value: string | null | undefined, locale: Locale): string | null {
  if (!value) return null;
  const found = VIDEO_CATEGORIES.find((c) => c.value === value);
  return found ? found.label[locale] ?? found.label.en : value;
}
