/**
 * Category value → label in the admin's language. A plain module (not
 * 'use client') so Server Components such as /category-suggestions can call it.
 * Categories are admin-managed (Videos admin › Categories): pass the live list
 * (admin-api /api/video-categories); the built-in list is the fallback.
 */
import { VIDEO_CATEGORIES } from '@al-ummah/shared-types';
import type { Locale } from '@/i18n/config';

export interface CategoryOption {
  value: string;
  label: { en: string; ar: string };
  retired?: boolean;
}

export function categoryLabel(value: string | null | undefined, locale: Locale, list: readonly CategoryOption[] = VIDEO_CATEGORIES): string | null {
  if (!value) return null;
  const found = list.find((c) => c.value === value) ?? VIDEO_CATEGORIES.find((c) => c.value === value);
  return found ? found.label[locale] ?? found.label.en : value;
}
