'use client';

import { useEffect, useId, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { useLanguage } from '@/i18n/I18nProvider';
import { applyColorMode, currentColorMode } from '@/lib/color-mode';
import {
  LOCALE_COOKIE,
  PREFERENCE_COOKIE_MAX_AGE,
  THEME_COOKIE,
  getDirection,
  isLocale,
  type Theme,
} from '@/i18n/config';

function writeCookie(name: string, value: string) {
  const secure = window.location.protocol === 'https:' ? '; Secure' : '';
  document.cookie = `${name}=${encodeURIComponent(value)}; Path=/; Max-Age=${PREFERENCE_COOKIE_MAX_AGE}; SameSite=Lax${secure}`;
}

export function applyTheme(theme: Theme) {
  applyColorMode(theme);
}

/**
 * Language and light/dark switchers. Preferences are persisted in cookies so the
 * server renders the right `lang`/`dir`/`data-color-mode` on the next request.
 * Light / Dark is two pressed-state buttons, no "System" (owner decision 2026-11-13): until the
 * first click the device decides, and the button for the mode on screen shows pressed.
 */
export function PreferencesControls({ className = '' }: { className?: string }) {
  const { t, locale, theme } = useLanguage();
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const languageId = useId();
  const themeId = useId();
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

  const onLocaleChange = (value: string) => {
    if (!isLocale(value) || value === locale) return;
    writeCookie(LOCALE_COOKIE, value);
    document.documentElement.lang = value;
    document.documentElement.dir = getDirection(value);
    startTransition(() => router.refresh());
  };

  const onThemeChange = (value: Theme) => {
    if (value === theme && value === shown) return;
    writeCookie(THEME_COOKIE, value);
    applyTheme(value);
    startTransition(() => router.refresh());
  };

  const selectClass =
    'bg-surface-2 text-fg border border-border rounded px-2 py-1 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-focus';

  return (
    <div className={`flex flex-wrap items-center gap-3 ${className}`} aria-busy={isPending}>
      <div className="flex items-center gap-2">
        <label htmlFor={languageId} className="text-fg-muted text-sm">
          {t('preferences.language')}
        </label>
        <select
          id={languageId}
          data-testid="language-select"
          value={locale}
          onChange={(e) => onLocaleChange(e.target.value)}
          className={selectClass}
        >
          <option value="en" lang="en">
            {t('preferences.english')}
          </option>
          <option value="ar" lang="ar">
            {t('preferences.arabic')}
          </option>
        </select>
      </div>
      <div className="flex items-center gap-2" role="group" aria-labelledby={themeId}>
        <span id={themeId} className="text-fg-muted text-sm">
          {t('preferences.theme')}
        </span>
        <div className="inline-flex rounded border border-border bg-surface-2 p-0.5">
          {(['light', 'dark'] as const).map((mode) => (
            <button
              key={mode}
              type="button"
              data-testid={`theme-${mode}`}
              aria-pressed={shown === mode}
              onClick={() => onThemeChange(mode)}
              suppressHydrationWarning
              className={`rounded px-2 py-0.5 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-focus ${
                shown === mode ? 'bg-accent text-on-accent font-semibold' : 'text-fg'
              }`}
            >
              {t(mode === 'light' ? 'preferences.themeLight' : 'preferences.themeDark')}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
