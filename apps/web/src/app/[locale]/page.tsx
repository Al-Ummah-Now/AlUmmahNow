import { headers } from 'next/headers';
import { JsonLd } from '@/components/seo/JsonLd';
import { originFromHost } from '@/lib/embed/request-origin';
import { websiteLd } from '@/lib/seo/structured-data';
import HomePageClient from './HomePageClient';

/** The home page (client, HomePageClient.tsx) with the site's WebSite + SearchAction for search engines. */
export default async function HomePage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const host = (await headers()).get('host');
  return (
    <>
      {host ? <JsonLd data={websiteLd(locale, originFromHost(host))} /> : null}
      <HomePageClient />
    </>
  );
}
