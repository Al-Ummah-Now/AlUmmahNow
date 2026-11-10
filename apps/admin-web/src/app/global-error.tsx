'use client';

import { useSyncExternalStore } from 'react';
import { BoundaryError } from '@/components/FriendlyError';
import { LOCALE_COOKIE, THEME_COOKIE, isLocale } from '@/i18n/config';
import './globals.css';

const noSubscribe = () => () => undefined;

function cookie(name: string): string | undefined {
  const match = document.cookie.split('; ').find((c) => c.startsWith(`${name}=`));
  return match ? decodeURIComponent(match.slice(name.length + 1)) : undefined;
}

/**
 * The root layout itself failed, so no providers exist: locale and theme
 * come from the preference cookies (the server render uses English).
 */
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const locale = useSyncExternalStore(noSubscribe, () => {
    const value = cookie(LOCALE_COOKIE);
    return isLocale(value) ? value : 'en';
  }, () => 'en');
  const theme = useSyncExternalStore(noSubscribe, () => {
    const value = cookie(THEME_COOKIE);
    return value === 'light' || value === 'dark' ? value : undefined;
  }, () => undefined);

  return (
    <html lang={locale} dir={locale === 'ar' ? 'rtl' : 'ltr'} data-theme={theme} suppressHydrationWarning>
      <body className="min-h-screen bg-bg text-fg">
        <BoundaryError error={error} reset={reset} locale={locale} />
      </body>
    </html>
  );
}
