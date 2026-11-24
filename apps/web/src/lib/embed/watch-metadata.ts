/**
 * Watch page social metadata (spec 25.2, docs/embeds/README.md §3):
 * Open Graph video, Twitter player card, hreflang alternates and the oEmbed
 * discovery link. Only public videos get it; others keep the site defaults.
 */

import type { Metadata } from 'next';
import { isPublicMp4Url, videoAspect, type EmbedVideo } from './content';
import { canonicalWatchUrl, embedUrl, oembedEndpointUrl } from './snippets';
import { cardOgImages, SITE_CARD_PATH, videoCardUrl } from '@/lib/share-card/layout';
import { watchFallbackDescription } from '@/lib/seo/structured-data';
import type { siteWatchCanonical } from '@/lib/seo/site-link';
import { metaDescription } from '@/lib/seo/description';

const PLAYER_WIDTH = 1280;
const PLAYER_HEIGHT = 720;
const STREAM_CONTENT_TYPE = 'video/mp4';

/**
 * The player size the cards declare: the video's own ratio (a Short is 405x720, 9:16), so X and
 * others that size their player card from it give a Short a tall box, not a 16:9 one with bars.
 * Landscape keeps 1280 wide; square and taller are 720 tall. Always positive integers; unknown: 1280x720.
 */
export function declaredPlayerSize(video: Pick<EmbedVideo, 'width' | 'height' | 'isShort'>): { width: number; height: number } {
  const a = videoAspect(video);
  if (!a || !Number.isFinite(a) || a <= 0) return { width: PLAYER_WIDTH, height: PLAYER_HEIGHT };
  return a > 1
    ? { width: PLAYER_WIDTH, height: Math.max(1, Math.round(PLAYER_WIDTH / a)) }
    : { width: Math.max(1, Math.round(PLAYER_HEIGHT * a)), height: PLAYER_HEIGHT };
}

/**
 * X requires `twitter:player` to be an absolute https URL. Keep loopback `http://` for local dev
 * and E2E stacks; upgrade any non-loopback `http://` origin to `https://`.
 */
function playerOrigin(origin: string): string {
  try {
    const u = new URL(origin);
    if (u.protocol === 'http:' && u.hostname !== 'localhost' && !u.hostname.startsWith('127.')) {
      u.protocol = 'https:';
      return u.origin;
    }
    return u.origin;
  } catch {
    return origin;
  }
}

/**
 * Direct progressive MP4 for `twitter:player:stream` (X mobile inline playback): the public R2 MP4
 * already used for SEO (`contentUrl`, D-SEO-11). Never emitted for unlisted videos or signed/expiring URLs.
 */
export function publicStreamUrl(video: Pick<EmbedVideo, 'contentUrl' | 'isUnlisted'>): string | undefined {
  if (video.isUnlisted || !isPublicMp4Url(video.contentUrl)) return undefined;
  return video.contentUrl;
}

/**
 * `onSite`: the video's page on the channel's scholar site when that site, on the scholar's own
 * domain, holds the canonical (AUN-SCHOLAR-SITES §4.4, siteWatchCanonical); the cards still play here.
 */
export function buildWatchMetadata(video: EmbedVideo | null, locale: string, origin: string, onSite: ReturnType<typeof siteWatchCanonical> = null): Metadata {
  if (!video) return {};
  const lang = locale === 'ar' ? 'ar' : 'en';
  const title = video.titleLocalized?.[lang] || video.title;
  const rawDescription = video.descriptionLocalized?.[lang] || video.description || '';
  // A video without a description gets one naming it and its channel, never the site's default text
  const description = metaDescription(rawDescription || watchFallbackDescription(lang, title, video.channelName));
  // A Short's canonical page is /shorts/{id} (D-SEO-10)
  const ownUrl = canonicalWatchUrl(origin, lang, video);
  const pageUrl = onSite?.canonical ?? ownUrl;
  const player = embedUrl(playerOrigin(origin), 'video', video.id, { lang });
  const size = declaredPlayerSize(video);
  const stream = publicStreamUrl(video);
  // The 1200x630 card on our domain (a Short's frame centered on a landscape card): WhatsApp and the
  // other apps show the large preview only for a wide image, X requires twitter:image as the player
  // card fallback, and crawlers cache it, so never a signed CDN URL.
  const image = video.poster ? videoCardUrl(origin, video.id) : `${origin.replace(/\/+$/, '')}${SITE_CARD_PATH}`;
  // type and secure_url: Meta's apps (WhatsApp, Facebook, Messenger) and LinkedIn read them for the large card
  const images = cardOgImages(image, title);

  return {
    title,
    description,
    alternates: {
      canonical: pageUrl,
      // Each language is its own canonical; x-default is English (D-SEO-1), or the site's languages
      languages: onSite?.languages ?? { en: canonicalWatchUrl(origin, 'en', video), ar: canonicalWatchUrl(origin, 'ar', video), 'x-default': canonicalWatchUrl(origin, 'en', video) },
      // oEmbed answers for this site's own watch URL
      types: { 'application/json+oembed': [{ url: oembedEndpointUrl(origin, ownUrl), title }] },
    },
    // No og:video (2026-11-15): it named our HTML player, which no chat app plays (WhatsApp, Telegram,
    // iMessage, Facebook/Messenger, Slack and Discord only play allow-listed players). Apps that see
    // og:video switch to a video-link layout with the small side thumbnail instead of the large card.
    // X still plays it through twitter:player (web iframe) and twitter:player:stream (mobile MP4).
    openGraph: {
      type: 'video.other',
      siteName: 'Al Ummah Now',
      title,
      description,
      url: pageUrl,
      locale: lang === 'ar' ? 'ar_AR' : 'en_US',
      images,
    },
    twitter: {
      card: 'player',
      title,
      description,
      images: [image],
      // Next's metadata renderer unconditionally calls player.streamUrl.toString() and has no field
      // for twitter:player:stream:content_type. When a public progressive MP4 exists, use twitter.players
      // and add content_type via `other`. When none exists, leave players empty and emit twitter:player
      // plus integer width/height via `other` so stream tags are omitted cleanly.
      players: stream ? [{ playerUrl: player, streamUrl: stream, width: size.width, height: size.height }] : [],
    },
    other: stream
      ? { 'twitter:player:stream:content_type': STREAM_CONTENT_TYPE }
      : {
          'twitter:player': player,
          'twitter:player:width': size.width,
          'twitter:player:height': size.height,
        },
  };
}
