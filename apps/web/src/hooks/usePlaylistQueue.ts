'use client';

/**
 * The playing list's queue for the watch page (docs/specs/PLAYLIST-PLAYBACK.md section 3).
 *
 * Pages from GET /api/playlists/{list}/queue are kept per list in memory, so moving to the next
 * video (a new watch page) shows the pane at once and only refreshes the window around it.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchQueue, type QueueItem, type QueuePage, type QueueSummary } from '@/lib/api/playlist-queue';

const PAGE = 50;

interface ListCache {
  summary: QueueSummary;
  total: number;
  exact: boolean;
  items: Map<number, QueueItem>;
}

const cache = new Map<string, ListCache>();

/** The video's position from the loaded pages (the occurrence at `index` when given). */
function cachedPosition(list: string | null, videoId: string, index: number | null): number | null {
  const cached = list ? cache.get(list) : undefined;
  if (!cached) return null;
  let fallback: number | null = null;
  for (const item of cached.items.values()) {
    if (item.id !== videoId) continue;
    if (index === null || item.index === index) return item.position;
    fallback ??= item.position;
  }
  return fallback;
}

function merge(list: string, page: QueuePage): ListCache {
  const prev = cache.get(list);
  // A changed total means the list changed (add, remove, reorder): start over
  const items = prev && prev.total === page.total ? prev.items : new Map<number, QueueItem>();
  for (const item of page.items) items.set(item.position, item);
  const entry = { summary: page.playlist, total: page.total, exact: page.exact, items };
  cache.set(list, entry);
  return entry;
}

export type QueueStatus = 'off' | 'loading' | 'ready' | 'unavailable' | 'error';

export interface PlaylistQueueState {
  status: QueueStatus;
  summary: QueueSummary | null;
  total: number;
  /** Visible position of the playing video, or null when it is not in the list */
  position: number | null;
  /** The next position when the video left the list */
  nextPosition: number | null;
  /** Loaded items in order */
  items: QueueItem[];
  hasEarlier: boolean;
  hasLater: boolean;
  loadEarlier: () => void;
  loadLater: () => void;
  /** The item at a position, loading its page when needed */
  itemAt: (position: number) => Promise<QueueItem | null>;
  retry: () => void;
}

export function usePlaylistQueue(list: string | null, videoId: string, index: number | null): PlaylistQueueState {
  const [status, setStatus] = useState<QueueStatus>(() => (list ? (cache.has(list) ? 'ready' : 'loading') : 'off'));
  const [entry, setEntry] = useState<ListCache | null>(() => (list ? cache.get(list) ?? null : null));
  const [position, setPosition] = useState<number | null>(() => cachedPosition(list, videoId, index));
  const [nextPos, setNextPos] = useState<number | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [, setVersion] = useState(0);
  const listRef = useRef(list);
  listRef.current = list;

  useEffect(() => {
    if (!list) {
      setStatus('off');
      setEntry(null);
      return undefined;
    }
    let cancelled = false;
    if (!cache.has(list)) setStatus('loading');
    // The same page moved to another video: answer from what is loaded until the API confirms
    setPosition(cachedPosition(list, videoId, index));
    setNextPos(null);
    fetchQueue(list, { video: videoId, index, limit: PAGE }).then((result) => {
      if (cancelled) return;
      if (!result.ok) {
        setStatus(result.status === 404 || result.status === 401 ? 'unavailable' : 'error');
        return;
      }
      setEntry(merge(list, result.page));
      setPosition(result.page.position);
      setNextPos(result.page.nextPosition);
      setStatus('ready');
    });
    return () => {
      cancelled = true;
    };
  }, [list, videoId, index, attempt]);

  // A list edited in another tab: refresh the window when the viewer comes back
  useEffect(() => {
    if (!list) return undefined;
    const onVisible = () => {
      if (document.visibilityState === 'visible') setAttempt((a) => a + 1);
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [list]);

  const loadPage = useCallback(async (offset: number): Promise<void> => {
    const current = listRef.current;
    if (!current) return;
    const result = await fetchQueue(current, { offset: Math.max(0, offset), limit: PAGE });
    if (!result.ok || listRef.current !== current) return;
    setEntry(merge(current, result.page));
    setVersion((v) => v + 1);
  }, []);

  const items = entry ? [...entry.items.values()].sort((a, b) => a.position - b.position) : [];
  const first = items[0]?.position ?? 0;
  const last = items.length ? items[items.length - 1].position : -1;

  const itemAt = useCallback(async (pos: number): Promise<QueueItem | null> => {
    const current = listRef.current;
    if (!current) return null;
    const cached = cache.get(current)?.items.get(pos);
    if (cached) return cached;
    await loadPage(pos - Math.floor(PAGE / 2));
    return cache.get(current)?.items.get(pos) ?? null;
  }, [loadPage]);

  return {
    status,
    summary: entry?.summary ?? null,
    total: entry?.total ?? 0,
    position,
    nextPosition: nextPos,
    items,
    hasEarlier: first > 0,
    hasLater: !!entry && last + 1 < entry.total,
    loadEarlier: () => void loadPage(first - PAGE),
    loadLater: () => void loadPage(last + 1),
    itemAt,
    retry: () => setAttempt((a) => a + 1),
  };
}
