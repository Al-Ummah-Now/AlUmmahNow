import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { errorPageTitle, errorScreenStrings } from '@al-ummah/shared-types';
import { LOCALE_REQUEST_HEADER } from '@/lib/i18n/locales';

/**
 * The 404 page's title and robots (app/not-found.tsx, app/[locale]/not-found.tsx): the family's tab
 * title ("Page not found | Al Ummah Now", absolute, so a 404 outside the locale layout reads the same)
 * and "noindex, nofollow" in place of the layout's "index, follow" (the Worker keeps it the only robots
 * meta, lib/seo/error-robots.ts). The Worker swaps the title to the 410 words for purged content
 * (lib/seo/gone.ts).
 */
export async function notFoundMetadata(): Promise<Metadata> {
  let locale = 'en';
  try {
    locale = (await headers()).get(LOCALE_REQUEST_HEADER) === 'ar' ? 'ar' : 'en';
  } catch {
    locale = 'en';
  }
  return { title: { absolute: errorPageTitle(locale, errorScreenStrings(locale).kinds.notFound.title) }, robots: { index: false, follow: false } };
}
