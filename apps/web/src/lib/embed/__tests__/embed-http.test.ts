/**
 * @jest-environment node
 *
 * Embed framing policy, middleware routing and the oEmbed endpoint.
 */
import { NextRequest } from 'next/server';
import { buildContentSecurityPolicy, EMBED_SECURITY_HEADERS, SECURITY_HEADERS } from '@/lib/security/csp';
import { middleware } from '@/middleware';
import { EMBED_REQUEST_HEADER } from '../routes';

// React.cache exists in Next's server React build, not in the react@18 test copy
jest.mock('react', () => ({ ...jest.requireActual('react'), cache: <T,>(fn: T) => fn }));
jest.mock('@/lib/logger-server', () => ({ logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() } }));

jest.mock('@/lib/embed/content', () => {
  const actual = jest.requireActual('@/lib/embed/content');
  return {
    ...actual,
    loadPublicVideo: jest.fn(),
    loadPublicPlaylist: jest.fn(),
  };
});

// eslint-disable-next-line @typescript-eslint/no-require-imports
const content = require('@/lib/embed/content') as {
  loadPublicVideo: jest.Mock;
  loadPublicPlaylist: jest.Mock;
};
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { GET, OPTIONS } = require('@/app/oembed/route') as typeof import('@/app/oembed/route');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const thumbRoute = require('@/app/thumb/[file]/route') as typeof import('@/app/thumb/[file]/route');

const HOST = 'videos.qa.alummahnow.net';

function frameAncestors(csp: string | null): string | undefined {
  return csp?.split(';').map((d) => d.trim()).find((d) => d.startsWith('frame-ancestors'));
}

describe('CSP frame-ancestors', () => {
  it("defaults to 'none' and allows any origin only when asked", () => {
    expect(frameAncestors(buildContentSecurityPolicy({ isDevelopment: false, nonce: 'n' }))).toBe("frame-ancestors 'none'");
    expect(frameAncestors(buildContentSecurityPolicy({ isDevelopment: false, nonce: 'n', frameAncestors: '*' }))).toBe('frame-ancestors *');
  });
  it('drops only X-Frame-Options for embeds', () => {
    expect(EMBED_SECURITY_HEADERS).not.toHaveProperty('X-Frame-Options');
    expect(SECURITY_HEADERS['X-Frame-Options']).toBe('DENY');
    const { 'X-Frame-Options': _xfo, ...rest } = SECURITY_HEADERS;
    expect(EMBED_SECURITY_HEADERS).toEqual(rest);
  });
});

describe('middleware', () => {
  const request = (path: string, headers: Record<string, string> = {}) =>
    new NextRequest(new URL(`https://${HOST}${path}`), { headers });

  it('serves embed frames frameable by any origin, with the ?lang= locale', async () => {
    const response = await middleware(request('/embed/v/abc?lang=ar'));
    expect(response.status).toBe(200);
    expect(frameAncestors(response.headers.get('Content-Security-Policy'))).toBe('frame-ancestors *');
    expect(response.headers.get('X-Frame-Options')).toBeNull();
    expect(response.headers.get('X-Locale')).toBe('ar');
    expect(response.headers.get('X-Text-Direction')).toBe('rtl');
    expect(response.headers.get(`x-middleware-request-${EMBED_REQUEST_HEADER}`)).toBe('1');
  });

  it('keeps app pages non-frameable and strips a client-sent embed header', async () => {
    const response = await middleware(request('/en/video/abc', { [EMBED_REQUEST_HEADER]: '1' }));
    expect(frameAncestors(response.headers.get('Content-Security-Policy'))).toBe("frame-ancestors 'none'");
    expect(response.headers.get('X-Frame-Options')).toBe('DENY');
    expect(response.headers.get(`x-middleware-request-${EMBED_REQUEST_HEADER}`)).toBeNull();
  });

  it('does not locale-redirect /oembed', async () => {
    const response = await middleware(request('/oembed?url=x'));
    expect(response.headers.get('location')).toBeNull();
    expect(response.status).toBe(200);
  });

  it('does not locale-redirect /thumb/<id>.jpg', async () => {
    const response = await middleware(request('/thumb/0174501b-cbc9-41b4-b386-93f9bb8429a7.jpg'));
    expect(response.headers.get('location')).toBeNull();
    expect(response.status).toBe(200);
  });

  it('still redirects unknown /embed paths to the localized 404', async () => {
    const response = await middleware(request('/embed/unknown'));
    expect(response.status).toBe(307);
  });
});

describe('GET /oembed', () => {
  const call = (query: string) => GET(new NextRequest(new URL(`https://${HOST}/oembed?${query}`), { headers: { host: HOST } }));
  const video = {
    id: 'v1', title: 'Tafsir', titleLocalized: { en: 'Tafsir', ar: 'تفسير' }, playUrl: 'https://vz/t/v1/playlist.m3u8',
    poster: 'https://vz/t/v1/thumbnail.jpg', duration: 75, channelId: 'c1', channelName: 'QA', channelHandle: 'qa',
  };

  beforeEach(() => {
    content.loadPublicVideo.mockReset();
    content.loadPublicPlaylist.mockReset();
  });

  it('answers a public video with CORS * and caching', async () => {
    content.loadPublicVideo.mockResolvedValue(video);
    const response = await call(`url=${encodeURIComponent(`https://${HOST}/en/video/v1?t=30`)}&maxwidth=480`);
    expect(response.status).toBe(200);
    expect(response.headers.get('access-control-allow-origin')).toBe('*');
    expect(response.headers.get('cache-control')).toBe('public, max-age=300');
    const body = await response.json();
    expect(body).toMatchObject({
      version: '1.0', type: 'video', title: 'Tafsir', author_name: 'QA', author_url: `https://${HOST}/en/@qa`,
      width: 480, height: 270, aun_video_id: 'v1', aun_duration: 75, provider_url: `https://${HOST}`,
    });
    expect(body.html).toContain(`src="https://${HOST}/embed/v/v1?start=30"`);
    expect(content.loadPublicVideo).toHaveBeenCalledWith('v1');
  });

  it('404s for content that is not public', async () => {
    content.loadPublicVideo.mockResolvedValue(null);
    const response = await call(`url=${encodeURIComponent(`https://${HOST}/en/video/private1`)}`);
    expect(response.status).toBe(404);
    expect(response.headers.get('cache-control')).toBe('no-store');
  });

  it('404s for empty playlists and foreign hosts, 400 without url, 501 for xml', async () => {
    content.loadPublicPlaylist.mockResolvedValue({ id: 'p1', title: 'L', videos: [] });
    expect((await call(`url=${encodeURIComponent(`https://${HOST}/en/playlist/p1`)}`)).status).toBe(404);
    expect((await call(`url=${encodeURIComponent('https://evil.example/en/video/v1')}`)).status).toBe(404);
    expect((await call('')).status).toBe(400);
    expect((await call(`url=x&format=xml`)).status).toBe(501);
    expect(content.loadPublicVideo).not.toHaveBeenCalled();
  });

  it('answers a public playlist', async () => {
    content.loadPublicPlaylist.mockResolvedValue({ id: 'p1', title: 'Series', channelName: 'QA', videos: [video] });
    const body = await (await call(`url=${encodeURIComponent(`https://${HOST}/embed/p/p1`)}`)).json();
    expect(body).toMatchObject({ title: 'Series', aun_playlist_id: 'p1', thumbnail_url: `https://${HOST}/thumb/v1.jpg` });
    expect(body.html).toContain(`https://${HOST}/embed/p/p1`);
  });

  it('answers CORS preflight', () => {
    const response = OPTIONS();
    expect(response.status).toBe(204);
    expect(response.headers.get('access-control-allow-origin')).toBe('*');
  });
});

// 2026-11-12: share previews must survive crawler caches, so no image that
// leaves our pages may carry a Bunny token (they expire after hours)
describe('oEmbed thumbnails', () => {
  const signed = 'https://vz-215a1ffd-a5a.b-cdn.net/bcdn_token=T&expires=1794459600&token_path=%2Fv1%2F/v1/thumbnail_1.jpg';
  it('point at the stable /thumb URL, never a signed CDN URL', async () => {
    content.loadPublicVideo.mockResolvedValue({ id: 'v1', title: 'T', playUrl: 'https://vz/t/v1/playlist.m3u8', poster: '/thumb/v1.jpg', thumbnailSource: signed });
    const response = await GET(new NextRequest(new URL(`https://${HOST}/oembed?url=${encodeURIComponent(`https://${HOST}/en/video/v1`)}`), { headers: { host: HOST } }));
    const text = await response.text();
    expect(text).not.toMatch(/bcdn_token|token=/);
    expect(JSON.parse(text).thumbnail_url).toBe(`https://${HOST}/thumb/v1.jpg`);
  });
});

describe('GET /thumb/<id>.jpg', () => {
  const ID = '0174501b-cbc9-41b4-b386-93f9bb8429a7';
  const realFetch = global.fetch;
  const fetchMock = jest.fn();
  const call = (file: string) => thumbRoute.GET(new Request(`https://${HOST}/thumb/${file}`), { params: Promise.resolve({ file }) });

  beforeEach(() => {
    content.loadPublicVideo.mockReset();
    fetchMock.mockReset();
    global.fetch = fetchMock as unknown as typeof fetch;
  });
  afterAll(() => {
    global.fetch = realFetch;
  });

  it('streams the current thumbnail of a public video from its freshly signed source', async () => {
    const source = `https://vz-215a1ffd-a5a.b-cdn.net/${ID}/thumbnail_1.jpg?token=fresh&expires=1999999999`;
    content.loadPublicVideo.mockResolvedValue({ id: ID, title: 'T', playUrl: 'x', poster: `/thumb/${ID}.jpg`, thumbnailSource: source });
    fetchMock.mockResolvedValue(new Response(new Uint8Array([0xff, 0xd8, 0xff]), { status: 200, headers: { 'content-type': 'image/jpeg' } }));
    const response = await call(`${ID}.jpg`);
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('image/jpeg');
    expect(response.headers.get('cache-control')).toBe('public, max-age=3600, s-maxage=3600');
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(new Uint8Array([0xff, 0xd8, 0xff]));
    expect(fetchMock).toHaveBeenCalledWith(source, expect.anything());
    expect(content.loadPublicVideo).toHaveBeenCalledWith(ID);
  });

  it('404s for a video that is not public (the anonymous API has none) without fetching anything', async () => {
    content.loadPublicVideo.mockResolvedValue(null);
    expect((await call(`${ID}.jpg`)).status).toBe(404);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('404s for bad ids and never proxies another host', async () => {
    expect((await call('..%2Fx.jpg')).status).toBe(404);
    expect((await call(`${ID}.png`)).status).toBe(404);
    content.loadPublicVideo.mockResolvedValue({ id: ID, title: 'T', playUrl: 'x', poster: `/thumb/${ID}.jpg`, thumbnailSource: 'https://evil.example/x.jpg' });
    expect((await call(`${ID}.jpg`)).status).toBe(404);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('404s when the source is not an image', async () => {
    content.loadPublicVideo.mockResolvedValue({ id: ID, title: 'T', playUrl: 'x', poster: `/thumb/${ID}.jpg`, thumbnailSource: `https://media.alummahnow.net/pub/${ID}/r/thumb.jpg` });
    fetchMock.mockResolvedValue(new Response('<html>', { status: 200, headers: { 'content-type': 'text/html' } }));
    expect((await call(`${ID}.jpg`)).status).toBe(404);
  });
});
