'use client';

import { metaSeparator } from '@al-ummah/shared-types';
import { useOptionalLocale } from '@/i18n/I18nProvider';
import type { Locale } from '@/i18n/config';

/**
 * The mark between two values in a line of facts ("Incident • Resolved", "2 attempts • 5 min ago").
 * Arabic uses the Arabic comma: a dot next to Arabic digits reads as the digit zero («٣ • ١٢»
 * reads as «٣٠١٢»; owner decision with O38, 2026-11-21). English keeps " • ".
 *
 * Inline text: renders « • » or «، » with its own spacing, so it goes straight between two values
 * with no spaces around it. In a flex row with a gap, pass `gap` (the row's gap as a CSS length):
 * the Arabic comma is then pulled back against the value before it, as Arabic punctuation sits.
 * For values joined in one string use `metaSeparator` / `joinMeta` from shared-types.
 */
export function Sep({ locale: localeProp, gap }: { locale?: Locale | string; gap?: string }) {
  const context = useOptionalLocale();
  const locale = localeProp === 'ar' || localeProp === 'en' ? localeProp : (context ?? 'en');
  const arabic = locale === 'ar';
  if (gap) {
    return arabic
      ? <span aria-hidden="true" data-meta-sep="ar" style={{ marginInlineStart: `calc(-1 * ${gap})` }}>،</span>
      : <span aria-hidden="true" data-meta-sep="en">•</span>;
  }
  return <>{metaSeparator(locale)}</>;
}
