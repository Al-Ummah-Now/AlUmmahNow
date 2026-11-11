'use client';

import React, { useCallback, useEffect, useState } from 'react';
import Link from '@/components/common/AppLink';
import { ArrowDown, ArrowUp, Bookmark, Clock, Play, ThumbsUp, Trash2 } from 'lucide-react';
import { watchHref } from '@/lib/playlists/playback';
import { storedIndexOf } from '@/lib/playlists/playlist-utils';
import { useAuth } from '@/components/AuthProvider/authContext';
import { useLanguage } from '@/hooks/useLanguage';
import { LibraryService, type LibraryVideo, type SavedPost } from '@/services/api/library';
import { fillTemplate } from '@/lib/i18n/translations/library-notifications';
import { logger } from '@/lib/logger-client';
import { LibraryVideoTile, type LibraryTileVideo } from './LibraryVideoTile';
import { SavedPostCard } from './SavedPostCard';

const PAGE_SIZE = 24;

export type LibraryListKind = 'watch-later' | 'liked' | 'saved-posts';

interface Props {
  kind: LibraryListKind;
  dir: 'ltr' | 'rtl';
}

type Item = LibraryVideo | SavedPost;

/**
 * Full Watch later / Liked videos / Saved posts pages (Story 29.6).
 * Watch later supports removing and keyboard-accessible reordering.
 */
export function LibraryListPage({ kind, dir }: Props) {
  const { user } = useAuth();
  const { t, lang } = useLanguage();
  const texts = t.library;
  const [items, setItems] = useState<Item[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [total, setTotal] = useState(0);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [loadingMore, setLoadingMore] = useState(false);
  const [message, setMessage] = useState('');
  // Watch later's stored order (its URL indexes); Liked is played newest first, as listed
  const [storedIds, setStoredIds] = useState<string[] | null>(null);
  const listAlias = kind === 'watch-later' ? 'WL' : kind === 'liked' ? 'LL' : null;

  const fetchPage = useCallback(
    (next: string | null) => {
      if (kind === 'watch-later') return LibraryService.watchLater({ limit: PAGE_SIZE, cursor: next });
      if (kind === 'liked') return LibraryService.liked({ limit: PAGE_SIZE, cursor: next });
      return LibraryService.savedPosts({ limit: PAGE_SIZE, cursor: next });
    },
    [kind],
  );

  const load = useCallback(async () => {
    setStatus('loading');
    const page = await fetchPage(null);
    if (!page) {
      setStatus('error');
      return;
    }
    setItems(page.items as Item[]);
    setCursor(page.nextCursor);
    setTotal(page.total);
    setStoredIds('videoIds' in page && Array.isArray(page.videoIds) ? page.videoIds : null);
    setStatus('ready');
  }, [fetchPage]);

  useEffect(() => {
    if (user) void load();
  }, [user, load]);

  const loadMore = async () => {
    if (!cursor) return;
    setLoadingMore(true);
    const page = await fetchPage(cursor);
    if (page) {
      setItems((prev) => [...prev, ...(page.items as Item[]).filter((i) => !prev.some((p) => p.id === i.id))]);
      setCursor(page.nextCursor);
    }
    setLoadingMore(false);
  };

  const removeItem = async (item: Item) => {
    const previous = items;
    setItems((prev) => prev.filter((i) => i.id !== item.id));
    setTotal((n) => Math.max(0, n - 1));
    const ok =
      kind === 'watch-later'
        ? (await LibraryService.removeFromWatchLater(item.id)).ok
        : kind === 'saved-posts'
          ? await LibraryService.unsavePost(item.id)
          : false;
    if (ok) {
      setMessage(kind === 'watch-later' ? texts.removedFromWatchLater : '');
    } else {
      logger.warn('[LibraryListPage] Remove failed', { kind, id: item.id });
      setItems(previous);
      setTotal((n) => n + 1);
      setMessage(texts.actionFailed);
    }
  };

  /** Move within the loaded page and persist the full order (unloaded items keep their place at the end). */
  const move = async (index: number, delta: -1 | 1) => {
    const target = index + delta;
    if (target < 0 || target >= items.length) return;
    const previous = items;
    const next = [...items];
    [next[index], next[target]] = [next[target], next[index]];
    setItems(next);
    const full = await LibraryService.watchLater({ limit: 1 });
    const loadedIds = next.map((i) => i.id);
    const rest = (full?.videoIds || []).filter((id) => !loadedIds.includes(id));
    const ok = await LibraryService.reorderWatchLater([...loadedIds, ...rest]);
    if (!ok) {
      setItems(previous);
      setMessage(texts.actionFailed);
    }
    requestAnimationFrame(() => {
      document.querySelector<HTMLButtonElement>(`[data-reorder="${next[target].id}:${delta < 0 ? 'up' : 'down'}"]`)?.focus();
    });
  };

  const meta = {
    'watch-later': { title: texts.watchLater, empty: texts.emptyWatchLater, Icon: Clock },
    liked: { title: texts.likedVideos, empty: texts.emptyLiked, Icon: ThumbsUp },
    'saved-posts': { title: texts.savedPosts, empty: texts.emptySavedPosts, Icon: Bookmark },
  }[kind];

  if (!user) {
    return (
      <main dir={dir} className="mx-auto max-w-3xl px-4 py-12 text-center">
        <p className="text-gray-700 dark:text-gray-300">{texts.signInPrompt}</p>
      </main>
    );
  }

  const iconButton =
    'rounded p-1.5 text-gray-600 hover:bg-gray-200 disabled:opacity-40 dark:text-gray-300 dark:hover:bg-gray-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500';

  return (
    <main dir={dir} className="mx-auto max-w-7xl px-4 py-8" data-testid={`library-${kind}-page`}>
      <nav aria-label={texts.title} className="mb-2 text-sm">
        <Link href={`/${lang}/library`} className="text-blue-700 hover:underline dark:text-blue-300">
          {texts.title}
        </Link>
      </nav>
      <h1 className="mb-6 flex items-center gap-3 text-2xl font-bold text-gray-900 dark:text-white">
        <meta.Icon className="h-7 w-7 text-[var(--fanous-color-accent)]" aria-hidden="true" />
        {meta.title}
        {total > 0 && kind !== 'saved-posts' && (
          <span className="text-base font-normal text-gray-500">{fillTemplate(texts.videosCount, { count: total.toLocaleString(lang) })}</span>
        )}
      </h1>

      {listAlias && status === 'ready' && items.length > 0 && (
        // Plays the whole list in place, starting with its first video (docs/specs/PLAYLIST-PLAYBACK.md)
        <Link
          href={watchHref(lang, items[0].id, { list: listAlias, index: storedIndexOf(storedIds, items[0].id, 0) })}
          data-testid="library-play-all"
          className="mb-6 inline-flex items-center gap-2 rounded-lg bg-[var(--fanous-color-primary)] px-4 py-2 font-medium text-[var(--fanous-color-on-primary)] hover:bg-[var(--fanous-color-primary-hover)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--fanous-color-focus-ring)]"
        >
          <Play className="h-4 w-4 rtl:-scale-x-100" aria-hidden="true" />
          {t.playlist.playAll}
        </Link>
      )}

      <p className="sr-only" role="status" aria-live="polite">{message}</p>

      {status === 'loading' ? (
        <p role="status" className="text-gray-500">{t.common.loading}</p>
      ) : status === 'error' ? (
        <div role="alert" className="text-red-600">
          {texts.loadError}{' '}
          <button type="button" onClick={() => void load()} className="font-medium underline">
            {texts.retry}
          </button>
        </div>
      ) : items.length === 0 ? (
        <p className="text-gray-600 dark:text-gray-400" data-testid="library-list-empty">{meta.empty}</p>
      ) : kind === 'saved-posts' ? (
        <ul className="space-y-3" data-testid="library-list">
          {(items as SavedPost[]).map((post) => (
            <li key={post.id} className="flex items-start gap-2">
              <div className="min-w-0 flex-1">
                <SavedPostCard post={post} />
              </div>
              <button type="button" className={iconButton} onClick={() => void removeItem(post)} aria-label={texts.unsavePost} title={texts.unsavePost}>
                <Trash2 className="h-4 w-4" aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <ol className="grid grid-cols-1 gap-6 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4" data-testid="library-list">
          {(items as LibraryVideo[]).map((video, index) => (
            <li key={video.id} className="flex flex-col gap-2" data-testid="library-list-item" data-video-id={video.id}>
              <LibraryVideoTile
                video={video as unknown as LibraryTileVideo}
                href={listAlias ? watchHref(lang, video.id, { list: listAlias, index: storedIndexOf(storedIds, video.id, index) }) : undefined}
                subtitle={video.likedAt ? fillTemplate(texts.likedOn, { date: new Date(video.likedAt).toLocaleDateString(lang) }) : undefined}
              />
              {kind === 'watch-later' && (
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    className={iconButton}
                    onClick={() => void move(index, -1)}
                    disabled={index === 0}
                    aria-label={`${texts.moveUp}: ${video.title}`}
                    data-reorder={`${video.id}:up`}
                  >
                    <ArrowUp className="h-4 w-4" aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    className={iconButton}
                    onClick={() => void move(index, 1)}
                    disabled={index === items.length - 1}
                    aria-label={`${texts.moveDown}: ${video.title}`}
                    data-reorder={`${video.id}:down`}
                  >
                    <ArrowDown className="h-4 w-4" aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    className={`${iconButton} ms-auto`}
                    onClick={() => void removeItem(video)}
                    aria-label={`${texts.removeFromWatchLater}: ${video.title}`}
                    data-testid="watch-later-remove"
                  >
                    <Trash2 className="h-4 w-4" aria-hidden="true" />
                  </button>
                </div>
              )}
            </li>
          ))}
        </ol>
      )}

      {cursor && status === 'ready' && (
        <div className="mt-6 text-center">
          <button
            type="button"
            onClick={() => void loadMore()}
            disabled={loadingMore}
            className="rounded-lg bg-gray-100 px-4 py-2 text-sm font-medium text-gray-900 hover:bg-gray-200 disabled:opacity-60 dark:bg-gray-800 dark:text-white"
          >
            {loadingMore ? t.common.loading : texts.loadMore}
          </button>
        </div>
      )}
    </main>
  );
}

export default LibraryListPage;
