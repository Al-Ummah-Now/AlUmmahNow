'use client';

import { useCallback, useMemo, useState } from 'react';
import { Plus } from 'lucide-react';
import { Autocomplete, type AutocompleteOption, type AutocompletePage } from '@/components/ui/Autocomplete';
import { useLanguage } from '@/hooks/useLanguage';
import { fetchInitialSuggestions, fetchSuggestions } from '@/lib/search/suggest-client';
import type { SearchSuggestion } from '@al-ummah/shared-types';
import { SelectedList, type PickedItem } from './SelectedList';

const MIN_QUERY = 2;
/** Channels per page before anything is typed */
const INITIAL_PAGE = 20;

interface ChannelPickerProps {
  /** This channel: it can't feature itself */
  channelId: string;
  value: PickedItem[];
  onChange: (items: PickedItem[]) => void;
  max: number;
  testId: string;
  label: string;
}

/**
 * Opens with the most viewed channels (paged on scroll), then finds channels
 * as you type (name or @handle, from the search index's suggestions); add them
 * in order. Already featured channels are marked. Suggestions only include
 * listable channels; the API checks again on save.
 */
export function ChannelPicker({ channelId, value, onChange, max, testId, label }: ChannelPickerProps) {
  const { t } = useLanguage();
  const f = t.channelSections.form;
  const [query, setQuery] = useState('');

  const selectedIds = useMemo(() => new Set(value.map((v) => v.id)), [value]);
  const full = value.length >= max;

  const toOption = useCallback((s: SearchSuggestion): AutocompleteOption => ({
    id: s.id!,
    label: s.text,
    subtitle: s.subtitle,
    keywords: [s.handle],
    thumbnailUrl: s.thumbnailUrl,
    thumbnailShape: 'round' as const,
    value: { id: s.id!, label: s.text, thumbnailUrl: s.thumbnailUrl, round: true } satisfies PickedItem,
  }), []);

  const load = useCallback(async (q: string, signal: AbortSignal): Promise<AutocompleteOption[]> => {
    const found = await fetchSuggestions(q.replace(/^@+/, ''), { types: ['channel'], limit: 10, signal });
    return found.filter((s) => s.id && s.id !== channelId).map(toOption);
  }, [channelId, toOption]);

  // Before anything is typed: the most viewed channels, a page at a time
  const loadInitial = useCallback(async (cursor: string | null, signal: AbortSignal): Promise<AutocompletePage> => {
    const page = await fetchInitialSuggestions({ types: ['channel'], limit: INITIAL_PAGE, offset: Number(cursor) || 0, signal });
    return { options: page.items.filter((s) => s.id && s.id !== channelId).map(toOption), next: page.next === null ? null : String(page.next) };
  }, [channelId, toOption]);

  return (
    <div className="space-y-3">
      <SelectedList items={value} onChange={onChange} testId={`${testId}-selected`} />
      <p className="text-xs text-muted-foreground" aria-live="polite">
        {full ? f.maxReached : f.selectedCount.replace('{count}', String(value.length)).replace('{max}', String(max))}
      </p>
      <Autocomplete
        mode="inline"
        value={query}
        onValueChange={setQuery}
        load={load}
        loadInitial={loadInitial}
        loadKey={channelId}
        emptyText={f.noChannelsFound}
        minChars={MIN_QUERY}
        keepOpenOnSelect
        onSelect={(option) => {
          const item = option.value as PickedItem;
          if (!selectedIds.has(item.id) && !full) onChange([...value, item]);
        }}
        decorate={(option) => ({
          selected: selectedIds.has(option.id),
          disabled: selectedIds.has(option.id) || full,
          // Already featured: marked, not added twice
          subtitle: selectedIds.has(option.id) ? [t.autocomplete.alreadyAdded, option.subtitle].filter(Boolean).join(' · ') : option.subtitle,
        })}
        label={f.searchChannels}
        listLabel={label}
        testId={`${testId}-search`}
        popupTestId={`${testId}-options`}
        optionTestId={() => `${testId}-option`}
        inputProps={{ type: 'search', placeholder: f.searchChannels, 'aria-describedby': `${testId}-hint` }}
        inputClassName="h-9 w-full rounded-md border border-input bg-transparent ps-3 pe-3 text-sm shadow-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        renderTrailing={(option) => (selectedIds.has(option.id) ? null : <Plus className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />)}
      />
      <p id={`${testId}-hint`} className="text-xs text-muted-foreground">
        {f.searchChannelsHint}
      </p>
    </div>
  );
}
