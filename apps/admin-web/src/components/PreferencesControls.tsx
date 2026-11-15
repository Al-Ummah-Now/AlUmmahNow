'use client';

import { useEffect, useState, useTransition, type MouseEvent } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useLanguage } from '@/i18n/I18nProvider';
import { applyColorMode, currentColorMode } from '@/lib/color-mode';
import { LOCALE_COOKIE, PREFERENCE_COOKIE_MAX_AGE, THEME_COOKIE, getDirection, type Theme } from '@/i18n/config';
import { HeaderLangButton, HeaderModeButton, selfHref } from '@/components/shell/HeaderParts';

function writeCookie(name: string, value: string) {
  const secure = window.location.protocol === 'https:' ? '; Secure' : '';
  document.cookie = `${name}=${encodeURIComponent(value)}; Path=/; Max-Age=${PREFERENCE_COOKIE_MAX_AGE}; SameSite=Lax${secure}`;
}

export function applyTheme(theme: Theme) {
  applyColorMode(theme);
}

/**
 * The header's language and light/dark buttons (docs/design/NAV.md "Header"), language first. The
 * choices are cookies (admin_locale, admin_theme), so the server renders the right lang/dir and
 * data-color-mode on the next request; a switch refreshes the current page, query and all.
 * Language: one button with the other language's name, never a select. Light / Dark: the videos
 * site's toggle (no "System", owner decision 2026-11-13); until the first click the device decides,
 * and the icon follows html.dark through CSS, so it is right at first paint.
 */
export function PreferencesControls() {
  const { locale, theme } = useLanguage();
  const router = useRouter();
  const pathname = usePathname() ?? '/';
  // The query is read in the browser (useSearchParams would need a Suspense boundary on static pages)
  const [search, setSearch] = useState('');
  useEffect(() => setSearch(window.location.search), [pathname]);
  const [isPending, startTransition] = useTransition();
  // The mode on screen: the saved choice, else the device's (only known in the browser)
  const [shown, setShown] = useState<Theme | null>(theme);
  useEffect(() => {
    const sync = () => setShown(currentColorMode());
    sync();
    const q = window.matchMedia('(prefers-color-scheme: dark)');
    const observer = new MutationObserver(sync);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    q.addEventListener('change', sync);
    return () => {
      observer.disconnect();
      q.removeEventListener('change', sync);
    };
  }, []);

  // The language lives in a cookie, not the URL: the link is this page with its query
  const here = selfHref(pathname, search);
  const other = locale === 'ar' ? 'en' : 'ar';

  const onLanguage = (e: MouseEvent<HTMLAnchorElement>) => {
    e.preventDefault();
    writeCookie(LOCALE_COOKIE, other);
    document.documentElement.lang = other;
    document.documentElement.dir = getDirection(other);
    startTransition(() => router.refresh());
  };

  const onTheme = () => {
    const value: Theme = currentColorMode() === 'dark' ? 'light' : 'dark';
    writeCookie(THEME_COOKIE, value);
    applyTheme(value);
    startTransition(() => router.refresh());
  };

  // display: contents keeps both buttons in the header's tools row; aria-busy while the refresh runs
  return (
    <div className="contents" aria-busy={isPending} data-testid="header-preferences">
      <HeaderLangButton lang={locale} href={here} onClick={onLanguage} />
      <HeaderModeButton lang={locale} dark={shown === 'dark'} onClick={onTheme} />
    </div>
  );
}
