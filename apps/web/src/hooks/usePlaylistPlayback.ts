'use client';

/**
 * Playlist playback on the watch page (docs/specs/PLAYLIST-PLAYBACK.md): reads `list`/`index`
 * from the URL, loads the queue, and works out what plays next (saved order, or the tab's
 * shuffle; loop at the end or stop, D9). Every move is a client-side push with an autoplay
 * request, so the browser's user activation carries over and unmuted play is allowed.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { getLocalizedValue } from '@al-ummah/shared-types';
import type { QueueItem } from '@/lib/api/playlist-queue';
import { usePlaylistQueue, type PlaylistQueueState } from '@/hooks/usePlaylistQueue';
import {
  nextPosition,
  parseListParams,
  previousPosition,
  readListMode,
  readPaneCollapsed,
  shuffledOrder,
  watchHref,
  writeListMode,
  writePaneCollapsed,
  type ListMode,
} from '@/lib/playlists/playback';
import { requestAutoplay } from '@/lib/video/autoplay-intent';
import { navigateOrLoad } from '@/lib/navigation/navigate-or-load';
import { removeUnwantedChars } from '@/lib/utility';
import type { UpNext } from '@/lib/video/player-ui';
import { channelLabel } from '@/lib/channel-name';

export interface PlaylistPlayback {
  /** A list is in the URL and usable (loading or ready) */
  active: boolean;
  list: string | null;
  queue: PlaylistQueueState;
  loop: boolean;
  shuffle: boolean;
  collapsed: boolean;
  canPrevious: boolean;
  canNext: boolean;
  toggleLoop: () => void;
  toggleShuffle: () => void;
  toggleCollapsed: () => void;
  previous: () => void;
  next: () => void;
  play: (item: QueueItem, opts?: { auto?: boolean }) => void;
  hrefFor: (item: QueueItem) => string;
  /** What the player's Next button, `N` and the end screen play (null at the end of the list) */
  upNext: UpNext | null;
  /** The next item's id and playback URL, for preloading (null at the end of the list) */
  nextVideo: { id: string; playUrl?: string } | null;
  /** End of the list with loop off: start again from the first video */
  replayList: (() => void) | null;
}

function currentUrlWithout(keys: string[], set: Record<string, string> = {}): string {
  const url = new URL(window.location.href);
  for (const k of keys) url.searchParams.delete(k);
  for (const [k, v] of Object.entries(set)) url.searchParams.set(k, v);
  return `${url.pathname}${url.search}${url.hash}`;
}

export interface PlaylistPlaybackOptions {
  /** The URL of an item (the dev player harness plays fixtures on its own route) */
  buildHref?: (videoId: string, list: string, index: number) => string;
}

export function usePlaylistPlayback(videoId: string, lang: string, options: PlaylistPlaybackOptions = {}): PlaylistPlayback {
  const { buildHref } = options;
  const router = useRouter();
  const searchParams = useSearchParams();
  const params = useMemo(() => parseListParams(searchParams), [searchParams]);
  const list = params?.list ?? null;
  const index = params?.index ?? null;
  const queue = usePlaylistQueue(list, videoId, index);

  const [mode, setMode] = useState<ListMode>(() => (list ? readListMode(list) : { loop: false, shuffleSeed: null, shuffleFirst: null }));
  useEffect(() => {
    if (list) setMode(readListMode(list));
  }, [list]);
  // Collapsed by default on phones; remembered per device
  const [collapsed, setCollapsed] = useState(false);
  useEffect(() => {
    setCollapsed(readPaneCollapsed(typeof window !== 'undefined' && window.matchMedia?.('(max-width: 639px)').matches));
  }, []);

  const { total, position } = queue;
  const shuffle = useMemo(
    () => (mode.shuffleSeed !== null && total > 0 ? shuffledOrder(total, mode.shuffleSeed, mode.shuffleFirst) : null),
    [mode.shuffleSeed, mode.shuffleFirst, total],
  );
  const step = { position, nextPosition: queue.nextPosition, total, loop: mode.loop, shuffle };
  const nextPos = queue.status === 'ready' ? nextPosition(step) : null;
  const prevPos = queue.status === 'ready' ? previousPosition(step) : null;

  const hrefFor = useCallback(
    (item: QueueItem) => (buildHref && list ? buildHref(item.id, list, item.index) : watchHref(lang, item.id, { list, index: item.index })),
    [buildHref, lang, list],
  );

  const play = useCallback((item: QueueItem, opts: { auto?: boolean } = {}) => {
    requestAutoplay(item.id, opts);
    // The page keeps its scroll: the mini player takes over when the player is out of view
    navigateOrLoad((href) => router.push(href, { scroll: false }), hrefFor(item));
  }, [router, hrefFor]);

  const { itemAt } = queue;
  const playAt = useCallback(async (pos: number | null) => {
    if (pos === null) return;
    const item = await itemAt(pos);
    if (item) play(item);
  }, [itemAt, play]);

  // Corrections replace the entry (no history step, D5): a dead list is dropped, a stale index fixed
  useEffect(() => {
    if (!list || typeof window === 'undefined') return;
    if (queue.status === 'unavailable') {
      window.history.replaceState(window.history.state, '', currentUrlWithout(['list', 'index']));
      return;
    }
    if (queue.status !== 'ready' || position === null) return;
    // Only once the queue answers for this video (right after a move it still holds the last one)
    const current = queue.items.find((i) => i.position === position);
    if (current && current.id === videoId && current.index !== index) {
      window.history.replaceState(window.history.state, '', currentUrlWithout([], { index: String(current.index) }));
    }
  }, [list, index, videoId, queue.status, queue.items, position]);

  // Make sure the next item is loaded, so up next has its title and thumbnail
  const nextItem = nextPos === null ? null : queue.items.find((i) => i.position === nextPos) ?? null;
  useEffect(() => {
    if (nextPos !== null && !nextItem) void itemAt(nextPos);
  }, [nextPos, nextItem, itemAt]);

  const upNext = useMemo<UpNext | null>(() => {
    if (!nextItem) return null;
    return {
      title: removeUnwantedChars(getLocalizedValue(nextItem.titleLocalized, nextItem.title, lang)),
      channel: channelLabel(nextItem, lang),
      thumbnail: nextItem.thumbnailUrl,
      badge: `${(nextItem.position + 1).toLocaleString(lang)} / ${total.toLocaleString(lang)}`,
      go: (opts) => play(nextItem, opts),
    };
  }, [nextItem, lang, total, play]);

  const firstPos = shuffle ? shuffle[0] : 0;
  const replayList = useMemo(
    () => (queue.status === 'ready' && total > 0 && nextPos === null ? () => void playAt(firstPos) : null),
    [queue.status, total, nextPos, playAt, firstPos],
  );

  const updateMode = (patch: Partial<ListMode>) => {
    if (!list) return;
    const nextMode = { ...mode, ...patch };
    writeListMode(list, nextMode);
    setMode(nextMode);
  };

  // OS media keys and lock-screen controls move in the list
  useEffect(() => {
    const session = typeof navigator !== 'undefined' ? navigator.mediaSession : undefined;
    if (!session || queue.status !== 'ready') return undefined;
    try {
      session.setActionHandler('nexttrack', nextPos === null ? null : () => void playAt(nextPos));
      session.setActionHandler('previoustrack', prevPos === null ? null : () => void playAt(prevPos));
    } catch {
      return undefined;
    }
    return () => {
      try {
        session.setActionHandler('nexttrack', null);
        session.setActionHandler('previoustrack', null);
      } catch {
        // Unsupported action: nothing to clean
      }
    };
  }, [queue.status, nextPos, prevPos, playAt]);

  return {
    active: !!list && queue.status !== 'unavailable' && queue.status !== 'off',
    list,
    queue,
    loop: mode.loop,
    shuffle: mode.shuffleSeed !== null,
    collapsed,
    canPrevious: prevPos !== null,
    canNext: nextPos !== null,
    toggleLoop: () => updateMode({ loop: !mode.loop }),
    toggleShuffle: () =>
      updateMode(mode.shuffleSeed === null
        ? { shuffleSeed: Math.floor(Math.random() * 2 ** 31), shuffleFirst: position }
        : { shuffleSeed: null, shuffleFirst: null }),
    toggleCollapsed: () => {
      writePaneCollapsed(!collapsed);
      setCollapsed(!collapsed);
    },
    previous: () => void playAt(prevPos),
    next: () => void playAt(nextPos),
    play,
    hrefFor,
    upNext,
    nextVideo: nextItem ? { id: nextItem.id, playUrl: nextItem.playUrl } : null,
    replayList,
  };
}
