/**
 * Watch page social metadata (spec 25.2, docs/embeds/README.md §3):
 * Open Graph video, Twitter player card, hreflang alternates and the oEmbed
 * discovery link. Only public videos get it; others keep the site defaults.
 */

import type { Metadata } from 'next';
import { videoAspect, type EmbedVideo } from './content';
import { canonicalWatchUrl, embedUrl, oembedEndpointUrl } from './snippets';
import { shareImageUrl } from './share-image';
import { watchFallbackDescription } from '@/lib/seo/structured-data';

const PLAYER_WIDTH = 1280;
const PLAYER_HEIGHT = 720;
const DESCRIPTION_MAX = 200;

/**
 * The player size the cards declare: the video's own ratio (a Short is 405x720, 9:16), so X and
 * others that size their player card from it give a Short a tall box, not a 16:9 one with bars.
 * Landscape keeps 1280 wide; square and taller are 720 tall. Unknown size: 1280x720.
 */
export function declaredPlayerSize(video: Pick<EmbedVideo, 'width' | 'height' | 'isShort'>): { width: number; height: number } {
  const a = videoAspect(video);
  if (!a) return { width: PLAYER_WIDTH, height: PLAYER_HEIGHT };
  return a > 1 ? { width: PLAYER_WIDTH, height: Math.round(PLAYER_WIDTH / a) } : { width: Math.round(PLAYER_HEIGHT * a), height: PLAYER_HEIGHT };
}

function truncate(text: string, max: number): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  return clean.length > max ? `${clean.slice(0, max - 1).trimEnd()}…` : clean;
}

export function buildWatchMetadata(video: EmbedVideo | null, locale: string, origin: string): Metadata {
  if (!video) return {};
  const lang = locale === 'ar' ? 'ar' : 'en';
  const title = video.titleLocalized?.[lang] || video.title;
  const rawDescription = video.descriptionLocalized?.[lang] || video.description || '';
  // A video without a description gets one naming it and its channel, never the site's default text
  const description = truncate(rawDescription || watchFallbackDescription(lang, title, video.channelName), DESCRIPTION_MAX);
  // A Short's canonical page is /shorts/{id} (D-SEO-10)
  const pageUrl = canonicalWatchUrl(origin, lang, video);
  const player = embedUrl(origin, 'video', video.id, { lang });
  const size = declaredPlayerSize(video);
  // Stable image on our domain: crawlers cache it, so never a signed CDN URL
  const image = video.poster ? shareImageUrl(origin, video.id) : undefined;
  const images = image ? [{ url: image, width: size.width, height: size.height, alt: title }] : undefined;

  return {
    title,
    description,
    alternates: {
      canonical: pageUrl,
      // Each language is its own canonical; x-default is English (D-SEO-1)
      languages: { en: canonicalWatchUrl(origin, 'en', video), ar: canonicalWatchUrl(origin, 'ar', video), 'x-default': canonicalWatchUrl(origin, 'en', video) },
      types: { 'application/json+oembed': [{ url: oembedEndpointUrl(origin, pageUrl), title }] },
    },
    openGraph: {
      type: 'video.other',
      siteName: 'Al Ummah Now',
      title,
      description,
      url: pageUrl,
      locale: lang === 'ar' ? 'ar_AR' : 'en_US',
      images,
      videos: [{ url: player, secureUrl: player, type: 'text/html', width: size.width, height: size.height }],
    },
    twitter: {
      card: 'player',
      title,
      description,
      images: image ? [image] : undefined,
      players: [{ playerUrl: player, streamUrl: player, width: size.width, height: size.height }],
    },
  };
}
