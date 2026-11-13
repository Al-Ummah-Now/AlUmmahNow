import { headers } from 'next/headers';
import { JsonLd } from '@/components/seo/JsonLd';
import { originFromHost } from '@/lib/embed/request-origin';
import { websiteLd } from '@/lib/seo/structured-data';
import { fetchVideosWithPagination } from '@/lib/api/videos';
import { withinBudget } from '@/lib/ssr/first-data';
import HomePageClient from './HomePageClient';

/**
 * The home page (client, HomePageClient.tsx) with the site's WebSite + SearchAction for search
 * engines. The first page of videos is read here, as the viewer, so the HTML already has the hero
 * and the cards (wiki AUN-SEO, phase 4); the client goes on from it.
 */
export default async function HomePage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const [host, firstPage] = await Promise.all([
    headers().then((h) => h.get('host')),
    withinBudget(() => fetchVideosWithPagination(null)),
  ]);
  return (
    <>
      {host ? <JsonLd data={websiteLd(locale, originFromHost(host))} /> : null}
      <HomePageClient initialPage={firstPage} />
    </>
  );
}
