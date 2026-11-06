'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { listDirectoryChannels } from '@/lib/api/channels';
import { ChannelTileGrid, ChannelTileGridSkeleton } from '@/components/ChannelTile';
import type { ChannelSummary } from '@/components/ChannelSections/sectionData';
import { useLanguage } from '@/hooks/useLanguage';
import { logger } from '@/lib/logger-client';

const PAGE_SIZE = 24;

export function ChannelsPageClient() {
  const { t, dir } = useLanguage();
  const [channels, setChannels] = useState<ChannelSummary[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const hasInitialFetch = useRef(false);

  const loadPage = useCallback(async (cursor: string | null) => {
    setLoading(true);
    setError(false);
    logger.info('ChannelsPage: Fetching channels', { cursor: cursor || 'initial' });
    try {
      const page = await listDirectoryChannels({ limit: PAGE_SIZE, cursor: cursor || undefined });
      if (!page) {
        logger.error('ChannelsPage: Empty response from channels API', { cursor });
        setError(true);
        return;
      }
      setChannels((prev) => {
        const seen = new Set(prev.map((c) => c.id));
        return [...prev, ...page.data.filter((c) => !seen.has(c.id))];
      });
      setNextCursor(page.cursor || null);
      logger.info('ChannelsPage: Channels loaded', { count: page.data.length, hasMore: !!page.cursor });
    } catch (err) {
      logger.error('ChannelsPage: Failed to fetch channels', { error: err });
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
            {t.discovery.allChannels}
          </h1>
          <p className="text-gray-600 dark:text-gray-400 mt-1">{t.discovery.allChannelsDescription}</p>
        </header>

        {error && channels.length === 0 ? (
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
        ) : loading && channels.length === 0 ? (
          <ChannelTileGridSkeleton />
        ) : channels.length === 0 && !nextCursor ? (
          <div className="text-center py-12" role="status">
            <h2 className="text-lg font-medium text-gray-900 dark:text-white mb-2">{t.discovery.noChannels}</h2>
            <p className="text-gray-600 dark:text-gray-400">{t.discovery.noChannelsDescription}</p>
          </div>
        ) : (
          <ChannelTileGrid channels={channels} />
        )}

        {nextCursor && (
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
