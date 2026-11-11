'use client';

import Link from '@/components/AppLink';
import { usePathname } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLanguage } from '@/i18n/I18nProvider';
import { PreferencesControls } from '@/components/PreferencesControls';
import { AccountMenu } from '@/components/AccountMenu';
import { Icon } from './icons';
import { CommandPalette } from './CommandPalette';
import {
  activeItem,
  badgeText,
  breadcrumbs,
  groupedItems,
  visibleItems,
  type NavAccess,
  type NavBadges,
  type NavItem,
  NAV_COOKIE,
} from './nav-model';

interface AdminShellProps {
  userEmail?: string;
  /** Auth server origin, for the account menu */
  authIssuer?: string;
  access: NavAccess;
  badges: NavBadges;
  /** From the admin_nav cookie, so the first paint has the right width */
  initialRail: boolean;
  children: React.ReactNode;
}

const focusRing = 'focus:outline-none focus-visible:ring-2 focus-visible:ring-focus';

/**
 * The admin's frame. Wide screens: a sidebar of grouped sections (collapsible to an icon rail)
 * beside a top bar with breadcrumbs, search (⌘K) and the account. Tablets: the rail. Phones: the
 * top bar, a bottom bar, and the sidebar as a drawer.
 */
export function AdminShell({ userEmail, authIssuer, access, badges, initialRail, children }: AdminShellProps) {
  const { t } = useLanguage();
  const pathname = usePathname();
  const [rail, setRail] = useState(initialRail);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const drawerRef = useRef<HTMLElement>(null);
  const menuButtonRef = useRef<HTMLButtonElement>(null);

  const items = useMemo(() => visibleItems(access), [access]);
  const groups = useMemo(() => groupedItems(access), [access]);
  const current = activeItem(pathname, items);
  const crumbs = breadcrumbs(pathname, items);

  // A new page closes the phone drawer
  useEffect(() => setDrawerOpen(false), [pathname]);

  // ⌘K / Ctrl+K anywhere
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && !e.altKey && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setPaletteOpen((open) => !open);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // The drawer: focus its first link on open, Escape closes and returns focus to the menu button
  useEffect(() => {
    if (!drawerOpen) return;
    drawerRef.current?.querySelector<HTMLElement>('a[href]')?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setDrawerOpen(false);
        menuButtonRef.current?.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [drawerOpen]);

  const toggleRail = useCallback(() => {
    setRail((value) => {
      const next = !value;
      const secure = window.location.protocol === 'https:' ? '; Secure' : '';
      document.cookie = `${NAV_COOKIE}=${next ? 'rail' : 'full'}; Path=/; Max-Age=31536000; SameSite=Lax${secure}`;
      return next;
    });
  }, []);

  // Labels: always in the phone drawer; in the rail they stay for screen readers only
  const railHide = rail ? 'md:sr-only' : '';
  const railGone = rail ? 'md:hidden' : '';

  const navLink = (item: NavItem) => {
    const active = item === current;
    const count = item.badge ? badges[item.badge] : null;
    const text = badgeText(count);
    return (
      <li key={item.href}>
        <Link
          href={item.href}
          aria-current={active ? 'page' : undefined}
          title={t(item.label)}
          className={`relative flex min-h-10 items-center gap-3 rounded-lg px-3 py-2 text-sm ${focusRing} ${
            active ? 'shell-item-active font-semibold text-drawer-active-text' : 'text-drawer-text hover:bg-surface-hover'
          } ${rail ? 'md:justify-center md:px-0' : ''}`}
        >
          <Icon name={item.icon} className={`size-[18px] ${active ? 'text-drawer-active-text' : 'text-drawer-icon'}`} />
          <span className={`min-w-0 flex-1 truncate ${railHide}`}>{t(item.label)}</span>
          {text && item.badgeTestId && (
            <span
              data-testid={item.badgeTestId}
              data-count={count ?? 0}
              className={`inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-accent px-1.5 text-xs font-semibold text-on-accent ${railGone}`}
            >
              <span aria-hidden="true">{text}</span>
              {item.badgeLabel && <span className="sr-only">{t(item.badgeLabel, { count: count ?? 0 })}</span>}
            </span>
          )}
          {text && (
            <span
              aria-hidden="true"
              className={`absolute end-2 top-1.5 hidden size-2 rounded-full bg-accent ${rail ? 'md:block' : ''}`}
            />
          )}
        </Link>
      </li>
    );
  };

  return (
    <div className={`min-h-screen md:grid ${rail ? 'md:grid-cols-[76px_minmax(0,1fr)]' : 'md:grid-cols-[264px_minmax(0,1fr)]'}`} data-rail={rail}>
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:start-2 focus:z-[70] rounded bg-accent px-4 py-2 text-on-accent"
      >
        {t('common.skipToContent')}
      </a>

      {/* Phone drawer scrim */}
      {drawerOpen && (
        <button
          type="button"
          aria-label={t('nav.close')}
          tabIndex={-1}
          onClick={() => setDrawerOpen(false)}
          className="fixed inset-0 z-40 bg-bg/70 md:hidden"
        />
      )}

      <nav
        ref={drawerRef}
        id="admin-nav"
        aria-label={t('nav.label')}
        data-testid="admin-sidebar"
        className={`shell-rail fixed inset-y-0 start-0 z-50 flex w-[300px] max-w-[86vw] flex-col border-e border-drawer-divider transition-transform duration-200 md:sticky md:top-0 md:z-auto md:h-screen md:w-auto md:max-w-none md:translate-x-0 ${
          drawerOpen ? 'translate-x-0' : 'max-md:invisible max-md:-translate-x-full max-md:rtl:translate-x-full'
        }`}
      >
        <div className="flex items-center gap-2 px-3 pb-2 pt-3">
          <Link
            href="/dashboard"
            className={`flex min-w-0 flex-1 items-center gap-2.5 rounded-lg p-1.5 text-drawer-text ${focusRing} ${rail ? 'md:justify-center' : ''}`}
          >
            <span className="shell-primary grid size-9 shrink-0 place-items-center rounded-[10px]">
              <Icon name="spark" className="size-[18px]" />
            </span>
            <span className={`flex min-w-0 flex-col leading-tight ${railHide}`}>
              <span className="truncate text-[15px] font-bold">{t('common.appName')}</span>
              <span className="text-xs text-fg-subtle">{t('common.admin')}</span>
            </span>
          </Link>
          <button
            type="button"
            onClick={() => setDrawerOpen(false)}
            aria-label={t('nav.close')}
            className={`grid size-10 place-items-center rounded-lg text-drawer-icon hover:bg-surface-hover md:hidden ${focusRing}`}
          >
            <Icon name="close" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-2.5 pb-3">
          {groups.map((group) => (
            <div key={group.id} className="border-t border-drawer-divider py-2 first:border-t-0">
              <h2 className={`px-3 pb-1 pt-1.5 text-[11px] font-semibold uppercase tracking-wider text-fg-subtle rtl:text-xs rtl:normal-case rtl:tracking-normal ${railHide}`}>
                {t(group.label)}
              </h2>
              <ul className="flex flex-col gap-0.5">{group.items.map(navLink)}</ul>
            </div>
          ))}
        </div>

        <div className="flex flex-col gap-2 border-t border-drawer-divider px-3 py-3">
          <PreferencesControls className={`${railGone} [&_select]:max-w-[9rem]`} />
          <button
            type="button"
            onClick={toggleRail}
            aria-pressed={rail}
            aria-label={rail ? t('nav.expand') : t('nav.collapse')}
            title={rail ? t('nav.expand') : t('nav.collapse')}
            data-testid="nav-collapse"
            className={`hidden size-9 place-items-center rounded-lg text-drawer-icon hover:bg-surface-hover md:grid ${focusRing} ${rail ? 'md:mx-auto' : ''}`}
          >
            <Icon name="sidebar" className="size-[18px] rtl:-scale-x-100" />
          </button>
        </div>
      </nav>

      <div className="flex min-w-0 flex-col">
        <header className="shell-header sticky top-0 z-30 flex h-14 items-center gap-2 border-b border-nav-border px-2 text-nav-text md:px-5">
          <button
            ref={menuButtonRef}
            type="button"
            onClick={() => setDrawerOpen(true)}
            aria-expanded={drawerOpen}
            aria-controls="admin-nav"
            aria-label={t('nav.open')}
            data-testid="nav-open"
            className={`grid size-10 place-items-center rounded-lg text-nav-icon hover:bg-nav-hover md:hidden ${focusRing}`}
          >
            <Icon name="menu" className="size-5" />
          </button>

          {crumbs.length > 0 && (
            <nav aria-label={t('nav.breadcrumbs')} className="min-w-0 flex-1">
              <ol className="flex min-w-0 items-center gap-1.5 text-sm">
                {crumbs.map((crumb, i) => {
                  const last = i === crumbs.length - 1;
                  return (
                    <li key={crumb.label} className={`flex min-w-0 items-center gap-1.5 ${last ? '' : 'max-md:hidden'}`}>
                      {crumb.href ? (
                        <Link href={crumb.href} className={`truncate rounded text-nav-search-placeholder hover:text-nav-text hover:underline ${focusRing}`}>
                          {t(crumb.label)}
                        </Link>
                      ) : (
                        <span aria-current={last ? 'page' : undefined} className={`truncate ${last ? 'font-semibold text-nav-text' : 'text-nav-search-placeholder'}`}>
                          {t(crumb.label)}
                        </span>
                      )}
                      {!last && <Icon name="chevron" className="size-3.5 text-nav-search-placeholder rtl:-scale-x-100" />}
                    </li>
                  );
                })}
              </ol>
            </nav>
          )}
          {crumbs.length === 0 && <div className="flex-1" />}

          <button
            type="button"
            onClick={() => setPaletteOpen(true)}
            data-testid="command-open"
            aria-keyshortcuts="Meta+K Control+K"
            className={`flex h-10 items-center gap-2.5 rounded-lg border border-nav-search-border bg-nav-search-bg px-2.5 text-sm text-nav-search-placeholder hover:text-nav-search-text max-md:w-10 max-md:justify-center max-md:border-transparent max-md:bg-transparent md:w-[min(26rem,34vw)] ${focusRing}`}
          >
            <Icon name="search" className="size-[18px]" />
            <span className="flex-1 text-start max-md:sr-only">{t('palette.placeholder')}</span>
            <kbd aria-hidden="true" className="rounded border border-nav-search-border px-1.5 text-[11px] max-md:hidden" dir="ltr">⌘K</kbd>
          </button>

          {userEmail && (
            <div className="flex items-center gap-1 md:gap-3 md:ps-2">
              <span className="hidden max-w-[14rem] truncate text-sm text-nav-search-placeholder lg:inline" data-testid="user-email">
                {userEmail}
              </span>
              {authIssuer && <AccountMenu issuer={authIssuer} currentEmail={userEmail} />}
              <form action="/api/logout" method="POST">
                <button
                  type="submit"
                  data-testid="logout-button"
                  title={t('common.logout')}
                  className={`flex h-10 items-center gap-2 rounded-lg px-2 text-sm text-nav-text hover:bg-nav-hover ${focusRing}`}
                >
                  <Icon name="logout" className="size-[18px] rtl:-scale-x-100" />
                  <span className="max-md:sr-only">{t('common.logout')}</span>
                </button>
              </form>
            </div>
          )}
        </header>

        <main id="main-content" tabIndex={-1} className="mx-auto w-full max-w-7xl px-4 pb-24 pt-6 focus:outline-none sm:px-6 md:pb-10 lg:px-8">
          {children}
        </main>
      </div>

      <nav
        aria-label={t('nav.quick')}
        className="shell-header fixed inset-x-0 bottom-0 z-30 grid grid-cols-4 border-t border-nav-border pb-[env(safe-area-inset-bottom)] text-nav-text md:hidden"
      >
        {[items.find((i) => i.href === '/dashboard'), items.find((i) => i.href === '/moderation')].filter(Boolean).map((item) => {
          const active = item === current;
          return (
            <Link
              key={item!.href}
              href={item!.href}
              aria-current={active ? 'page' : undefined}
              className={`relative flex min-h-14 flex-col items-center justify-center gap-0.5 text-[11px] ${active ? 'font-semibold text-nav-active-text' : 'text-nav-text'} ${focusRing}`}
            >
              <Icon name={item!.icon} className={`size-[22px] ${active ? 'text-nav-active-text' : 'text-nav-icon'}`} />
              {t(item!.label)}
            </Link>
          );
        })}
        <button type="button" onClick={() => setPaletteOpen(true)} className={`flex min-h-14 flex-col items-center justify-center gap-0.5 text-[11px] ${focusRing}`}>
          <Icon name="search" className="size-[22px] text-nav-icon" />
          {t('nav.search')}
        </button>
        <button type="button" onClick={() => setDrawerOpen(true)} aria-controls="admin-nav" aria-expanded={drawerOpen} className={`flex min-h-14 flex-col items-center justify-center gap-0.5 text-[11px] ${focusRing}`}>
          <Icon name="menu" className="size-[22px] text-nav-icon" />
          {t('nav.menu')}
        </button>
      </nav>

      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} items={items} access={access} />
    </div>
  );
}
