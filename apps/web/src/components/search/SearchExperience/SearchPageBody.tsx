'use client';

/**
 * Search v2 page body (Story 29.8), shared by the LTR and RTL page variants.
 * All spacing uses logical properties (ps/pe/ms/me/start/end) so the same
 * markup mirrors correctly under dir="rtl".
 */

import React, { useState } from 'react';
import { AlertCircle, Search as SearchIcon } from 'lucide-react';
import type { SearchPageModel } from '@/hooks/useSearchPage';
import { useLanguage } from '@/hooks/useLanguage';
import { SearchBar } from './SearchBar';
import { ActiveFilterChips, SearchFilterButton, SearchFilterPanel, SearchTypeChips } from './SearchFilterPanel';
import { SearchResultList, SearchResultSkeleton } from './SearchResultList';

export function SearchPageBody({ model }: { model: SearchPageModel }) {
  const { t } = useLanguage();
  const [filtersOpen, setFiltersOpen] = useState(false);
  const { state, status, results } = model;

  return (
    <main className="flex w-full flex-col gap-4 p-4 md:p-6" data-testid="search-page">
      <h1 className="text-2xl font-bold text-gray-900 dark:text-white sm:hidden">{t.search.searchPageTitle}</h1>

      {/* The header has this box from sm up */}
      <div className="sm:hidden">
      <SearchBar
        value={model.draft}
        onChange={model.setDraft}
        onSubmit={model.submit}
        onSelectCategory={category => model.update({ category, type: state.type ?? 'video' })}
        history={model.history}
        onRemoveHistory={model.removeHistoryEntry}
        onClearHistory={model.clearHistory}
        autoFocus={!state.q}
      />
      </div>

      <div className="flex items-center gap-2 min-w-0">
        <div className="min-w-0 flex-1">
          <SearchTypeChips state={state} onChange={type => model.update({ type })} />
        </div>
        <SearchFilterButton state={state} open={filtersOpen} onOpenChange={setFiltersOpen} />
      </div>

      <SearchFilterPanel
        state={state}
        open={filtersOpen}
        onOpenChange={setFiltersOpen}
        onChange={model.update}
        onClear={() => {
          model.clearFilters();
          setFiltersOpen(false);
        }}
      />

      <ActiveFilterChips state={state} channelName={model.channelName} onRemove={model.removeFilter} />

      <div aria-live="polite" className="sr-only">
        {status === 'loading' ? t.search.searching : status === 'done' ? (results.length === 1 ? t.search.foundOneResult : t.search.foundResults.replace('{count}', String(results.length))) : ''}
      </div>

      {status === 'idle' && (
        <div className="flex flex-col items-center gap-3 py-16 text-center text-gray-500 dark:text-gray-400" data-testid="search-idle">
          <SearchIcon className="h-10 w-10" aria-hidden="true" />
          <p className="max-w-md">{t.search.startSearching}</p>
        </div>
      )}

      {status === 'loading' && <SearchResultSkeleton />}

      {status === 'error' && (
        <div role="alert" className="flex flex-col items-center gap-3 py-12 text-center" data-testid="search-error">
          <AlertCircle className="h-8 w-8 text-red-500" aria-hidden="true" />
          <p className="text-gray-700 dark:text-gray-200">{t.search.searchError}</p>
          <button type="button" onClick={model.retry} className="h-10 rounded-full bg-gray-800 px-5 text-white hover:bg-gray-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500">
            {t.search.retry}
          </button>
        </div>
      )}

      {status === 'done' && (
        <>
          {model.relaxed && (
            <p className="rounded-md bg-amber-50 dark:bg-amber-900/30 px-3 py-2 text-sm text-amber-900 dark:text-amber-100" data-testid="search-relaxed">
              {t.search.relaxedNotice}
            </p>
          )}
          {results.length > 0 ? (
            <>
              <SearchResultList results={results} />
              {model.hasMore && (
                <div className="flex justify-center pt-2">
                  <button
                    type="button"
                    data-testid="search-load-more"
                    onClick={model.loadMore}
                    disabled={model.loadingMore}
                    className="h-11 rounded-full border border-gray-300 dark:border-gray-600 px-6 text-gray-800 dark:text-gray-100 hover:bg-gray-100 dark:hover:bg-gray-800 disabled:opacity-60 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
                  >
                    {model.loadingMore ? t.search.loadingMore : t.search.loadMore}
                  </button>
                </div>
              )}
            </>
          ) : (
            <div className="py-12 text-center" data-testid="search-empty">
              <h2 className="mb-2 text-lg font-semibold text-gray-700 dark:text-gray-200">{t.search.noResultsTitle}</h2>
              <p className="mb-4 text-gray-500 dark:text-gray-400">{t.search.noResultsMessage}</p>
              <button type="button" onClick={model.clearFilters} className="h-10 rounded-full bg-gray-700 px-5 text-white hover:bg-gray-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500">
                {t.search.clearFilters}
              </button>
            </div>
          )}
        </>
      )}
    </main>
  );
}
