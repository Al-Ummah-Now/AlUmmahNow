/**
 * Large link previews (2026-11-15, owner: "its only a small image with text to the side, cant make
 * it a big one with text under?"). WhatsApp, Telegram, iMessage, Facebook/Messenger, LinkedIn,
 * Slack and Discord pick the large card (image on top, title and description under) only when the
 * og:image is wide; a portrait or square image (a Short's frame, a channel avatar, the app icon)
 * gets the small thumbnail at the side. WhatsApp also drops images over ~300 KB.
 *
 * So every share image is a 1200x630 (1.91:1) JPEG made by /og/<kind>/<id>.jpg
 * (app/og/[kind]/[file]/route.ts). This file is the pure part: which kind of card a source makes.
 */

import fanousTokens from '../../../../../packages/fanous-tokens/tokens/fanous.tokens.json';

export const CARD_WIDTH = 1200;
export const CARD_HEIGHT = 630;
export const CARD_TYPE = 'image/jpeg';
/** Quality of the card JPEG: a photo card stays well under WhatsApp's ~300 KB */
export const CARD_QUALITY = 82;

/** Sources this close to 1.91:1 fill the card (cropping at most ~16% of one side); others are framed. */
const FILL_MIN_ASPECT = 1.6;
const FILL_MAX_ASPECT = 2.3;

/**
 * - `fill`: a wide image (a landscape video frame), cropped to 1200x630 around its centre.
 * - `framed`: the whole image, as large as fits, centred on a blurred, dimmed copy of itself
 *   (a Short's vertical frame, a square image). Nothing is added: no logo, badge or text.
 * - `avatar`: a channel: its logo, a 420px circle, centred on its banner cropped to fill the card
 *   (compose.ts composeChannelCard), or on CHANNEL_PAGE_COLOUR without a banner.
 */
export type CardLayout =
  | { kind: 'fill' }
  | { kind: 'framed'; width: number; height: number; left: number; top: number }
  | { kind: 'avatar'; size: number; left: number; top: number };

export const AVATAR_SIZE = 420;

/** The page colour behind a channel logo without a banner: the Fanous `night` token (the dark page of production's theme) */
export const CHANNEL_PAGE_COLOUR: string = fanousTokens.color.brand.night.$value;

export function cardLayout(width: number, height: number): CardLayout {
  if (!(width > 0) || !(height > 0)) return { kind: 'fill' };
  const aspect = width / height;
  if (aspect >= FILL_MIN_ASPECT && aspect <= FILL_MAX_ASPECT) return { kind: 'fill' };
  // As large as fits inside the card (a Short's 720x1280 frame becomes 354x630)
  const scale = Math.min(CARD_WIDTH / width, CARD_HEIGHT / height);
  const w = Math.min(CARD_WIDTH, Math.round(width * scale));
  const h = Math.min(CARD_HEIGHT, Math.round(height * scale));
  return { kind: 'framed', width: w, height: h, left: Math.round((CARD_WIDTH - w) / 2), top: Math.round((CARD_HEIGHT - h) / 2) };
}

export function avatarLayout(): Extract<CardLayout, { kind: 'avatar' }> {
  return { kind: 'avatar', size: AVATAR_SIZE, left: Math.round((CARD_WIDTH - AVATAR_SIZE) / 2), top: Math.round((CARD_HEIGHT - AVATAR_SIZE) / 2) };
}

/** og:image entries for a card URL (Meta's apps and LinkedIn read type and secure_url). */
export function cardOgImages(url: string, alt?: string) {
  return [{ url, secureUrl: url, type: CARD_TYPE, width: CARD_WIDTH, height: CARD_HEIGHT, ...(alt ? { alt } : {}) }];
}

/** Card paths: `/og/v/<videoId>.jpg`, `/og/c/<channelId>.jpg`, `/og/i/<base64url image URL>.jpg` */
export type CardKind = 'v' | 'c' | 'i';
const CARD_PATH = /^\/og\/(v|c|i)\/([A-Za-z0-9_-]{1,2048})\.jpg$/;

export function parseCardPath(pathname: string): { kind: CardKind; id: string } | null {
  const m = CARD_PATH.exec(pathname);
  return m ? { kind: m[1] as CardKind, id: m[2] } : null;
}

const trimOrigin = (origin: string) => origin.replace(/\/+$/, '');

export const videoCardUrl = (origin: string, videoId: string) => `${trimOrigin(origin)}/og/v/${encodeURIComponent(videoId)}.jpg`;
export const channelCardUrl = (origin: string, channelId: string) => `${trimOrigin(origin)}/og/c/${encodeURIComponent(channelId)}.jpg`;

function base64Url(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function fromBase64Url(value: string): string | null {
  try {
    const binary = atob(value.replace(/-/g, '+').replace(/_/g, '/'));
    return new TextDecoder('utf-8', { fatal: true }).decode(Uint8Array.from(binary, (c) => c.charCodeAt(0)));
  } catch {
    return null;
  }
}

/** A card for any public image on our hosts (a post's picture, an article cover) */
export const imageCardUrl = (origin: string, imageUrl: string) => `${trimOrigin(origin)}/og/i/${base64Url(imageUrl)}.jpg`;

/** The site's own card: the owner's brand art (1200x630, as supplied), used when a page has no image */
export const SITE_CARD_PATH = '/brand/og-default.jpg';
