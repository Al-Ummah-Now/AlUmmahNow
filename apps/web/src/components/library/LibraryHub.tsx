'use client';

import React, { useCallback, useEffect, useState } from 'react';
import Link from '@/components/common/AppLink';
import { Bookmark, Clock, History, ListVideo, ThumbsUp, Library as LibraryIcon } from 'lucide-react';
import { useAuth } from '@/components/AuthProvider/authContext';
import { useMultiAccount } from '@/hooks/useMultiAccount';
import { useLanguage } from '@/hooks/useLanguage';
import { LibraryService, type SavedPost } from '@/services/api/library';
import { WatchHistoryService } from '@/services/api/watch-history';
import { listPlaylists, type PlaylistWithVideos } from '@/lib/api/playlists';
import { fillTemplate } from '@/lib/i18n/translations/library-notifications';
import { logger } from '@/lib/logger-client';
import { LibraryVideoTile, type LibraryTileVideo } from './LibraryVideoTile';
import { SavedPostCard } from './SavedPostCard';

const PREVIEW = 6;

type SectionState<T> = { status: 'loading' | 'ready' | 'error'; items: T[]; total?: number };

function useSection<T>(load: () => Promise<{ items: T[]; total?: number } | null>, enabled: boolean) {
  const [state, setState] = useState<SectionState<T>>({ status: 'loading', items: [] });
  const run = useCallback(async () => {
    setState((s) => ({ ...s, status: 'loading' }));
    try {
      const result = await load();
      setState(result ? { status: 'ready', items: result.items, total: result.total } : { status: 'error', items: [] });
    } catch (error) {
      logger.warn('[LibraryHub] Section failed', { error });
      setState({ status: 'error', items: [] });
    }
  }, [load]);
  useEffect(() => {
    if (enabled) void run();
  }, [enabled, run]);
  return { state, retry: run };
}

interface SectionProps<T> {
  id: string;
  title: string;
  icon: React.ReactNode;
  seeAllHref?: string | null;
  empty: string;
  state: SectionState<T>;
  retry: () => void;
  render: (item: T) => React.ReactNode;
  keyOf: (item: T) => string;
  grid?: boolean;
}

function Section<T>({ id, title, icon, seeAllHref, empty, state, retry, render, keyOf, grid = true }: SectionProps<T>) {
  const { t } = useLanguage();
  const texts = t.library;
  const headingId = `library-${id}-heading`;
  return (
    <section aria-labelledby={headingId} data-testid={`library-section-${id}`} className="mb-10">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 id={headingId} className="flex items-center gap-2 text-lg font-semibold text-gray-900 dark:text-white">
          <span aria-hidden="true" className="text-[var(--fanous-color-accent)]">{icon}</span>
          {title}
          {typeof state.total === 'number' && state.total > 0 && (
            <span className="text-sm font-normal text-gray-500">({state.total})</span>
          )}
        </h2>
        {seeAllHref && typeof state.total === 'number' && state.total > 0 && (
          <Link href={seeAllHref} className="text-sm font-medium text-blue-700 hover:underline dark:text-blue-300" data-testid={`library-see-all-${id}`}>
            {texts.seeAll}
          </Link>
        )}
      </div>
      {state.status === 'loading' ? (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6" role="status" aria-label={t.common.loading}>
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="aspect-video animate-pulse rounded-lg bg-gray-200 dark:bg-gray-800" />
          ))}
        </div>
      ) : state.status === 'error' ? (
        <div role="alert" className="text-sm text-red-600">
          {texts.loadError}{' '}
          <button type="button" onClick={retry} className="font-medium underline">
            {texts.retry}
          </button>
        </div>
      ) : state.items.length === 0 ? (
        <p className="text-sm text-gray-600 dark:text-gray-400" data-testid={`library-empty-${id}`}>{empty}</p>
      ) : (
        <ul className={grid ? 'grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6' : 'space-y-3'}>
          {state.items.map((item) => (
            <li key={keyOf(item)}>{render(item)}</li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** Library hub (Story 29.6): History, Watch later, Liked videos, Playlists, Saved posts. */
export function LibraryHubView({ dir }: { dir: 'ltr' | 'rtl' }) {
  const { user } = useAuth();
  const { user: account } = useMultiAccount();
  const { t, lang } = useLanguage();
  const texts = t.library;
  const channelId = account?.channel?.id;
  const enabled = !!user;

  const history = useSection<LibraryTileVideo>(
    useCallback(async () => {
      const page = await WatchHistoryService.list({ limit: PREVIEW });
      if (!page) return null;
      return {
        total: page.total,
        items: page.entries.map((e) => ({
          id: e.videoId,
          title: e.videoTitle,
          thumbnailUrl: e.videoThumbnail,
          channelName: e.channelName,
          duration: e.videoDuration,
        })),
      };
    }, []),
    enabled,
  );
  const watchLater = useSection<LibraryTileVideo>(
    useCallback(async () => {
      const page = await LibraryService.watchLater({ limit: PREVIEW });
      return page ? { items: page.items as unknown as LibraryTileVideo[], total: page.total } : null;
    }, []),
    enabled,
  );
  const liked = useSection<LibraryTileVideo>(
    useCallback(async () => {
      const page = await LibraryService.liked({ limit: PREVIEW });
      return page ? { items: page.items as unknown as LibraryTileVideo[], total: page.total } : null;
    }, []),
    enabled,
  );
  const playlists = useSection<PlaylistWithVideos>(
    useCallback(async () => {
      if (!channelId) return { items: [] };
      const page = await listPlaylists({ channelId, limit: PREVIEW });
      return page ? { items: page.data || [] } : null;
    }, [channelId]),
    enabled,
  );
  const saved = useSection<SavedPost>(
    useCallback(async () => {
      const page = await LibraryService.savedPosts({ limit: PREVIEW });
      return page ? { items: page.items, total: page.total } : null;
    }, []),
    enabled,
  );

  if (!user) {
    return (
      <main dir={dir} className="mx-auto max-w-3xl px-4 py-12 text-center" data-testid="library-signed-out">
        <LibraryIcon className="mx-auto mb-3 h-10 w-10 text-gray-400" aria-hidden="true" />
        <h1 className="mb-2 text-2xl font-bold text-gray-900 dark:text-white">{texts.title}</h1>
        <p className="text-gray-700 dark:text-gray-300">{texts.signInPrompt}</p>
      </main>
    );
  }

  return (
    <main dir={dir} className="mx-auto max-w-7xl px-4 py-8" data-testid="library-page">
      <header className="mb-8">
        <h1 className="flex items-center gap-3 text-3xl font-bold text-gray-900 dark:text-white">
          <LibraryIcon className="h-8 w-8 text-[var(--fanous-color-accent)]" aria-hidden="true" />
          {texts.title}
        </h1>
        <p className="mt-1 text-gray-600 dark:text-gray-400">{texts.description}</p>
      </header>

      <Section
        id="history"
        title={texts.history}
        icon={<History className="h-5 w-5" />}
        seeAllHref={`/${lang}/history`}
        empty={texts.emptyHistory}
        state={history.state}
        retry={history.retry}
        keyOf={(v) => v.id}
        render={(v) => <LibraryVideoTile video={v} />}
      />
      <Section
        id="watch-later"
        title={texts.watchLater}
        icon={<Clock className="h-5 w-5" />}
        seeAllHref={`/${lang}/library/watch-later`}
        empty={texts.emptyWatchLater}
        state={watchLater.state}
        retry={watchLater.retry}
        keyOf={(v) => v.id}
        render={(v) => <LibraryVideoTile video={v} />}
      />
      <Section
        id="liked"
        title={texts.likedVideos}
        icon={<ThumbsUp className="h-5 w-5" />}
        seeAllHref={`/${lang}/library/liked`}
        empty={texts.emptyLiked}
        state={liked.state}
        retry={liked.retry}
        keyOf={(v) => v.id}
        render={(v) => <LibraryVideoTile video={v} />}
      />
      <Section
        id="playlists"
        title={texts.playlists}
        icon={<ListVideo className="h-5 w-5" />}
        seeAllHref={channelId ? `/${lang}/channels/${channelId}?tab=playlists` : null}
        empty={channelId ? texts.emptyPlaylists : texts.createChannelForPlaylists}
        state={playlists.state}
        retry={playlists.retry}
        keyOf={(p) => p.id}
        render={(p) => (
          <Link
            href={`/${lang}/playlist/${encodeURIComponent(p.id)}`}
            className="block rounded-lg border border-gray-200 p-3 hover:border-[var(--fanous-color-accent)] dark:border-gray-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
            data-testid="library-playlist"
          >
            <ListVideo className="mb-2 h-6 w-6 text-gray-500" aria-hidden="true" />
            <p className="line-clamp-2 text-sm font-medium text-gray-900 dark:text-white">{p.name || (p as { title?: string }).title}</p>
            <p className="text-xs text-gray-500">{fillTemplate(texts.videosCount, { count: (p.videos?.length || 0).toLocaleString(lang) })}</p>
          </Link>
        )}
      />
      <Section
        id="saved-posts"
        title={texts.savedPosts}
        icon={<Bookmark className="h-5 w-5" />}
        seeAllHref={`/${lang}/library/saved-posts`}
        empty={texts.emptySavedPosts}
        state={saved.state}
        retry={saved.retry}
        keyOf={(p) => p.id}
        grid={false}
        render={(p) => <SavedPostCard post={p} />}
      />
    </main>
  );
}

export default function LibraryHub() {
  return <LibraryHubView dir="ltr" />;
}
