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
 * - `avatar`: a channel without a banner: its logo, a 420px circle, centred on CHANNEL_PAGE_COLOUR.
 *   A channel with a banner uses channelLayout (the banner whole, the logo at its bottom-start corner).
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

/**
 * A channel with a banner (owner, 2026-11-15, reference image: "something like this"): the banner runs
 * edge to edge across the card and fills most of its height, with thin bands of the page colour; a
 * LARGE round logo (about 37% of the card height) sits at the bottom-start corner (left in English,
 * right in Arabic) with most of it over the banner's lower edge. Rules kept from the owner: the banner
 * keeps its shape (cropped, never stretched), the logo is never clipped (an even CHANNEL_MARGIN from
 * the card edges), nothing collides.
 *
 * Banner: full card width, `bannerHeight` tall. A narrower banner (16:9, square, portrait) is
 * cropped to fill that box (cover). A very wide one (6:1) is cropped by at most
 * MAX_BANNER_SIDE_CROP of its width: below that it is shown shorter, with thicker bands.
 *
 * Variants (owner picks one; the review page renders all three):
 * - v1: the reference: banner box 87% of the card height, logo 37% (232 px), 80% of it over the banner
 * - v2: the logo a little smaller and higher: 32% (200 px), 90% over the banner
 * - v3: the banner covers the whole card, the logo (232 px) on it at the bottom-start corner
 */
export type ChannelVariant = 'v1' | 'v2' | 'v3';
export const CHANNEL_VARIANT: ChannelVariant = 'v1';
export const CHANNEL_MARGIN = 24;
/** The most of a very wide banner's width a card crops away (both sides together) */
const MAX_BANNER_SIDE_CROP = 0.45;
const VARIANTS: Record<ChannelVariant, { bannerHeight: number; logo: number; inside: number; startInset: number }> = {
  v1: { bannerHeight: 548, logo: 232, inside: 0.8, startInset: 60 },
  v2: { bannerHeight: 548, logo: 200, inside: 0.9, startInset: 64 },
  v3: { bannerHeight: CARD_HEIGHT, logo: 232, inside: 1, startInset: 48 },
};

export interface Box { left: number; top: number; width: number; height: number }
/** `source`: the part of the banner shown (a centred crop), in the banner's own pixels */
export interface ChannelLayout { banner: Box; source: Box; logo: Box }

export function channelLayout(bannerWidth: number, bannerHeight: number, rtl: boolean, variant: ChannelVariant = CHANNEL_VARIANT): ChannelLayout {
  const v = VARIANTS[variant];
  const w = bannerWidth > 0 ? bannerWidth : 4;
  const h = bannerHeight > 0 ? bannerHeight : 1;
  const aspect = w / h;
  // Full width; as tall as the variant's box, but a very wide banner keeps (1 - MAX_BANNER_SIDE_CROP) of its width
  const natural = CARD_WIDTH / aspect;
  const leastCropped = CARD_WIDTH / (aspect * (1 - MAX_BANNER_SIDE_CROP));
  // v3 always covers the whole card; the others cap how much of a very wide banner is cut away
  const height = variant === 'v3' ? CARD_HEIGHT : Math.round(Math.min(v.bannerHeight, Math.max(natural, Math.min(leastCropped, v.bannerHeight))));
  // The crop of the banner that fills CARD_WIDTH x height (cover, centred)
  const boxAspect = CARD_WIDTH / height;
  const source = aspect > boxAspect
    ? { width: Math.round(h * boxAspect), height: h, left: Math.round((w - h * boxAspect) / 2), top: 0 }
    : { width: w, height: Math.round(w / boxAspect), left: 0, top: Math.round((h - w / boxAspect) / 2) };
  // Banner + the part of the logo below it, centred vertically; the logo never closer than the margin to an edge
  const below = Math.round(v.logo * (1 - v.inside));
  const groupTop = Math.round((CARD_HEIGHT - (height + below)) / 2);
  const logoTop = Math.min(groupTop + height - (v.logo - below), CARD_HEIGHT - CHANNEL_MARGIN - v.logo);
  const startX = Math.max(CHANNEL_MARGIN, v.startInset);
  const logoLeft = rtl ? CARD_WIDTH - startX - v.logo : startX;
  return {
    banner: { left: 0, top: Math.max(0, groupTop), width: CARD_WIDTH, height },
    source,
    logo: { left: logoLeft, top: logoTop, width: v.logo, height: v.logo },
  };
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
/** A channel's card; Arabic pages mirror it (the logo at the right), so the language is part of the URL */
export const channelCardUrl = (origin: string, channelId: string, lang?: string | null) =>
  `${trimOrigin(origin)}/og/c/${encodeURIComponent(channelId)}.jpg${lang === 'ar' ? '?lang=ar' : ''}`;

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
