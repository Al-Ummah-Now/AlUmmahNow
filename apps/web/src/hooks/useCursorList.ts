'use client';

/**
 * One paged list read through an API cursor (`{ data, cursor }`), for the
 * channel tabs (Videos, Shorts, Live, Playlists). The first page loads on
 * mount and whenever `key` changes; `loadMore` appends the next page until the
 * API returns no cursor. Every tab used to read only the first 20 items
 * (2026-11-10: a channel of 51 Shorts showed 20, one of 369 videos showed 22).
 *
 * A failed page keeps what is already shown and offers a retry; an answer for
 * an older `key` (the user switched channel) is dropped.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { logger } from '@/lib/logger-client';

export interface CursorPage<T> {
  data?: T[] | null;
  cursor?: string | null;
}

export type FetchCursorPage<T> = (cursor: string | undefined) => Promise<CursorPage<T> | null>;

export interface CursorListState<T> {
  items: T[];
  /** The first page is loading */
  loading: boolean;
  /** A later page is loading */
  loadingMore: boolean;
  /** More pages exist */
  hasMore: boolean;
  /** The first page failed (nothing to show) */
  failed: boolean;
  /** A later page failed (items stay; retry with loadMore) */
  moreFailed: boolean;
  loadMore: () => void;
  retry: () => void;
}

export function useCursorList<T extends { id?: string }>(key: string, fetchPage: FetchCursorPage<T>, label: string): CursorListState<T> {
  const [items, setItems] = useState<T[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [failed, setFailed] = useState(false);
  const [moreFailed, setMoreFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const generation = useRef(0);
  const fetchRef = useRef(fetchPage);
  fetchRef.current = fetchPage;

  useEffect(() => {
    const mine = ++generation.current;
    setItems([]);
    setCursor(null);
    setLoading(true);
    setFailed(false);
    setMoreFailed(false);
    fetchRef
      .current(undefined)
      .then((page) => {
        if (mine !== generation.current) return;
        setItems(page?.data ?? []);
        setCursor(page?.cursor || null);
      })
      .catch((error) => {
        if (mine !== generation.current) return;
        logger.error(`Failed to load ${label}`, { key, error });
        setFailed(true);
      })
      .finally(() => {
        if (mine === generation.current) setLoading(false);
      });
  }, [key, label, attempt]);

  const loadMore = useCallback(() => {
    if (!cursor || loadingMore) return;
    const mine = generation.current;
    setLoadingMore(true);
    setMoreFailed(false);
    fetchRef
      .current(cursor)
      .then((page) => {
        if (mine !== generation.current) return;
        // A page can overlap the previous one if the list changed meanwhile
        setItems((prev) => {
          const seen = new Set(prev.map((item) => item.id));
          return [...prev, ...(page?.data ?? []).filter((item) => !item.id || !seen.has(item.id))];
        });
        setCursor(page?.cursor || null);
      })
      .catch((error) => {
        if (mine !== generation.current) return;
        logger.warn(`Failed to load more ${label}`, { key, error });
        setMoreFailed(true);
      })
      .finally(() => {
        if (mine === generation.current) setLoadingMore(false);
      });
  }, [cursor, loadingMore, key, label]);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);

  return { items, loading, loadingMore, hasMore: !!cursor, failed, moreFailed, loadMore, retry };
}
