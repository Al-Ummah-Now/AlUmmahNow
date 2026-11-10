'use client';

/**
 * Search input with live suggestions (videos, channels, playlists and
 * categories from the search index, with thumbnails, grouped) and the private
 * on-device history while the input is empty (Story 29.8).
 *
 * Enter runs the full search; picking a suggestion opens that video, channel
 * or playlist (a category runs a category search). With `channelId` the
 * suggestions are that channel's videos and playlists (in-channel search).
 * The combobox itself is components/ui/Autocomplete.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Clock, LayoutGrid, ListVideo, Search, X } from 'lucide-react';
import type { SearchSuggestion } from '@al-ummah/shared-types';
import { Autocomplete, type AutocompleteOption } from '@/components/ui/Autocomplete';
import { fetchSuggestions, suggestionHref, type SuggestKind } from '@/lib/search/suggest-client';
import type { SearchHistoryEntry } from '@/lib/search/history';
import { useLanguage } from '@/hooks/useLanguage';

interface SearchBarProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit: (query?: string) => void;
  onSelectCategory?: (category: string) => void;
  history: SearchHistoryEntry[];
  onRemoveHistory: (query: string) => void;
  onClearHistory: () => void;
  autoFocus?: boolean;
  /** Compact form for the site header */
  variant?: 'page' | 'header';
  /** Suggest only this channel's videos and playlists */
  channelId?: string;
  /** Override the placeholder (e.g. "Search this channel") */
  placeholder?: string;
  /** Override the input's test id */
  inputTestId?: string;
}

const ALL_KINDS: SuggestKind[] = ['video', 'channel', 'playlist', 'category'];
const CHANNEL_KINDS: SuggestKind[] = ['video', 'playlist'];

/** Map API suggestions to combobox options (grouped by type, with thumbnails). */
export function suggestionOptions(suggestions: SearchSuggestion[]): AutocompleteOption[] {
  return suggestions.map((s, index) => ({
    id: `${s.type}:${s.id ?? s.text}:${index}`,
    label: s.text,
    group: s.type,
    subtitle: s.subtitle,
    thumbnailUrl: s.thumbnailUrl,
    thumbnailShape: s.type === 'channel' ? 'round' : s.type === 'video' ? 'wide' : s.type === 'playlist' ? 'square' : undefined,
    icon: s.type === 'category' ? <LayoutGrid className="h-4 w-4" /> : s.type === 'playlist' ? <ListVideo className="h-4 w-4" /> : <Search className="h-4 w-4" />,
    value: s,
  }));
}

export function SearchBar({
  value, onChange, onSubmit, onSelectCategory, history, onRemoveHistory, onClearHistory, autoFocus,
  variant = 'page', channelId, placeholder, inputTestId,
}: SearchBarProps) {
  const { t, lang } = useLanguage();
  const router = useRouter();
  // Marks the input interactive once hydrated (used by E2E tests to avoid typing into server HTML).
  const [ready, setReady] = useState(false);
  useEffect(() => setReady(true), []);
  const header = variant === 'header';
  const a = t.autocomplete;
  // The popup renders beside the form: the header's .ah-search pill clips and restyles its children
  const [popupHost, setPopupHost] = useState<HTMLDivElement | null>(null);

  const groups = useMemo(() => [
    { key: 'channel', label: a.groupChannels },
    { key: 'video', label: a.groupVideos },
    { key: 'playlist', label: a.groupPlaylists },
    { key: 'category', label: a.groupCategories },
  ], [a]);

  const load = useCallback(
    async (query: string, signal: AbortSignal) =>
      suggestionOptions(await fetchSuggestions(query, { types: channelId ? CHANNEL_KINDS : ALL_KINDS, channelId, limit: 8, signal })),
    [channelId],
  );

  const recent: AutocompleteOption[] = useMemo(() => history.slice(0, 8).map((h) => ({
    id: `recent:${h.query}`,
    label: h.query,
    icon: <Clock className="h-4 w-4" />,
    removable: true,
  })), [history]);

  const choose = (option: AutocompleteOption) => {
    const suggestion = option.value as SearchSuggestion | undefined;
    if (!suggestion) {
      // A recent search runs again
      onChange(option.label);
      onSubmit(option.label);
      return;
    }
    if (suggestion.type === 'category' && onSelectCategory) {
      const category = suggestion.metadata?.category;
      if (typeof category === 'string') {
        onChange('');
        onSelectCategory(category);
        return;
      }
    }
    const href = suggestionHref(suggestion, lang);
    if (href) {
      router.push(href);
      return;
    }
    onChange(suggestion.text);
    onSubmit(suggestion.text);
  };

  const emptyHeader = (
    <div className="flex items-center justify-between gap-2 px-4 pt-3 pb-1 text-xs text-[var(--fanous-color-text-secondary)]">
      <span>{t.search.recentSearches}</span>
      {history.length > 0 && (
        <button
          type="button"
          data-testid="search-history-clear"
          onPointerDown={(event) => event.preventDefault()}
          onClick={onClearHistory}
          className="font-medium text-brand hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-brand rounded"
        >
          {t.search.clearSearchHistory}
        </button>
      )}
    </div>
  );

  return (
    <div className="relative flex-1 min-w-0">
      <form
        role="search"
        aria-label={t.search.searchInputLabel}
        onSubmit={(event) => {
          event.preventDefault();
          onSubmit();
        }}
        className={header ? 'ah-search flex h-9 items-stretch rounded-full border border-white/30' : 'flex items-stretch'}
      >
        <Autocomplete
          className="flex-1 min-w-0"
          value={value}
          onValueChange={onChange}
          onSelect={choose}
          onSubmit={(query) => onSubmit(query)}
          load={load}
          loadKey={channelId ?? 'all'}
          popupHost={popupHost}
          groups={groups}
          emptyOptions={recent}
          emptyHeader={emptyHeader}
          emptyText={t.search.historyEmpty}
          emptyFooter={<p className="px-4 py-2 text-xs text-[var(--fanous-color-text-secondary)] border-t border-[var(--fanous-color-divider)]">{t.search.historyPrivacyNote}</p>}
          onRemove={(option) => onRemoveHistory(option.label)}
          minChars={2}
          maxOptions={10}
          label={t.search.searchInputLabel}
          listLabel={value.trim() ? t.search.suggestionsLabel : t.search.recentSearches}
          testId={inputTestId ?? (header ? 'header-search-input' : 'search-input')}
          popupTestId="search-dropdown"
          optionTestId={(option) => (option.removable ? 'search-history-item' : 'search-suggestion')}
          removeTestId="search-history-remove"
          inputProps={{
            type: 'search',
            autoFocus,
            enterKeyHint: 'search',
            placeholder: placeholder ?? t.search.searchPlaceholder,
            maxLength: 200,
            'data-ready': ready ? 'true' : undefined,
          } as React.InputHTMLAttributes<HTMLInputElement>}
          inputClassName={header
            ? 'h-full w-full rounded-s-full bg-transparent ps-4 pe-9 text-sm text-white placeholder:text-white/60 focus:outline-none'
            : 'w-full h-11 ps-10 pe-10 rounded-s-full border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 text-gray-900 dark:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 [&::-webkit-search-cancel-button]:hidden'}
        >
          {!header && <Search className="pointer-events-none absolute start-3 top-1/2 -translate-y-1/2 h-5 w-5 text-gray-400" aria-hidden="true" />}
          {value && (
            <button
              type="button"
              onClick={(event) => {
                onChange('');
                (event.currentTarget.parentElement?.querySelector('input') as HTMLInputElement | null)?.focus();
              }}
              aria-label={t.search.clear}
              data-testid={header ? 'header-search-clear' : 'search-input-clear'}
              className={`absolute end-2 top-1/2 -translate-y-1/2 p-1.5 rounded-full focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${header ? 'text-white/80 hover:bg-white/10' : 'text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800'}`}
            >
              <X className="h-4 w-4" aria-hidden="true" />
            </button>
          )}
        </Autocomplete>
        <button
          type="submit"
          aria-label={t.search.searchButton}
          data-testid={header ? 'header-search-submit' : 'search-submit'}
          className={header ? 'grid w-11 place-items-center rounded-e-full border-s border-white/30 text-white hover:bg-white/10' : "h-11 px-5 rounded-e-full bg-gray-800 text-white hover:bg-gray-900 dark:bg-gray-700 dark:hover:bg-gray-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"}
        >
          {header ? <Search className="h-[18px] w-[18px]" aria-hidden="true" /> : t.search.searchButton}
        </button>
      </form>
      <div ref={setPopupHost} />
    </div>
  );
}
