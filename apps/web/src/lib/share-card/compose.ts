/**
 * Makes a 1200x630 share card with Cloudflare's Images binding (`IMAGES` in wrangler): crop, fit,
 * blur and overlay only. Text is never drawn: the title and description are the preview's text
 * under the image, in the page's language.
 */
import { avatarLayout, CARD_HEIGHT, CARD_QUALITY, CARD_TYPE, CARD_WIDTH, cardLayout, channelLayout, CHANNEL_PAGE_COLOUR } from './layout';
import { circleMask, encodePng, solid } from './png';

/** The part of the Images binding the cards use (workers-types ImagesBinding) */
export interface ImagesLike {
  info(stream: ReadableStream<Uint8Array>): Promise<{ width?: number; height?: number; format?: string }>;
  input(stream: ReadableStream<Uint8Array>): TransformerLike;
}
export interface TransformerLike {
  transform(options: Record<string, unknown>): TransformerLike;
  draw(image: ReadableStream<Uint8Array> | TransformerLike, options?: Record<string, unknown>): TransformerLike;
  output(options: { format: string; quality?: number }): Promise<{ image(): ReadableStream<Uint8Array> }>;
}

const streamOf = (bytes: ArrayBuffer | Uint8Array) => new Response(bytes as BodyInit).body as ReadableStream<Uint8Array>;

/** The blurred, dimmed background a framed image or an avatar sits on */
const backdrop = (images: ImagesLike, bytes: ArrayBuffer) =>
  images.input(streamOf(bytes)).transform({ width: CARD_WIDTH, height: CARD_HEIGHT, fit: 'cover', blur: 40, brightness: 0.55 });

async function toJpeg(t: TransformerLike): Promise<ArrayBuffer> {
  const out = await t.output({ format: CARD_TYPE, quality: CARD_QUALITY });
  return new Response(out.image()).arrayBuffer();
}

/** A video frame, post picture or article cover: filled when wide, else framed on itself. */
export async function composeImageCard(images: ImagesLike, bytes: ArrayBuffer): Promise<ArrayBuffer> {
  const info = await images.info(streamOf(bytes));
  const layout = cardLayout(info.width ?? 0, info.height ?? 0);
  if (layout.kind !== 'framed') {
    return toJpeg(images.input(streamOf(bytes)).transform({ width: CARD_WIDTH, height: CARD_HEIGHT, fit: 'cover', gravity: 'center' }));
  }
  const front = images.input(streamOf(bytes)).transform({ width: layout.width, height: layout.height, fit: 'scale-down' });
  return toJpeg(backdrop(images, bytes).draw(front, { top: layout.top, left: layout.left }));
}

async function roundLogo(images: ImagesLike, avatar: ArrayBuffer, size: number): Promise<ReadableStream<Uint8Array>> {
  // Square crop around the centre, then the circle (the binding gives raw RGBA; png.ts adds the alpha)
  const square = await images.input(streamOf(avatar)).transform({ width: size, height: size, fit: 'cover', gravity: 'center' }).output({ format: 'rgba' });
  const pixels = new Uint8Array(await new Response(square.image()).arrayBuffer());
  return streamOf(await encodePng(size, size, circleMask(size, pixels)));
}

const pageCanvas = async (images: ImagesLike) =>
  images.input(streamOf(await encodePng(CARD_WIDTH, CARD_HEIGHT, solid(CARD_WIDTH, CARD_HEIGHT, CHANNEL_PAGE_COLOUR))));

/**
 * A channel (owner, 2026-11-15): its banner whole on the theme's page colour, with its logo (avatar,
 * cut into a circle like the site's avatars, otherwise as supplied) at the banner's bottom-start
 * corner, mirrored for Arabic (layout.ts channelLayout). Without a banner the logo sits centred on
 * the page colour; without a logo the banner alone. Nothing else is drawn: the channel's name is the
 * preview's title under the image.
 */
export async function composeChannelCard(images: ImagesLike, avatar: ArrayBuffer | null, cover: ArrayBuffer | null, rtl = false): Promise<ArrayBuffer> {
  if (!avatar && !cover) throw new Error('A channel card needs an avatar or a banner');
  if (!cover) {
    const layout = avatarLayout();
    return toJpeg((await pageCanvas(images)).draw(await roundLogo(images, avatar as ArrayBuffer, layout.size), { top: layout.top, left: layout.left }));
  }
  const info = await images.info(streamOf(cover));
  const { banner, logo } = channelLayout(info.width ?? 0, info.height ?? 0, rtl);
  const bannerImage = images.input(streamOf(cover)).transform({ width: banner.width, height: banner.height, fit: 'contain' });
  let card = (await pageCanvas(images)).draw(bannerImage, { top: banner.top, left: banner.left });
  if (avatar) card = card.draw(await roundLogo(images, avatar, logo.width), { top: logo.top, left: logo.left });
  return toJpeg(card);
}
