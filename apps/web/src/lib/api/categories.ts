/**
 * Video categories for the browser (admin-managed since 2026-11-15; wiki
 * AUN-VIDEO-CATEGORIES): api-videos GET /api/categories, already in display
 * order, retired ones flagged. The built-in list (shared-types
 * VIDEO_CATEGORIES) is the value until the first answer and whenever the API
 * cannot be read, so nothing waits on it. One request at a time, read again
 * after a minute (the API's own cache time).
 */
import { CATEGORY_SLUG_PATTERN, VIDEO_CATEGORIES } from '@al-ummah/shared-types';
import { getApiUrl } from '@/lib/runtime-config';
import { logger } from '@/lib/logger-client';

export interface WebVideoCategory {
  value: string;
  label: { en: string; ar: string };
  retired: boolean;
}

export const FALLBACK_CATEGORIES: WebVideoCategory[] = VIDEO_CATEGORIES.map((c) => ({
  value: c.value,
  label: { en: c.label.en, ar: c.label.ar },
  retired: false,
}));

export const CATEGORY_REFRESH_MS = 60_000;

let current: WebVideoCategory[] = FALLBACK_CATEGORIES;
let inflight: Promise<WebVideoCategory[]> | null = null;
let lastFetch = 0;
const listeners = new Set<(list: WebVideoCategory[]) => void>();

export function getCachedCategories(): WebVideoCategory[] {
  return current;
}

export function subscribeCategories(listener: (list: WebVideoCategory[]) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function parse(body: unknown): WebVideoCategory[] | null {
  const list = (body as { result?: { categories?: unknown } } | null)?.result?.categories;
  if (!Array.isArray(list)) return null;
  const out = list.flatMap((c): WebVideoCategory[] => {
    const v = c as { value?: unknown; label?: { en?: unknown; ar?: unknown }; retired?: unknown };
    if (typeof v.value !== 'string' || typeof v.label?.en !== 'string' || typeof v.label?.ar !== 'string') return [];
    return [{ value: v.value, label: { en: v.label.en, ar: v.label.ar }, retired: v.retired === true }];
  });
  return out.length ? out : null;
}

/** The live list (cached for a minute; the last good list or the built-in one when it cannot be read). */
export function loadCategories(now = Date.now(), fetchImpl?: typeof fetch): Promise<WebVideoCategory[]> {
  if (inflight) return inflight;
  const doFetch = fetchImpl ?? (typeof fetch === 'function' ? fetch : null);
  if (!doFetch) return Promise.resolve(current);
  if (lastFetch && now - lastFetch < CATEGORY_REFRESH_MS) return Promise.resolve(current);
  lastFetch = now;
  inflight = (async () => {
    try {
      const res = await doFetch(`${getApiUrl()}/api/categories`);
      const list = res.ok ? parse(await res.json()) : null;
      if (list) {
        current = list;
        for (const listener of listeners) listener(list);
      } else {
        logger.warn('Video categories not read; keeping the current list', { status: res.status });
      }
    } catch (error) {
      logger.warn('Video categories not read; keeping the current list', { error: error instanceof Error ? error.message : String(error) });
    } finally {
      inflight = null;
    }
    return current;
  })();
  return inflight;
}

/** Tests: back to the built-in list. */
export function resetCategoriesForTests(): void {
  current = FALLBACK_CATEGORIES;
  inflight = null;
  lastFetch = 0;
  listeners.clear();
}

/** A category's label in a language (retired ones keep theirs); null when the value is unknown. */
export function categoryLabelIn(list: readonly WebVideoCategory[], value: string | null | undefined, lang: string): string | null {
  if (!value) return null;
  const found = list.find((c) => c.value === value);
  if (!found) return null;
  return lang === 'ar' ? found.label.ar : found.label.en;
}

/**
 * The options a picker shows: the active categories, plus the current value
 * when it is a retired (or not yet listed) category, so editing other fields keeps it.
 */
export function pickerCategories(list: readonly WebVideoCategory[], current?: string | null): WebVideoCategory[] {
  const active = list.filter((c) => !c.retired);
  if (!current || active.some((c) => c.value === current)) return active;
  const kept = list.find((c) => c.value === current) ?? { value: current, label: { en: current.replace(/_/g, ' '), ar: current.replace(/_/g, ' ') }, retired: true };
  return [...active, kept];
}

/** A category value's shape (any admin-made category; the server checks it exists). */
export function isCategorySlug(value: unknown): value is string {
  return typeof value === 'string' && CATEGORY_SLUG_PATTERN.test(value);
}
