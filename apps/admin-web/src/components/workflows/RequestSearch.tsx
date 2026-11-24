'use client';

import { useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { Autocomplete, type AutocompleteSource } from '@/components/search/Autocomplete';
import type { AutocompleteItem } from '@/components/search/autocomplete-model';
import { useLanguage } from '@/i18n/I18nProvider';
import { translateDynamic } from '@/i18n/translate';
import { suggestWorkflowRequests } from '@/lib/api/workflows';
import { logger } from '@/lib/logger-client';

/**
 * The live search over requests (wiki AUN-WORKFLOWS §10): matches what a request changes, in either
 * language, and opens the chosen request.
 */
export function RequestSearch() {
  const router = useRouter();
  const { t, locale } = useLanguage();
  const source = useCallback<AutocompleteSource>(
    async (q) => {
      const result = await suggestWorkflowRequests(q);
      if (!result.ok) {
        logger.warn('[approvals] Request search failed', { status: result.status, code: result.code });
        throw new Error(`Request search answered ${result.status}`);
      }
      return {
        items: result.data.items.map(
          (r): AutocompleteItem => ({
            // the box's own source: "error" is only the kind it groups the rows under (no icon or link)
            kind: 'error',
            id: r.id,
            label: locale === 'ar' ? r.title.ar : r.title.en,
            secondary: translateDynamic(t, 'workflows.status', r.status),
            imageUrl: null,
          }),
        ),
        next: null,
      };
    },
    [locale, t],
  );
  return (
    <Autocomplete
      kind="error"
      mode="pick"
      label={t('workflows.searchLabel')}
      placeholder={t('workflows.searchPlaceholder')}
      source={source}
      allowIds={false}
      showIds={false}
      initialResults
      messages={{
        noMatches: (query) => t('workflows.searchEmpty', { query }),
        count: (count) => t('workflows.searchCount', { count }),
      }}
      onChange={(id) => {
        if (id) router.push(`/approvals/${encodeURIComponent(id)}`);
      }}
      testId="approvals-search"
    />
  );
}
