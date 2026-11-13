import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { notFound } from 'next/navigation';
import { originFromHost } from '@/lib/embed/request-origin';
import { isValidContentId } from '@/lib/embed/params';
import { ContentUnavailableError } from '@/lib/seo/availability';
import { playlistAvailability } from '@/lib/seo/availability-server';

interface PlaylistLayoutProps {
  children: React.ReactNode;
  params: Promise<{ locale: string; id: string }>;
}

/** A playlist only the signed-in viewer can see (private) is never indexed. */
export async function generateMetadata({ params }: Pick<PlaylistLayoutProps, 'params'>): Promise<Metadata> {
  const { locale, id } = await params;
  if (!isValidContentId(id) || (await playlistAvailability(id)) !== 'public') {
    return { robots: { index: false, follow: false } };
  }
  const host = (await headers()).get('host');
  if (!host) return {};
  // Each language is its own canonical; x-default is English (D-SEO-1)
  const url = (lang: string) => `${originFromHost(host)}/${lang}/playlist/${encodeURIComponent(id)}`;
  return {
    alternates: {
      canonical: url(locale === 'ar' ? 'ar' : 'en'),
      languages: { en: url('en'), ar: url('ar'), 'x-default': url('en') },
    },
  };
}

/** Real status codes for the (client) playlist page: 404 when nobody here may see it, 503 when the API is down. */
export default async function PlaylistLayout({ children, params }: PlaylistLayoutProps): Promise<React.JSX.Element> {
  const { id } = await params;
  if (!isValidContentId(id)) notFound();
  const availability = await playlistAvailability(id);
  if (availability === 'missing') notFound();
  if (availability === 'unavailable') throw new ContentUnavailableError('a playlist');
  return <>{children}</>;
}
