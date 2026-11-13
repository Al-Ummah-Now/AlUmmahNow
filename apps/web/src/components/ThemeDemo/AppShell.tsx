'use client';
// Prototype only: the redesigned application shell. One component for both directions.
import { HeaderSearch } from '@/components/Header/HeaderSearch';
import { useEffect, useState } from 'react';
import Link from '@/components/common/AppLink';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useTheme } from 'next-themes';
import { ChevronLeft, ChevronRight, CircleHelp, CircleUserRound, Clock, Compass, Heart, History, Home, Languages, Menu, Moon, ShieldCheck, Sun, Tv, BookOpen, Mail, Activity, X, type LucideIcon } from 'lucide-react';
import { useLanguage } from '@/hooks/useLanguage';
import { saveLanguagePreference } from '@/lib/i18n/utils';
import { NotificationBell } from '@/components/notifications/NotificationBell';
import { UnifiedNavigation } from '@/components/UnifiedNavigation';
import { UnifiedNavigationRTL } from '@/components/UnifiedNavigation/rtl';
import { UploadAction } from '@/components/Header/UploadAction';
import { BrandLogo } from '@/components/brand/BrandLogo';
import { useRailMotion } from './rail-breakpoint';
import { statusPageUrl } from '@/lib/navigation/destinations';
import { IdentityTour } from '@/components/help/IdentityTour';

const L = {
  en: { status: 'Status', browse: 'Browse', create: 'Create', more: 'More', history: 'History', watchLater: 'Watch later', liked: 'Liked videos', settings: 'Settings', search: 'Search videos', lightMode: 'Switch to light mode', darkMode: 'Switch to dark mode', other: 'العربية', otherLabel: 'التبديل إلى العربية', menu: 'Menu', close: 'Close menu' },
  ar: { status: 'حالة الخدمات', browse: 'تصفّح', create: 'إنشاء', more: 'المزيد', history: 'السجل', watchLater: 'المشاهدة لاحقًا', liked: 'المرئيات التي أعجبتك', settings: 'الإعدادات', search: 'ابحث عن مرئيات', lightMode: 'التبديل إلى الوضع الفاتح', darkMode: 'التبديل إلى الوضع الداكن', other: 'English', otherLabel: 'Switch to English', menu: 'القائمة', close: 'إغلاق القائمة' },
};

/** `hub`: the "You" entry. In the collapsed rail it is an icon item; in the open rail and the drawer it reads as
 * the section's heading link ("You ›") over History, Watch later and Liked videos (owner, 2026-11-13). */
interface Item { label: string; href: string; icon: LucideIcon; tab?: boolean; hub?: boolean; external?: boolean }

export function AppShell() {
  const { t, lang, oppositeLanguage } = useLanguage();
  const pathname = usePathname() ?? '';
  const router = useRouter();
  const params = useSearchParams();
  const { resolvedTheme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  const [open, setOpen] = useState(false);
  const c = lang === 'ar' ? L.ar : L.en;
  const base = `/${lang}`;
  const rtl = lang === 'ar';

  // One build serves stage and production: the env's status host is known only in the browser
  const [statusHref, setStatusHref] = useState(() => statusPageUrl('', lang));
  useEffect(() => { setMounted(true); setStatusHref(statusPageUrl(window.location.hostname, lang)); }, [lang]);
  useRailMotion(open);
  useEffect(() => { setOpen(false); }, [pathname]);
  useEffect(() => { document.documentElement.dataset.rail = open ? 'open' : 'closed'; }, [open]);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  const groups: { title?: string; items: Item[] }[] = [
    { items: [
      { label: t.navigation.homeLink, href: `${base}/`, icon: Home, tab: true },
      { label: t.navigation.explore, href: `${base}/explore`, icon: Compass, tab: true },
      { label: t.navigation.subscriptions, href: `${base}/subscriptions`, icon: Tv, tab: true },
    ] },
    { items: [
      { label: t.navigation.library, href: `${base}/library`, icon: CircleUserRound, tab: true, hub: true },
      { label: c.history, href: `${base}/history`, icon: History },
      { label: c.watchLater, href: `${base}/library/watch-later`, icon: Clock },
      { label: c.liked, href: `${base}/library/liked`, icon: Heart },
    ] },
    { title: c.more, items: [
      { label: t.help.navLabel, href: `${base}/help`, icon: CircleHelp },
      { label: t.navigation.privacyAndCookies, href: `${base}/settings/privacy`, icon: ShieldCheck },
      { label: t.communityGuidelines.navLabel, href: `${base}/community-guidelines`, icon: BookOpen },
      { label: t.contact.navLabel, href: `${base}/contact`, icon: Mail },
      // The public status page (apps/status): its own host, so it opens even when this site is down
      { label: c.status, href: statusHref, icon: Activity, external: true },
    ] },
  ];

  const isCurrent = (href: string) => {
    const clean = href.replace(/\/$/, '');
    return clean === base ? pathname === base || pathname === `${base}/` : pathname === clean || pathname.startsWith(`${clean}/`);
  };

  const switchLanguage = () => {
    saveLanguagePreference(oppositeLanguage);
    const next = pathname.replace(base, `/${oppositeLanguage}`) || `/${oppositeLanguage}`;
    const qs = params?.toString();
    router.push(qs ? `${next}?${qs}` : next);
  };

  const dark = mounted && resolvedTheme === 'dark';
  const tabs = groups.flatMap((g) => g.items).filter((i) => i.tab);

  return (
    <div dir={rtl ? 'rtl' : 'ltr'}>
      <header className="ah">
        <div className="ah-start">
          <button type="button" className="ic" aria-label={open ? c.close : c.menu} aria-expanded={open} data-testid="nav-drawer-toggle" onClick={() => setOpen(!open)}><Menu aria-hidden="true" /></button>
          <Link href={`${base}/`} className="ah-brand" aria-label={t.a11y.goToHomePage}>
            <BrandLogo className="ah-logo" />
            <span>{t.common.appName}</span>
          </Link>
        </div>
        <HeaderSearch />
        <div className="ah-end">
          {/* The action cluster (docs/design/NAV.md): Upload, notifications, account; mirrored in RTL */}
          <UploadAction />
          <NotificationBell dir={rtl ? 'rtl' : 'ltr'} />
          {rtl ? <UnifiedNavigationRTL /> : <UnifiedNavigation />}
        </div>
      </header>

      {open && <button type="button" className="nv-scrim" aria-label={c.close} tabIndex={-1} onClick={() => setOpen(false)} />}
      <nav className="nv-panel" data-open={open} data-testid="side-nav" aria-label={c.browse}>
        <div className="nv-scroll">
          {groups.map((g, i) => (
            <div className="nv-group" key={g.title ?? i}>
              {g.title && <div className="nv-heading">{g.title}</div>}
              {g.items.map((it) => it.external ? (
                <a key={it.label} href={it.href} className="nv" data-testid="nav-status" title={it.label}>
                  <it.icon aria-hidden="true" /><span>{it.label}</span>
                </a>
              ) : (
                <Link key={it.href} href={it.href} className={it.hub ? 'nv nv-hub' : 'nv'} data-testid={it.hub ? 'nav-you' : undefined} aria-current={isCurrent(it.href) ? 'page' : undefined} title={it.label}>
                  <it.icon aria-hidden="true" /><span>{it.label}</span>
                  {it.hub && (rtl ? <ChevronLeft className="nv-chev" aria-hidden="true" /> : <ChevronRight className="nv-chev" aria-hidden="true" />)}
                </Link>
              ))}
            </div>
          ))}
        </div>
        <div className="nv-foot">
          <button type="button" className="ic ic-sm" data-testid="theme-toggle" aria-label={dark ? c.lightMode : c.darkMode} title={dark ? c.lightMode : c.darkMode} onClick={() => setTheme(dark ? 'light' : 'dark')} suppressHydrationWarning>
            {dark ? <Sun aria-hidden="true" /> : <Moon aria-hidden="true" />}
          </button>
          <button type="button" className="ic ic-sm nv-lang" data-testid="language-toggle" aria-label={c.otherLabel} title={c.otherLabel} onClick={switchLanguage}>
            <Languages aria-hidden="true" /><span lang={rtl ? 'en' : 'ar'}>{c.other}</span>
          </button>
          <button type="button" className="ic ic-sm nv-close" aria-label={c.close} onClick={() => setOpen(false)}><X aria-hidden="true" /></button>
        </div>
      </nav>

      {/* The identity tour: offered once per account, re-opened from Help */}
      <IdentityTour />

      <nav className="tabbar" aria-label={c.browse}>
        {tabs.map((it) => (
          <Link key={it.href} href={it.href} className="tb" aria-current={isCurrent(it.href) ? 'page' : undefined}><it.icon aria-hidden="true" /><span>{it.label}</span></Link>
        ))}
      </nav>
    </div>
  );
}
