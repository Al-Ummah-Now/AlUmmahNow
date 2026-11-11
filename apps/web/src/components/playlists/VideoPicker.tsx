'use client';

/**
 * Pick videos of a channel, Shorts included: search, a format filter
 * (all / videos / Shorts), multi-select with "select all on this page", and
 * pages over every video through the API cursor. The selection keeps the
 * order the videos were chosen in (the order they are added to a playlist).
 *
 * Shared by the playlist editor, the create form and "Add to playlist"; the
 * upload flows can use it too.
 */

import { Autocomplete, Highlight, type AutocompleteOption } from '@/components/ui/Autocomplete';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, Search, X, Film, Check } from 'lucide-react';
import { useLanguage } from '@/hooks/useLanguage';
import { listVideos } from '@/lib/api/videos';
import { reportError } from '@/lib/errors/reporter';
import type { VideoObject } from '@/interfaces';
import '@/theme/playlist-tools.css';
import { counted, fill, formatDuration, localTitle } from './text';
import { FAINT, MUTED, NOTICE, TEXT } from './styles';

export type PickerFormat = 'all' | 'video' | 'short';

/** What the picker remembers of a chosen video (for the ordered selection tray). */
export interface PickedVideo {
  id: string;
  title: string;
  titleLocalized?: Record<string, string>;
  thumbnailUrl?: string;
  isShort?: boolean;
}

interface Props {
  channelId: string;
  /** Chosen videos, in the order they were chosen. */
  selected: PickedVideo[];
  onChange: (next: PickedVideo[]) => void;
  /** Videos already in the playlist: shown, but not selectable. */
  excludeIds?: ReadonlySet<string>;
  pageSize?: number;
  /** Prefix for element ids. */
  idPrefix?: string;
  /** The caller shows the selection itself (the create form's reorderable list) */
  hideTray?: boolean;
}

/** Fetches per page at most, while a title search keeps coming back short. */
const MAX_FILL_FETCHES = 8;
const SEARCH_DELAY_MS = 300;

type Page = { videos: VideoObject[]; next: string | null };

export function toPicked(video: Pick<VideoObject, 'id' | 'title' | 'titleLocalized' | 'thumbnailUrl'> & { isShort?: boolean }): PickedVideo {
  return {
    id: video.id,
    title: video.title,
    ...(video.titleLocalized ? { titleLocalized: video.titleLocalized } : {}),
    ...(video.thumbnailUrl ? { thumbnailUrl: video.thumbnailUrl } : {}),
    ...(video.isShort ? { isShort: true } : {}),
  };
}

export default function VideoPicker({ channelId, selected, onChange, excludeIds, pageSize = 24, idPrefix = 'picker', hideTray }: Props) {
  const { t, lang, isRTL } = useLanguage();
  const p = t.playlistTools;
  const [query, setQuery] = useState('');
  const [debounced, setDebounced] = useState('');
  const [format, setFormat] = useState<PickerFormat>('all');
  // cursors[i] is the cursor that loads page i (page 0: none)
  const [cursors, setCursors] = useState<(string | null)[]>([null]);
  const [pageIndex, setPageIndex] = useState(0);
  const [page, setPage] = useState<Page | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const request = useRef(0);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(query.trim()), SEARCH_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [query]);

  // A new search or filter starts at page 1
  useEffect(() => {
    // Same array when already at the start, so the first page loads once
    setCursors((prev) => (prev.length === 1 && prev[0] === null ? prev : [null]));
    setPageIndex(0);
  }, [debounced, format, channelId]);

  const load = useCallback(async (cursor: string | null) => {
    const id = ++request.current;
    setLoading(true);
    setFailed(false);
    try {
      const videos: VideoObject[] = [];
      let next: string | null = cursor;
      // The API filters after reading, so a search page can come back short
      // with a cursor: keep following it until the page is full or it ends
      for (let fetches = 0; fetches < MAX_FILL_FETCHES; fetches++) {
        const result = await listVideos({
          channelId,
          limit: pageSize - videos.length,
          ...(next ? { cursor: next } : {}),
          ...(format !== 'all' ? { format } : {}),
          ...(debounced ? { q: debounced } : {}),
        }, { channelId });
        if (!result) throw new Error('listVideos returned no answer');
        videos.push(...(result.data || []));
        next = (result as { cursor?: string }).cursor || null;
        if (!next || videos.length >= pageSize) break;
      }
      if (id !== request.current) return;
      setPage({ videos, next });
    } catch (error) {
      if (id !== request.current) return;
      reportError(error, { shown: true, extra: { step: 'playlist-picker-load', channelId, format, searching: Boolean(debounced) } });
      setFailed(true);
      setPage(null);
    } finally {
      if (id === request.current) setLoading(false);
    }
  }, [channelId, pageSize, format, debounced]);

  useEffect(() => {
    void load(cursors[pageIndex] ?? null);
  }, [load, cursors, pageIndex]);

  const selectedIds = useMemo(() => new Set(selected.map((v) => v.id)), [selected]);
  const selectable = (page?.videos ?? []).filter((v) => !excludeIds?.has(v.id));
  const allOnPage = selectable.length > 0 && selectable.every((v) => selectedIds.has(v.id));

  const toggle = (video: VideoObject) => {
    if (excludeIds?.has(video.id)) return;
    onChange(selectedIds.has(video.id) ? selected.filter((v) => v.id !== video.id) : [...selected, toPicked(video)]);
  };

  const suggest = useCallback(async (q: string, signal: AbortSignal): Promise<AutocompleteOption[]> => {
    const result = await listVideos({ channelId, limit: 8, q, ...(format !== 'all' ? { format } : {}) }, { channelId });
    if (signal.aborted || !result) return [];
    return (result.data || []).map((video) => ({
      id: video.id,
      label: localTitle(video, lang),
      subtitle: [video.isShort ? p.shortBadge : null, formatDuration(video.duration) || null].filter(Boolean).join(' · ') || undefined,
      thumbnailUrl: video.thumbnailUrl,
      thumbnailShape: 'wide' as const,
      value: video,
    }));
  }, [channelId, format, lang, p.shortBadge]);

  const toggleAllOnPage = () => {
    if (allOnPage) {
      const drop = new Set(selectable.map((v) => v.id));
      onChange(selected.filter((v) => !drop.has(v.id)));
    } else {
      onChange([...selected, ...selectable.filter((v) => !selectedIds.has(v.id)).map(toPicked)]);
    }
  };

  const goNext = () => {
    if (!page?.next) return;
    setCursors((prev) => {
      const copy = prev.slice(0, pageIndex + 1);
      copy[pageIndex + 1] = page.next;
      return copy;
    });
    setPageIndex((i) => i + 1);
  };

  const Prev = isRTL ? ChevronRight : ChevronLeft;
  const Next = isRTL ? ChevronLeft : ChevronRight;
  const formats: { key: PickerFormat; label: string }[] = [
    { key: 'all', label: p.formatAll },
    { key: 'video', label: p.formatVideos },
    { key: 'short', label: p.formatShorts },
  ];

  return (
    <div className="pl-picker space-y-3" data-testid="video-picker">
      <p className={`text-sm ${MUTED}`}>{p.pickerHelp}</p>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        {/* The standard live autocomplete: suggestions as you type (tick one to select it), and the
            grid below filters to the same text */}
        <Autocomplete
          className="flex-1"
          value={query}
          onValueChange={setQuery}
          load={suggest}
          loadKey={`${channelId}:${format}`}
          minChars={1}
          maxOptions={8}
          keepOpenOnSelect
          onSelect={(option) => toggle(option.value as VideoObject)}
          onSubmit={() => undefined}
          decorate={(option) => {
            const excluded = excludeIds?.has(option.id) ?? false;
            return { selected: selectedIds.has(option.id) || excluded, disabled: excluded };
          }}
          label={p.searchLabel}
          inputId={`${idPrefix}-search`}
          inputProps={{ type: 'search', placeholder: p.searchLabel }}
          inputClassName="f-input f-icon-start w-full py-2 text-sm"
          testId="picker-search"
          popupTestId="picker-suggestions"
          optionTestId={() => 'picker-suggestion'}
        >
          <Search className={`pointer-events-none absolute start-3 top-[22px] h-4 w-4 -translate-y-1/2 ${FAINT}`} aria-hidden="true" />
        </Autocomplete>
        <div role="group" aria-label={p.formatLabel} className="flex flex-wrap gap-2">
          {formats.map((f) => (
            <button
              key={f.key}
              type="button"
              className="chip"
              aria-pressed={format === f.key}
              onClick={() => setFormat(f.key)}
              data-testid={`picker-format-${f.key}`}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <label className={`relative inline-flex cursor-pointer items-center gap-2 text-sm font-medium ${TEXT} ${selectable.length === 0 ? 'opacity-50' : ''}`}>
          <input
            type="checkbox"
            className="peer pl-hit"
            checked={allOnPage}
            disabled={selectable.length === 0 || loading}
            onChange={toggleAllOnPage}
            data-testid="picker-select-page"
          />
          <span className="ck pl-ck" data-on={allOnPage || undefined} aria-hidden="true">{allOnPage && <Check />}</span>
          {p.selectAllOnPage}
        </label>
        {/* The grid's match count is announced (the autocomplete announces its own suggestions) */}
        <span className="sr-only" role="status" aria-live="polite" data-testid="picker-match-count">
          {debounced && !loading && page ? (selectable.length === 1 ? t.search.foundOneResult : t.search.foundResults.replace('{count}', String(selectable.length))) : ''}
        </span>
        <span className={`text-sm ${MUTED}`} aria-live="polite" data-testid="picker-selected-count">
          {counted(selected.length, p.selectedOne, p.selectedOther)}
        </span>
      </div>

      {failed ? (
        <div role="alert" className={`flex flex-wrap items-center justify-between gap-3 rounded-[var(--r-md)] px-4 py-3 text-sm ${NOTICE.error}`}>
          <span>{p.loadVideosFailed}</span>
          <button type="button" className="b b-secondary b-sm" onClick={() => void load(cursors[pageIndex] ?? null)}>{p.tryAgain}</button>
        </div>
      ) : loading && !page ? (
        <ul className="grid gap-2 sm:grid-cols-2" aria-busy="true" aria-label={p.loadingVideos}>
          {Array.from({ length: 6 }, (_, i) => (
            <li key={i} className="flex items-center gap-3 p-2"><span className="sk h-12 w-20 flex-none" /><span className="sk h-4 flex-1" /></li>
          ))}
        </ul>
      ) : page && page.videos.length === 0 ? (
        <div className="empty">
          <Film className="h-10 w-10" aria-hidden="true" />
          <p>{debounced || format !== 'all' ? p.noMatches : p.noChannelVideos}</p>
        </div>
      ) : (
        <ul className={`grid gap-1 sm:grid-cols-2 ${loading ? 'opacity-60' : ''}`} aria-busy={loading} data-testid="picker-list">
          {page?.videos.map((video) => {
            const title = localTitle(video, lang);
            const inPlaylist = excludeIds?.has(video.id) ?? false;
            const checked = selectedIds.has(video.id);
            const position = checked ? selected.findIndex((v) => v.id === video.id) + 1 : 0;
            const duration = formatDuration(video.duration);
            return (
              <li key={video.id}>
                <label
                  className={`pl-row relative flex items-center gap-3 p-2 ${inPlaylist ? 'cursor-default opacity-60' : 'cursor-pointer'}`}
                  data-selected={checked || undefined}
                  data-testid="picker-video"
                  data-video-id={video.id}
                >
                  <input
                    type="checkbox"
                    className="peer pl-hit"
                    checked={checked || inPlaylist}
                    disabled={inPlaylist}
                    onChange={() => toggle(video)}
                    aria-label={fill(p.selectVideo, { title })}
                  />
                  <span className="ck pl-ck flex-none" data-on={checked || inPlaylist || undefined} aria-hidden="true">
                    {position > 0 ? <span className="pl-ck-num">{position}</span> : inPlaylist ? <Check /> : null}
                  </span>
                  <span className={`pl-thumb flex-none ${video.isShort ? 'pl-thumb-short' : ''}`}>
                    {video.thumbnailUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={video.thumbnailUrl} alt="" loading="lazy" />
                    ) : (
                      <Film className="h-5 w-5" aria-hidden="true" />
                    )}
                    {duration && <span className="pl-dur">{duration}</span>}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className={`line-clamp-2 text-sm font-medium ${TEXT}`} dir="auto"><Highlight text={title} query={debounced} /></span>
                    <span className="mt-1 flex flex-wrap gap-1">
                      {video.isShort && <span className="bdg bdg-ok">{p.shortBadge}</span>}
                      {video.isPublic === false && <span className="bdg pl-bdg-muted">{t.playlist.privateLabel}</span>}
                      {video.uploadStatus && video.uploadStatus !== 'ready' && <span className="bdg pl-bdg-muted">{p.processingBadge}</span>}
                      {inPlaylist && <span className="bdg pl-bdg-muted">{p.inPlaylist}</span>}
                    </span>
                  </span>
                </label>
              </li>
            );
          })}
        </ul>
      )}

      <nav className="flex items-center justify-between gap-2" aria-label={p.pagerLabel}>
        <button type="button" className="b b-secondary b-sm" onClick={() => setPageIndex((i) => Math.max(0, i - 1))} disabled={pageIndex === 0 || loading} data-testid="picker-prev">
          <Prev aria-hidden="true" />
          {p.previousPage}
        </button>
        <span className={`text-sm ${MUTED}`} aria-live="polite" data-testid="picker-page">{fill(p.pageLabel, { page: pageIndex + 1 })}</span>
        <button type="button" className="b b-secondary b-sm" onClick={goNext} disabled={!page?.next || loading} data-testid="picker-next">
          {p.nextPage}
          <Next aria-hidden="true" />
        </button>
      </nav>

      {selected.length > 0 && !hideTray && (
        <div className="pl-tray rounded-[var(--r-md)] p-3" data-testid="picker-tray">
          <div className="mb-2 flex items-center justify-between gap-2">
            <h4 className={`text-sm font-semibold ${TEXT}`}>{p.selectedHeading}</h4>
            <button type="button" className="b b-ghost b-sm" onClick={() => onChange([])}>{p.clearSelection}</button>
          </div>
          <ol className="flex flex-wrap gap-2">
            {selected.map((video, i) => {
              const title = localTitle(video, lang);
              return (
                <li key={video.id} className="pl-pill inline-flex max-w-full items-center gap-1.5 ps-2.5" data-testid="picker-tray-item">
                  <span className={`text-xs font-semibold ${MUTED}`}>{i + 1}</span>
                  <span className={`max-w-[14rem] truncate text-sm ${TEXT}`}>{title}</span>
                  <button type="button" className="pl-pill-x" onClick={() => onChange(selected.filter((v) => v.id !== video.id))} aria-label={fill(p.unselect, { title })}>
                    <X className="h-3.5 w-3.5" aria-hidden="true" />
                  </button>
                </li>
              );
            })}
          </ol>
        </div>
      )}
    </div>
  );
}
