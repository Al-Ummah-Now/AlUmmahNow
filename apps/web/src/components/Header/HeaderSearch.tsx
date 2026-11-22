'use client';

import { Suspense, useEffect, useRef, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { ArrowLeft, Search } from 'lucide-react';
import { SearchBar } from '@/components/search/SearchExperience/SearchBar';
import { useLanguage } from '@/hooks/useLanguage';
import { HEADER_PATHS } from '@/lib/navigation/destinations';
import {
  addSearchHistory,
  clearSearchHistory,
  getSearchHistory,
  removeSearchHistoryEntry,
  subscribeSearchHistory,
  type SearchHistoryEntry,
} from '@/lib/search/history';

const SLOT_ID = 'header-search';

function HeaderSearchInner() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const { t, lang } = useLanguage();
  const page = `/${lang}${HEADER_PATHS.search}`;
  const onSearchPage = pathname === page;
  const currentQuery = onSearchPage ? (params?.get('q') ?? '') : '';
  // In-channel search keeps suggesting that channel's videos and playlists
  const channelId = onSearchPage ? (params?.get('channelId') || undefined) : undefined;
  const [draft, setDraft] = useState(currentQuery);
  const [history, setHistory] = useState<SearchHistoryEntry[]>([]);
  // Below 1024px the slot is a popover sheet over the bar (docs/design/NAV.md "Search"): the icon opens it
  const slot = useRef<HTMLDivElement>(null);
  const [sheetOpen, setSheetOpen] = useState(false);

  useEffect(() => setDraft(currentQuery), [currentQuery]);

  useEffect(() => {
    let active = true;
    getSearchHistory().then((entries) => {
      if (active) setHistory(entries);
    });
    const unsubscribe = subscribeSearchHistory(setHistory);
    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  useEffect(() => {
    const el = slot.current;
    if (!el) return;
    const onToggle = (event: Event) => setSheetOpen((event as ToggleEvent).newState === 'open');
    el.addEventListener('toggle', onToggle);
    return () => el.removeEventListener('toggle', onToggle);
  }, []);

  const open = (next: URLSearchParams) => {
    if (slot.current?.matches(':popover-open')) slot.current.hidePopover();
    router.push(`${page}?${next.toString()}`);
  };
  // On the search page a new query keeps the chosen type and filters
  const nextParams = () => new URLSearchParams(onSearchPage ? (params?.toString() ?? '') : '');

  const submit = (query?: string) => {
    const q = (query ?? draft).trim();
    if (!q) return;
    void addSearchHistory(q);
    const next = nextParams();
    next.set('q', q);
    open(next);
  };

  const selectCategory = (category: string) => {
    const next = nextParams();
    next.delete('q');
    next.set('category', category);
    next.set('type', 'video');
    open(next);
  };

  return (
    <>
      <button type="button" popoverTarget={SLOT_ID} data-testid="header-search-open" aria-label={t.navigation.search} title={t.navigation.search} className="aun-icon-btn aun-search-open">
        <Search aria-hidden="true" />
      </button>
      {/* Escape with text clears it (the autocomplete cancels the key), on an empty field it closes the sheet */}
      <div ref={slot} id={SLOT_ID} popover="auto" data-testid="header-search-sheet" className="aun-search-slot ah-search-wrap">
        <button type="button" popoverTarget={SLOT_ID} popoverTargetAction="hide" data-testid="header-search-back" aria-label={t.common.back} title={t.common.back} className="aun-search-back">
          <ArrowLeft aria-hidden="true" />
        </button>
        <SearchBar
          // a new input when the sheet opens, so it takes the focus
          key={sheetOpen ? 'sheet' : 'bar'}
          variant="header"
          value={draft}
          onChange={setDraft}
          onSubmit={submit}
          onSelectCategory={selectCategory}
          history={history}
          onRemoveHistory={(query) => void removeSearchHistoryEntry(query)}
          onClearHistory={() => void clearSearchHistory()}
          autoFocus={sheetOpen}
          channelId={channelId}
        />
      </div>
    </>
  );
}

/**
 * The shared header search (packages/fanous-tokens nav/aun-nav.css "header search", the same elements as
 * header.js searchHtml()) with suggestions and history; below 1024px an icon opens it over the header.
 */
export function HeaderSearch() {
  return (
    <Suspense fallback={<div className="aun-search-slot" aria-hidden="true"><div className="aun-search" /></div>}>
      <HeaderSearchInner />
    </Suspense>
  );
}
