/**
 * The command palette (⌘K / Ctrl+K): pages from the nav and people, channels, videos and more from
 * the admin suggest endpoints, in one list. Pure, so matching and keyboard movement are tested
 * without a browser (test/palette-model.test.ts).
 */
import type { AdminSuggestion, AdminSuggestKind } from '@al-ummah/shared-types';
import { MIN_QUERY } from '@/components/search/autocomplete-model';
import type { NavAccess, NavItem } from './nav-model';

/** Suggestions asked for per kind: enough to recognise the item, few enough to scan. */
export const PER_KIND = 4;
/** Pages shown when nothing is typed. */
export const START_PAGES = 6;

export type PaletteOption =
  | { type: 'page'; id: string; item: NavItem; label: string }
  | { type: 'entity'; id: string; suggestion: AdminSuggestion };

/** Kinds this admin may search, in the order they are shown. */
export function paletteKinds(access: NavAccess): AdminSuggestKind[] {
  const kinds: AdminSuggestKind[] = ['user', 'channel', 'video', 'playlist'];
  if (access.contact) kinds.push('contact');
  if (access.errors) kinds.push('error');
  return kinds;
}

/** Lower-case and strip Arabic diacritics and tatweel, so "تعليقات" finds "التعليقات". */
export function fold(text: string): string {
  return text.toLocaleLowerCase().normalize('NFKD').replace(/[ً-ٰٟـ]/g, '').replace(/\p{M}/gu, '');
}

/**
 * Pages whose label (in the admin's language, or in English) contains every typed word.
 * Nothing typed: the first pages, so the palette is useful as soon as it opens.
 */
export function matchPages(query: string, items: NavItem[], label: (item: NavItem) => string, englishLabel: (item: NavItem) => string): PaletteOption[] {
  const words = fold(query).split(/\s+/).filter(Boolean);
  const pages = items
    .filter((item) => {
      if (!words.length) return true;
      const haystack = `${fold(label(item))} ${fold(englishLabel(item))}`;
      return words.every((w) => haystack.includes(w));
    })
    .map((item): PaletteOption => ({ type: 'page', id: `page-${item.href}`, item, label: label(item) }));
  return words.length ? pages : pages.slice(0, START_PAGES);
}

export const asksForEntities = (query: string): boolean => query.trim().length >= MIN_QUERY;

/** Pages first (they are instant), then each kind's suggestions in kind order. */
export function paletteOptions(pages: PaletteOption[], results: Partial<Record<AdminSuggestKind, AdminSuggestion[]>>, kinds: AdminSuggestKind[]): PaletteOption[] {
  const entities = kinds.flatMap((kind) =>
    (results[kind] ?? []).slice(0, PER_KIND).map((suggestion): PaletteOption => ({ type: 'entity', id: `${kind}-${suggestion.id}`, suggestion })),
  );
  return [...pages, ...entities];
}

/** Arrow keys wrap around; an empty list has no active option. */
export function move(active: number, count: number, step: 1 | -1): number {
  if (count === 0) return -1;
  if (active < 0) return step === 1 ? 0 : count - 1;
  return (active + step + count) % count;
}
