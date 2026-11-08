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

  it('serves embed frames frameable by any origin, with the ?lang= locale', () => {
    const response = middleware(request('/embed/v/abc?lang=ar'));
    expect(response.status).toBe(200);
    expect(frameAncestors(response.headers.get('Content-Security-Policy'))).toBe('frame-ancestors *');
    expect(response.headers.get('X-Frame-Options')).toBeNull();
    expect(response.headers.get('X-Locale')).toBe('ar');
    expect(response.headers.get('X-Text-Direction')).toBe('rtl');
    expect(response.headers.get(`x-middleware-request-${EMBED_REQUEST_HEADER}`)).toBe('1');
  });

  it('keeps app pages non-frameable and strips a client-sent embed header', () => {
    const response = middleware(request('/en/video/abc', { [EMBED_REQUEST_HEADER]: '1' }));
    expect(frameAncestors(response.headers.get('Content-Security-Policy'))).toBe("frame-ancestors 'none'");
    expect(response.headers.get('X-Frame-Options')).toBe('DENY');
    expect(response.headers.get(`x-middleware-request-${EMBED_REQUEST_HEADER}`)).toBeNull();
  });

  it('does not locale-redirect /oembed', () => {
    const response = middleware(request('/oembed?url=x'));
    expect(response.headers.get('location')).toBeNull();
    expect(response.status).toBe(200);
  });

  it('still redirects unknown /embed paths to the localized 404', () => {
    const response = middleware(request('/embed/unknown'));
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
    expect(body).toMatchObject({ title: 'Series', aun_playlist_id: 'p1', thumbnail_url: video.poster });
    expect(body.html).toContain(`https://${HOST}/embed/p/p1`);
  });

  it('answers CORS preflight', () => {
    const response = OPTIONS();
    expect(response.status).toBe(204);
    expect(response.headers.get('access-control-allow-origin')).toBe('*');
  });
});
