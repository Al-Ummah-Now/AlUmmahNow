/**
 * @jest-environment node
 *
 * Large link previews (2026-11-15): the pure card rules, the source key and the composition calls
 * made on the Images binding (mocked; the real binding is exercised by the local preview renders).
 */
import { avatarLayout, cardLayout, fromBase64Url, imageCardUrl, parseCardPath, videoCardUrl, channelCardUrl } from '../layout';
import { stableSourceKey } from '../source-key';
import { composeChannelCard, composeImageCard, type ImagesLike, type TransformerLike } from '../compose';

describe('cardLayout', () => {
  it('fills the card with a landscape frame (16:9 and wider crop a little)', () => {
    expect(cardLayout(1920, 1080)).toEqual({ kind: 'fill' });
    expect(cardLayout(1280, 720)).toEqual({ kind: 'fill' });
    expect(cardLayout(1200, 630)).toEqual({ kind: 'fill' });
  });

  it('frames a Short centred at full card height', () => {
    expect(cardLayout(720, 1280)).toEqual({ kind: 'framed', width: 354, height: 630, left: 423, top: 0 });
    expect(cardLayout(1080, 1920)).toEqual({ kind: 'framed', width: 354, height: 630, left: 423, top: 0 });
  });

  it('frames a square picture and a 4:3 one; a panorama is framed across the width', () => {
    expect(cardLayout(800, 800)).toEqual({ kind: 'framed', width: 630, height: 630, left: 285, top: 0 });
    expect(cardLayout(1024, 768)).toMatchObject({ kind: 'framed', height: 630, top: 0 });
    expect(cardLayout(3000, 1000)).toEqual({ kind: 'framed', width: 1200, height: 400, left: 0, top: 115 });
  });

  it('an unknown size fills (the binding crops whatever it is)', () => {
    expect(cardLayout(0, 0)).toEqual({ kind: 'fill' });
  });

  it('centres a 420px avatar', () => {
    expect(avatarLayout()).toEqual({ kind: 'avatar', size: 420, left: 390, top: 105 });
  });
});

describe('card URLs', () => {
  it('builds and parses /og paths', () => {
    expect(videoCardUrl('https://videos.alummahnow.net/', 'v1')).toBe('https://videos.alummahnow.net/og/v/v1.jpg');
    expect(channelCardUrl('https://videos.alummahnow.net', 'c1')).toBe('https://videos.alummahnow.net/og/c/c1.jpg');
    expect(parseCardPath('/og/v/55e83716-15ca-41d9-af12-12d7a7e44e79.jpg')).toEqual({ kind: 'v', id: '55e83716-15ca-41d9-af12-12d7a7e44e79' });
    expect(parseCardPath('/og/x/v1.jpg')).toBeNull();
    expect(parseCardPath('/og/v/../a.jpg')).toBeNull();
  });

  it('round-trips an image URL (Arabic file names too) through base64url', () => {
    const src = 'https://images.alummahnow.net/covers/صورة.jpg?width=1280';
    const url = imageCardUrl('https://videos.alummahnow.net', src);
    const parsed = parseCardPath(new URL(url).pathname);
    expect(parsed?.kind).toBe('i');
    expect(fromBase64Url(parsed!.id)).toBe(src);
    expect(fromBase64Url('%%%')).toBeNull();
  });
});

describe('stableSourceKey', () => {
  it('drops Bunny signatures (query and path form), keeps the picture', () => {
    expect(stableSourceKey('https://vz-1.b-cdn.net/v1/thumbnail_2.jpg?token=a&expires=1')).toBe('https://vz-1.b-cdn.net/v1/thumbnail_2.jpg');
    expect(stableSourceKey('https://vz-1.b-cdn.net/bcdn_token=T&expires=9&token_path=%2Fv1%2F/v1/thumbnail.jpg')).toBe('https://vz-1.b-cdn.net/v1/thumbnail.jpg');
    expect(stableSourceKey('https://images.alummahnow.net/a.jpg?width=1280')).toBe('https://images.alummahnow.net/a.jpg?width=1280');
  });
});

/** A recording fake of the Images binding */
function fakeImages(size: { width: number; height: number }) {
  const calls: unknown[] = [];
  const transformer = (name: string): TransformerLike => {
    const t: TransformerLike = {
      transform: (o) => { calls.push([name, 'transform', o]); return t; },
      draw: (_img, o) => { calls.push([name, 'draw', o]); return t; },
      output: async (o) => { calls.push([name, 'output', o]); return { image: () => new Response(new Uint8Array([0xff, 0xd8])).body as ReadableStream<Uint8Array> }; },
    };
    return t;
  };
  let n = 0;
  const images: ImagesLike = { info: async () => size, input: () => transformer(`in${n++}`) };
  return { images, calls };
}

describe('compose', () => {
  const bytes = new Uint8Array([1, 2, 3]).buffer;

  it('a landscape frame: one crop to 1200x630, JPEG', async () => {
    const { images, calls } = fakeImages({ width: 1920, height: 1080 });
    const out = await composeImageCard(images, bytes);
    expect(out.byteLength).toBe(2);
    expect(calls).toEqual([
      ['in0', 'transform', { width: 1200, height: 630, fit: 'cover', gravity: 'center' }],
      ['in0', 'output', { format: 'image/jpeg', quality: 82 }],
    ]);
  });

  it('a Short: its whole frame centred on a blurred copy of itself, nothing else drawn', async () => {
    const { images, calls } = fakeImages({ width: 720, height: 1280 });
    await composeImageCard(images, bytes);
    expect(calls).toEqual([
      ['in0', 'transform', { width: 354, height: 630, fit: 'scale-down' }],
      ['in1', 'transform', { width: 1200, height: 630, fit: 'cover', blur: 40, brightness: 0.55 }],
      ['in1', 'draw', { top: 0, left: 423 }],
      ['in1', 'output', { format: 'image/jpeg', quality: 82 }],
    ]);
  });

  it('a channel: its 4:1 banner whole on a blurred copy (nothing drawn over it), else the avatar on a blurred avatar', async () => {
    const a = fakeImages({ width: 2560, height: 640 });
    await composeChannelCard(a.images, bytes, bytes);
    expect(a.calls).toEqual([
      ['in0', 'transform', { width: 1200, height: 300, fit: 'scale-down' }],
      ['in1', 'transform', { width: 1200, height: 630, fit: 'cover', blur: 40, brightness: 0.55 }],
      ['in1', 'draw', { top: 165, left: 0 }],
      ['in1', 'output', { format: 'image/jpeg', quality: 82 }],
    ]);
    const b = fakeImages({ width: 800, height: 800 });
    await composeChannelCard(b.images, bytes, null);
    expect(b.calls).toEqual([
      ['in0', 'transform', { width: 420, height: 420, fit: 'cover', gravity: 'center' }],
      ['in1', 'transform', expect.objectContaining({ blur: 40 })],
      ['in1', 'draw', { top: 105, left: 390 }],
      ['in1', 'output', { format: 'image/jpeg', quality: 82 }],
    ]);
    await expect(composeChannelCard(b.images, null, null)).rejects.toThrow();
  });
});
