import type { Metadata } from 'next';
import { errorPageTitle, errorScreenStrings } from '@al-ummah/shared-types';
import { getI18n } from '@/i18n/server';
import { PublicShell } from '@/components/PublicShell';
import { FriendlyError } from '@/components/FriendlyError';

/**
 * The family's tab title ("Page not found | Al Ummah Now", as on every app) instead of the admin's
 * own. Robots is cleared (null drops the layout's): Next renders its own robots meta on a 404, in the
 * HTML and the RSC payload, so that one is the only robots meta and the Worker sets it to
 * "noindex, nofollow" (lib/seo/error-robots.ts); X-Robots-Tag says the same.
 */
export async function generateMetadata(): Promise<Metadata> {
  const { locale } = await getI18n();
  return { title: { absolute: errorPageTitle(locale, errorScreenStrings(locale).kinds.notFound.title) }, robots: null };
}

export default async function NotFound() {
  const { locale } = await getI18n();

  return (
    // The family card places itself as on every app: centred in the page on desktop, top-aligned 16px
    // from each edge on a phone (aun-error-page.css). Not `inline`: that keeps it at the top at every width
    <PublicShell top>
      <div data-testid="not-found" className="w-full">
        <FriendlyError locale={locale} kind="notFound" />
      </div>
    </PublicShell>
  );
}
