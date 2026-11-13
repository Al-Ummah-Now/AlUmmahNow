'use client';

/**
 * The playlist pane on the watch page (docs/specs/PLAYLIST-PLAYBACK.md section 5): the playing
 * list in its saved order, the current video highlighted and kept in view inside the pane,
 * previous/next, loop, shuffle and collapse. Each item is a real link (new tab works); a plain
 * click plays it in place. Mirrored for RTL through logical properties.
 */

import React, { useEffect, useRef, type KeyboardEvent, type MouseEvent } from 'react';
import Link from '@/components/common/AppLink';
import { ChevronDown, ChevronUp, ListVideo, Lock, Play, Repeat, Shuffle, SkipBack, SkipForward } from 'lucide-react';
import { getLocalizedValue } from '@al-ummah/shared-types';
import { useLanguage } from '@/hooks/useLanguage';
import { pickLanguage } from '@/lib/format/pick-language';
import { removeUnwantedChars } from '@/lib/utility';
import { formatDuration, getPlaylistHref } from '@/lib/playlists/playlist-utils';
import type { QueueItem } from '@/lib/api/playlist-queue';
import type { PlaylistQueueState } from '@/hooks/usePlaylistQueue';
import { channelLabel } from '@/lib/channel-name';

export interface PlaylistPaneProps {
  queue: PlaylistQueueState;
  listId: string;
  loop: boolean;
  shuffle: boolean;
  collapsed: boolean;
  canPrevious: boolean;
  canNext: boolean;
  onToggleLoop: () => void;
  onToggleShuffle: () => void;
  onToggleCollapsed: () => void;
  onPrevious: () => void;
  onNext: () => void;
  /** Plays an item in place (client-side, with autoplay) */
  onPlay: (item: QueueItem) => void;
  hrefFor: (item: QueueItem) => string;
}

const iconButton =
  'inline-flex h-9 w-9 items-center justify-center rounded-full text-[var(--fanous-color-text-primary)] hover:bg-[var(--fanous-color-surface-raised)] disabled:opacity-40 disabled:hover:bg-transparent focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--fanous-color-focus-ring)] aria-pressed:text-[var(--fanous-color-accent)] aria-pressed:bg-[var(--fanous-color-surface-raised)]';

export function PlaylistPane(props: PlaylistPaneProps) {
  const { queue, listId, loop, shuffle, collapsed } = props;
  const { t, lang, isRTL } = useLanguage();
  const tp = t.playlist;
  const listRef = useRef<HTMLOListElement | null>(null);
  const currentRef = useRef<HTMLAnchorElement | null>(null);
  const headingId = `playlist-pane-title-${listId}`;
  const listDomId = `playlist-pane-list-${listId}`;

  // The current item stays in view inside the pane; the page itself never scrolls
  useEffect(() => {
    const list = listRef.current;
    const current = currentRef.current?.closest('li');
    if (!list || !current || collapsed) return;
    const top = current.offsetTop - list.offsetTop;
    if (top < list.scrollTop || top + current.offsetHeight > list.scrollTop + list.clientHeight) {
      list.scrollTop = Math.max(0, top - list.clientHeight / 2 + current.offsetHeight / 2);
    }
  }, [queue.position, queue.items.length, collapsed]);

  const summary = queue.summary;
  const title = !summary
    ? tp.queueLabel
    : summary.kind === 'watch_later'
      ? t.library.watchLater
      : summary.kind === 'liked'
        ? t.library.likedVideos
        : removeUnwantedChars(getLocalizedValue(summary.titleLocalized, pickLanguage(summary.title || '', lang), lang));
  const titleHref = !summary
    ? null
    : summary.kind === 'watch_later'
      ? `/${lang}/library/watch-later`
      : summary.kind === 'liked'
        ? `/${lang}/library/liked`
        : getPlaylistHref(lang, summary.id);
  const owner = summary?.kind === 'playlist' ? channelLabel(summary, lang) : tp.you;
  const ownerHref = summary?.kind === 'playlist' && summary.channelId
    ? (summary.channelHandle ? `/${lang}/@${encodeURIComponent(summary.channelHandle)}` : `/${lang}/channels/${encodeURIComponent(summary.channelId)}`)
    : null;
  const total = queue.total.toLocaleString(lang);
  const positionText = tp.position
    .replace('{position}', queue.position === null ? '–' : (queue.position + 1).toLocaleString(lang))
    .replace('{total}', total);

  // Arrow keys move between items (roving through the links)
  const onListKeyDown = (event: KeyboardEvent<HTMLOListElement>) => {
    const links = Array.from(listRef.current?.querySelectorAll<HTMLAnchorElement>('a[data-queue-link]') ?? []);
    const at = links.indexOf(document.activeElement as HTMLAnchorElement);
    let next = -1;
    if (event.key === 'ArrowDown') next = Math.min(links.length - 1, at + 1);
    else if (event.key === 'ArrowUp') next = Math.max(0, at - 1);
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = links.length - 1;
    if (next < 0) return;
    event.preventDefault();
    links[next]?.focus();
  };

  const onItemClick = (event: MouseEvent<HTMLAnchorElement>, item: QueueItem) => {
    // New tab, new window and download keep the link's own behaviour
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    props.onPlay(item);
  };

  return (
    <section
      aria-labelledby={headingId}
      dir={isRTL ? 'rtl' : 'ltr'}
      className="mb-4 overflow-hidden rounded-xl border border-[var(--fanous-color-divider)] bg-[var(--fanous-color-surface)]"
      data-testid="playlist-pane"
      data-list={listId}
      data-collapsed={collapsed || undefined}
    >
      <header className="flex flex-col gap-1 px-4 pt-3 pb-2">
        <div className="flex items-start gap-2">
          <ListVideo className="mt-1 h-5 w-5 shrink-0 text-[var(--fanous-color-accent)]" aria-hidden="true" />
          <div className="min-w-0 flex-1">
            <h2 id={headingId} className="truncate text-base font-bold text-[var(--fanous-color-text-primary)]">
              {titleHref ? <Link href={titleHref} className="hover:underline">{title}</Link> : title}
            </h2>
            <p className="flex flex-wrap items-center gap-x-2 text-sm text-[var(--fanous-color-text-secondary)]">
              {owner && (
                <span>
                  {ownerHref ? <Link href={ownerHref} className="hover:underline">{owner}</Link> : owner}
                </span>
              )}
              {summary && !summary.isPublic && <Lock className="h-3.5 w-3.5" aria-label={tp.privateLabel} />}
              {queue.status === 'ready' && (
                <span className="tabular-nums" data-testid="playlist-pane-position" aria-live="polite">
                  {positionText}
                </span>
              )}
            </p>
            {queue.status === 'ready' && queue.position === null && (
              <p className="text-xs text-[var(--fanous-color-text-muted)]" data-testid="playlist-pane-not-in-list">{tp.notInPlaylist}</p>
            )}
          </div>
        </div>
        <div className="flex items-center gap-1" role="group" aria-label={tp.queueLabel}>
          <button type="button" className={iconButton} onClick={props.onPrevious} disabled={!props.canPrevious} aria-label={tp.previousVideo} title={tp.previousVideo} data-testid="playlist-pane-previous">
            <SkipBack className="h-4 w-4" aria-hidden="true" />
          </button>
          <button type="button" className={iconButton} onClick={props.onNext} disabled={!props.canNext} aria-label={tp.nextVideo} title={tp.nextVideo} data-testid="playlist-pane-next">
            <SkipForward className="h-4 w-4" aria-hidden="true" />
          </button>
          <button type="button" className={iconButton} onClick={props.onToggleLoop} aria-pressed={loop} aria-label={tp.loop} title={tp.loop} data-testid="playlist-pane-loop">
            <Repeat className="h-4 w-4" aria-hidden="true" />
          </button>
          <button type="button" className={iconButton} onClick={props.onToggleShuffle} aria-pressed={shuffle} aria-label={tp.shuffle} title={tp.shuffle} data-testid="playlist-pane-shuffle">
            <Shuffle className="h-4 w-4" aria-hidden="true" />
          </button>
          <button
            type="button"
            className={`${iconButton} ms-auto`}
            onClick={props.onToggleCollapsed}
            aria-expanded={!collapsed}
            aria-controls={listDomId}
            aria-label={collapsed ? tp.showQueue : tp.hideQueue}
            title={collapsed ? tp.showQueue : tp.hideQueue}
            data-testid="playlist-pane-collapse"
          >
            {collapsed ? <ChevronDown className="h-4 w-4" aria-hidden="true" /> : <ChevronUp className="h-4 w-4" aria-hidden="true" />}
          </button>
        </div>
      </header>

      <div id={listDomId} hidden={collapsed}>
        {queue.status === 'loading' && (
          <p role="status" className="px-4 pb-3 text-sm text-[var(--fanous-color-text-muted)]">{t.common.loading}</p>
        )}
        {queue.status === 'error' && (
          <div role="alert" className="px-4 pb-3 text-sm text-[var(--fanous-color-error-text)]">
            {tp.queueLoadError}{' '}
            <button type="button" onClick={queue.retry} className="font-medium underline">{tp.retry}</button>
          </div>
        )}
        {queue.status === 'ready' && (
          <>
            {queue.hasEarlier && (
              <button type="button" onClick={queue.loadEarlier} className="w-full px-4 py-2 text-sm font-medium text-[var(--fanous-color-link)] hover:bg-[var(--fanous-color-surface-raised)]" data-testid="playlist-pane-earlier">
                {tp.loadEarlier}
              </button>
            )}
            <ol
              ref={listRef}
              className="max-h-[min(60vh,28rem)] overflow-y-auto overscroll-contain pb-2"
              onKeyDown={onListKeyDown}
              data-testid="playlist-pane-list"
            >
              {queue.items.map((item) => {
                const current = item.position === queue.position;
                const itemTitle = removeUnwantedChars(getLocalizedValue(item.titleLocalized, item.title, lang));
                const duration = formatDuration(item.duration ?? undefined);
                return (
                  <li key={`${item.position}:${item.id}`} className="[content-visibility:auto] [contain-intrinsic-size:auto_72px]">
                    <a
                      ref={current ? currentRef : undefined}
                      href={props.hrefFor(item)}
                      onClick={(event) => onItemClick(event, item)}
                      aria-current={current ? 'true' : undefined}
                      aria-label={current ? `${tp.nowPlaying}: ${itemTitle}` : tp.playItem.replace('{title}', itemTitle)}
                      data-queue-link=""
                      data-testid="playlist-pane-item"
                      data-video-id={item.id}
                      data-position={item.position}
                      className={`flex items-center gap-3 px-3 py-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--fanous-color-focus-ring)] ${
                        current ? 'bg-[var(--fanous-color-surface-raised)]' : 'hover:bg-[var(--fanous-color-surface-raised)]'
                      }`}
                    >
                      <span className="w-6 shrink-0 text-center text-xs tabular-nums text-[var(--fanous-color-text-muted)]" aria-hidden="true">
                        {current ? <Play className="mx-auto h-3.5 w-3.5 fill-current text-[var(--fanous-color-accent)]" /> : (item.position + 1).toLocaleString(lang)}
                      </span>
                      <span className="relative block aspect-video w-24 shrink-0 overflow-hidden rounded-md bg-[var(--fanous-color-surface-raised)]">
                        {item.thumbnailUrl && (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={item.thumbnailUrl} alt="" loading="lazy" decoding="async" className="h-full w-full object-cover" />
                        )}
                        {duration && (
                          <span className="absolute bottom-1 end-1 rounded bg-[var(--fanous-color-surface)] px-1 text-[11px] font-medium tabular-nums text-[var(--fanous-color-text-primary)]" dir="ltr">
                            {duration}
                          </span>
                        )}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className={`line-clamp-2 text-sm ${current ? 'font-semibold' : 'font-medium'} text-[var(--fanous-color-text-primary)]`}>{itemTitle}</span>
                        {item.channelName && summary?.kind !== 'playlist' && (
                          <span className="block truncate text-xs text-[var(--fanous-color-text-secondary)]">{channelLabel(item, lang)}</span>
                        )}
                      </span>
                    </a>
                  </li>
                );
              })}
            </ol>
            {queue.hasLater && (
              <button type="button" onClick={queue.loadLater} className="w-full px-4 py-2 text-sm font-medium text-[var(--fanous-color-link)] hover:bg-[var(--fanous-color-surface-raised)]" data-testid="playlist-pane-later">
                {tp.loadLater}
              </button>
            )}
          </>
        )}
      </div>
    </section>
  );
}

export default PlaylistPane;
