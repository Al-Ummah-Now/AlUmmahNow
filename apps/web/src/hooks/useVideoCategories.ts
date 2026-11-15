'use client';

/**
 * The video categories (admin-managed): `active` for pickers and filters,
 * `all` (retired included) for labels. Starts with the cached or built-in list
 * and updates when the live one arrives (lib/api/categories.ts).
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  categoryLabelIn,
  getCachedCategories,
  loadCategories,
  subscribeCategories,
  type WebVideoCategory,
} from '@/lib/api/categories';

export interface VideoCategoriesState {
  all: WebVideoCategory[];
  active: WebVideoCategory[];
  /** Label in a language; null for an unknown value */
  label: (value: string | null | undefined, lang: string) => string | null;
}

export function useVideoCategories(): VideoCategoriesState {
  const [all, setAll] = useState<WebVideoCategory[]>(getCachedCategories);
  useEffect(() => {
    const unsubscribe = subscribeCategories(setAll);
    void loadCategories().then(setAll);
    return unsubscribe;
  }, []);
  const active = useMemo(() => all.filter((c) => !c.retired), [all]);
  const label = useCallback((value: string | null | undefined, lang: string) => categoryLabelIn(all, value, lang), [all]);
  return { all, active, label };
}
