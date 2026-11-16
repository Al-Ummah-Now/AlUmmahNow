'use client';

import { forwardRef, useId, useMemo, useState } from 'react';
import { ListVideo, Search } from 'lucide-react';
import type { YtImportItem, YtImportPlaylist, YtVisibilityMode } from '@al-ummah/shared-types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { OptionCard } from '@/components/ui/OptionCard';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useLanguage } from '@/hooks/useLanguage';
import { filterItems, pickable, playlistItemIds } from '@/lib/youtube-import/wizard';
import { num, useFill, formatDate, StepHeading, Thumb, VisibilityBadge } from './parts';

const PAGE = 100;

interface Props {
  locale: string;
  items: YtImportItem[];
  playlists: YtImportPlaylist[];
  selected: ReadonlySet<string>;
  onSelected: (next: Set<string>) => void;
  selectedPlaylists: ReadonlySet<string>;
  onSelectedPlaylists: (next: Set<string>) => void;
  visibilityMode: YtVisibilityMode;
  onVisibilityMode: (mode: YtVisibilityMode) => void;
  saving: boolean;
  error: string;
  onNext: () => void;
}

export const PickStep = forwardRef<HTMLHeadingElement, Props>(function PickStep(props, headingRef) {
  const { locale, items, playlists, selected, onSelected, selectedPlaylists, onSelectedPlaylists, visibilityMode, onVisibilityMode, saving, error, onNext } = props;
  const { t, lang } = useLanguage();
  const fill = useFill();
  const text = t.studio.youtube.pick;
  const ids = useId();
  const [query, setQuery] = useState('');
  const [limit, setLimit] = useState(PAGE);
  const [hint, setHint] = useState('');

  const shown = useMemo(() => filterItems(items, query), [items, query]);
  const pickableShown = shown.filter(pickable);
  const total = items.filter(pickable).length;
  const allShownSelected = pickableShown.length > 0 && pickableShown.every((i) => selected.has(i.id));

  const toggle = (id: string) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    onSelected(next);
    setHint('');
  };

  const toggleAll = () => {
    const next = new Set(selected);
    for (const i of pickableShown) {
      if (allShownSelected) next.delete(i.id);
      else next.add(i.id);
    }
    onSelected(next);
    setHint('');
  };

  const next = () => {
    if (selected.size === 0) {
      setHint(text.nothingSelected);
      return;
    }
    onNext();
  };

  const counter = fill(text.selectedCount, { count: selected.size, total });

  return (
    <section className="yt-panel" data-testid="yt-pick">
      <StepHeading ref={headingRef} testId="yt-step-heading">{text.heading}</StepHeading>

      <Tabs defaultValue="videos" dir={locale === 'ar' ? 'rtl' : 'ltr'}>
        <TabsList className="mb-4">
          <TabsTrigger value="videos" className="min-h-9" data-testid="yt-tab-videos">{text.videosTab} <span className="ms-1.5 tabular-nums text-muted-foreground">{num(lang, items.length)}</span></TabsTrigger>
          <TabsTrigger value="playlists" className="min-h-9" data-testid="yt-tab-playlists">{text.playlistsTab} <span className="ms-1.5 tabular-nums text-muted-foreground">{num(lang, playlists.length)}</span></TabsTrigger>
        </TabsList>

        <TabsContent value="videos" className="mt-0">
          <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center">
            <div className="relative flex-1">
              <label htmlFor={`${ids}-search`} className="sr-only">{text.search}</label>
              <Search className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
              <Input id={`${ids}-search`} type="search" value={query} onChange={(e) => { setQuery(e.target.value); setLimit(PAGE); }} placeholder={text.search} className="min-h-11 ps-9" dir="auto" data-testid="yt-search" />
            </div>
            <div className="flex items-center gap-2">
              <Button variant="outline" className="min-h-11" onClick={toggleAll} disabled={pickableShown.length === 0} data-testid="yt-select-all">
                {allShownSelected ? text.clear : text.selectAll}
              </Button>
            </div>
          </div>

          {shown.length === 0 ? (
            <p className="rounded-lg border border-dashed border-border py-10 text-center text-sm text-muted-foreground" data-testid="yt-no-results">{text.noResults}</p>
          ) : (
            <ul className="yt-list" aria-label={text.videosTab} data-testid="yt-video-list">
              {shown.slice(0, limit).map((item) => {
                const disabled = !pickable(item);
                const checked = !disabled && selected.has(item.id);
                const scheduled = item.ytVisibility === 'private' && !!item.publishAt && new Date(item.publishAt).getTime() > Date.now();
                return (
                  <li key={item.id}>
                    <label className="yt-row" data-checked={checked || undefined} data-disabled={disabled || undefined} data-testid="yt-video-row" data-item-id={item.id}>
                      <input type="checkbox" className="yt-check" checked={checked} disabled={disabled} onChange={() => toggle(item.id)} aria-describedby={`${ids}-${item.id}-meta`} data-testid="yt-video-check" />
                      <Thumb item={item} className="w-28 sm:w-36" />
                      <span className="min-w-0 flex-1">
                        <span className="line-clamp-2 text-sm font-medium text-foreground"><bdi>{item.title}</bdi></span>
                        <span id={`${ids}-${item.id}-meta`} className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                          <VisibilityBadge visibility={item.ytVisibility} scheduled={scheduled} />
                          {item.publishedAt && <span><span className="sr-only">{text.published} </span>{formatDate(item.publishedAt, locale)}</span>}
                          {item.madeForKids && <span className="yt-chip">{text.madeForKids}</span>}
                          {disabled && <span className="yt-chip yt-chip-done" data-testid="yt-imported">{text.imported}</span>}
                        </span>
                      </span>
                    </label>
                  </li>
                );
              })}
            </ul>
          )}
          {shown.length > limit && (
            <div className="mt-3 text-center">
              <Button variant="ghost" className="min-h-11" onClick={() => setLimit((n) => n + PAGE)} data-testid="yt-show-more">{text.showMore}</Button>
            </div>
          )}
        </TabsContent>

        <TabsContent value="playlists" className="mt-0">
          <ul className="grid gap-3 md:grid-cols-2" data-testid="yt-playlist-list">
            {playlists.map((pl) => {
              const own = playlistItemIds(pl, items);
              const recreate = selectedPlaylists.has(pl.ytPlaylistId);
              const allIn = own.length > 0 && own.every((id) => selected.has(id));
              return (
                <li key={pl.ytPlaylistId} className="yt-card flex flex-col gap-3 p-4" data-testid="yt-playlist-row">
                  <div className="flex items-start gap-3">
                    <span className="yt-pl-icon" aria-hidden="true"><ListVideo className="h-5 w-5" /></span>
                    <div className="min-w-0 flex-1">
                      <p className="line-clamp-2 font-medium text-foreground"><bdi>{pl.title}</bdi></p>
                      <p className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                        <VisibilityBadge visibility={pl.ytVisibility} />
                        {fill(text.playlistVideos, { count: pl.ytVideoIds.length })}
                      </p>
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                    <label className="flex min-h-11 items-center gap-2 text-sm text-foreground">
                      <input
                        type="checkbox"
                        className="yt-check"
                        checked={recreate}
                        onChange={() => {
                          const nextSet = new Set(selectedPlaylists);
                          if (recreate) nextSet.delete(pl.ytPlaylistId);
                          else nextSet.add(pl.ytPlaylistId);
                          onSelectedPlaylists(nextSet);
                        }}
                        data-testid="yt-playlist-recreate"
                      />
                      {text.playlistImport}
                    </label>
                    <Button
                      variant="outline"
                      size="sm"
                      className="min-h-11"
                      disabled={own.length === 0 || allIn}
                      onClick={() => {
                        onSelected(new Set([...selected, ...own]));
                        setHint('');
                      }}
                      data-testid="yt-playlist-select"
                    >
                      {text.selectPlaylistVideos}
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
        </TabsContent>
      </Tabs>

      <fieldset className="mt-6">
        <legend className="mb-2 text-sm font-semibold text-foreground">{text.visibilityHeading}</legend>
        <div className="grid gap-2 md:grid-cols-2">
          <OptionCard name={`${ids}-vis`} value="keep" checked={visibilityMode === 'keep'} onSelect={() => onVisibilityMode('keep')} title={text.keepVisibility} help={text.keepVisibilityHelp} inputTestId="yt-vis-keep" />
          <OptionCard name={`${ids}-vis`} value="private" checked={visibilityMode === 'private'} onSelect={() => onVisibilityMode('private')} title={text.allPrivate} help={text.allPrivateHelp} inputTestId="yt-vis-private" />
        </div>
      </fieldset>

      <div className="yt-footer">
        <p className="text-sm text-foreground" aria-live="polite" data-testid="yt-selected-count">{counter}</p>
        <div className="flex flex-col items-end gap-1">
          {(hint || error) && <p role="alert" className="yt-error text-sm">{hint || error}</p>}
          <Button onClick={next} disabled={saving} className="min-h-11 px-6" data-testid="yt-pick-next">{text.next}</Button>
        </div>
      </div>
    </section>
  );
});
