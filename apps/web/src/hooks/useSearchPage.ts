'use client';

/**
 * State and data for the search page (Story 29.8): URL-driven query/filters,
 * index-backed results with cursor paging, and private on-device history.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import type { SearchResultItem } from '@al-ummah/shared-types';
import { searchContent } from '@/lib/api/search';
import {
  SearchHistoryEntry,
  addSearchHistory,
  clearSearchHistory,
  getSearchHistory,
  removeSearchHistoryEntry,
  subscribeSearchHistory,
} from '@/lib/search/history';
import {
  SearchFilterKey,
  SearchUrlState,
  canSearch,
  normalizeState,
  parseSearchParams,
  toSearchParams,
  toSearchQuery,
  withoutFilter,
} from '@/lib/search/url-state';
import { logger } from '@/lib/logger-client';

export type SearchStatus = 'idle' | 'loading' | 'done' | 'error';

const PAGE_SIZE = 20;

export function useSearchPage() {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const paramsKey = params?.toString() ?? '';
  const state = useMemo(() => parseSearchParams(new URLSearchParams(paramsKey)), [paramsKey]);

  const [draft, setDraft] = useState(state.q);
  const [results, setResults] = useState<SearchResultItem[]>([]);
  const [status, setStatus] = useState<SearchStatus>('idle');
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [relaxed, setRelaxed] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [history, setHistory] = useState<SearchHistoryEntry[]>([]);
  const requestId = useRef(0);

  useEffect(() => setDraft(state.q), [state.q]);

  useEffect(() => {
    let active = true;
    getSearchHistory().then(entries => {
      if (active) setHistory(entries);
    });
    const unsubscribe = subscribeSearchHistory(setHistory);
    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  const runSearch = useCallback(async (current: SearchUrlState) => {
    const id = ++requestId.current;
    setStatus('loading');
    setRelaxed(false);
    const response = await searchContent(toSearchQuery(current, null, PAGE_SIZE));
    if (id !== requestId.current) return;
    if (!response.ok) {
      logger.warn('[SearchPage] Search failed', { status: response.status });
      setResults([]);
      setNextCursor(null);
      setStatus('error');
      return;
    }
    setResults(response.data.results);
    setNextCursor(response.data.nextCursor);
    setRelaxed(response.data.relaxed);
    setStatus('done');
    logger.info('[SearchPage] Results shown', { count: response.data.results.length, type: response.data.type });
  }, []);

  useEffect(() => {
    if (canSearch(state)) {
      runSearch(state);
    } else {
      requestId.current++;
      setResults([]);
      setNextCursor(null);
      setStatus('idle');
    }
  }, [state, runSearch]);

  const navigate = useCallback((next: SearchUrlState) => {
    const query = toSearchParams(normalizeState(next)).toString();
    router.push(query ? `${pathname}?${query}` : pathname, { scroll: false });
  }, [pathname, router]);

  const submit = useCallback((query?: string) => {
    const q = (query ?? draft).trim();
    setDraft(q);
    if (q) addSearchHistory(q).catch(error => logger.warn('[SearchPage] Could not save history', { error }));
    if (q === state.q && canSearch(state)) {
      runSearch(state);
      return;
    }
    navigate({ ...state, q });
  }, [draft, navigate, runSearch, state]);

  const update = useCallback((patch: Partial<SearchUrlState>) => navigate({ ...state, ...patch }), [navigate, state]);
  const removeFilter = useCallback((key: SearchFilterKey) => navigate(withoutFilter(state, key)), [navigate, state]);
  const clearFilters = useCallback(() => navigate({ q: state.q, verified: false, sort: 'relevance' }), [navigate, state.q]);

  const loadMore = useCallback(async () => {
    if (!nextCursor || loadingMore) return;
    const id = requestId.current;
    setLoadingMore(true);
    const response = await searchContent(toSearchQuery(state, nextCursor, PAGE_SIZE));
    setLoadingMore(false);
    if (id !== requestId.current) return;
    if (!response.ok) {
      logger.warn('[SearchPage] Load more failed', { status: response.status });
      return;
    }
    setResults(prev => {
      const seen = new Set(prev.map(r => `${r.type}:${r.id}`));
      return [...prev, ...response.data.results.filter(r => !seen.has(`${r.type}:${r.id}`))];
    });
    setNextCursor(response.data.nextCursor);
  }, [loadingMore, nextCursor, state]);

  const channelName = useMemo(() => {
    if (!state.channelId) return undefined;
    for (const item of results) {
      if (item.type === 'channel' && item.id === state.channelId) return item.channel.name;
      if (item.type !== 'channel' && item.channel?.id === state.channelId && item.channel.name) return item.channel.name;
    }
    return undefined;
  }, [results, state.channelId]);

  return {
    state,
    draft,
    setDraft,
    results,
    status,
    relaxed,
    hasMore: !!nextCursor,
    loadingMore,
    channelName,
    history,
    submit,
    update,
    removeFilter,
    clearFilters,
    loadMore,
    retry: () => runSearch(state),
    removeHistoryEntry: (query: string) => removeSearchHistoryEntry(query),
    clearHistory: () => clearSearchHistory(),
  };
}

export type SearchPageModel = ReturnType<typeof useSearchPage>;
