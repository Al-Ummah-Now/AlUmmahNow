'use client';

import { useRouter } from 'next/navigation';
import Link from 'next/link';
import type { FormEvent } from 'react';
import { Search } from 'lucide-react';
import { useLanguage } from '@/hooks/useLanguage';
import { HEADER_PATHS } from '@/lib/navigation/destinations';

/** A search box on wider screens; on phones an icon that opens the search page. */
export function HeaderSearch() {
  const router = useRouter();
  const { t, lang } = useLanguage();
  const page = `/${lang}${HEADER_PATHS.search}`;
  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const query = String(new FormData(event.currentTarget).get('q') ?? '').trim();
    if (query) router.push(`${page}?q=${encodeURIComponent(query)}`);
  };
  return (
    <>
      <form role="search" onSubmit={onSubmit} className="hidden sm:flex h-9 w-full max-w-md items-stretch overflow-hidden rounded-full border border-white/30">
        <input name="q" type="search" data-testid="header-search-input" placeholder={t.navigation.search} aria-label={t.navigation.search} className="min-w-0 flex-1 bg-transparent px-4 text-sm text-white placeholder:text-white/60 focus:outline-none" />
        <button type="submit" aria-label={t.navigation.search} className="grid w-11 place-items-center border-s border-white/30 hover:bg-white/10"><Search className="h-[18px] w-[18px]" aria-hidden="true" /></button>
      </form>
      <Link href={page} data-testid="header-search-link" aria-label={t.navigation.search} className="sm:hidden grid h-9 w-9 place-items-center rounded-full hover:bg-white/10"><Search className="h-[18px] w-[18px]" aria-hidden="true" /></Link>
    </>
  );
}
