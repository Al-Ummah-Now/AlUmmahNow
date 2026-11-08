/**
 * Watch page social metadata (spec 25.2, docs/embeds/README.md §3):
 * Open Graph video, Twitter player card, hreflang alternates and the oEmbed
 * discovery link. Only public videos get it; others keep the site defaults.
 */

import type { Metadata } from 'next';
import type { EmbedVideo } from './content';
import { embedUrl, oembedEndpointUrl, watchPageUrl } from './snippets';

const PLAYER_WIDTH = 1280;
const PLAYER_HEIGHT = 720;
const DESCRIPTION_MAX = 200;

function truncate(text: string, max: number): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  return clean.length > max ? `${clean.slice(0, max - 1).trimEnd()}…` : clean;
}

export function buildWatchMetadata(video: EmbedVideo | null, locale: string, origin: string): Metadata {
  if (!video) return {};
  const lang = locale === 'ar' ? 'ar' : 'en';
  const title = video.titleLocalized?.[lang] || video.title;
  const rawDescription = video.descriptionLocalized?.[lang] || video.description || '';
  const description = rawDescription ? truncate(rawDescription, DESCRIPTION_MAX) : undefined;
  const pageUrl = watchPageUrl(origin, lang, video.id);
  const player = embedUrl(origin, 'video', video.id, { lang });
  const images = video.poster ? [{ url: video.poster, width: PLAYER_WIDTH, height: PLAYER_HEIGHT, alt: title }] : undefined;

  return {
    title,
    description,
    alternates: {
      canonical: pageUrl,
      languages: { en: watchPageUrl(origin, 'en', video.id), ar: watchPageUrl(origin, 'ar', video.id) },
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
      videos: [{ url: player, secureUrl: player, type: 'text/html', width: PLAYER_WIDTH, height: PLAYER_HEIGHT }],
    },
    twitter: {
      card: 'player',
      title,
      description,
      images: video.poster ? [video.poster] : undefined,
      players: [{ playerUrl: player, streamUrl: player, width: PLAYER_WIDTH, height: PLAYER_HEIGHT }],
    },
  };
}
