import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { notFound } from 'next/navigation';
import { loadPublicVideo } from '@/lib/embed/content';
import { isValidContentId } from '@/lib/embed/params';
import { originFromHost } from '@/lib/embed/request-origin';
import { buildWatchMetadata } from '@/lib/embed/watch-metadata';
import { ContentUnavailableError } from '@/lib/seo/availability';
import { videoAvailability } from '@/lib/seo/availability-server';

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
  return buildWatchMetadata(video, locale, originFromHost(host));
}

/**
 * The status code is decided here, before anything streams: a video nobody may see is a real 404
 * (not a 200 "Video not found"), and an API outage is a 503 (worker.ts), never a 404.
 */
export default async function WatchLayout({ children, params }: WatchLayoutProps): Promise<React.JSX.Element> {
  const { id } = await params;
  if (!isValidContentId(id)) notFound();
  const availability = await videoAvailability(id);
  if (availability === 'missing') notFound();
  if (availability === 'unavailable') throw new ContentUnavailableError('a video');
  return <>{children}</>;
}
