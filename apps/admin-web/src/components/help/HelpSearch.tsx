'use client';

/**
 * The admin guide's search (wiki AUN-ADMIN-HELP): the standard live autocomplete over every
 * setting's label, summary and area, in the page's language, searched in the browser (the index
 * is the guide's own text, a few KB). Choosing a setting opens its section; Enter lists matches.
 */
import { useCallback } from 'react';
import { Autocomplete, type AutocompleteSource } from '@/components/search/Autocomplete';
import { useLanguage } from '@/i18n/I18nProvider';
import { matchHelp, type HelpSearchItem } from '@/lib/help/search';

export function HelpSearch({ items, defaultValue }: { items: HelpSearchItem[]; defaultValue?: string }) {
  const { t } = useLanguage();
  const source = useCallback<AutocompleteSource>(
    async (query) => ({
      items: matchHelp(items, query).slice(0, 8).map((i) => ({
        kind: 'help' as const,
        id: i.href,
        label: i.label.replace(/`/g, ''),
        secondary: i.area,
        imageUrl: null,
        meta: i.summary.replace(/`/g, ''),
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
