'use client';

/**
 * Explore page body (Story 29.7). The LTR/RTL variants pass their own
 * live-stream card so each direction uses its matching card implementation.
 */

import React from 'react';
import type { LiveStream } from '@al-ummah/shared-types';
import { useLanguage } from '@/hooks/useLanguage';
import { useLiveStreams } from '@/hooks/useLiveStreams';
import { EXPLORE_LANGUAGES, ExploreModel } from '@/hooks/useExplore';
import {
  CategoryGrid,
  LiveNowSection,
  NewChannelsSection,
  RailSkeleton,
  SeasonalSection,
  SectionError,
  TrendingSection,
} from './ExploreSections';

export function ExploreBody({ model, renderLiveCard }: { model: ExploreModel; renderLiveCard: (stream: LiveStream) => React.ReactNode }) {
  const { t } = useLanguage();
  const live = useLiveStreams({ status: 'live', limit: 8 });
  const { trending, explore, language } = model;
  const languageName = (code: string) => (code === 'ar' ? t.explore.arabic : t.explore.english);

  return (
    <main className="flex w-full flex-col gap-10 p-4 md:p-6" data-testid="explore-page">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">{t.explore.title}</h1>
          <p className="mt-1 text-gray-600 dark:text-gray-300">{t.explore.subtitle}</p>
        </div>
        <div role="group" aria-label={t.explore.contentLanguage} className="flex gap-2" data-testid="explore-language">
          {[undefined, ...EXPLORE_LANGUAGES].map(code => {
            const selected = language === code;
            return (
              <button
                key={code ?? 'all'}
                type="button"
                aria-pressed={selected}
                data-testid={`explore-language-${code ?? 'all'}`}
                onClick={() => model.setLanguage(code)}
                className={`h-9 rounded-full border px-3 text-sm font-medium focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${selected
                  ? 'border-gray-900 bg-gray-900 text-white dark:border-white dark:bg-white dark:text-gray-900'
                  : 'border-gray-300 bg-white text-gray-800 hover:bg-gray-100 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-100 dark:hover:bg-gray-800'}`}
              >
                {code ? languageName(code) : t.explore.allLanguages}
              </button>
            );
          })}
        </div>
      </header>

      {explore.status === 'ready' && explore.data.seasonal.map(rail => <SeasonalSection key={rail.id} rail={rail} />)}

      {trending.status === 'loading' && <RailSkeleton />}
      {trending.status === 'error' && <SectionError onRetry={model.retryTrending} />}
      {trending.status === 'ready' && <TrendingSection videos={trending.data.videos} fallback={trending.data.fallback} />}

      {explore.status === 'loading' && <RailSkeleton />}
      {explore.status === 'error' && <SectionError onRetry={model.retryExplore} />}
      {explore.status === 'ready' && <CategoryGrid categories={explore.data.categories} />}

      <LiveNowSection
        streams={live.streams}
        loading={live.isLoading}
        error={live.isError}
        onRetry={() => live.refetch()}
        renderCard={renderLiveCard}
      />

      {explore.status === 'ready' && <NewChannelsSection channels={explore.data.newChannels} />}
    </main>
  );
}
