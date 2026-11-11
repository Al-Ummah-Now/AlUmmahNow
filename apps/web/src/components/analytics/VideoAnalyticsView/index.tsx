'use client';

/**
 * Per-video analytics (#241): one owned video's totals, watch time and average
 * view duration from GET /api/analytics/videos/:id. Loading and error states
 * (with retry); the API answers null for a missing or someone else's video.
 */

import React, { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { getVideoAnalytics } from '@/lib/api/analytics';
import type { VideoAnalyticsData } from '@/lib/api/types';
import { useLanguage } from '@/hooks/useLanguage';
import { logger } from '@/lib/logger-client';
import AnalyticsCard from '../AnalyticsCard';
import AnalyticsCardRTL from '../AnalyticsCard/rtl';

/** 75 → "1:15", 3725 → "1:02:05" */
export function formatDuration(seconds: number): string {
  const total = Math.max(0, Math.round(Number.isFinite(seconds) ? seconds : 0));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

type State = { status: 'loading' } | { status: 'error' } | { status: 'ready'; data: VideoAnalyticsData };

export function VideoAnalyticsView({ videoId }: { videoId: string }) {
  const { t, lang, isRTL } = useLanguage();
  const d = t.analytics.dashboard;
  const locale = lang === 'ar' ? 'ar' : 'en-US';
  const fmt = (n: number) => (Number.isFinite(n) ? n : 0).toLocaleString(locale);
  const Card = isRTL ? AnalyticsCardRTL : AnalyticsCard;
  const [state, setState] = useState<State>({ status: 'loading' });

  const load = useCallback(async () => {
    setState({ status: 'loading' });
    try {
      const data = await getVideoAnalytics(videoId);
      setState(data ? { status: 'ready', data } : { status: 'error' });
    } catch (error) {
      logger.error('[VideoAnalyticsView] Failed to load video analytics', { videoId, error });
      setState({ status: 'error' });
    }
  }, [videoId]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="container mx-auto px-4 py-8" dir={isRTL ? 'rtl' : 'ltr'} data-testid="video-analytics">
      <Link href={`/${lang}/studio/go/analytics`} className="text-sm font-medium text-blue-700 hover:underline dark:text-blue-300">
        {isRTL ? '→' : '←'} {d.backToAnalytics}
      </Link>

      {state.status === 'loading' && (
        <div role="status" className="py-16 text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500 mx-auto mb-4" aria-hidden="true" />
          <p className="text-gray-600 dark:text-gray-300">{t.common.loading}</p>
        </div>
      )}

      {state.status === 'error' && (
        <div role="alert" className="py-16 text-center">
          <h1 className="text-2xl font-bold text-gray-800 dark:text-white mb-2">{d.videoAnalytics}</h1>
          <p className="text-gray-600 dark:text-gray-300 mb-4">{d.videoLoadError}</p>
          <button type="button" onClick={() => void load()} className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg">
            {d.retry}
          </button>
        </div>
      )}

      {state.status === 'ready' && (
        <>
          <header className="mt-4 mb-8">
            <p className="text-sm text-gray-500 dark:text-gray-400">{d.videoAnalytics}</p>
            <h1 className="text-3xl font-bold text-gray-800 dark:text-white">{state.data.title}</h1>
            {state.data.dateCreated && (
              <p className="text-sm text-gray-600 dark:text-gray-300">
                {d.published.replace('{date}', new Date(state.data.dateCreated).toLocaleDateString(locale))}
              </p>
            )}
          </header>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            <Card title={t.analytics.views} value={fmt(state.data.views)} icon="eye" />
            <Card title={d.watchTimeTotal} value={d.hoursValue.replace('{hours}', (Math.round((state.data.watchTime / 3600) * 10) / 10).toLocaleString(locale))} icon="clock" />
            <Card title={d.avgViewDuration} value={formatDuration(state.data.avgViewDuration)} icon="clock" />
            <Card title={d.likes} value={fmt(state.data.likes)} icon="heart" />
            <Card title={d.comments} value={fmt(state.data.comments)} icon="message" />
            <Card title={d.overallEngagementRate} value={`${(state.data.engagementRate || 0).toFixed(1)}%`} icon="trending" />
          </div>
          <p className="mt-8 text-sm text-gray-500 dark:text-gray-400">{d.retentionComingSoon}</p>
        </>
      )}
    </div>
  );
}

export default VideoAnalyticsView;
