'use client';

import { useCallback, useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import type { Playlist } from '@al-ummah/shared-types';
import { getChannelPlaylists } from '@/lib/api/channels';
import { playlistName } from '@/lib/playlists/playlist-names';
import { getPlaylistCoverUrl } from '@/lib/playlists/playlist-utils';
import { useLanguage } from '@/hooks/useLanguage';
import { Autocomplete, type AutocompleteOption, type AutocompletePage } from '@/components/ui/Autocomplete';
import { fetchSuggestions } from '@/lib/search/suggest-client';
import { SelectedList, type PickedItem } from './SelectedList';

/** Playlists per page; the list pages on as it is scrolled */
const PICKER_PAGE = 30;

interface PlaylistPickerProps {
  channelId: string;
  value: PickedItem[];
  onChange: (items: PickedItem[]) => void;
  max: number;
  testId: string;
  label: string;
}

type PickerPlaylist = Playlist & { title?: string; cover?: { thumbnailUrl?: string | null } | null };

export function toPickedPlaylist(playlist: PickerPlaylist, locale: string): PickedItem {
  return {
    id: playlist.id,
    label: playlistName(playlist, locale),
    thumbnailUrl: getPlaylistCoverUrl(playlist),
  };
}

/**
 * Pick from the channel's public playlists, listed as soon as it opens (paged
 * on scroll, searchable); chosen ones are ticked. With `max` 1 a pick replaces
 * the current one.
 */
export function PlaylistPicker({ channelId, value, onChange, max, testId, label }: PlaylistPickerProps) {
  const { t, locale } = useLanguage();
  const f = t.channelSections.form;


  const single = max === 1;
  const selectedIds = useMemo(() => new Set(value.map((v) => v.id)), [value]);
  const full = !single && value.length >= max;

  const [query, setQuery] = useState('');
  const toOption = useCallback((playlist: PickerPlaylist): AutocompleteOption => {
    const item = toPickedPlaylist(playlist, locale);
    return {
      id: playlist.id, label: item.label, keywords: [playlist.name, playlist.title],
      subtitle: t.channelSections.render.videosCount.replace('{count}', String(playlist.videosCount ?? 0)),
      thumbnailUrl: item.thumbnailUrl ?? undefined, thumbnailShape: 'wide' as const, value: item,
    };
  }, [locale, t]);

  // The channel's public playlists as soon as it opens, a page at a time
  const loadInitial = useCallback(async (cursor: string | null): Promise<AutocompletePage> => {
    const page = await getChannelPlaylists(channelId, { limit: PICKER_PAGE, ...(cursor ? { cursor } : {}) });
    if (!page) throw new Error('channel playlists unavailable');
    const next = (page as { cursor?: string }).cursor || page.pagination?.nextCursor || null;
    return { options: ((page.data ?? []) as PickerPlaylist[]).filter((p) => p.isPublic !== false).map(toOption), next };
  }, [channelId, toOption]);

  // Playlists past the first page come from the search index (public ones only, like this list)
  const loadMore = useCallback(async (q: string, signal: AbortSignal): Promise<AutocompleteOption[]> => {
    const found = await fetchSuggestions(q, { types: ['playlist'], channelId, limit: 10, signal });
    return found.filter((s) => s.id).map((s) => ({
      id: s.id!, label: s.text, thumbnailUrl: s.thumbnailUrl, thumbnailShape: 'wide' as const,
      subtitle: s.count !== undefined ? t.channelSections.render.videosCount.replace('{count}', String(s.count)) : undefined,
      value: { id: s.id!, label: s.text, thumbnailUrl: s.thumbnailUrl } satisfies PickedItem,
    }));
  }, [channelId, t]);

  const toggle = (item: PickedItem) => {
    if (selectedIds.has(item.id)) onChange(value.filter((v) => v.id !== item.id));
    else if (single) onChange([item]);
    else if (!full) onChange([...value, item]);
  };

  return (
    <div className="space-y-3">
      {!single && <SelectedList items={value} onChange={onChange} testId={`${testId}-selected`} />}
      {!single && (
        <p className="text-xs text-muted-foreground" aria-live="polite">
          {full ? f.maxReached : f.selectedCount.replace('{count}', String(value.length)).replace('{max}', String(max))}
        </p>
      )}
      <Autocomplete
        mode="inline"
        value={query}
        onValueChange={setQuery}
        loadInitial={loadInitial}
        emptyText={f.noPlaylists}
        load={loadMore}
        loadKey={`${channelId}:${locale}`}
        maxOptions={PICKER_PAGE}
        keepOpenOnSelect={!single}
        onSelect={(option) => toggle(option.value as PickedItem)}
        decorate={(option) => {
          const selected = selectedIds.has(option.id);
          return { selected, disabled: !selected && full };
        }}
        label={f.searchPlaylists}
        listLabel={label}
        testId={`${testId}-search`}
        popupTestId={`${testId}-options`}
        optionTestId={() => `${testId}-option`}
        inputProps={{ type: 'search', placeholder: f.searchPlaylists }}
        inputClassName="h-9 w-full rounded-md border border-input bg-transparent ps-9 pe-3 text-sm shadow-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <Search className="pointer-events-none absolute start-3 top-[1.125rem] h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
      </Autocomplete>
    </div>
  );
}
