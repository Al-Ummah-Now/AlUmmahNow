/**
 * @jest-environment node
 *
 * GET /og/<kind>/<id>.jpg (large link previews, 2026-11-15): public content only, a 1200x630 JPEG
 * made once per source picture and stored in R2, the brand card when it cannot be made, and never
 * a proxy for other hosts or signed URLs.
 */
jest.mock('react', () => ({ ...jest.requireActual('react'), cache: <T,>(fn: T) => fn }));
jest.mock('@/lib/logger-server', () => ({ logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() } }));
jest.mock('@/lib/embed/content', () => ({ loadPublicVideo: jest.fn(), loadPublicChannelImages: jest.fn() }));
const env: Record<string, unknown> = {};
jest.mock('@opennextjs/cloudflare', () => ({ getCloudflareContext: async () => ({ env }) }));

import { GET } from '../route';
import { loadPublicChannelImages, loadPublicVideo } from '@/lib/embed/content';
import { imageCardUrl } from '@/lib/share-card/layout';

const video = loadPublicVideo as jest.Mock;
const channel = loadPublicChannelImages as jest.Mock;
const HOST = 'https://videos.alummahnow.net';
const ID = '55e83716-15ca-41d9-af12-12d7a7e44e79';
const CARD = new Uint8Array([0xff, 0xd8, 0xff, 0xe0]);
const BRAND = new Uint8Array([0xff, 0xd8, 0x01]);

const call = (kind: string, file: string) => GET(new Request(`${HOST}/og/${kind}/${file}`), { params: Promise.resolve({ kind, file }) });

function fakeImages(size = { width: 720, height: 1280 }) {
  // `rgba` (the channel logo's pixels, 420x420) gives raw pixels; anything else the finished card
  const t = { transform: () => t, draw: () => t, output: async (o: { format: string }) => ({ image: () => new Response(o.format === 'rgba' ? new Uint8Array(420 * 420 * 4) : CARD).body }) };
  return { info: jest.fn(async () => size), input: jest.fn(() => t) };
}

describe('GET /og/<kind>/<id>.jpg', () => {
  const realFetch = global.fetch;
  const fetchMock = jest.fn();
  let store: Map<string, ArrayBuffer>;

  beforeEach(() => {
    jest.clearAllMocks();
    store = new Map();
    for (const k of Object.keys(env)) delete env[k];
    Object.assign(env, {
      IMAGES: fakeImages(),
      videos: {
        get: jest.fn(async (k: string) => (store.has(k) ? { arrayBuffer: async () => store.get(k) } : null)),
        put: jest.fn(async (k: string, v: ArrayBuffer) => { store.set(k, v); }),
      },
      ASSETS: { fetch: jest.fn(async () => new Response(BRAND, { headers: { 'content-type': 'image/jpeg' } })) },
    });
    fetchMock.mockReset();
    fetchMock.mockResolvedValue(new Response(new Uint8Array([1, 2, 3]), { headers: { 'content-type': 'image/jpeg' } }));
    global.fetch = fetchMock as unknown as typeof fetch;
  });
  afterAll(() => { global.fetch = realFetch; });

  it('makes a public Short\'s card once: JPEG with its length, stored in R2, read from R2 next time', async () => {
    video.mockResolvedValue({ id: ID, thumbnailSource: `https://vz-215a1ffd-a5a.b-cdn.net/${ID}/thumbnail.jpg?token=a&expires=1` });
    const first = await call('v', `${ID}.jpg`);
    expect(first.status).toBe(200);
    expect(first.headers.get('content-type')).toBe('image/jpeg');
    expect(first.headers.get('content-length')).toBe(String(CARD.byteLength));
    expect(first.headers.get('cache-control')).toBe('public, max-age=3600, s-maxage=3600');
    expect(new Uint8Array(await first.arrayBuffer())).toEqual(CARD);
    expect(store.size).toBe(1);
    expect([...store.keys()][0]).toMatch(/^share-cards\/v1\/v\/[0-9a-f]{24}\/[0-9a-f]{24}\.jpg$/);

    // a fresh signature for the same picture: same stored card, no new transform
    video.mockResolvedValue({ id: ID, thumbnailSource: `https://vz-215a1ffd-a5a.b-cdn.net/${ID}/thumbnail.jpg?token=b&expires=2` });
    fetchMock.mockClear();
    const again = await call('v', `${ID}.jpg`);
    expect(new Uint8Array(await again.arrayBuffer())).toEqual(CARD);
    expect(fetchMock).not.toHaveBeenCalled();
    expect((env.IMAGES as { input: jest.Mock }).input).toHaveBeenCalledTimes(2);
  });

  it('404s for a video nobody may see, a bad id or an unknown kind, without fetching anything', async () => {
    video.mockResolvedValue(null);
    expect((await call('v', `${ID}.jpg`)).status).toBe(404);
    expect((await call('v', '..%2Fx.jpg')).status).toBe(404);
    expect((await call('x', `${ID}.jpg`)).status).toBe(404);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('a channel: logo and banner both fetched, card made; no pictures → the brand card', async () => {
    channel.mockResolvedValue({ id: 'c1', avatarUrl: 'https://images.alummahnow.net/a.jpg', coverUrl: 'https://images.alummahnow.net/c.jpg' });
    const res = await call('c', 'c1.jpg');
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(CARD);
    expect(fetchMock.mock.calls.map((c) => c[0]).sort()).toEqual(['https://images.alummahnow.net/a.jpg', 'https://images.alummahnow.net/c.jpg']);

    channel.mockResolvedValue({ id: 'c2' });
    const plain = await call('c', 'c2.jpg');
    expect(plain.status).toBe(200);
    expect(new Uint8Array(await plain.arrayBuffer())).toEqual(BRAND);
    expect(plain.headers.get('cache-control')).toBe('public, max-age=300, s-maxage=300');
  });

  it('/og/i: only our public image hosts, never a signed URL or another site', async () => {
    const ok = imageCardUrl(HOST, 'https://images.alummahnow.net/post/1.jpg');
    const file = new URL(ok).pathname.split('/').pop() as string;
    const res = await call('i', file);
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('public, max-age=604800, s-maxage=3600');
    for (const bad of ['https://evil.example/x.jpg', 'http://images.alummahnow.net/x.jpg', 'https://vz-1.b-cdn.net/v/thumbnail.jpg?token=t&expires=1']) {
      const f = new URL(imageCardUrl(HOST, bad)).pathname.split('/').pop() as string;
      expect((await call('i', f)).status).toBe(404);
    }
  });

  it('a source that fails or a binding error: the brand card, short-cached, nothing stored', async () => {
    video.mockResolvedValue({ id: ID, thumbnailSource: `https://images.alummahnow.net/t/${ID}.jpg` });
    fetchMock.mockResolvedValue(new Response('nope', { status: 500 }));
    expect(new Uint8Array(await (await call('v', `${ID}.jpg`)).arrayBuffer())).toEqual(BRAND);
    fetchMock.mockResolvedValue(new Response(new Uint8Array([1]), { headers: { 'content-type': 'image/jpeg' } }));
    (env.IMAGES as { info: jest.Mock }).info.mockRejectedValue(new Error('bad image'));
    expect(new Uint8Array(await (await call('v', `${ID}.jpg`)).arrayBuffer())).toEqual(BRAND);
    expect(store.size).toBe(0);
  });

  it('no Images binding (next dev): the brand card', async () => {
    delete env.IMAGES;
    video.mockResolvedValue({ id: ID, thumbnailSource: `https://images.alummahnow.net/t/${ID}.jpg` });
    expect(new Uint8Array(await (await call('v', `${ID}.jpg`)).arrayBuffer())).toEqual(BRAND);
  });
});
