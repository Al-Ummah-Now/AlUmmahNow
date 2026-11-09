'use client';

import { Suspense, useEffect, useState } from 'react';
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

function HeaderSearchInner() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const { t, lang } = useLanguage();
  const page = `/${lang}${HEADER_PATHS.search}`;
  const onSearchPage = pathname === page;
  const currentQuery = onSearchPage ? (params?.get('q') ?? '') : '';
  const [draft, setDraft] = useState(currentQuery);
  const [history, setHistory] = useState<SearchHistoryEntry[]>([]);
  const [phoneOpen, setPhoneOpen] = useState(false);

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

  const open = (next: URLSearchParams) => {
    setPhoneOpen(false);
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

  const bar = (autoFocus: boolean) => (
    <SearchBar
      variant="header"
      value={draft}
      onChange={setDraft}
      onSubmit={submit}
      onSelectCategory={selectCategory}
      history={history}
      onRemoveHistory={(query) => void removeSearchHistoryEntry(query)}
      onClearHistory={() => void clearSearchHistory()}
      autoFocus={autoFocus}
    />
  );

  return (
    <>
      <div className="ah-search-wrap hidden sm:block w-full max-w-md">{bar(false)}</div>
      <button type="button" onClick={() => setPhoneOpen(true)} data-testid="header-search-open" aria-label={t.navigation.search} className="ic ah-search-phone sm:hidden grid h-9 w-9 place-items-center rounded-full hover:bg-white/10">
        <Search className="h-[18px] w-[18px]" aria-hidden="true" />
      </button>
      {phoneOpen && (
        <div
          data-testid="header-search-sheet"
          className="ah-search-sheet fixed inset-x-0 top-0 z-[70] flex h-14 items-center gap-1 bg-[#093041] px-2 sm:hidden"
          onKeyDown={(event) => { if (event.key === 'Escape' && !draft) setPhoneOpen(false); }}
        >
          <button type="button" onClick={() => setPhoneOpen(false)} data-testid="header-search-back" aria-label={t.common.back} className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-white hover:bg-white/10">
            <ArrowLeft className="h-[18px] w-[18px] rtl:rotate-180" aria-hidden="true" />
          </button>
          {bar(true)}
        </div>
      )}
    </>
  );
}

/** Search box with suggestions and history; on phones an icon opens it over the header. */
export function HeaderSearch() {
  return (
    <Suspense fallback={<div className="hidden sm:block h-9 w-full max-w-md" />}>
      <HeaderSearchInner />
    </Suspense>
  );
}
