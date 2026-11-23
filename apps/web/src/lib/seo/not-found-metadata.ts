import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { errorPageTitle, errorScreenStrings } from '@al-ummah/shared-types';
import { LOCALE_REQUEST_HEADER } from '@/lib/i18n/locales';

/**
 * The 404 page's title and robots (app/not-found.tsx, app/[locale]/not-found.tsx): the family's tab
 * title ("Page not found | Al Ummah Now", absolute, so a 404 outside the locale layout reads the same).
 * Robots is cleared (null drops the layout's "index, follow"): Next renders its own robots meta on any
 * status above 400, in the HTML and in the RSC payload, so that one is the page's only robots meta and
 * the Worker sets it to the family's "noindex, nofollow" (lib/seo/error-robots.ts). A second robots
 * meta of ours would be dropped from the HTML by the Worker but put back by hydration from the payload.
 * The Worker swaps the title to the 410 words for purged content (lib/seo/gone.ts).
 */
export async function notFoundMetadata(): Promise<Metadata> {
  let locale = 'en';
  try {
    locale = (await headers()).get(LOCALE_REQUEST_HEADER) === 'ar' ? 'ar' : 'en';
  } catch {
    locale = 'en';
  }
  return { title: { absolute: errorPageTitle(locale, errorScreenStrings(locale).kinds.notFound.title) }, robots: null };
}
