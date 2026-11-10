'use client';

/**
 * Explore page data (Story 29.7): trending by content language (with a
 * "popular this month" fallback when nothing is trending), categories,
 * new channels and seasonal rails from /api/explore, live now via useLiveStreams.
 */

import { useCallback, useEffect, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import type { ExploreResponse, VideoObject } from '@al-ummah/shared-types';
import { getExploreData, searchContent } from '@/lib/api/search';
import { getTrendingVideos } from '@/lib/api/videos';
import { searchVideoToVideoObject } from '@/lib/search/mappers';
import { logger } from '@/lib/logger-client';

export const EXPLORE_LANGUAGES = ['en', 'ar'] as const;
export type ExploreLanguage = (typeof EXPLORE_LANGUAGES)[number];

type Load<T> = { status: 'loading' } | { status: 'error' } | { status: 'ready'; data: T };

export interface TrendingData {
  videos: VideoObject[];
  fallback: boolean;
}

export function useExplore() {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const raw = params?.get('language');
  const language = (EXPLORE_LANGUAGES as ReadonlyArray<string>).includes(raw ?? '') ? (raw as ExploreLanguage) : undefined;

  const [trending, setTrending] = useState<Load<TrendingData>>({ status: 'loading' });
  const [explore, setExplore] = useState<Load<ExploreResponse>>({ status: 'loading' });

  const loadTrending = useCallback(async () => {
    setTrending({ status: 'loading' });
    try {
      const videos = await getTrendingVideos('week', undefined, 12, language);
      if (videos.length > 0) {
        setTrending({ status: 'ready', data: { videos, fallback: false } });
        return;
      }
      const popular = await searchContent({ type: 'video', sort: 'popular', date: 'month', language, limit: 12 });
      const fallbackVideos = popular.ok
        ? popular.data.results.flatMap(item => (item.type === 'video' ? [searchVideoToVideoObject(item.video, item.channel?.name)] : []))
        : [];
      setTrending({ status: 'ready', data: { videos: fallbackVideos, fallback: true } });
    } catch (error) {
      logger.warn('[Explore] Trending failed', { error, language });
      setTrending({ status: 'error' });
    }
  }, [language]);

  const loadExplore = useCallback(async () => {
    setExplore({ status: 'loading' });
    const data = await getExploreData(language);
    if (!data) {
      setExplore({ status: 'error' });
      return;
    }
    setExplore({ status: 'ready', data });
    logger.debug('[Explore] Explore data loaded', { language, seasonal: data.seasonal.length });
  }, [language]);

  useEffect(() => {
    loadTrending();
    loadExplore();
  }, [loadTrending, loadExplore]);

  const setLanguage = useCallback((next?: ExploreLanguage) => {
    const query = new URLSearchParams(params?.toString() ?? '');
    if (next) query.set('language', next);
    else query.delete('language');
    const qs = query.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }, [params, pathname, router]);

  return { language, setLanguage, trending, explore, retryTrending: loadTrending, retryExplore: loadExplore };
}

export type ExploreModel = ReturnType<typeof useExplore>;
