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
// The Light / Dark control every app shares (docs/design/NAV.md): Lucide sun/moon, action names
import { MOON_ICON_BODY, SUN_ICON_BODY, modeToggleLabel } from '../../../../packages/fanous-tokens/nav/mode-toggle.js';

/** A Lucide icon from the shared markup; CSS (globals.css) shows the one for the mode on screen. */
function ModeIcon({ icon }: { icon: 'sun' | 'moon' }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`lucide lucide-${icon} mode-icon mode-${icon} size-[18px]`}
      aria-hidden="true"
      focusable="false"
      dangerouslySetInnerHTML={{ __html: icon === 'sun' ? SUN_ICON_BODY : MOON_ICON_BODY }}
    />
  );
}

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
 * Light / Dark is the videos site's toggle (no "System", owner decision 2026-11-13): one icon
 * button, the Moon in light mode and the Sun in dark, named for the mode it switches to. Until the
 * first click the device decides; the icon follows html.dark through CSS, so it is right at first paint.
 */
export function PreferencesControls({ className = '' }: { className?: string }) {
  const { t, locale, theme } = useLanguage();
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const languageId = useId();
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
      <button
        type="button"
        data-testid="theme-toggle"
        aria-label={modeToggleLabel(locale, shown === 'dark')}
        title={modeToggleLabel(locale, shown === 'dark')}
        onClick={() => onThemeChange(currentColorMode() === 'dark' ? 'light' : 'dark')}
        suppressHydrationWarning
        className="inline-grid size-11 shrink-0 place-items-center rounded-full text-drawer-icon hover:bg-surface-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-focus"
      >
        <ModeIcon icon="moon" />
        <ModeIcon icon="sun" />
      </button>
    </div>
  );
}
