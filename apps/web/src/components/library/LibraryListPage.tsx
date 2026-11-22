'use client';

import { formatClock, formatDate, formatNumber, getLocalizedValue } from '@al-ummah/shared-types';
import React, { useCallback, useEffect, useState } from 'react';
import Link from '@/components/common/AppLink';
import { ArrowDown, ArrowUp, Bookmark, Clock, Lock, Play, Shuffle, ThumbsUp, Trash2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import VideoThumbnail, { THUMBNAIL_16_9 } from '@/components/VideoThumbnail';
import { MetaParts } from '@/components/common/MetaParts';
import { formatVideoCount } from '@/lib/format/videoMeta';
import { keepLastWordsTogether } from '@/lib/format/titleWrap';
import { channelLabel } from '@/lib/channel-name';
import { removeUnwantedChars } from '@/lib/utility';
import '@/theme/library-list.css';
import '@/theme/history.css';
import { watchHref, writeListMode } from '@/lib/playlists/playback';
import { storedIndexOf } from '@/lib/playlists/playlist-utils';
import { useAuth } from '@/components/AuthProvider/authContext';
import { useLanguage } from '@/hooks/useLanguage';
import { LibraryService, type LibraryVideo, type SavedPost } from '@/services/api/library';
import { fillTemplate } from '@/lib/i18n/translations/library-notifications';
import { logger } from '@/lib/logger-client';
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
  const { t, lang: pageLang } = useLanguage();
  const lang = pageLang === 'ar' ? 'ar' : 'en';
  const router = useRouter();
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
        <p className="text-[var(--fanous-color-text-secondary)]">{texts.signInPrompt}</p>
      </main>
    );
  }

  const status_ = (
    <>
      <p className="sr-only" role="status" aria-live="polite">{message}</p>
      {status === 'loading' ? (
        <p role="status" className="lbl-status">{t.common.loading}</p>
      ) : status === 'error' ? (
        <div role="alert" className="lbl-status lbl-error">
          {texts.loadError}{' '}
          <button type="button" onClick={() => void load()} className="font-medium underline">
            {texts.retry}
          </button>
        </div>
      ) : items.length === 0 ? (
        <p className="lbl-empty" data-testid="library-list-empty">{meta.empty}</p>
      ) : null}
    </>
  );

  const loadMoreButton = cursor && status === 'ready' && (
    <div className="mt-6 text-center">
      <button
        type="button"
        onClick={() => void loadMore()}
        disabled={loadingMore}
        className="lbl-more"
      >
        {loadingMore ? t.common.loading : texts.loadMore}
      </button>
    </div>
  );

  if (kind === 'saved-posts') {
    return (
      <main dir={dir} className="mx-auto max-w-3xl px-4 py-8" data-testid={`library-${kind}-page`}>
        <nav aria-label={texts.title} className="mb-2 text-sm">
          <Link href={`/${lang}/library`} className="lbl-crumb">{texts.title}</Link>
        </nav>
        <h1 className="mb-6 flex items-center gap-3 text-2xl font-bold text-[var(--fanous-color-text-primary)]">
          <meta.Icon className="h-7 w-7 text-[var(--fanous-color-accent)]" aria-hidden="true" />
          {meta.title}
        </h1>
        {status_}
        {status === 'ready' && items.length > 0 && (
        <ul className="space-y-3" data-testid="library-list">
          {(items as SavedPost[]).map((post) => (
            <li key={post.id} className="flex items-start gap-2">
              <div className="min-w-0 flex-1">
                <SavedPostCard post={post} />
              </div>
              <button type="button" className="lbl-icon" onClick={() => void removeItem(post)} aria-label={texts.unsavePost} title={texts.unsavePost}>
                <Trash2 className="h-4 w-4" aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
        )}
        {loadMoreButton}
      </main>
    );
  }

  const videos = items as LibraryVideo[];
  const first = videos[0];
  const playHref = (video: LibraryVideo, index: number) => watchHref(lang, video.id, { list: listAlias, index: storedIndexOf(storedIds, video.id, index) });

  // Shuffle: the player's own per-tab shuffle for this list (lib/playlists/playback.ts), from a random video
  const shuffle = () => {
    if (!listAlias || videos.length === 0) return;
    const pick = Math.floor(Math.random() * videos.length);
    const index = storedIndexOf(storedIds, videos[pick].id, pick);
    writeListMode(listAlias, { loop: false, shuffleSeed: Math.floor(Math.random() * 2 ** 31), shuffleFirst: index });
    logger.debug('[LibraryListPage] Shuffle', { kind, index });
    router.push(watchHref(lang, videos[pick].id, { list: listAlias, index }));
  };

  return (
    <main dir={dir} className="lbl" data-testid={`library-${kind}-page`}>
      <div className="lbl-layout">
        <aside className="lbl-panel" data-testid="library-panel">
          <div className="lbl-cover" aria-hidden="true">
            <span className="lbl-sheet lbl-sheet-2" />
            <span className="lbl-sheet lbl-sheet-1" />
            <span className="lbl-cover-art">
              {first ? (
                <VideoThumbnail src={first.thumbnailUrl} alt="" sizes="(max-width: 1023px) 50vw, 340px" style={THUMBNAIL_16_9} />
              ) : (
                <span className="lbl-cover-empty"><meta.Icon /></span>
              )}
            </span>
          </div>
          <div className="lbl-panel-text">
            <nav aria-label={texts.title}>
              <Link href={`/${lang}/library`} className="lbl-crumb">{texts.title}</Link>
            </nav>
            <h1 className="lbl-title">{meta.title}</h1>
            <p className="lbl-meta">
              <MetaParts
                lang={lang}
                parts={[
                  { key: 'private', node: <span className="whitespace-nowrap"><Lock className="lbl-lock" aria-hidden="true" />{t.playlist.privateLabel}</span> },
                  ...(total > 0 ? [{ key: 'count', keep: true, node: formatVideoCount(total, lang) }] : []),
                ]}
              />
            </p>
            {status === 'ready' && first && listAlias && (
              <div className="lbl-actions">
                {/* Plays the whole list in place, starting with its first video (docs/specs/PLAYLIST-PLAYBACK.md) */}
                <Link href={playHref(first, 0)} data-testid="library-play-all" className="lbl-btn lbl-btn-primary">
                  {/* Media icons never mirror in RTL: play points right in Arabic too */}
                  <Play className="h-4 w-4 fill-current" aria-hidden="true" />
                  {t.playlist.playAll}
                </Link>
                <button type="button" onClick={shuffle} data-testid="library-shuffle" className="lbl-btn lbl-btn-secondary">
                  <Shuffle className="h-4 w-4" aria-hidden="true" />
                  {t.playlist.shuffle}
                </button>
              </div>
            )}
          </div>
        </aside>

        <section className="lbl-main" aria-label={meta.title}>
          {status_}
          {status === 'ready' && videos.length > 0 && (
            <ol className="lbl-list" data-testid="library-list">
              {videos.map((video, index) => {
                const title = removeUnwantedChars(getLocalizedValue(video.titleLocalized, video.title || '', lang));
                const duration = video.duration && video.duration > 0 ? formatClock(lang, Math.floor(video.duration)) : null;
                const channel = channelLabel(video, lang);
                return (
                  <li key={video.id} className="lbl-row" data-testid="library-list-item" data-video-id={video.id}>
                    <span className="lbl-index" aria-hidden="true">{formatNumber(lang, index + 1)}</span>
                    <Link href={playHref(video, index)} className="lbl-row-link" data-testid="library-video">
                      <span className="lbl-row-thumb">
                        <VideoThumbnail src={video.thumbnailUrl} alt="" sizes="(max-width: 639px) 136px, 168px" style={THUMBNAIL_16_9}>
                          {duration && <span className="hx-duration" dir="ltr">{duration}</span>}
                        </VideoThumbnail>
                      </span>
                      <span className="lbl-row-text">
                        <span className="lbl-row-title line-clamp-2" dir="auto">{keepLastWordsTogether(title)}</span>
                        {channel && <span className="lbl-row-sub" dir="auto">{channel}</span>}
                        {video.likedAt && (
                          <span className="lbl-row-sub">{fillTemplate(texts.likedOn, { date: formatDate(lang, new Date(video.likedAt), {}) })}</span>
                        )}
                      </span>
                    </Link>
                    {kind === 'watch-later' && (
                      <div className="lbl-row-actions">
                        <button
                          type="button"
                          className="lbl-icon"
                          onClick={() => void move(index, -1)}
                          disabled={index === 0}
                          aria-label={`${texts.moveUp}: ${title}`}
                          title={texts.moveUp}
                          data-reorder={`${video.id}:up`}
                        >
                          <ArrowUp aria-hidden="true" />
                        </button>
                        <button
                          type="button"
                          className="lbl-icon"
                          onClick={() => void move(index, 1)}
                          disabled={index === videos.length - 1}
                          aria-label={`${texts.moveDown}: ${title}`}
                          title={texts.moveDown}
                          data-reorder={`${video.id}:down`}
                        >
                          <ArrowDown aria-hidden="true" />
                        </button>
                        <button
                          type="button"
                          className="lbl-icon"
                          onClick={() => void removeItem(video)}
                          aria-label={`${texts.removeFromWatchLater}: ${title}`}
                          title={texts.removeFromWatchLater}
                          data-testid="watch-later-remove"
                        >
                          <Trash2 aria-hidden="true" />
                        </button>
                      </div>
                    )}
                  </li>
                );
              })}
            </ol>
          )}
          {loadMoreButton}
        </section>
      </div>
    </main>
  );
}

export default LibraryListPage;
