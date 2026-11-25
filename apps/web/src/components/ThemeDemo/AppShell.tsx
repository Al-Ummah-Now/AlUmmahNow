'use client';
// The application shell: the shared header (docs/design/NAV.md "Header"), the side rail / drawer and the
// phone tab bar. One component for both directions.
import { HeaderSearch } from '@/components/Header/HeaderSearch';
import { useEffect, useState, type MouseEvent } from 'react';
import Link from '@/components/common/AppLink';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useTheme } from 'next-themes';
import { ChevronLeft, ChevronRight, CircleHelp, CircleUserRound, Clock, Compass, Heart, History, Home, Menu, ShieldCheck, Tv, BookOpen, BookOpenText, Mail, Activity, Info, X, type LucideIcon } from 'lucide-react';
import { useLanguage } from '@/hooks/useLanguage';
import { saveLanguagePreference } from '@/lib/i18n/utils';
import { NotificationBell } from '@/components/notifications/NotificationBell';
import { UnifiedNavigation } from '@/components/UnifiedNavigation';
import { UploadAction } from '@/components/Header/UploadAction';
import { HeaderBrand, HeaderEnvBadge, HeaderLangButton, HeaderMenuButton, HeaderModeButton, langSwitchHref } from '@/components/Header/HeaderParts';
import { BRAND_LOGO } from '@/components/brand/BrandLogo';
import { useRailMotion } from './rail-breakpoint';
import { useMoreBelow } from './rail-scroll';
import { statusPageUrl } from '@/lib/navigation/destinations';
import { getEnvironment } from '@/lib/runtime-config';
import { IdentityTour } from '@/components/help/IdentityTour';
import { useFeatures } from '@/hooks/useFeatures';
import { CREDITS_COPY } from '@/lib/credits/copy';

const L = {
  en: { about: 'About', status: 'Status', browse: 'Browse', more: 'More', history: 'History', watchLater: 'Watch later', liked: 'Liked videos', close: 'Close menu' },
  ar: { about: 'من نحن', status: 'حالة الخدمات', browse: 'تصفّح', more: 'المزيد', history: 'السجل', watchLater: 'المشاهدة لاحقًا', liked: 'المرئيات التي أعجبتك', close: 'إغلاق القائمة' },
};

/** `hub`: the "You" entry. In the collapsed rail it is an icon item; in the open rail and the drawer it reads as
 * the section's heading link ("You ›") over History, Watch later and Liked videos (owner, 2026-11-13). */
interface Item { label: string; href: string; icon: LucideIcon; tab?: boolean; hub?: boolean; external?: boolean; testId?: string }

export function AppShell() {
  useEffect(() => { console.log(`HDR ${Date.now()} app mount AppShell ${location.pathname}`); return () => console.log(`HDR ${Date.now()} app unmount AppShell ${location.pathname}`); }, []);
  const { t, lang, oppositeLanguage } = useLanguage();
  const pathname = usePathname() ?? '';
  const router = useRouter();
  const params = useSearchParams();
  const { resolvedTheme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  const [open, setOpen] = useState(false);
  // Credits (Quran Foundation's attribution and editions) only while Quran text from QF is shown here
  const { features } = useFeatures();
  const showCredits = features.quranText || features.quranEditions;
  const c = lang === 'ar' ? L.ar : L.en;
  const base = `/${lang}`;
  const rtl = lang === 'ar';

  // One build serves stage and production: the env's status host is known only in the browser
  const [statusHref, setStatusHref] = useState(() => statusPageUrl('', lang));
  useEffect(() => { setMounted(true); setStatusHref(statusPageUrl(window.location.hostname, lang)); }, [lang]);
  useRailMotion(open);
  // The rail's list: data-more-below while items are below; the edge strip under it shades then (#1620)
  const railList = useMoreBelow<HTMLDivElement>();
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
      // The CMS About page (the one www serves), app/[locale]/about
      { label: c.about, href: `${base}/about`, icon: Info },
      { label: t.help.navLabel, href: `${base}/help`, icon: CircleHelp },
      { label: t.navigation.privacyAndCookies, href: `${base}/settings/privacy`, icon: ShieldCheck },
      { label: t.communityGuidelines.navLabel, href: `${base}/community-guidelines`, icon: BookOpen },
      ...(showCredits ? [{ label: CREDITS_COPY[rtl ? 'ar' : 'en'].navLabel, href: `${base}/credits`, icon: BookOpenText, testId: 'nav-credits' }] : []),
      { label: t.contact.navLabel, href: `${base}/contact`, icon: Mail },
      // The public status page (apps/status): its own host, so it opens even when this site is down
      { label: c.status, href: statusHref, icon: Activity, external: true, testId: 'nav-status' },
    ] },
  ];

  const matches = (href: string) => {
    const clean = href.replace(/\/$/, '');
    return clean === base ? pathname === base || pathname === `${base}/` : pathname === clean || pathname.startsWith(`${clean}/`);
  };
  // One current item per list: when a parent and its sub-page are both listed ("You" and Watch later), only the
  // most specific match is the current page
  const currentOf = (hrefs: string[]) => hrefs.filter(matches).sort((a, b) => b.length - a.length)[0];

  // The same page and query in the other language (the locale prefix swapped)
  const langHref = langSwitchHref(pathname, lang, params?.toString());
  const switchLanguage = (e: MouseEvent<HTMLAnchorElement>) => {
    // A modified click (new tab or window) follows the link itself
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
    e.preventDefault();
    saveLanguagePreference(oppositeLanguage);
    router.push(langHref);
  };

  const dark = mounted && resolvedTheme === 'dark';
  const environment = getEnvironment();
  const tabs = groups.flatMap((g) => g.items).filter((i) => i.tab);
  const currentRail = currentOf(groups.flatMap((g) => g.items).filter((i) => !i.external).map((i) => i.href));
  const currentTab = currentOf(tabs.map((i) => i.href));
  const tab = (it: Item) => (
    <Link key={it.href} href={it.href} className="tb" aria-current={it.href === currentTab ? 'page' : undefined}><it.icon aria-hidden="true" /><span>{it.label}</span></Link>
  );

  return (
    // display: contents: this wrapper only carries the direction. As a box it was exactly the header's
    // height, and a sticky header can't outlast its parent: it scrolled away with the page, leaving the
    // rail's top band empty (owner, 2026-11-16: "why is nav floating"). The header, rail (.nv-panel) and
    // tab bar (.tabbar) must never sit inside a box that clips, transforms or filters them.
    <div dir={rtl ? 'rtl' : 'ltr'} className="contents">
      {/* The shared header (docs/design/NAV.md "Header"; pieces in Header/HeaderParts.tsx, checked against
          packages/fanous-tokens/nav/header.js): drawer toggle, brand, env badge, search, then Upload, the
          bell, language, light/dark and the account (or Sign in); mirrored in RTL */}
      <header className="ah aun-header">
        <HeaderMenuButton lang={lang} label={open ? c.close : undefined} className="ah-menu" aria-expanded={open} data-testid="nav-drawer-toggle" onClick={() => setOpen(!open)} />
        <HeaderBrand lang={lang} href={`${base}/`} app={t.navigation.appVideos} link={Link} img={{ srcSet: BRAND_LOGO.srcSet, loading: 'eager', fetchPriority: 'high', decoding: 'async', 'data-testid': 'brand-logo' }} />
        <HeaderEnvBadge environment={environment} lang={lang} />
        <div className="aun-header-primary ah-primary"><HeaderSearch /></div>
        <div className="aun-header-tools ah-end">
          <UploadAction />
          <NotificationBell dir={rtl ? 'rtl' : 'ltr'} />
          <HeaderLangButton lang={lang} href={langHref} onClick={switchLanguage} />
          <HeaderModeButton lang={lang} dark={dark} onClick={() => setTheme(dark ? 'light' : 'dark')} />
          <UnifiedNavigation />
        </div>
      </header>

      {open && <button type="button" className="nv-scrim" aria-label={c.close} tabIndex={-1} onClick={() => setOpen(false)} />}
      <nav className="nv-panel" data-open={open} data-testid="side-nav" aria-label={c.browse}>
        <div className="nv-scroll" ref={railList} data-testid="side-nav-list">
          {groups.map((g, i) => (
            <div className="nv-group" key={g.title ?? i}>
              {g.title && <div className="nv-heading">{g.title}</div>}
              {g.items.map((it) => it.external ? (
                <a key={it.label} href={it.href} className="nv" data-testid={it.testId} title={it.label}>
                  <it.icon aria-hidden="true" /><span>{it.label}</span>
                </a>
              ) : (
                <Link key={it.href} href={it.href} className={it.hub ? 'nv nv-hub' : 'nv'} data-testid={it.hub ? 'nav-you' : undefined} aria-current={it.href === currentRail ? 'page' : undefined} title={it.label}>
                  <it.icon aria-hidden="true" /><span>{it.label}</span>
                  {it.hub && (rtl ? <ChevronLeft className="nv-chev" aria-hidden="true" /> : <ChevronRight className="nv-chev" aria-hidden="true" />)}
                </Link>
              ))}
            </div>
          ))}
        </div>
        {/* The scroll hint (#1620): a 14px strip below the list, outside its scroll box, so it never sits
            over an item; with a line, a soft shadow and a small down chevron only while the list says more items are below (system.css .nv-edge) */}
        <div className="nv-edge" aria-hidden="true" />
        {/* Language and light/dark live in the header (docs/design/NAV.md); the drawer keeps its close button */}
        <div className="nv-foot">
          <button type="button" className="ic ic-sm nv-close" aria-label={c.close} onClick={() => setOpen(false)}><X aria-hidden="true" /></button>
        </div>
      </nav>

      {/* The identity tour: offered once per account, re-opened from Help */}
      <IdentityTour />

      {/* Phone tab bar. Below 640px it also carries Upload (centre) and More (the drawer), which leave the header
          there so that language, light/dark and the account fit beside the logo (docs/design/NAV.md "Phone") */}
      <nav className="tabbar" aria-label={c.browse}>
        {tabs.slice(0, 2).map(tab)}
        <UploadAction variant="tab" />
        {tabs.slice(2).map(tab)}
        <button type="button" className="tb tb-phone" aria-expanded={open} data-testid="nav-more-tab" onClick={() => setOpen(!open)}><Menu aria-hidden="true" /><span>{c.more}</span></button>
      </nav>
    </div>
  );
}
