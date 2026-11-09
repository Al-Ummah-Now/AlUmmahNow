'use client';

import React from 'react';
import Link from 'next/link';
import { History, Trash2, X, RefreshCw, PauseCircle, PlayCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/components/AuthProvider/authContext';
import { useLanguage } from '@/hooks/useLanguage';
import { useWatchHistory, type UseWatchHistoryReturn } from '@/hooks/useWatchHistory';
import { resolveUrl } from '@/lib/utility';
import type { WatchHistoryItem } from '@/services/api/watch-history';
import type { AppTranslations } from '@/lib/i18n/types';

export interface WatchHistoryEntryProps {
  entry: WatchHistoryItem;
  lang: string;
  t: AppTranslations;
  onRemove: (videoId: string) => void;
}

export function WatchHistoryEntry({ entry, lang, t, onRemove }: WatchHistoryEntryProps) {
  const percent = Math.max(0, Math.min(100, Math.round(entry.percentageWatched || 0)));
  const watchedOn = new Date(entry.lastWatchedAt).toLocaleDateString(lang === 'ar' ? 'ar' : 'en');

  return (
    <li className="flex gap-4 items-start p-3 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800">
      {/* Same target as the title link: hidden from assistive tech and the tab order */}
      <Link href={`/${lang}/video/${entry.videoId}`} aria-hidden="true" tabIndex={-1} className="relative flex-shrink-0 w-40 h-24 bg-gray-200 dark:bg-gray-700 rounded-md overflow-hidden">
        {entry.videoThumbnail && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={resolveUrl(entry.videoThumbnail)} alt="" className="w-full h-full object-cover" />
        )}
        <span className="absolute bottom-0 left-0 h-1 bg-red-600" style={{ width: `${percent}%` }} aria-hidden="true" />
      </Link>
      <div className="flex-1 min-w-0">
        <Link href={`/${lang}/video/${entry.videoId}`} className="font-semibold text-gray-900 dark:text-white line-clamp-2 hover:underline">
          {entry.videoTitle}
        </Link>
        {entry.channelName && entry.channelId && (
          <Link href={`/${lang}/channels/${entry.channelId}`} className="block text-sm text-gray-600 dark:text-gray-400 hover:underline">
            {entry.channelName}
          </Link>
        )}
        {/* Legacy videos have a channel name but no channel page */}
        {entry.channelName && !entry.channelId && (
          <span className="block text-sm text-gray-600 dark:text-gray-400">{entry.channelName}</span>
        )}
        <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
          {t.watchHistory.lastWatched.replace('{date}', watchedOn)}
          {' • '}
          {entry.completed ? t.watchHistory.completed : t.watchHistory.percentWatched.replace('{percent}', String(percent))}
        </p>
      </div>
      <button
        type="button"
        onClick={() => onRemove(entry.videoId)}
        className="p-2 rounded-full text-gray-500 hover:text-gray-900 hover:bg-gray-100 dark:hover:text-white dark:hover:bg-gray-700"
        aria-label={t.watchHistory.remove}
        title={t.watchHistory.remove}
      >
        <X className="w-4 h-4" />
      </button>
    </li>
  );
}

/** Error text for the history page (shared by LTR and RTL). */
export function watchHistoryErrorMessage(error: UseWatchHistoryReturn['error'], t: AppTranslations): string | null {
  switch (error) {
    case 'load': return t.watchHistory.loadFailed;
    case 'remove': return t.watchHistory.removeFailed;
    case 'clear': return t.watchHistory.clearFailed;
    case 'pause': return t.watchHistory.pauseFailed;
    default: return null;
  }
}

/** Pause / resume control (shown once the setting has loaded). */
export function PauseHistoryButton({ history, t }: { history: UseWatchHistoryReturn; t: AppTranslations }) {
  if (history.paused === null) return null;
  return (
    <Button
      variant="outline"
      size="sm"
      onClick={history.togglePause}
      disabled={history.isTogglingPause}
      aria-pressed={history.paused}
      className="flex items-center gap-2"
    >
      {history.paused ? <PlayCircle className="w-4 h-4" /> : <PauseCircle className="w-4 h-4" />}
      {history.paused ? t.watchHistory.resume : t.watchHistory.pause}
    </Button>
  );
}

/** Notice shown while recording is paused. */
export function PausedNotice({ history, t }: { history: UseWatchHistoryReturn; t: AppTranslations }) {
  if (!history.paused) return null;
  return (
    <p className="mb-4 p-3 rounded-md text-sm bg-brand-soft text-brand-ink dark:bg-brand-soft dark:text-brand-ink" role="status">
      {t.watchHistory.pausedNotice}
    </p>
  );
}

/**
 * Watch history page content (LTR).
 */
export default function WatchHistoryPage() {
  const { t, lang } = useLanguage();
  const { user } = useAuth();
  const history = useWatchHistory(!!user);

  const handleClear = async () => {
    if (window.confirm(t.watchHistory.confirmClear)) {
      await history.clearAll();
    }
  };

  if (!user) {
    return (
      <div className="p-6 text-center" dir="ltr">
        <History className="w-16 h-16 text-gray-400 mx-auto mb-4" />
        <h1 className="text-2xl font-bold mb-2">{t.watchHistory.title}</h1>
        <p className="text-gray-600 dark:text-gray-400">{t.watchHistory.signInRequired}</p>
      </div>
    );
  }

  const errorMessage = watchHistoryErrorMessage(history.error, t);

  return (
    <div className="max-w-4xl mx-auto p-6" dir="ltr">
      <div className="flex justify-between items-center gap-4 mb-6">
        <div>
          <h1 className="text-3xl font-bold">{t.watchHistory.title}</h1>
          <p className="text-gray-600 dark:text-gray-400 mt-1">
            {history.total > 0
              ? (history.total === 1 ? t.watchHistory.totalCountOne : t.watchHistory.totalCount.replace('{count}', String(history.total)))
              : t.watchHistory.subtitle}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <PauseHistoryButton history={history} t={t} />
          {history.entries.length > 0 && (
            <Button variant="outline" size="sm" onClick={handleClear} disabled={history.isClearing} className="flex items-center gap-2">
              <Trash2 className="w-4 h-4" />
              {history.isClearing ? t.watchHistory.clearing : t.watchHistory.clearAll}
            </Button>
          )}
        </div>
      </div>

      <PausedNotice history={history} t={t} />

      {errorMessage && (
        <p className="mb-4 text-sm text-red-600 dark:text-red-400" role="alert">{errorMessage}</p>
      )}

      {history.isLoading && history.entries.length === 0 ? (
        <div className="flex justify-center py-12">
          <RefreshCw className="w-5 h-5 animate-spin" aria-label={t.common.loading} />
        </div>
      ) : history.entries.length === 0 ? (
        <div className="text-center py-12">
          <History className="w-16 h-16 text-gray-400 mx-auto mb-4" />
          <h2 className="text-xl font-semibold mb-2">{t.watchHistory.empty}</h2>
          <p className="text-gray-600 dark:text-gray-400 mb-4">{t.watchHistory.emptyDescription}</p>
          <Link href={`/${lang}`} className="text-brand-ink dark:text-brand-ink hover:underline">{t.watchHistory.browseVideos}</Link>
        </div>
      ) : (
        <>
          <ul className="space-y-2">
            {history.entries.map((entry) => (
              <WatchHistoryEntry key={entry.videoId} entry={entry} lang={lang} t={t} onRemove={history.remove} />
            ))}
          </ul>
          {history.hasMore && (
            <div className="flex justify-center mt-6">
              <Button variant="outline" onClick={history.loadMore} disabled={history.isLoadingMore}>
                {history.isLoadingMore ? t.common.loading : t.watchHistory.loadMore}
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
