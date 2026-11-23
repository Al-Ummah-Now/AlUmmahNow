import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { notFound } from 'next/navigation';
import { originFromHost } from '@/lib/embed/request-origin';
import { loadPublicPlaylistResult, loadPublicVideo } from '@/lib/embed/content';
import { playlistFallbackDescription, siteName } from '@/lib/seo/structured-data';
import { isValidContentId } from '@/lib/embed/params';
import { metaDescription } from '@/lib/seo/description';
import { LARGE_CARD, ogImages, twitterImages } from '@/lib/seo/site-share-image';
import { channelCardUrl, videoCardUrl } from '@/lib/share-card/layout';
import { ContentUnavailableError } from '@/lib/seo/availability';
import { playlistAvailability } from '@/lib/seo/availability-server';
import { notFoundMetadata } from '@/lib/seo/not-found-metadata';

interface PlaylistLayoutProps {
  children: React.ReactNode;
  params: Promise<{ locale: string; id: string }>;
}

/** A playlist only the signed-in viewer can see (private) is never indexed. */
export async function generateMetadata({ params }: Pick<PlaylistLayoutProps, 'params'>): Promise<Metadata> {
  const { locale, id } = await params;
  if (!isValidContentId(id)) return notFoundMetadata();
  const availability = await playlistAvailability(id);
  // The layout answers 404 (or the Worker 410): the error page's title and robots, not ours
  if (availability === 'missing') return notFoundMetadata();
  if (availability !== 'public') return { robots: { index: false, follow: false } };
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
    channelId?: string; videos?: unknown;
  };
  const title = data.titleLocalized?.[lang] || data.title || data.name || '';
  const channel = data.channelNameLocalized?.[lang] || data.channelName;
  const own = (data.descriptionLocalized?.[lang] || data.description || '').trim() || (title ? playlistFallbackDescription(lang, title, channel) : '');
  const description = own ? metaDescription(own) : undefined;
  // The first video's 1200x630 card (large previews) when it is public, else the channel's
  const first = Array.isArray(data.videos) && typeof data.videos[0] === 'string' ? await loadPublicVideo(data.videos[0]) : null;
  const origin = originFromHost(host);
  const image = first?.poster ? videoCardUrl(origin, first.id) : data.channelId ? channelCardUrl(origin, data.channelId, lang) : null;
  return {
    ...(title ? { title } : {}),
    ...(description ? { description } : {}),
    alternates: {
      canonical: url(lang),
      languages: { en: url('en'), ar: url('ar'), 'x-default': url('en') },
    },
    // Replaces the root layout's openGraph, so it names its image itself
    openGraph: { type: 'website', siteName: siteName(lang), url: url(lang), ...(title ? { title } : {}), ...(description ? { description } : {}), images: ogImages(image, title || undefined) },
    twitter: { card: LARGE_CARD, ...(title ? { title } : {}), ...(description ? { description } : {}), images: twitterImages(image) },
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
