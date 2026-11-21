import { headers } from 'next/headers';
import { JsonLd } from '@/components/seo/JsonLd';
import { originFromHost } from '@/lib/embed/request-origin';
import type { Metadata } from 'next';
import { homeMetadata, websiteLd } from '@/lib/seo/structured-data';
import { fetchVideosWithPagination } from '@/lib/api/videos';
import { getHomeRails } from '@/lib/api/discovery-home';
import { withinBudget } from '@/lib/ssr/first-data';
import { stableImages } from '@/lib/ssr/stable-images';
import { NONCE_HEADER } from '@/lib/security/nonce-header';
import { SIGN_IN_BANNER_SCRIPT } from '@/lib/home/sign-in-banner';
import HomePageClient from './HomePageClient';

/**
 * The home page (client, HomePageClient.tsx) with the site's WebSite + SearchAction for search
 * engines. The first page of videos is read here, as the viewer, so the HTML already has the hero
 * and the cards (wiki AUN-SEO, phase 4); the client goes on from it. The ranked rails (wiki E07
 * "Discovery ranking") are read here too, in the page language, so their headings and cards are in the HTML. Its images are the stable /thumb
 * ones, never signed CDN URLs (lib/ssr/stable-images.ts).
 */
export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  return homeMetadata((await params).locale);
}

export default async function HomePage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const language = locale === 'ar' ? 'ar' : 'en';
  const [requestHeaders, firstPage, rails] = await Promise.all([
    headers(),
    withinBudget(() => fetchVideosWithPagination(null)),
    withinBudget(() => getHomeRails(language)),
  ]);
  const host = requestHeaders.get('host');
  const stable = firstPage ? stableImages(firstPage) : undefined;
  const stableRails = rails ? stableImages(rails) : undefined;
  return (
    <>
      {host ? <JsonLd data={websiteLd(locale, originFromHost(host))} /> : null}
      {/* Before the sign-in banner in the HTML: hides a dismissed one before the first paint (CLS 0) */}
      <script nonce={requestHeaders.get(NONCE_HEADER) ?? undefined} dangerouslySetInnerHTML={{ __html: SIGN_IN_BANNER_SCRIPT }} />
      <HomePageClient
        initialPage={stable?.value}
        initialPartial={stable?.partial}
        initialRails={stableRails?.value}
        initialRailsPartial={stableRails?.partial}
      />
    </>
  );
}
