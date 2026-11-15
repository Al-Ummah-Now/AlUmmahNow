/**
 * Share images for page metadata (large previews, 2026-11-15). Every og:image is a 1200x630 JPEG:
 * a page's own card from /og/<kind>/<id>.jpg (lib/share-card), or the site's brand card. With a wide
 * image and `summary_large_image`, WhatsApp, Telegram, iMessage, Facebook/Messenger, LinkedIn, Slack,
 * Discord and X show the big preview (image on top, text under), not the small side thumbnail.
 *
 * Next merges metadata per key, so a page that sets its own `openGraph` or `twitter` replaces the
 * root's and loses the site card unless it lists one: every such page goes through these helpers.
 */
import { CARD_HEIGHT, CARD_TYPE, CARD_WIDTH, SITE_CARD_PATH } from '@/lib/share-card/layout';

/** The owner's brand art, 1200x630 as supplied (public/brand/og-default.jpg, same file as www) */
export const SITE_SHARE_IMAGE = { url: SITE_CARD_PATH, width: CARD_WIDTH, height: CARD_HEIGHT, type: CARD_TYPE } as const;

/** The X card for every page with a share image (the watch page keeps its player card) */
export const LARGE_CARD = 'summary_large_image' as const;

export type OgImage = { url: string; secureUrl?: string; type: string; width: number; height: number; alt?: string };

/** og:image for a page: its own card (a 1200x630 /og/ URL), else the site's. */
export function ogImages(card: string | null | undefined, alt?: string): OgImage[] {
  const image: OgImage = card ? { url: card, secureUrl: card, type: CARD_TYPE, width: CARD_WIDTH, height: CARD_HEIGHT } : { ...SITE_SHARE_IMAGE };
  return [alt ? { ...image, alt } : image];
}

/** twitter:image for a page: its own card, else the site's. */
export function twitterImages(card: string | null | undefined): string[] {
  return [card || SITE_SHARE_IMAGE.url];
}
