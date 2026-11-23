import { cache } from 'react';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { AboutPage } from '@/components/about/AboutPage';
import { loadPage } from '@/lib/about/cms-page';
import { ABOUT_FALLBACK } from '@/lib/about/fallback';
import { ABOUT_SLUG, aboutMetadata } from '@/lib/about/metadata';
import { deriveWwwUrl } from '@/lib/scholars/sites';
import { notFoundMetadata } from '@/lib/seo/not-found-metadata';

/**
 * About (/[locale]/about): the CMS About page, the one www serves at /{l}/about/. Editors change it in
 * the CMS pages editor; it is canonical to www's (lib/about/metadata.ts). With the CMS down, the last
 * good copy, then the built-in copy (lib/about/cms-page.ts): never a blank page.
 */
interface AboutRouteProps {
  params: Promise<{ locale: string }>;
}

// Read per request (the CMS copy changes without a deploy); the CMS read itself is edge-cached
export const dynamic = 'force-dynamic';

const lang = (locale: string): 'en' | 'ar' => (locale === 'ar' ? 'ar' : 'en');
const wwwUrl = () => deriveWwwUrl(process.env.OPENAUTH_ISSUER || process.env.Issuer, process.env.WWW_URL);

/**
 * One CMS read per request (metadata and page share it). Not translated yet: the other language's
 * page, as www shows it (its canonical then names the original, lib/about/metadata.ts).
 */
const load = cache(async (locale: 'en' | 'ar') => {
  const own = await loadPage(locale, ABOUT_SLUG, ABOUT_FALLBACK[locale]);
  if (own.status === 'ok') return own;
  const other = locale === 'ar' ? 'en' : 'ar';
  const borrowed = await loadPage(other, ABOUT_SLUG, null);
  return borrowed.status === 'ok' && borrowed.source !== 'builtin' ? borrowed : own;
});

export async function generateMetadata({ params }: AboutRouteProps): Promise<Metadata> {
  const l = lang((await params).locale);
  const r = await load(l);
  // The page answers 404 then: the error page's title and robots
  if (r.status !== 'ok') return notFoundMetadata();
  return aboutMetadata(r.page, l, wwwUrl());
}

export default async function AboutRoute({ params }: AboutRouteProps) {
  const l = lang((await params).locale);
  const r = await load(l);
  // Removed or unpublished in the CMS: gone here too, as on www
  if (r.status !== 'ok') notFound();
  return <AboutPage page={r.page} locale={l} source={r.source} wwwUrl={wwwUrl()} />;
}
