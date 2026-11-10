'use client';

/**
 * "Settings › <page>" trail with a back arrow to the parent page. Rendered by
 * settings/layout.tsx on the settings sub-pages, by the profile and Contact us
 * pages when opened from Settings (?from=settings, or ?from=/<lang>/settings on
 * Contact us, whose ?from= is the page the message is about), and by
 * ChannelSettingsBreadcrumb on the
 * channel settings pages. Real links to the parent route, never history.back():
 * a page opened directly has nothing to go back to.
 */

import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { ArrowLeft, ChevronRight } from 'lucide-react';
import { useLanguage } from '@/hooks/useLanguage';
import type { AppTranslations } from '@al-ummah/shared-types';

export interface Crumb {
  label: string;
  /** Omitted for a grouping label that is not a page of its own. */
  href?: string;
}

/** True when ?from= says the page was opened from the Settings page. */
export function openedFromSettings(from: string | null | undefined, lang: string): boolean {
  if (!from) return false;
  return from === 'settings' || from.replace(/\/+$/, '') === `/${lang}/settings`;
}

/** The trail for the page at `pathname`, or null where the layout shows none (/settings itself, channel pages). */
export function settingsTrail(pathname: string, lang: string, t: AppTranslations, fromSettings = false): Crumb[] | null {
  const base = `/${lang}`;
  const settings = `${base}/settings`;
  const root: Crumb = { label: t.header?.settings || 'Settings', href: settings };
  const path = pathname.replace(/\/+$/, '');

  if (path === `${base}/profile`) {
    return fromSettings ? [root, { label: t.settings?.profileSettings || 'Profile Settings', href: `${base}/profile` }] : null;
  }
  if (path === `${base}/contact`) {
    return fromSettings ? [root, { label: t.contact.settingsTitle, href: `${base}/contact` }] : null;
  }
  if (path === `${settings}/upload-defaults`) return [root, { label: t.settings?.uploadDefaults || 'Upload Defaults', href: path }];
  if (path === `${settings}/privacy`) return [root, { label: t.privacy.settingsTitle, href: path }];
  return null;
}

interface BreadcrumbTrailProps {
  trail: Crumb[];
  label: string;
  testId?: string;
  className?: string;
}

/** The trail itself: back arrow to the nearest linked ancestor, then the crumbs; the last one is the current page. */
export function BreadcrumbTrail({ trail, label, testId = 'settings-breadcrumb', className }: BreadcrumbTrailProps) {
  const { t, dir } = useLanguage();
  const parent = [...trail.slice(0, -1)].reverse().find((c) => c.href);
  const backLabel = parent
    ? t.common.backTo
      ? t.common.backTo.replace('{page}', parent.label)
      : `${t.common.back} ${parent.label}`
    : '';

  return (
    <nav className={className ? `sb ${className}` : 'sb'} dir={dir} aria-label={label} data-testid={testId}>
      {parent?.href && (
        <Link href={parent.href} className="sb-back" aria-label={backLabel} title={backLabel} data-testid="settings-back">
          <ArrowLeft className="sb-arrow" aria-hidden="true" />
        </Link>
      )}
      <ol className="sb-list">
        {trail.map((c, i) => {
          const last = i === trail.length - 1;
          return (
            <li key={`${i}-${c.label}`} className="sb-item">
              {last ? (
                <span aria-current="page" className="sb-current">{c.label}</span>
              ) : c.href ? (
                <Link href={c.href} className="sb-link">{c.label}</Link>
              ) : (
                <span className="sb-text">{c.label}</span>
              )}
              {!last && <ChevronRight className="sb-sep" aria-hidden="true" />}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

export function SettingsBreadcrumb() {
  const { t, lang } = useLanguage();
  const pathname = usePathname() ?? '';
  const params = useSearchParams();
  const trail = settingsTrail(pathname, lang, t, openedFromSettings(params?.get('from'), lang));
  if (!trail) return null;
  return <BreadcrumbTrail trail={trail} label={t.settings?.breadcrumb || 'Settings breadcrumb'} className="sb-page" />;
}

export default SettingsBreadcrumb;
