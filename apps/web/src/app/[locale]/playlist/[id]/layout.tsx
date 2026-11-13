import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { isValidContentId } from '@/lib/embed/params';
import { ContentUnavailableError } from '@/lib/seo/availability';
import { playlistAvailability } from '@/lib/seo/availability-server';

interface PlaylistLayoutProps {
  children: React.ReactNode;
  params: Promise<{ locale: string; id: string }>;
}

/** A playlist only the signed-in viewer can see (private) is never indexed. */
export async function generateMetadata({ params }: Pick<PlaylistLayoutProps, 'params'>): Promise<Metadata> {
  const { id } = await params;
  if (!isValidContentId(id) || (await playlistAvailability(id)) !== 'public') {
    return { robots: { index: false, follow: false } };
  }
  return {};
}

/** Real status codes for the (client) playlist page: 404 when nobody here may see it, 503 when the API is down. */
export default async function PlaylistLayout({ children, params }: PlaylistLayoutProps) {
  const { id } = await params;
  if (!isValidContentId(id)) notFound();
  const availability = await playlistAvailability(id);
  if (availability === 'missing') notFound();
  if (availability === 'unavailable') throw new ContentUnavailableError('a playlist');
  return children;
}
