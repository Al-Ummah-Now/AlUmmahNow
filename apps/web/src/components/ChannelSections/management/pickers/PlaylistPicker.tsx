'use client';

import { useEffect, useMemo, useState } from 'react';
import { Check } from 'lucide-react';
import type { Playlist } from '@al-ummah/shared-types';
import { getChannelPlaylists } from '@/lib/api/channels';
import { pickLanguage } from '@/lib/format/pick-language';
import { getPlaylistCoverUrl } from '@/lib/playlists/playlist-utils';
import { useLanguage } from '@/hooks/useLanguage';
import { logger } from '@/lib/logger-client';
import { SelectedList, type PickedItem } from './SelectedList';

const PICKER_PAGE = 50;

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
    label: pickLanguage(playlist.name || playlist.title || '', locale),
    thumbnailUrl: getPlaylistCoverUrl(playlist),
  };
}

/** Pick from the channel's public playlists; with `max` 1 a pick replaces the current one */
export function PlaylistPicker({ channelId, value, onChange, max, testId, label }: PlaylistPickerProps) {
  const { t, locale } = useLanguage();
  const f = t.channelSections.form;
  const [playlists, setPlaylists] = useState<PickerPlaylist[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    getChannelPlaylists(channelId, { limit: PICKER_PAGE })
      .then((page) => {
        const list = ((page?.data ?? []) as PickerPlaylist[]).filter((p) => p.isPublic !== false);
        if (!cancelled) setPlaylists(list);
      })
      .catch((error) => {
        logger.warn('PlaylistPicker: channel playlists unavailable', { channelId, error });
        if (!cancelled) setPlaylists([]);
      });
    return () => {
      cancelled = true;
    };
  }, [channelId]);

  const single = max === 1;
  const selectedIds = useMemo(() => new Set(value.map((v) => v.id)), [value]);
  const full = !single && value.length >= max;

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
      <ul aria-label={label} className="max-h-72 space-y-1 overflow-y-auto rounded-md border border-border p-1" data-testid={`${testId}-options`}>
        {playlists === null ? (
          <li className="p-3 text-sm text-muted-foreground">{f.loading}</li>
        ) : playlists.length === 0 ? (
          <li className="p-3 text-sm text-muted-foreground">{f.noPlaylists}</li>
        ) : (
          playlists.map((playlist) => {
            const item = toPickedPlaylist(playlist, locale);
            const selected = selectedIds.has(playlist.id);
            const disabled = !selected && full;
            return (
              <li key={playlist.id}>
                <button
                  type="button"
                  disabled={disabled}
                  aria-pressed={selected}
                  onClick={() => toggle(item)}
                  data-playlist-id={playlist.id}
                  className={`flex w-full items-center gap-3 rounded p-1.5 text-start focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50 ${selected ? 'bg-brand-soft' : 'hover:bg-muted'}`}
                >
                  {item.thumbnailUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element -- small picker thumbnail
                    <img src={item.thumbnailUrl} alt="" className="h-10 w-16 shrink-0 rounded bg-muted object-cover" />
                  ) : (
                    <span className="h-10 w-16 shrink-0 rounded bg-muted" />
                  )}
                  <span className="min-w-0 flex-1 text-sm text-foreground">
                    <span className="block truncate" dir="auto">{item.label}</span>
                    <span className="block text-xs text-muted-foreground">
                      {t.channelSections.render.videosCount.replace('{count}', String(playlist.videosCount ?? 0))}
                    </span>
                  </span>
                  {selected && <Check className="h-4 w-4 shrink-0 text-brand" aria-hidden="true" />}
                </button>
              </li>
            );
          })
        )}
      </ul>
    </div>
  );
}
