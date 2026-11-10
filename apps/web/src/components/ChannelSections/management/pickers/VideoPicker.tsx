'use client';

import { useEffect, useMemo, useState } from 'react';
import { Check, Search } from 'lucide-react';
import { getLocalizedValue, type VideoObject } from '@al-ummah/shared-types';
import { getChannelVideos } from '@/lib/api/channels';
import { getVideoById } from '@/lib/api/videos';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { useLanguage } from '@/hooks/useLanguage';
import { logger } from '@/lib/logger-client';
import { SelectedList, type PickedItem } from './SelectedList';
import { extractVideoId, isPublicVideo } from './videoIds';

/** Videos listed in the picker; older ones can still be added by link */
const PICKER_PAGE = 50;

interface VideoPickerProps {
  channelId: string;
  value: PickedItem[];
  onChange: (items: PickedItem[]) => void;
  max: number;
  /** Accept any public video by link (featured videos); otherwise only this channel's */
  anyChannel?: boolean;
  testId: string;
  /** Accessible name of the list */
  label: string;
}

export function toPickedVideo(video: Pick<VideoObject, 'id' | 'title' | 'titleLocalized' | 'thumbnailUrl'>, lang: string): PickedItem {
  return { id: video.id, label: getLocalizedValue(video.titleLocalized, video.title, lang), thumbnailUrl: video.thumbnailUrl };
}

/**
 * Pick videos from the channel's latest uploads (searchable by title), or
 * by pasting a link. With `max` 1 a pick replaces the current one.
 */
export function VideoPicker({ channelId, value, onChange, max, anyChannel = false, testId, label }: VideoPickerProps) {
  const { t, lang } = useLanguage();
  const f = t.channelSections.form;
  const [videos, setVideos] = useState<VideoObject[] | null>(null);
  const [query, setQuery] = useState('');
  const [paste, setPaste] = useState('');
  const [pasteError, setPasteError] = useState(false);
  const [pasting, setPasting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    getChannelVideos(channelId, { limit: PICKER_PAGE, sort: 'latest' })
      .then((page) => {
        if (!cancelled) setVideos((page?.data ?? []).filter(isPublicVideo) as VideoObject[]);
      })
      .catch((error) => {
        logger.warn('VideoPicker: channel videos unavailable', { channelId, error });
        if (!cancelled) setVideos([]);
      });
    return () => {
      cancelled = true;
    };
  }, [channelId]);

  const single = max === 1;
  const selectedIds = useMemo(() => new Set(value.map((v) => v.id)), [value]);
  const full = !single && value.length >= max;
  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!videos) return [];
    if (!q) return videos;
    return videos.filter((video) => getLocalizedValue(video.titleLocalized, video.title, lang).toLowerCase().includes(q));
  }, [videos, query, lang]);

  const toggle = (item: PickedItem) => {
    if (selectedIds.has(item.id)) {
      onChange(value.filter((v) => v.id !== item.id));
    } else if (single) {
      onChange([item]);
    } else if (!full) {
      onChange([...value, item]);
    }
  };

  const addPasted = async () => {
    const id = extractVideoId(paste);
    setPasteError(false);
    if (!id) {
      setPasteError(true);
      return;
    }
    setPasting(true);
    try {
      const video = await getVideoById(id);
      if (!video || !isPublicVideo(video) || (!anyChannel && video.channelId !== channelId)) {
        setPasteError(true);
        return;
      }
      if (!selectedIds.has(video.id)) toggle(toPickedVideo(video, lang));
      setPaste('');
    } catch {
      setPasteError(true);
    } finally {
      setPasting(false);
    }
  };

  return (
    <div className="space-y-3">
      <SelectedList items={value} onChange={onChange} testId={`${testId}-selected`} />
      {!single && (
        <p className="text-xs text-muted-foreground" aria-live="polite">
          {full ? f.maxReached : f.selectedCount.replace('{count}', String(value.length)).replace('{max}', String(max))}
        </p>
      )}

      <div className="relative">
        <Search className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
        <Input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={f.searchVideos}
          aria-label={f.searchVideos}
          className="ps-9"
          data-testid={`${testId}-search`}
        />
      </div>

      <ul
        aria-label={label}
        className="max-h-64 space-y-1 overflow-y-auto rounded-md border border-border p-1"
        data-testid={`${testId}-options`}
      >
        {videos === null ? (
          <li className="p-3 text-sm text-muted-foreground">{f.loading}</li>
        ) : visible.length === 0 ? (
          <li className="p-3 text-sm text-muted-foreground">{f.noVideos}</li>
        ) : (
          visible.map((video) => {
            const item = toPickedVideo(video, lang);
            const selected = selectedIds.has(video.id);
            const disabled = !selected && full;
            return (
              <li key={video.id}>
                <button
                  type="button"
                  disabled={disabled}
                  aria-pressed={selected}
                  onClick={() => toggle(item)}
                  data-video-id={video.id}
                  className={`flex w-full items-center gap-3 rounded p-1.5 text-start focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50 ${selected ? 'bg-brand-soft' : 'hover:bg-muted'}`}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element -- small picker thumbnail */}
                  <img src={video.thumbnailUrl} alt="" className="h-10 w-16 shrink-0 rounded bg-muted object-cover" />
                  <span className="min-w-0 flex-1 truncate text-sm text-foreground" dir="auto">{item.label}</span>
                  {selected && <Check className="h-4 w-4 shrink-0 text-brand" aria-hidden="true" />}
                </button>
              </li>
            );
          })
        )}
      </ul>

      <div className="space-y-1">
        <label htmlFor={`${testId}-paste`} className="text-xs font-medium text-muted-foreground">{f.pasteVideo}</label>
        <div className="flex gap-2">
          <Input
            id={`${testId}-paste`}
            value={paste}
            onChange={(e) => {
              setPaste(e.target.value);
              setPasteError(false);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                void addPasted();
              }
            }}
            dir="ltr"
            aria-invalid={pasteError}
            aria-describedby={pasteError ? `${testId}-paste-error` : undefined}
            data-testid={`${testId}-paste`}
          />
          <Button type="button" variant="outline" onClick={addPasted} disabled={!paste.trim() || pasting || full}>
            {f.addPasted}
          </Button>
        </div>
        {pasteError && (
          <p id={`${testId}-paste-error`} role="alert" className="text-xs text-destructive">{f.pastedNotFound}</p>
        )}
      </div>
    </div>
  );
}
