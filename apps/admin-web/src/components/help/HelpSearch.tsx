'use client';

/**
 * The admin guide's search (wiki AUN-ADMIN-HELP): the standard live autocomplete over every
 * setting's label, summary and area, in the page's language, searched in the browser (the index
 * is the guide's own text, a few KB). Choosing a setting opens its section; Enter lists matches.
 */
import { useCallback } from 'react';
import { Autocomplete, type AutocompleteSource } from '@/components/search/Autocomplete';
import { useLanguage } from '@/i18n/I18nProvider';

export interface HelpSearchItem {
  href: string;
  label: string;
  area: string;
  summary: string;
}

/** Folds case and Arabic letter forms so «اعداد» finds «إعداد». */
export function fold(text: string): string {
  return text
    .toLocaleLowerCase()
    .normalize('NFKD')
    .replace(/[ً-ْٰـ]/g, '')
    .replace(/[إأآٱ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه')
    .replace(/\p{M}/gu, '');
}

export function matchHelp(items: readonly HelpSearchItem[], query: string): HelpSearchItem[] {
  const words = fold(query).split(/\s+/).filter(Boolean);
  if (!words.length) return [...items];
  const scored = items
    .map((item) => {
      const label = fold(item.label);
      const rest = fold(`${item.area} ${item.summary}`);
      if (!words.every((w) => label.includes(w) || rest.includes(w))) return null;
      return { item, score: words.filter((w) => label.includes(w)).length };
    })
    .filter((x): x is { item: HelpSearchItem; score: number } => x !== null);
  return scored.sort((a, b) => b.score - a.score).map((x) => x.item);
}

export function HelpSearch({ items, defaultValue }: { items: HelpSearchItem[]; defaultValue?: string }) {
  const { t } = useLanguage();
  const source = useCallback<AutocompleteSource>(
    async (query) => ({
      items: matchHelp(items, query).slice(0, 8).map((i) => ({
        kind: 'help' as const,
        id: i.href,
        label: i.label,
        secondary: i.area,
        imageUrl: null,
        meta: i.summary,
      })),
      next: null,
    }),
    [items],
  );
  return (
    <form action="/help" method="get" role="search" className="max-w-2xl">
      <Autocomplete
        kind="help"
        mode="search"
        name="q"
        label={t('adminHelp.searchLabel')}
        placeholder={t('adminHelp.searchPlaceholder')}
        defaultValue={defaultValue}
        source={source}
        showIds={false}
        testId="help-search"
        messages={{
          count: (count) => t('adminHelp.matches', { count }),
          noMatches: (query) => t('adminHelp.noMatches', { query }),
        }}
      />
    </form>
  );
}
