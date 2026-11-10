'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import type { VideoObject } from '@/interfaces';
import VideoCardLTR from '@/components/videoCard/index';
import VideoCardRTL from '@/components/videoCard/rtl/index';
import { fetchVideosWithPagination } from '@/lib/api/videos';
import { useLanguage } from '@/hooks/useLanguage';
import { logger } from '@/lib/logger-client';

/**
 * GET /api/videos returns a top-level `cursor`; the typed client also allows
 * `pagination.nextCursor`. Accept either, '' / missing means no more pages.
 */
export function getNextVideosCursor(page: unknown): string | null {
  if (!page || typeof page !== 'object') return null;
  const body = page as { cursor?: string; pagination?: { nextCursor?: string; cursor?: string; hasMore?: boolean } };
  if (body.cursor) return body.cursor;
  if (body.pagination?.nextCursor) return body.pagination.nextCursor;
  if (body.pagination?.hasMore && body.pagination.cursor) return body.pagination.cursor;
  return null;
}

export function VideosPageClient() {
  const { t, isRTL, dir } = useLanguage();
  const [videos, setVideos] = useState<VideoObject[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const hasInitialFetch = useRef(false);

  const VideoCard = isRTL ? VideoCardRTL : VideoCardLTR;

  const loadPage = useCallback(async (cursor: string | null) => {
    setLoading(true);
    setError(false);
    logger.debug('VideosPage: Fetching videos', { cursor: cursor || 'initial' });
    try {
      const page = await fetchVideosWithPagination(cursor);
      if (!page) {
        logger.error('VideosPage: Empty response from videos API', { cursor });
        setError(true);
        return;
      }
      const pageVideos: VideoObject[] = page.data ?? [];
      setVideos((prev) => {
        const seen = new Set(prev.map((v) => v.id));
        return [...prev, ...pageVideos.filter((v) => !seen.has(v.id))];
      });
      setNextCursor(getNextVideosCursor(page));
      logger.debug('VideosPage: Videos loaded', { count: pageVideos.length });
    } catch (err) {
      logger.error('VideosPage: Failed to fetch videos', { error: err });
      setError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (hasInitialFetch.current) return;
    hasInitialFetch.current = true;
    loadPage(null);
  }, [loadPage]);

  return (
    <main dir={dir} className="min-h-screen bg-white dark:bg-gray-900">
      <div className="max-w-7xl mx-auto px-4 py-8 space-y-6">
        <header>
          <h1 className="text-2xl md:text-3xl font-bold text-gray-900 dark:text-white">
            {t.discovery.allVideos}
          </h1>
          <p className="text-gray-600 dark:text-gray-400 mt-1">{t.discovery.allVideosDescription}</p>
        </header>

        {error && videos.length === 0 ? (
          <div className="text-center py-12" role="alert">
            <p className="text-red-600 dark:text-red-400 mb-4">{t.discovery.loadFailed}</p>
            <button
              type="button"
              onClick={() => loadPage(null)}
              className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white"
            >
              {t.common.retry}
            </button>
          </div>
        ) : loading && videos.length === 0 ? (
          <p className="text-gray-500 dark:text-gray-400" role="status">{t.common.loading}</p>
        ) : videos.length === 0 ? (
          <div className="text-center py-12" role="status">
            <h2 className="text-lg font-medium text-gray-900 dark:text-white mb-2">{t.discovery.noVideos}</h2>
            <p className="text-gray-600 dark:text-gray-400">{t.discovery.noVideosDescription}</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4 gap-4">
            {videos.map((video) => (
              <VideoCard key={video.id} {...video} />
            ))}
          </div>
        )}

        {nextCursor && videos.length > 0 && (
          <div className="flex justify-center">
            <button
              type="button"
              onClick={() => loadPage(nextCursor)}
              disabled={loading}
              className="px-4 py-2 rounded-lg bg-gray-700 hover:bg-gray-800 text-white disabled:opacity-50"
            >
              {loading ? t.common.loading : t.common.loadMore || t.common.viewAll}
            </button>
          </div>
        )}
      </div>
    </main>
  );
}
