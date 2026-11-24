'use client';

/**
 * "Your library" on the home page (#242, owner 2026-11-22): the signed-in viewer's Continue watching,
 * Watch later and Liked videos as playlist-style cards (PlaylistCardFrame: stacked cover, count badge,
 * an action over the cover), in one row under a rail-style heading.
 *
 * - Continue watching: the newest unfinished video on the cover with its progress; the card opens the
 *   history page's Continue watching view and Resume opens that video where it stopped. Left out while
 *   history is paused.
 * - Watch later and Liked videos: the first video of the list on the cover; the card opens the list and
 *   Play all plays it in place (lists WL and LL, docs/specs/PLAYLIST-PLAYBACK.md).
 *
 * A card with nothing in it is left out and the others share the row; with none, or signed out, there
 * is no row. Each list loads on its own and a failed one is simply left out (optional content never
 * shows an error); the row appears once all three have settled, so it never grows card by card.
 * Layout (theme/home-rails.css): three across on tablets and up; a card whose cell is wide enough lays
 * its cover beside the text, so one or two cards fill the row; a card alone also lists the next two
 * videos of its list ("Up next"), more to see rather than just a bigger picture. Phones swipe a row of
 * two or three.
 */

import React, { useEffect, useState } from 'react';
import Link from '@/components/common/AppLink';
import { ChevronRight, Library as LibraryIcon, Play } from 'lucide-react';
import { formatNumber, getLocalizedValue } from '@al-ummah/shared-types';
import VideoThumbnail, { THUMBNAIL_16_9 } from '@/components/VideoThumbnail';
import { PlaylistCardFrame } from '@/components/PlaylistCard/PlaylistCardFrame';
import { PlayAllOverlay } from '@/components/PlaylistCover/PlayAllOverlay';
import { MetaParts } from '@/components/common/MetaParts';
import { useAuth } from '@/components/AuthProvider/authContext';
import { useLanguage } from '@/hooks/useLanguage';
import { WatchHistoryService, entryTitle, type WatchHistoryItem } from '@/services/api/watch-history';
import { LibraryService, type LibraryVideo } from '@/services/api/library';
import { formatVideoCount, keepNumbersWithUnits } from '@/lib/format/videoMeta';
import { watchHref } from '@/lib/playlists/playback';
import { storedIndexOf } from '@/lib/playlists/playlist-utils';
import { channelLabel } from '@/lib/channel-name';
import { removeUnwantedChars } from '@/lib/utility';
import { logger } from '@/lib/logger-client';
import '@/theme/home-rails.css';

type ListKind = 'watch-later' | 'liked';

/** How many videos a card loads: its cover's and the two a lone wide card lists under "Up next" */
const LOAD = 3;

interface ContinueCard {
  kind: 'continue';
  top: WatchHistoryItem;
  next: WatchHistoryItem[];
  total: number;
}

interface ListCard {
  kind: ListKind;
  top: LibraryVideo;
  next: LibraryVideo[];
  total: number;
  /** The first video's index in the list's stored order (the watch URL's `index`) */
  index: number;
}

type LibraryCard = ContinueCard | ListCard;

const LIST: Record<ListKind, { alias: string; path: string }> = {
  'watch-later': { alias: 'WL', path: 'library/watch-later' },
  liked: { alias: 'LL', path: 'library/liked' },
};

const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));

/** Continue watching: the newest unfinished video and how many there are, unless history is paused */
async function loadContinue(): Promise<ContinueCard | null> {
  const [paused, page] = await Promise.all([WatchHistoryService.getPaused(), WatchHistoryService.list({ limit: LOAD, completed: false })]);
  // The service reads a malformed page as empty; this guards any other caller's shape too
  if (paused !== false || !page || !Array.isArray(page.entries) || page.entries.length === 0) return null;
  return { kind: 'continue', top: page.entries[0], next: page.entries.slice(1, LOAD), total: Math.max(page.total || 0, page.entries.length) };
}

async function loadList(kind: ListKind): Promise<ListCard | null> {
  const page = kind === 'watch-later' ? await LibraryService.watchLater({ limit: LOAD }) : await LibraryService.liked({ limit: LOAD });
  if (!page || !Array.isArray(page.items) || page.items.length === 0) return null;
  const top = page.items[0];
  const storedIds = 'videoIds' in page && Array.isArray(page.videoIds) ? page.videoIds : null;
  return { kind, top, next: page.items.slice(1, LOAD), total: Math.max(page.total || 0, page.items.length), index: storedIndexOf(storedIds, top.id, 0) };
}

/** One list's load: a failure leaves its card out and is logged, never thrown */
function settle<T>(load: Promise<T | null>, list: string): Promise<T | null> {
  return load.catch((error: unknown) => {
    logger.warn('[LibraryRow] Could not load a library list', { list, error: errorText(error) });
    return null;
  });
}

interface NextItem {
  key: string;
  title: string;
  thumbnail?: string;
  /** The channel, or how far it was watched */
  detail: string;
}

/**
 * The videos after the cover's one, shown only when the card has the row to itself (theme/home-rails.css). Part of the
 * card's link: a preview of what the list holds, not links of their own.
 */
function UpNext({ items, label, testId }: { items: NextItem[]; label: string; testId: string }) {
  if (items.length === 0) return null;
  return (
    <div className="hlib-next" data-testid={testId}>
      <p className="hlib-next-h">{label}</p>
      <ol>
        {items.map((item) => (
          <li key={item.key}>
            <span className="hlib-next-thumb">
              <VideoThumbnail src={item.thumbnail} alt="" style={THUMBNAIL_16_9} />
            </span>
            <span className="hlib-next-text">
              <span className="hlib-next-title" dir="auto">{item.title}</span>
              {item.detail && <span className="hlib-next-detail" dir="auto">{item.detail}</span>}
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
}

const actionClass =
  'inline-flex items-center gap-1.5 rounded-full bg-[var(--fanous-color-primary)] px-3 py-1.5 text-xs font-semibold text-[var(--fanous-color-on-primary)] shadow hover:bg-[var(--fanous-color-primary-hover)] hover:text-[var(--fanous-color-on-primary-hover)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--fanous-color-focus-ring)]';

export function LibraryRow() {
  const { user } = useAuth();
  const { t, lang } = useLanguage();
  const [cards, setCards] = useState<LibraryCard[] | null>(null);
  const userId = user?.id;

  useEffect(() => {
    setCards(null);
    if (!userId) return;
    let cancelled = false;
    void Promise.all([
      settle(loadContinue(), 'continue'),
      settle(loadList('watch-later'), 'watch-later'),
      settle(loadList('liked'), 'liked'),
    ]).then((loaded) => {
      if (!cancelled) setCards(loaded.filter((card): card is LibraryCard => card !== null));
    });
    return () => {
      cancelled = true;
    };
  }, [userId]);

  if (!cards || cards.length === 0) return null;

  const heading = t.library.homeRow;
  const headingId = 'home-library-heading';

  const percentOf = (entry: WatchHistoryItem) => Math.max(0, Math.min(100, Math.round(entry.percentageWatched || 0)));
  const watchedText = (percent: number) => keepNumbersWithUnits(t.watchHistory.percentWatched.replace('{percent}', formatNumber(lang, percent)));
  const videoTitle = (video: LibraryVideo) => removeUnwantedChars(getLocalizedValue(video.titleLocalized, video.title || '', lang));

  const renderCard = (card: LibraryCard) => {
    if (card.kind === 'continue') {
      const { top, total, next } = card;
      const title = removeUnwantedChars(entryTitle(top, lang));
      const percent = percentOf(top);
      const watched = watchedText(percent);
      return (
        <li key="continue" data-testid="continue-watching" data-video-id={top.videoId}>
          <PlaylistCardFrame
            href={`/${lang}/history?view=continue`}
            testId="continue-watching-card"
            title={t.library.continueWatching}
            countLabel={formatVideoCount(total, lang, { compact: true })}
            progress={percent}
            cover={(overlay) => (
              <VideoThumbnail src={top.videoThumbnail} alt="" style={THUMBNAIL_16_9}>
                {overlay}
              </VideoThumbnail>
            )}
            meta={
              <p className="plc-meta" data-testid="continue-watching-meta">
                <MetaParts
                  lang={lang}
                  stack="always"
                  parts={[
                    { key: 'title', node: <strong dir="auto">{title}</strong> },
                    { key: 'watched', keep: true, node: watched },
                  ]}
                />
              </p>
            }
            extra={
              <UpNext
                label={t.library.upNext}
                testId="continue-watching-next"
                items={next.map((entry) => ({ key: entry.videoId, title: removeUnwantedChars(entryTitle(entry, lang)), thumbnail: entry.videoThumbnail, detail: watchedText(percentOf(entry)) }))}
              />
            }
            action={
              <Link
                href={`/${lang}/video/${encodeURIComponent(top.videoId)}`}
                data-testid="continue-watching-resume"
                aria-label={t.watchHistory.resumeTopLabel.replace('{title}', title)}
                className={actionClass}
              >
                <Play className="h-3.5 w-3.5 fill-current" aria-hidden="true" />
                {t.watchHistory.resumeTop}
              </Link>
            }
          />
        </li>
      );
    }

    const { kind, top, total, index, next } = card;
    const listTitle = kind === 'watch-later' ? t.library.watchLater : t.library.likedVideos;
    const title = videoTitle(top);
    const channel = channelLabel(top, lang);
    const testId = `home-library-${kind}`;
    return (
      <li key={kind} data-testid={testId} data-video-id={top.id}>
        <PlaylistCardFrame
          href={`/${lang}/${LIST[kind].path}`}
          testId={`${testId}-card`}
          title={listTitle}
          countLabel={formatVideoCount(total, lang, { compact: true })}
          cover={(overlay) => (
            <VideoThumbnail src={top.thumbnailUrl} alt="" style={THUMBNAIL_16_9}>
              {overlay}
            </VideoThumbnail>
          )}
          meta={
            <p className="plc-meta" data-testid={`${testId}-meta`}>
              <MetaParts
                lang={lang}
                stack="always"
                parts={[
                  { key: 'title', node: <strong dir="auto">{title}</strong> },
                  ...(channel ? [{ key: 'channel', node: <span dir="auto">{channel}</span> }] : []),
                ]}
              />
            </p>
          }
          extra={
            <UpNext
              label={t.library.upNext}
              testId={`${testId}-next`}
              items={next.map((video) => ({ key: video.id, title: videoTitle(video), thumbnail: video.thumbnailUrl, detail: channelLabel(video, lang) }))}
            />
          }
          action={
            <PlayAllOverlay
              href={watchHref(lang, top.id, { list: LIST[kind].alias, index })}
              label={t.playlist.playAll}
              ariaLabel={t.library.playAllIn.replace('{list}', listTitle)}
              testId={`${testId}-play`}
            />
          }
        />
      </li>
    );
  };

  return (
    <section className="hlib" aria-labelledby={headingId} data-testid="home-library" data-count={cards.length}>
      <div className="hr-head">
        <span className="hr-badge" aria-hidden="true">
          <LibraryIcon />
        </span>
        <h2 id={headingId} className="hr-title street-plate">
          <span className="hr-title-text">{heading}</span>
        </h2>
        <span className="hr-rule" aria-hidden="true" />
        <Link href={`/${lang}/library`} className="hr-all" aria-label={t.rails.seeAllLabel.replace('{rail}', heading)} data-testid="home-library-all">
          {t.rails.seeAll}
          <ChevronRight aria-hidden="true" />
        </Link>
      </div>
      <ul className="hlib-list" data-count={cards.length}>
        {cards.map(renderCard)}
      </ul>
    </section>
  );
}

export default LibraryRow;
