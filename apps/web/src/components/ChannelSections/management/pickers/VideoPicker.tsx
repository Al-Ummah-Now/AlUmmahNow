'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import { getLocalizedValue, type VideoObject } from '@al-ummah/shared-types';
import { getChannelVideos } from '@/lib/api/channels';
import { getVideoById } from '@/lib/api/videos';
import { Input } from '@/components/ui/input';
import { Autocomplete, type AutocompleteOption } from '@/components/ui/Autocomplete';
import { fetchSuggestions } from '@/lib/search/suggest-client';
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
  // The latest uploads, matched as you type; older (and, for featured videos, other channels') public videos come from the search index
  const videoOptions = useMemo<AutocompleteOption[]>(() => (videos ?? []).map((video) => {
    const item = toPickedVideo(video, lang);
    return { id: video.id, label: item.label, keywords: [video.title, ...Object.values(video.titleLocalized ?? {})], thumbnailUrl: video.thumbnailUrl, thumbnailShape: 'wide' as const, value: item };
  }), [videos, lang]);

  const loadMore = useCallback(async (q: string, signal: AbortSignal): Promise<AutocompleteOption[]> => {
    const found = await fetchSuggestions(q, { types: ['video'], channelId: anyChannel ? undefined : channelId, limit: 10, signal });
    return found.filter((s) => s.id).map((s) => ({
      id: s.id!, label: s.text, subtitle: anyChannel ? s.subtitle : undefined, thumbnailUrl: s.thumbnailUrl, thumbnailShape: 'wide' as const,
      value: { id: s.id!, label: s.text, thumbnailUrl: s.thumbnailUrl } satisfies PickedItem,
    }));
  }, [anyChannel, channelId]);

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

      <Autocomplete
        mode="inline"
        value={query}
        onValueChange={setQuery}
        options={videoOptions}
        emptyOptions={videoOptions}
        emptyText={videos === null ? f.loading : f.noVideos}
        load={loadMore}
        loadKey={`${channelId}:${anyChannel}`}
        maxOptions={PICKER_PAGE}
        keepOpenOnSelect={!single}
        onSelect={(option) => toggle(option.value as PickedItem)}
        decorate={(option) => {
          const selected = selectedIds.has(option.id);
          return { selected, disabled: !selected && full };
        }}
        label={f.searchVideos}
        listLabel={label}
        testId={`${testId}-search`}
        popupTestId={`${testId}-options`}
        optionTestId={() => `${testId}-option`}
        inputProps={{ type: 'search', placeholder: f.searchVideos }}
        inputClassName="h-9 w-full rounded-md border border-input bg-transparent ps-9 pe-3 text-sm shadow-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <Search className="pointer-events-none absolute start-3 top-[1.125rem] h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
      </Autocomplete>

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
