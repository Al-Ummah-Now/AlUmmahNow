'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { logger } from '@/lib/logger-client';
import { WatchHistoryService, WatchHistoryItem } from '@/services/api/watch-history';

const PAGE_SIZE = 20;

/** How long a removed entry can be brought back (the undo toast) before it is deleted for good */
export const UNDO_MS = 6000;

export type WatchHistoryError = 'load' | 'remove' | 'clear' | 'pause' | null;

export interface UseWatchHistoryReturn {
  entries: WatchHistoryItem[];
  total: number;
  isLoading: boolean;
  isLoadingMore: boolean;
  isClearing: boolean;
  hasMore: boolean;
  error: WatchHistoryError;
  /** With a search: how many of the newest entries it covered (the API searches at most 200) */
  searched: number | null;
  reload: () => Promise<void>;
  loadMore: () => Promise<void>;
  /** Hides the entry at once and deletes it once the undo time is over (or the page is left) */
  remove: (videoId: string) => void;
  /** The entry removed last, while it can still be brought back */
  lastRemoved: WatchHistoryItem | null;
  /** Brings the last removed entry back to its place; nothing is deleted */
  undoRemove: () => void;
  clearAll: () => Promise<void>;
  /** Recording paused for this account (null until loaded). */
  paused: boolean | null;
  isTogglingPause: boolean;
  togglePause: () => Promise<void>;
}

export interface UseWatchHistoryOptions {
  /** false: only started, unfinished videos (the Continue watching view); omitted: everything */
  completed?: boolean;
  /** Search: entries whose title (any language) or channel name holds every word */
  q?: string;
}

interface Pending {
  entry: WatchHistoryItem;
  index: number;
  timer: ReturnType<typeof setTimeout>;
}

/**
 * Paginated watch history of the active account with remove (undoable), clear and pause.
 */
export function useWatchHistory(enabled: boolean, options: UseWatchHistoryOptions = {}): UseWatchHistoryReturn {
  const { completed } = options;
  const q = options.q?.trim() || undefined;
  const [entries, setEntries] = useState<WatchHistoryItem[]>([]);
  const [total, setTotal] = useState(0);
  const [cursor, setCursor] = useState<string | undefined>(undefined);
  const [hasMore, setHasMore] = useState(false);
  const [searched, setSearched] = useState<number | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [isClearing, setIsClearing] = useState(false);
  const [error, setError] = useState<WatchHistoryError>(null);
  const [paused, setPaused] = useState<boolean | null>(null);
  const [isTogglingPause, setIsTogglingPause] = useState(false);
  const [lastRemoved, setLastRemoved] = useState<WatchHistoryItem | null>(null);
  const pending = useRef(new Map<string, Pending>());

  const params = useCallback((extra: { cursor?: string } = {}) => ({ limit: PAGE_SIZE, ...extra, completed, ...(q ? { q } : {}) }), [completed, q]);

  const reload = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    const page = await WatchHistoryService.list(params());
    if (!page) {
      setError('load');
    } else {
      const hidden = pending.current;
      setEntries((page.entries || []).filter((e) => !hidden.has(e.videoId)));
      setTotal(Math.max(0, (page.total || 0) - hidden.size));
      setCursor(page.cursor);
      setHasMore(!!page.hasMore);
      setSearched(typeof page.searched === 'number' ? page.searched : null);
      logger.debug('[useWatchHistory] Loaded history', { count: page.entries?.length, total: page.total, completed, searching: !!q });
    }
    setIsLoading(false);
  }, [params, completed, q]);

  const loadMore = useCallback(async () => {
    if (!hasMore || !cursor) return;
    setIsLoadingMore(true);
    const page = await WatchHistoryService.list(params({ cursor }));
    if (!page) {
      setError('load');
    } else {
      setEntries((prev) => {
        const seen = new Set(prev.map((e) => e.videoId));
        return [...prev, ...(page.entries || []).filter((e) => !seen.has(e.videoId) && !pending.current.has(e.videoId))];
      });
      setTotal(Math.max(0, (page.total || 0) - pending.current.size));
      setCursor(page.cursor);
      setHasMore(!!page.hasMore);
    }
    setIsLoadingMore(false);
  }, [cursor, hasMore, params]);

  /** Deletes a removed entry for good; a failed delete brings it back with an error */
  const commit = useCallback(async (videoId: string) => {
    const item = pending.current.get(videoId);
    if (!item) return;
    clearTimeout(item.timer);
    pending.current.delete(videoId);
    setLastRemoved((current) => (current?.videoId === videoId ? null : current));
    const ok = await WatchHistoryService.remove(videoId);
    if (!ok) {
      logger.warn('[useWatchHistory] Remove failed; the entry is back', { videoId });
      setEntries((prev) => (prev.some((e) => e.videoId === videoId) ? prev : insertAt(prev, item.entry, item.index)));
      setTotal((n) => n + 1);
      setError('remove');
    }
  }, []);

  const remove = useCallback((videoId: string) => {
    setError(null);
    setEntries((prev) => {
      const index = prev.findIndex((e) => e.videoId === videoId);
      if (index < 0) return prev;
      const entry = prev[index];
      const existing = pending.current.get(videoId);
      if (existing) clearTimeout(existing.timer);
      pending.current.set(videoId, { entry, index, timer: setTimeout(() => void commit(videoId), UNDO_MS) });
      setLastRemoved(entry);
      return prev.filter((e) => e.videoId !== videoId);
    });
    setTotal((n) => Math.max(0, n - 1));
  }, [commit]);

  const undoRemove = useCallback(() => {
    setLastRemoved((entry) => {
      if (!entry) return null;
      const item = pending.current.get(entry.videoId);
      if (item) {
        clearTimeout(item.timer);
        pending.current.delete(entry.videoId);
        setEntries((prev) => insertAt(prev, item.entry, item.index));
        setTotal((n) => n + 1);
      }
      return null;
    });
  }, []);

  // Leaving the page (or this view) deletes what is still waiting: undo is only offered while it is shown
  useEffect(() => {
    const flush = () => {
      for (const videoId of [...pending.current.keys()]) void commit(videoId);
    };
    window.addEventListener('pagehide', flush);
    return () => {
      window.removeEventListener('pagehide', flush);
      flush();
    };
  }, [commit]);

  const clearAll = useCallback(async () => {
    setError(null);
    setIsClearing(true);
    const ok = await WatchHistoryService.clearAll();
    if (ok) {
      for (const item of pending.current.values()) clearTimeout(item.timer);
      pending.current.clear();
      setLastRemoved(null);
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
    if (enabled) void reload();
  }, [enabled, reload]);

  useEffect(() => {
    if (enabled) void WatchHistoryService.getPaused().then(setPaused);
  }, [enabled]);

  return {
    entries, total, isLoading, isLoadingMore, isClearing, hasMore, error, searched, reload, loadMore,
    remove, lastRemoved, undoRemove, clearAll, paused, isTogglingPause, togglePause,
  };
}

function insertAt(list: WatchHistoryItem[], entry: WatchHistoryItem, index: number): WatchHistoryItem[] {
  const next = [...list];
  next.splice(Math.min(Math.max(index, 0), next.length), 0, entry);
  return next;
}
