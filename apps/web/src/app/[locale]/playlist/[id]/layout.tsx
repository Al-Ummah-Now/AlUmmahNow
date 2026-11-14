import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { notFound } from 'next/navigation';
import { originFromHost } from '@/lib/embed/request-origin';
import { loadPublicPlaylistResult } from '@/lib/embed/content';
import { playlistFallbackDescription, siteName } from '@/lib/seo/structured-data';
import { isValidContentId } from '@/lib/embed/params';
import { metaDescription } from '@/lib/seo/description';
import { ogImages, twitterImages } from '@/lib/seo/site-share-image';
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
  const lang = locale === 'ar' ? 'ar' : 'en';
  // The anonymous read the status check already made (per-request cache)
  const data = ((await loadPublicPlaylistResult(id)).data ?? {}) as {
    title?: string; name?: string; titleLocalized?: Record<string, string>;
    description?: string; descriptionLocalized?: Record<string, string>;
    channelName?: string; channelNameLocalized?: Record<string, string>;
  };
  const title = data.titleLocalized?.[lang] || data.title || data.name || '';
  const channel = data.channelNameLocalized?.[lang] || data.channelName;
  const own = (data.descriptionLocalized?.[lang] || data.description || '').trim() || (title ? playlistFallbackDescription(lang, title, channel) : '');
  const description = own ? metaDescription(own) : undefined;
  return {
    ...(title ? { title } : {}),
    ...(description ? { description } : {}),
    alternates: {
      canonical: url(lang),
      languages: { en: url('en'), ar: url('ar'), 'x-default': url('en') },
    },
    // Replaces the root layout's openGraph, so it names the site's image itself
    openGraph: { type: 'website', siteName: siteName(lang), url: url(lang), ...(title ? { title } : {}), ...(description ? { description } : {}), images: ogImages(null, title || undefined) },
    twitter: { card: 'summary', ...(title ? { title } : {}), ...(description ? { description } : {}), images: twitterImages(null) },
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
