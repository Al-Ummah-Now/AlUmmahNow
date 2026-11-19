import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { errorScreenStrings } from '@al-ummah/shared-types';
import { LOCALE_REQUEST_HEADER } from '@/lib/i18n/locales';

/**
 * The 404 page's title and robots (app/not-found.tsx, app/[locale]/not-found.tsx): the page's own
 * title in its language and noindex in place of the layout's "index, follow". The Worker swaps the
 * title to the 410 words for purged content (lib/seo/gone.ts).
 */
export async function notFoundMetadata(): Promise<Metadata> {
  let locale = 'en';
  try {
    locale = (await headers()).get(LOCALE_REQUEST_HEADER) === 'ar' ? 'ar' : 'en';
  } catch {
    locale = 'en';
  }
  return { title: errorScreenStrings(locale).kinds.notFound.title, robots: { index: false, follow: true } };
}
