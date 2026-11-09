'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useLanguage } from '@/i18n/I18nProvider';
import type { MessageKey } from '@/i18n/translate';
import { PreferencesControls } from './PreferencesControls';
import { AccountMenu } from './AccountMenu';

interface AdminNavProps {
  userEmail?: string;
  /** Auth server origin, for the account menu. */
  authIssuer?: string;
}

const NAV_ITEMS: { href: string; label: MessageKey }[] = [
  { href: '/dashboard', label: 'nav.dashboard' },
  { href: '/moderation', label: 'nav.moderation' },
  { href: '/moderation/ai', label: 'nav.aiModeration' },
  { href: '/translations', label: 'nav.translations' },
  { href: '/indices', label: 'nav.indices' },
  { href: '/site-theme', label: 'nav.siteTheme' },
];

export function AdminNav({ userEmail, authIssuer }: AdminNavProps) {
  const pathname = usePathname();
  const { t } = useLanguage();

  // Most specific match wins, so /moderation/ai does not also highlight /moderation
  const activeHref = NAV_ITEMS.map((i) => i.href)
    .filter((href) => pathname === href || pathname.startsWith(`${href}/`))
    .sort((a, b) => b.length - a.length)[0];
  const isActive = (path: string) => path === activeHref;

  return (
    <header className="bg-surface border-b border-border">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:start-2 focus:z-50 bg-accent text-on-accent px-4 py-2 rounded"
      >
        {t('common.skipToContent')}
      </a>
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-3 flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
        <Link href="/dashboard" className="flex items-baseline gap-2 rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-focus">
          <span className="text-xl font-bold text-fg">{t('common.appName')}</span>
          <span className="text-sm text-fg-muted">{t('common.admin')}</span>
        </Link>

        <nav aria-label={t('nav.label')} className="order-3 w-full lg:order-none lg:w-auto">
          <ul className="flex flex-wrap items-center gap-1 sm:gap-2">
            {NAV_ITEMS.map((item) => {
              const active = isActive(item.href);
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    aria-current={active ? 'page' : undefined}
                    className={`block px-3 py-2 rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-focus ${
                      active ? 'bg-surface-hover text-fg font-medium' : 'text-fg-muted hover:text-fg hover:bg-surface-hover'
                    }`}
                  >
                    {t(item.label)}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>

        <div className="flex flex-wrap items-center gap-3">
          <PreferencesControls />
          {userEmail && (
            <div className="flex items-center gap-3 ps-3 border-s border-border">
              <span className="hidden md:inline text-fg-muted text-sm" data-testid="user-email">
                {userEmail}
              </span>
              {authIssuer && <AccountMenu issuer={authIssuer} currentEmail={userEmail} />}
              <form action="/api/logout" method="POST">
                <button
                  type="submit"
                  data-testid="logout-button"
                  className="text-fg-muted hover:text-fg text-sm px-2 py-1 rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-focus"
                >
                  {t('common.logout')}
                </button>
              </form>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
