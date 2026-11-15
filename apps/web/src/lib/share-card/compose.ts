/**
 * Makes a 1200x630 share card with Cloudflare's Images binding (`IMAGES` in wrangler): crop, fit,
 * blur and overlay only. Text is never drawn: the title and description are the preview's text
 * under the image, in the page's language.
 */
import { avatarLayout, CARD_HEIGHT, CARD_QUALITY, CARD_TYPE, CARD_WIDTH, cardLayout } from './layout';

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

const streamOf = (bytes: ArrayBuffer) => new Response(bytes).body as ReadableStream<Uint8Array>;

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

/**
 * A channel: its cover banner whole (a 4:1 banner is framed on a blurred copy of itself, never cut
 * or drawn over), else its avatar centred on a blurred copy of the avatar. The name is the preview's
 * title under the image.
 */
export async function composeChannelCard(images: ImagesLike, avatar: ArrayBuffer | null, cover: ArrayBuffer | null): Promise<ArrayBuffer> {
  if (cover) return composeImageCard(images, cover);
  if (!avatar) throw new Error('A channel card needs an avatar or a cover');
  const layout = avatarLayout();
  const front = images.input(streamOf(avatar)).transform({ width: layout.size, height: layout.size, fit: 'cover', gravity: 'center' });
  return toJpeg(backdrop(images, avatar).draw(front, { top: layout.top, left: layout.left }));
}
