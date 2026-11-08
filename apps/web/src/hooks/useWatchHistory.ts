'use client';

import { useCallback, useEffect, useState } from 'react';
import { logger } from '@/lib/logger-client';
import { WatchHistoryService, WatchHistoryItem } from '@/services/api/watch-history';

const PAGE_SIZE = 20;

export type WatchHistoryError = 'load' | 'remove' | 'clear' | 'pause' | null;

export interface UseWatchHistoryReturn {
  entries: WatchHistoryItem[];
  total: number;
  isLoading: boolean;
  isLoadingMore: boolean;
  isClearing: boolean;
  hasMore: boolean;
  error: WatchHistoryError;
  reload: () => Promise<void>;
  loadMore: () => Promise<void>;
  remove: (videoId: string) => Promise<void>;
  clearAll: () => Promise<void>;
  /** Recording paused for this account (null until loaded). */
  paused: boolean | null;
  isTogglingPause: boolean;
  togglePause: () => Promise<void>;
}

/**
 * Paginated watch history of the active account with remove/clear actions.
 */
export function useWatchHistory(enabled: boolean): UseWatchHistoryReturn {
  const [entries, setEntries] = useState<WatchHistoryItem[]>([]);
  const [total, setTotal] = useState(0);
  const [cursor, setCursor] = useState<string | undefined>(undefined);
  const [hasMore, setHasMore] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [isClearing, setIsClearing] = useState(false);
  const [error, setError] = useState<WatchHistoryError>(null);
  const [paused, setPaused] = useState<boolean | null>(null);
  const [isTogglingPause, setIsTogglingPause] = useState(false);

  const reload = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    const page = await WatchHistoryService.list({ limit: PAGE_SIZE });
    if (!page) {
      setError('load');
    } else {
      setEntries(page.entries || []);
      setTotal(page.total || 0);
      setCursor(page.cursor);
      setHasMore(!!page.hasMore);
      logger.debug('[useWatchHistory] Loaded history', { count: page.entries?.length, total: page.total });
    }
    setIsLoading(false);
  }, []);

  const loadMore = useCallback(async () => {
    if (!hasMore || !cursor) return;
    setIsLoadingMore(true);
    const page = await WatchHistoryService.list({ limit: PAGE_SIZE, cursor });
    if (!page) {
      setError('load');
    } else {
      setEntries((prev) => {
        const seen = new Set(prev.map((e) => e.videoId));
        return [...prev, ...(page.entries || []).filter((e) => !seen.has(e.videoId))];
      });
      setTotal(page.total || 0);
      setCursor(page.cursor);
      setHasMore(!!page.hasMore);
    }
    setIsLoadingMore(false);
  }, [cursor, hasMore]);

  const remove = useCallback(async (videoId: string) => {
    setError(null);
    const previous = entries;
    setEntries((prev) => prev.filter((e) => e.videoId !== videoId));
    setTotal((n) => Math.max(0, n - 1));
    const ok = await WatchHistoryService.remove(videoId);
    if (!ok) {
      setEntries(previous);
      setTotal((n) => n + 1);
      setError('remove');
    }
  }, [entries]);

  const clearAll = useCallback(async () => {
    setError(null);
    setIsClearing(true);
    const ok = await WatchHistoryService.clearAll();
    if (ok) {
      setEntries([]);
      setTotal(0);
      setCursor(undefined);
      setHasMore(false);
    } else {
      setError('clear');
    }
    setIsClearing(false);
  }, []);

  const togglePause = useCallback(async () => {
    if (paused === null) return;
    setError(null);
    setIsTogglingPause(true);
    const stored = await WatchHistoryService.setPaused(!paused);
    if (stored === null) {
      setError('pause');
    } else {
      setPaused(stored);
    }
    setIsTogglingPause(false);
  }, [paused]);

  useEffect(() => {
    if (enabled) {
      reload();
      void WatchHistoryService.getPaused().then(setPaused);
    }
  }, [enabled, reload]);

  return {
    entries, total, isLoading, isLoadingMore, isClearing, hasMore, error, reload, loadMore, remove, clearAll,
    paused, isTogglingPause, togglePause,
  };
}
