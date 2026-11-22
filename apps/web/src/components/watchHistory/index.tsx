'use client';

/**
 * The history pages (owner 2026-11-22, "what does youtube do and why not a grid?"), one component for English and
 * Arabic (logical CSS, theme/history.css):
 *
 * - Continue watching (`/history?view=continue`, the home library row's "See all"): a grid of video cards like the
 *   home page's, each with its progress, title, channel and "watched X%" with when; remove (×) on the card, undone
 *   from a toast instead of a confirm. Title, count, the link to the whole history and Pause share one header row.
 * - The whole history (`/history`): YouTube's history list, grouped by day (Today, Yesterday, the weekday, then the
 *   date, in the viewer's zone), × at the end of each row, a side column (search, Pause, Clear all) beside it on
 *   desktop and above it on phones, the width capped so there is no dead space.
 */

import { formatNumber } from '@al-ummah/shared-types';
import React, { useState } from 'react';
import Link from '@/components/common/AppLink';
import { History, Trash2, X, RefreshCw, PauseCircle, PlayCircle, Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import VideoThumbnail, { THUMBNAIL_16_9 } from '@/components/VideoThumbnail';
import { useAuth } from '@/components/AuthProvider/authContext';
import { useLanguage } from '@/hooks/useLanguage';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { useWatchHistory, type UseWatchHistoryReturn } from '@/hooks/useWatchHistory';
import { keepLastWordsTogether } from '@/lib/format/titleWrap';
import { groupByDay, watchedTime } from '@/lib/format/historyDays';
import { formatDuration } from '@/lib/playlists/playlist-utils';
import { entryTitle, type WatchHistoryItem } from '@/services/api/watch-history';
import type { AppTranslations } from '@/lib/i18n/types';
import { formatAbsoluteDate, formatRelativeTime, formatVideoCount, keepNumbersWithUnits } from '@/lib/format/videoMeta';
import { MetaParts } from '@/components/common/MetaParts';
import { channelLabel } from '@/lib/channel-name';
import { removeUnwantedChars } from '@/lib/utility';
import '@/theme/history.css';

export interface WatchHistoryPageProps {
  /** `continue`: the Continue watching view (`/history?view=continue`) */
  view?: 'all' | 'continue';
}

type Lang = 'en' | 'ar';

interface EntryProps {
  entry: WatchHistoryItem;
  lang: Lang;
  t: AppTranslations;
  onRemove: (videoId: string) => void;
}

const percentOf = (entry: WatchHistoryItem) => Math.max(0, Math.min(100, Math.round(entry.percentageWatched || 0)));

/** "38% watched" / «تمت مشاهدة ٣٨٪», or "Watched" once finished */
const progressText = (entry: WatchHistoryItem, lang: Lang, t: AppTranslations) =>
  entry.completed ? t.watchHistory.completed : keepNumbersWithUnits(t.watchHistory.percentWatched.replace('{percent}', formatNumber(lang, percentOf(entry))));

const titleOf = (entry: WatchHistoryItem, lang: Lang) => removeUnwantedChars(entryTitle(entry, lang));

/** The thumbnail's progress bar: inset with a track, so a short bar (9%) is never lost under the rounded corner */
function ProgressBar({ percent }: { percent: number }) {
  if (percent <= 0) return null;
  return (
    <span className="hx-progress absolute inset-x-1.5 bottom-1.5 h-1 overflow-hidden rounded-full" aria-hidden="true" data-testid="watch-history-progress">
      <span className="block h-full rounded-full" style={{ inlineSize: `${Math.max(percent, 4)}%` }} />
    </span>
  );
}

function Thumb({ entry, lang, sizes }: { entry: WatchHistoryItem; lang: Lang; sizes: string }) {
  const duration = entry.videoDuration ? formatDuration(entry.videoDuration, lang) : '';
  return (
    <VideoThumbnail src={entry.videoThumbnail} alt="" sizes={sizes} style={THUMBNAIL_16_9}>
      {duration && <span className="hx-duration" dir="ltr">{duration}</span>}
      <ProgressBar percent={entry.completed ? 100 : percentOf(entry)} />
    </VideoThumbnail>
  );
}

function RemoveButton({ entry, lang, t, onRemove, className }: EntryProps & { className: string }) {
  const label = t.watchHistory.removeTitled.replace('{title}', titleOf(entry, lang));
  return (
    <button type="button" onClick={() => onRemove(entry.videoId)} className={className} aria-label={label} title={t.watchHistory.remove} data-testid="watch-history-remove">
      <X aria-hidden="true" />
    </button>
  );
}

/** Continue watching: a card like the home page's, with the progress and remove on it */
export function ContinueCard({ entry, lang, t, onRemove }: EntryProps) {
  const title = titleOf(entry, lang);
  const watchedOn = formatRelativeTime(entry.lastWatchedAt, lang);
  return (
    <li className="hx-card" data-testid="history-card" data-video-id={entry.videoId}>
      <Link href={`/${lang}/video/${entry.videoId}`} className="video-card hx-link">
        <Thumb entry={entry} lang={lang} sizes="(max-width: 639px) 50vw, (max-width: 1023px) 33vw, 320px" />
        <span className="hx-body">
          <h3 className="hx-title" dir="auto">{keepLastWordsTogether(title)}</h3>
          {entry.channelName && <span className="hx-channel" dir="auto">{channelLabel(entry, lang)}</span>}
          <p className="hx-meta">
            <MetaParts
              lang={lang}
              parts={[
                { key: 'progress', keep: true, node: progressText(entry, lang, t) },
                { key: 'when', keep: true, node: <span title={formatAbsoluteDate(entry.lastWatchedAt, lang)}>{keepNumbersWithUnits(watchedOn)}</span> },
              ]}
            />
          </p>
        </span>
      </Link>
      <RemoveButton entry={entry} lang={lang} t={t} onRemove={onRemove} className="hx-remove" />
    </li>
  );
}

/** The whole history: one row of a day, × at its end */
export function HistoryRow({ entry, lang, t, onRemove }: EntryProps) {
  const href = `/${lang}/video/${entry.videoId}`;
  return (
    <li className="hx-row" data-video-id={entry.videoId}>
      {/* Same target as the title link: hidden from assistive tech and the tab order */}
      <Link href={href} aria-hidden="true" tabIndex={-1} className="hx-row-thumb">
        <Thumb entry={entry} lang={lang} sizes="(max-width: 639px) 144px, 200px" />
      </Link>
      <div className="hx-row-text">
        <Link href={href} className="hx-row-title line-clamp-2" dir="auto">
          {keepLastWordsTogether(titleOf(entry, lang))}
        </Link>
        {entry.channelName && entry.channelId ? (
          <Link href={`/${lang}/channels/${entry.channelId}`} className="hx-row-channel" dir="auto">{channelLabel(entry, lang)}</Link>
        ) : entry.channelName ? (
          // Legacy videos have a channel name but no channel page
          <span className="hx-row-channel" dir="auto">{channelLabel(entry, lang)}</span>
        ) : null}
        <p className="hx-meta">
          <MetaParts
            lang={lang}
            stack="phone"
            parts={[
              { key: 'progress', keep: true, node: progressText(entry, lang, t) },
              { key: 'when', keep: true, node: <time dateTime={entry.lastWatchedAt} title={formatAbsoluteDate(entry.lastWatchedAt, lang)}>{watchedTime(entry.lastWatchedAt, lang)}</time> },
            ]}
          />
        </p>
      </div>
      <RemoveButton entry={entry} lang={lang} t={t} onRemove={onRemove} className="hx-row-remove" />
    </li>
  );
}

/** Error text for the history page. */
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
      data-testid="watch-history-pause"
    >
      {history.paused ? <PlayCircle className="w-4 h-4" aria-hidden="true" /> : <PauseCircle className="w-4 h-4" aria-hidden="true" />}
      {history.paused ? t.watchHistory.resume : t.watchHistory.pause}
    </Button>
  );
}

/** Notice shown while recording is paused. */
export function PausedNotice({ history, t }: { history: UseWatchHistoryReturn; t: AppTranslations }) {
  if (!history.paused) return null;
  return (
    <p className="hx-notice" role="status">
      {t.watchHistory.pausedNotice}
    </p>
  );
}

/** "Removed from watch history · Undo": the remove is only final once this is gone */
function UndoToast({ history, t }: { history: UseWatchHistoryReturn; t: AppTranslations }) {
  return (
    <div className="hx-toast-region" role="status" aria-live="polite">
      {history.lastRemoved && (
        <div className="hx-toast" data-testid="history-undo-toast">
          <span>{t.watchHistory.removed}</span>
          <button type="button" onClick={history.undoRemove} className="hx-toast-undo" data-testid="history-undo">
            {t.watchHistory.undo}
          </button>
        </div>
      )}
    </div>
  );
}

function LoadMore({ history, t }: { history: UseWatchHistoryReturn; t: AppTranslations }) {
  if (!history.hasMore) return null;
  return (
    <div className="flex justify-center mt-6">
      <Button variant="outline" onClick={history.loadMore} disabled={history.isLoadingMore}>
        {history.isLoadingMore ? t.common.loading : t.watchHistory.loadMore}
      </Button>
    </div>
  );
}

function Loading({ t }: { t: AppTranslations }) {
  return (
    <div className="flex justify-center py-12">
      <RefreshCw className="w-5 h-5 animate-spin" aria-label={t.common.loading} />
    </div>
  );
}

function Empty({ lang, t, text }: { lang: Lang; t: AppTranslations; text: string }) {
  return (
    <div className="hx-empty">
      <History className="w-16 h-16 mx-auto mb-4" aria-hidden="true" />
      <h2 className="text-xl font-semibold mb-2">{t.watchHistory.empty}</h2>
      <p className="mb-4">{text}</p>
      <Link href={`/${lang}`} className="hx-link-text">{t.watchHistory.browseVideos}</Link>
    </div>
  );
}

function Count({ history, lang, fallback }: { history: UseWatchHistoryReturn; lang: Lang; fallback: string }) {
  return <p className="hx-count">{history.total > 0 ? formatVideoCount(history.total, lang, { compact: true }) : fallback}</p>;
}

function ContinueWatchingView({ history, lang, t }: { history: UseWatchHistoryReturn; lang: Lang; t: AppTranslations }) {
  const errorMessage = watchHistoryErrorMessage(history.error, t);
  return (
    <div className="hx-wide">
      <header className="hx-head">
        <h1 className="hx-h1">{t.library.continueWatching}</h1>
        <Count history={history} lang={lang} fallback={t.watchHistory.continueSubtitle} />
        <Link href={`/${lang}/history`} data-testid="watch-history-view-switch" className="hx-switch">
          {t.watchHistory.allHistory}
        </Link>
        <span className="hx-head-end">
          <PauseHistoryButton history={history} t={t} />
        </span>
      </header>
      <PausedNotice history={history} t={t} />
      {errorMessage && <p className="hx-error" role="alert">{errorMessage}</p>}
      {history.isLoading && history.entries.length === 0 ? (
        <Loading t={t} />
      ) : history.entries.length === 0 ? (
        <Empty lang={lang} t={t} text={t.watchHistory.continueEmpty} />
      ) : (
        <>
          <ul className="hx-grid" data-testid="continue-grid">
            {history.entries.map((entry) => (
              <ContinueCard key={entry.videoId} entry={entry} lang={lang} t={t} onRemove={history.remove} />
            ))}
          </ul>
          <LoadMore history={history} t={t} />
        </>
      )}
    </div>
  );
}

function HistoryListView({ history, lang, t, query, onSearch, onClear }: {
  history: UseWatchHistoryReturn; lang: Lang; t: AppTranslations; query: string; onSearch: (q: string) => void; onClear: () => void;
}) {
  const [draft, setDraft] = useState(query);
  const errorMessage = watchHistoryErrorMessage(history.error, t);
  const days = groupByDay(history.entries, lang, { today: t.watchHistory.today, yesterday: t.watchHistory.yesterday });
  const searching = query.length > 0;

  return (
    <div className="hx-layout">
      <div className="hx-main">
        <header className="hx-main-head">
          <h1 className="hx-h1">{t.watchHistory.title}</h1>
          {!searching && <Count history={history} lang={lang} fallback={t.watchHistory.subtitle} />}
          <Link href={`/${lang}/history?view=continue`} data-testid="watch-history-view-switch" className="hx-switch">
            {t.library.continueWatching}
          </Link>
        </header>
        <PausedNotice history={history} t={t} />
        {errorMessage && <p className="hx-error" role="alert">{errorMessage}</p>}
        {searching && (
          <p className="hx-results" data-testid="watch-history-results">
            <span dir="auto">{t.watchHistory.searchResultsFor.replace('{query}', query)}</span>
            {history.searched !== null && history.searched >= 200 && (
              <span className="hx-results-note">{t.watchHistory.searchWindow.replace('{count}', formatNumber(lang, history.searched))}</span>
            )}
          </p>
        )}
        {history.isLoading && history.entries.length === 0 ? (
          <Loading t={t} />
        ) : history.entries.length === 0 ? (
          searching ? (
            <p className="hx-empty" dir="auto">{t.watchHistory.searchNoResults.replace('{query}', query)}</p>
          ) : (
            <Empty lang={lang} t={t} text={t.watchHistory.emptyDescription} />
          )
        ) : (
          <div className="hx-days">
            {days.map((day) => (
              <section key={day.key} className="hx-day" aria-labelledby={`hx-day-${day.key}`}>
                <h2 id={`hx-day-${day.key}`} className="hx-day-h">{day.label}</h2>
                <ul className="hx-rows">
                  {day.entries.map((entry) => (
                    <HistoryRow key={entry.videoId} entry={entry} lang={lang} t={t} onRemove={history.remove} />
                  ))}
                </ul>
              </section>
            ))}
            <LoadMore history={history} t={t} />
          </div>
        )}
      </div>

      <aside className="hx-side" aria-label={t.watchHistory.manage}>
        <form
          role="search"
          className="hx-search"
          onSubmit={(e) => {
            e.preventDefault();
            onSearch(draft.trim());
          }}
        >
          <label htmlFor="hx-search-input" className="sr-only">{t.watchHistory.searchLabel}</label>
          <input
            id="hx-search-input"
            type="search"
            value={draft}
            onChange={(e) => {
              setDraft(e.target.value);
              if (!e.target.value && searching) onClear();
            }}
            placeholder={t.watchHistory.searchLabel}
            className="hx-search-input"
            data-testid="watch-history-search"
            dir="auto"
            maxLength={200}
          />
          {searching ? (
            <button type="button" className="hx-search-btn" onClick={() => { setDraft(''); onClear(); }} aria-label={t.watchHistory.searchClear} title={t.watchHistory.searchClear}>
              <X aria-hidden="true" />
            </button>
          ) : (
            <button type="submit" className="hx-search-btn" aria-label={t.watchHistory.searchSubmit} title={t.watchHistory.searchSubmit}>
              <Search aria-hidden="true" />
            </button>
          )}
        </form>
        <div className="hx-side-actions">
          <PauseHistoryButton history={history} t={t} />
          <ClearAllButton history={history} t={t} show={searching || history.entries.length > 0} />
        </div>
      </aside>
    </div>
  );
}

function ClearAllButton({ history, t, show }: { history: UseWatchHistoryReturn; t: AppTranslations; show: boolean }) {
  const { confirm, dialog } = useConfirm();
  if (!show) return dialog;
  // Clearing all history is high impact: the user types the delete word first
  const handleClear = async () => {
    const confirmed = await confirm({
      title: t.confirmDialog.clearHistoryTitle,
      description: t.watchHistory.confirmClear,
      confirmLabel: t.watchHistory.clearAll,
      typeToConfirm: t.confirmDialog.deleteWord,
      testId: 'watch-history-clear-dialog',
    });
    if (confirmed) await history.clearAll();
  };
  return (
    <>
      {dialog}
      <Button variant="outline" size="sm" onClick={handleClear} disabled={history.isClearing} className="flex items-center gap-2">
        <Trash2 className="w-4 h-4" aria-hidden="true" />
        {history.isClearing ? t.watchHistory.clearing : t.watchHistory.clearAll}
      </Button>
    </>
  );
}

export default function WatchHistoryPage({ view = 'all' }: WatchHistoryPageProps = {}) {
  const { t, lang: pageLang, isRTL } = useLanguage();
  const lang: Lang = pageLang === 'ar' ? 'ar' : 'en';
  const dir = isRTL ? 'rtl' : 'ltr';
  const { user } = useAuth();
  const continueView = view === 'continue';
  const [query, setQuery] = useState('');
  // The Continue watching view: started, unfinished videos only. The whole history can be searched
  const history = useWatchHistory(!!user, continueView ? { completed: false } : { q: query });

  if (!user) {
    return (
      <div className="hx-signed-out" dir={dir}>
        <History className="w-16 h-16 mx-auto mb-4" aria-hidden="true" />
        <h1 className="text-2xl font-bold mb-2">{continueView ? t.library.continueWatching : t.watchHistory.title}</h1>
        <p>{t.watchHistory.signInRequired}</p>
      </div>
    );
  }

  return (
    <div className="hx" dir={dir} data-testid="watch-history-page" data-view={view}>
      {continueView ? (
        <ContinueWatchingView history={history} lang={lang} t={t} />
      ) : (
        <HistoryListView history={history} lang={lang} t={t} query={query} onSearch={setQuery} onClear={() => setQuery('')} />
      )}
      <UndoToast history={history} t={t} />
    </div>
  );
}
