import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { notFound } from 'next/navigation';
import { loadPublicChapters, loadPublicVideo } from '@/lib/embed/content';
import { isValidContentId } from '@/lib/embed/params';
import { originFromHost } from '@/lib/embed/request-origin';
import { buildWatchMetadata } from '@/lib/embed/watch-metadata';
import { loadSiteLink, siteWatchCanonical } from '@/lib/seo/site-link';
import { ContentUnavailableError } from '@/lib/seo/availability';
import { videoAvailability } from '@/lib/seo/availability-server';
import { breadcrumbLd, videoObjectLd } from '@/lib/seo/structured-data';
import { JsonLd } from '@/components/seo/JsonLd';

interface WatchLayoutProps {
  children: React.ReactNode;
  params: Promise<{ locale: string; id: string }>;
}

/** Pages only the signed-in viewer can see (their own private video) are never indexed. */
const NOINDEX: Metadata = { robots: { index: false, follow: false } };

/**
 * Server metadata for the (client) watch page: OG / Twitter player cards and
 * the oEmbed discovery link. Fetched anonymously, so private videos get none
 * and are noindex.
 */
export async function generateMetadata({ params }: Pick<WatchLayoutProps, 'params'>): Promise<Metadata> {
  const { locale, id } = await params;
  if (!isValidContentId(id)) return NOINDEX;
  const video = await loadPublicVideo(id);
  // Not playable for everyone (private, processing, removed): noindex
  if (!video) return NOINDEX;
  const host = (await headers()).get('host');
  if (!host) return {};
  // The channel's scholar site on its own domain holds the canonical (AUN-SCHOLAR-SITES §4.4)
  const onSite = siteWatchCanonical(await loadSiteLink(video.channelId), locale, video.id);
  const meta = buildWatchMetadata(video, locale, originFromHost(host), onSite);
  // Unlisted (D-SEO-5): the share card stays, search engines never index it
  return video.isUnlisted ? { ...meta, robots: { index: false, follow: false } } : meta;
}

/**
 * The status code is decided here, before anything streams: a video nobody may see is a real 404
 * (not a 200 "Video not found"), and an API outage is a 503 (worker.ts), never a 404.
 */
export default async function WatchLayout({ children, params }: WatchLayoutProps): Promise<React.JSX.Element> {
  const { locale, id } = await params;
  if (!isValidContentId(id)) notFound();
  const availability = await videoAvailability(id);
  if (availability === 'missing') notFound();
  if (availability === 'unavailable') throw new ContentUnavailableError('a video');
  return (
    <>
      <WatchStructuredData id={id} locale={locale} />
      {children}
    </>
  );
}

/** VideoObject + BreadcrumbList for a public video; nothing for unlisted or private ones (wiki AUN-SEO). */
async function WatchStructuredData({ id, locale }: { id: string; locale: string }) {
  const video = await loadPublicVideo(id);
  const host = (await headers()).get('host');
  if (!video || video.isUnlisted || !host) return null;
  const origin = originFromHost(host);
  const lang = locale === 'ar' ? 'ar' : 'en';
  // Chapters become the VideoObject's Clip parts (key moments); fetched only when the API says there are some
  const chapters = video.hasChapters ? await loadPublicChapters(id) : [];
  const ld = videoObjectLd(video, lang, origin, chapters);
  const onSite = siteWatchCanonical(await loadSiteLink(video.channelId), lang, video.id);
  if (onSite) ld.url = onSite.canonical;
  const crumbs = video.channelName && (video.channelHandle || video.channelId)
    ? [breadcrumbLd([
        { name: video.channelName, url: video.channelHandle ? `${origin}/${lang}/@${video.channelHandle}` : `${origin}/${lang}/channels/${video.channelId}` },
        { name: ld.name, url: ld.url },
      ])]
    : [];
  return <JsonLd data={[ld, ...crumbs]} />;
}
