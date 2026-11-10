'use client';

/**
 * In-channel search on the channel tab bar: a search icon that opens a box
 * suggesting this channel's videos and playlists as you type. Enter opens the
 * search page limited to the channel (?channelId=); picking a suggestion
 * opens the video or playlist. Recent searches are the viewer's private
 * on-device search history (lib/search/history).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Clock, Search, X } from 'lucide-react';
import type { SearchSuggestion } from '@al-ummah/shared-types';
import { Autocomplete, type AutocompleteOption } from '@/components/ui/Autocomplete';
import { suggestionOptions } from '@/components/search/SearchExperience/SearchBar';
import { useLanguage } from '@/hooks/useLanguage';
import { fetchSuggestions, suggestionHref } from '@/lib/search/suggest-client';
import {
  addSearchHistory,
  clearSearchHistory,
  getSearchHistory,
  removeSearchHistoryEntry,
  subscribeSearchHistory,
  type SearchHistoryEntry,
} from '@/lib/search/history';

export function ChannelSearch({ channelId }: { channelId: string }) {
  const { t, lang } = useLanguage();
  const a = t.autocomplete;
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState('');
  const [history, setHistory] = useState<SearchHistoryEntry[]>([]);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!open) return;
    let active = true;
    getSearchHistory().then((entries) => { if (active) setHistory(entries); });
    const unsubscribe = subscribeSearchHistory(setHistory);
    inputRef.current?.focus();
    return () => {
      active = false;
      unsubscribe();
    };
  }, [open]);

  const groups = useMemo(() => [
    { key: 'video', label: a.groupVideos },
    { key: 'playlist', label: a.groupPlaylists },
  ], [a]);

  const load = useCallback(
    async (query: string, signal: AbortSignal) =>
      suggestionOptions(await fetchSuggestions(query, { types: ['video', 'playlist'], channelId, limit: 8, signal })),
    [channelId],
  );

  const recent: AutocompleteOption[] = useMemo(() => history.slice(0, 6).map((h) => ({
    id: `recent:${h.query}`, label: h.query, icon: <Clock className="h-4 w-4" />, removable: true,
  })), [history]);

  const search = (query: string) => {
    const q = query.trim();
    if (!q) return;
    void addSearchHistory(q);
    router.push(`/${lang}/search?${new URLSearchParams({ q, channelId }).toString()}`);
  };

  const choose = (option: AutocompleteOption) => {
    const suggestion = option.value as SearchSuggestion | undefined;
    const href = suggestion ? suggestionHref(suggestion, lang) : null;
    if (href) router.push(href);
    else search(option.label);
  };

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} aria-label={a.searchChannel} data-testid="channel-search-open"
        className="ms-2 grid h-9 w-9 shrink-0 place-items-center rounded-full text-[var(--fanous-color-text-secondary)] hover:bg-[var(--m-hover,#0000000d)] focus:outline-none focus-visible:ring-2 focus-visible:ring-brand">
        <Search className="h-[18px] w-[18px]" aria-hidden="true" />
      </button>
    );
  }

  return (
    <form role="search" aria-label={a.searchChannel} data-testid="channel-search"
      className="ms-2 flex w-full max-w-xs shrink-0 items-center gap-1"
      onSubmit={(event) => { event.preventDefault(); search(draft); }}>
      <Search className="h-4 w-4 shrink-0 text-[var(--fanous-color-text-secondary)]" aria-hidden="true" />
      <Autocomplete
        className="min-w-0 flex-1"
        value={draft}
        onValueChange={setDraft}
        onSelect={choose}
        onSubmit={search}
        load={load}
        loadKey={channelId}
        groups={groups}
        emptyOptions={recent}
        emptyHeader={history.length > 0 ? (
          <div className="flex items-center justify-between gap-2 px-4 pt-3 pb-1 text-xs text-[var(--fanous-color-text-secondary)]">
            <span>{a.groupRecent}</span>
            <button type="button" data-testid="channel-search-clear-recent" onPointerDown={(event) => event.preventDefault()}
              onClick={() => void clearSearchHistory()} className="font-medium text-brand hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-brand rounded">
              {a.clearRecent}
            </button>
          </div>
        ) : undefined}
        onRemove={(option) => void removeSearchHistoryEntry(option.label)}
        label={a.searchChannel}
        listLabel={t.search.suggestionsLabel}
        testId="channel-search-input"
        popupTestId="channel-search-dropdown"
        // Wider than the box, opening toward the page from the end of the tab bar
        popupClassName="!start-auto w-80 max-w-[calc(100vw-2rem)]"
        optionTestId={(option) => (option.removable ? 'channel-search-recent' : 'channel-search-suggestion')}
        inputRef={inputRef}
        inputProps={{
          type: 'search', enterKeyHint: 'search', placeholder: a.searchChannel, maxLength: 200,
          onKeyDown: (event) => { if (event.key === 'Escape' && !draft) setOpen(false); },
        }}
        inputClassName="h-9 w-full border-b border-[var(--fanous-color-divider)] bg-transparent px-1 text-sm text-[var(--fanous-color-text-primary)] placeholder:text-[var(--fanous-color-text-muted)] focus:border-brand focus:outline-none [&::-webkit-search-cancel-button]:hidden"
      />
      <button type="button" onClick={() => { setDraft(''); setOpen(false); }} aria-label={a.closeSearch} data-testid="channel-search-close"
        className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-[var(--fanous-color-text-secondary)] hover:bg-[var(--m-hover,#0000000d)] focus:outline-none focus-visible:ring-2 focus-visible:ring-brand">
        <X className="h-4 w-4" aria-hidden="true" />
      </button>
    </form>
  );
}
