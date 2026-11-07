'use client';

import { useId, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { useLanguage } from '@/i18n/I18nProvider';
import {
  LOCALE_COOKIE,
  PREFERENCE_COOKIE_MAX_AGE,
  THEME_COOKIE,
  getDirection,
  isLocale,
  isTheme,
  type Theme,
} from '@/i18n/config';

function writeCookie(name: string, value: string) {
  const secure = window.location.protocol === 'https:' ? '; Secure' : '';
  document.cookie = `${name}=${encodeURIComponent(value)}; Path=/; Max-Age=${PREFERENCE_COOKIE_MAX_AGE}; SameSite=Lax${secure}`;
}

export function applyTheme(theme: Theme) {
  const root = document.documentElement;
  if (theme === 'system') {
    root.removeAttribute('data-theme');
  } else {
    root.setAttribute('data-theme', theme);
  }
}

/**
 * Language and theme switchers. Preferences are persisted in cookies so the
 * server renders the right `lang`/`dir`/`data-theme` on the next request.
 */
export function PreferencesControls({ className = '' }: { className?: string }) {
  const { t, locale, theme } = useLanguage();
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const languageId = useId();
  const themeId = useId();

  const onLocaleChange = (value: string) => {
    if (!isLocale(value) || value === locale) return;
    writeCookie(LOCALE_COOKIE, value);
    document.documentElement.lang = value;
    document.documentElement.dir = getDirection(value);
    startTransition(() => router.refresh());
  };

  const onThemeChange = (value: string) => {
    if (!isTheme(value) || value === theme) return;
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
      <div className="flex items-center gap-2">
        <label htmlFor={themeId} className="text-fg-muted text-sm">
          {t('preferences.theme')}
        </label>
        <select
          id={themeId}
          data-testid="theme-select"
          value={theme}
          onChange={(e) => onThemeChange(e.target.value)}
          className={selectClass}
        >
          <option value="system">{t('preferences.themeSystem')}</option>
          <option value="light">{t('preferences.themeLight')}</option>
          <option value="dark">{t('preferences.themeDark')}</option>
        </select>
      </div>
    </div>
  );
}
