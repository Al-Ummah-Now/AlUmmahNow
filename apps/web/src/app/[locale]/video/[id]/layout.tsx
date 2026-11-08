import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { loadPublicVideo } from '@/lib/embed/content';
import { isValidContentId } from '@/lib/embed/params';
import { originFromHost } from '@/lib/embed/request-origin';
import { buildWatchMetadata } from '@/lib/embed/watch-metadata';

interface WatchLayoutProps {
  children: React.ReactNode;
  params: Promise<{ locale: string; id: string }>;
}

/**
 * Server metadata for the (client) watch page: OG / Twitter player cards and
 * the oEmbed discovery link. Fetched anonymously, so private videos get none.
 */
export async function generateMetadata({ params }: Pick<WatchLayoutProps, 'params'>): Promise<Metadata> {
  const { locale, id } = await params;
  if (!isValidContentId(id)) return {};
  const host = (await headers()).get('host');
  if (!host) return {};
  return buildWatchMetadata(await loadPublicVideo(id), locale, originFromHost(host));
}

export default function WatchLayout({ children }: WatchLayoutProps) {
  return children;
}
