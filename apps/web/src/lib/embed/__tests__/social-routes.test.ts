/**
 * @jest-environment node
 */
/** Scheduler-tool support on the web host (wiki AUN-SOCIAL, SOC-1): feeds, channel oEmbed, share kit clip downloads. */
import { NextRequest } from 'next/server';
import { middleware } from '@/middleware';
import { buildChannelOEmbed, parseChannelUrl, parseContentUrl } from '../oembed';
import { isFeedPath, isStudioDownloadPath } from '../routes';

jest.mock('react', () => ({ ...jest.requireActual('react'), cache: <T,>(fn: T) => fn }));
jest.mock('@/lib/logger-server', () => ({ logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() } }));
jest.mock('@/lib/channel-loaders', () => ({ loadChannelByHandle: jest.fn(), loadChannelById: jest.fn() }));
jest.mock('@/lib/api/server-auth', () => ({ getServerAuthContext: jest.fn() }));
jest.mock('@/lib/api/api-client', () => ({
  ...jest.requireActual('@/lib/api/api-client'),
  apiRequestServerResult: jest.fn(),
  buildApiUrl: (path: string) => `https://api.test${path}`,
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const loaders = require('@/lib/channel-loaders') as { loadChannelByHandle: jest.Mock; loadChannelById: jest.Mock };
// eslint-disable-next-line @typescript-eslint/no-require-imports
const api = require('@/lib/api/api-client') as { apiRequestServerResult: jest.Mock };
// eslint-disable-next-line @typescript-eslint/no-require-imports
const oembedRoute = require('@/app/oembed/route') as typeof import('@/app/oembed/route');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const feedRoute = require('@/app/feeds/[channelId]/[file]/route') as typeof import('@/app/feeds/[channelId]/[file]/route');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const clipRoute = require('@/app/studio-download/clip/[channelId]/[file]/route') as typeof import('@/app/studio-download/clip/[channelId]/[file]/route');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const captionsRoute = require('@/app/studio-download/captions/[videoId]/[source]/[file]/route') as typeof import('@/app/studio-download/captions/[videoId]/[source]/[file]/route');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const serverAuth = require('@/lib/api/server-auth') as { getServerAuthContext: jest.Mock };

const HOST = 'videos.qa.alummahnow.net';
const realFetch = global.fetch;
let fetchMock: jest.Mock;

beforeEach(() => {
  fetchMock = jest.fn();
  global.fetch = fetchMock as unknown as typeof fetch;
  loaders.loadChannelByHandle.mockReset();
  loaders.loadChannelById.mockReset();
  api.apiRequestServerResult.mockReset();
});
afterAll(() => {
  global.fetch = realFetch;
});

describe('path matchers', () => {
  it.each(['/feeds/ch1/all.xml', '/feeds/c_-1/videos.xml'])('feed path %s', (p) => expect(isFeedPath(p)).toBe(true));
  it.each(['/feeds/ch1/all.json', '/feeds/../x.xml', '/feeds/ch1/ALL.xml', '/en/feeds/ch1/all.xml'])('not a feed path %s', (p) => expect(isFeedPath(p)).toBe(false));
  it('studio download paths', () => {
    expect(isStudioDownloadPath('/studio-download/clip/ch1/s1.mp4')).toBe(true);
    expect(isStudioDownloadPath('/studio-download/clip/ch1/s1.mov')).toBe(false);
    expect(isStudioDownloadPath('/studio-download/clip/ch1/a/b.mp4')).toBe(false);
    expect(isStudioDownloadPath('/studio-download/captions/v1/track/ar.vtt')).toBe(true);
    expect(isStudioDownloadPath('/studio-download/captions/v1/draft/pt-BR.srt')).toBe(true);
    expect(isStudioDownloadPath('/studio-download/captions/v1/other/ar.vtt')).toBe(false);
    expect(isStudioDownloadPath('/studio-download/captions/v1/track/ar.txt')).toBe(false);
  });

  it('middleware leaves feeds and clip downloads alone (no locale redirect)', async () => {
    for (const path of ['/feeds/ch1/all.xml', '/studio-download/clip/ch1/s1.mp4', '/studio-download/captions/v1/track/ar.vtt']) {
      const response = await middleware(new NextRequest(new URL(`https://${HOST}${path}`)));
      expect(response.headers.get('location')).toBeNull();
      expect(response.status).toBe(200);
    }
  });
});

describe('channel oEmbed', () => {
  it.each([
    [`https://${HOST}/en/@noor`, { handle: 'noor' }],
    [`https://${HOST}/ar/@noor/videos`, { handle: 'noor' }],
    [`https://${HOST}/en/c/noor/`, { handle: 'noor' }],
    [`https://${HOST}/en/channels/ch1`, { id: 'ch1' }],
    [`https://${HOST}/ar/channels/ch1/community`, { id: 'ch1' }],
  ])('parses %s', (url, expected) => expect(parseChannelUrl(url, HOST)).toEqual(expected));

  it.each([`https://evil.example/en/@noor`, `https://${HOST}/fr/@noor`, `https://${HOST}/en/@noor/a/b`, `javascript:alert(1)`, 'nope'])('refuses %s', (url) =>
    expect(parseChannelUrl(url, HOST)).toBeNull(),
  );

  it('a Shorts URL is a video', () => {
    expect(parseContentUrl(`https://${HOST}/ar/shorts/s1`, HOST)).toEqual({ kind: 'video', id: 's1' });
  });

  it('builds a link card with the channel\'s 1200x630 share card', () => {
    expect(buildChannelOEmbed(`https://${HOST}`, 'ch1', { title: 'Noor', url: `https://${HOST}/en/@noor`, thumbnailUrl: `https://${HOST}/og/c/ch1.jpg` })).toEqual({
      version: '1.0',
      type: 'link',
      provider_name: expect.any(String),
      provider_url: `https://${HOST}`,
      title: 'Noor',
      author_name: 'Noor',
      author_url: `https://${HOST}/en/@noor`,
      thumbnail_url: `https://${HOST}/og/c/ch1.jpg`,
      thumbnail_width: 1200,
      thumbnail_height: 630,
      aun_channel_id: 'ch1',
    });
  });

  const call = (url: string) => oembedRoute.GET(new NextRequest(new URL(`https://${HOST}/oembed?url=${encodeURIComponent(url)}`), { headers: { host: HOST } }));

  it('GET /oembed answers a public channel', async () => {
    loaders.loadChannelByHandle.mockResolvedValue({ id: 'ch1', name: 'Noor', handle: 'noor', avatarUrl: 'https://x.b-cdn.net/a.jpg' });
    const response = await call(`https://${HOST}/en/@noor`);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ type: 'link', title: 'Noor', aun_channel_id: 'ch1', author_url: `https://${HOST}/en/@noor` });
    expect(loaders.loadChannelByHandle).toHaveBeenCalledWith('noor');
  });

  it('GET /oembed 404s for hidden, private and unknown channels', async () => {
    loaders.loadChannelById.mockResolvedValueOnce({ id: 'ch1', name: 'N', isHidden: true }).mockResolvedValueOnce({ id: 'ch1', name: 'N', isPrivate: true }).mockResolvedValueOnce(null);
    for (let i = 0; i < 3; i++) expect((await call(`https://${HOST}/en/channels/ch1`)).status).toBe(404);
  });
});

describe('GET /feeds/<channelId>/<kind>.xml', () => {
  const call = (path: string, channelId: string, file: string) =>
    feedRoute.GET(new Request(`https://${HOST}${path}`), { params: Promise.resolve({ channelId, file }) });
  const rss = '<?xml version="1.0"?><rss version="2.0"><channel><title>N</title></channel></rss>';

  beforeEach(() => {
    process.env.API_URL = 'https://api.test';
  });

  it('proxies the feed anonymously, in Arabic when asked', async () => {
    fetchMock.mockResolvedValue(new Response(rss, { status: 200, headers: { 'cache-control': 'public, max-age=900' } }));
    const response = await call('/feeds/ch1/all.xml?lang=ar', 'ch1', 'all.xml');
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('application/rss+xml; charset=utf-8');
    expect(response.headers.get('cache-control')).toBe('public, max-age=900');
    expect(response.headers.get('access-control-allow-origin')).toBe('*');
    expect(await response.text()).toBe(rss);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.test/api/social/feeds/ch1/all.xml?lang=ar');
    expect((init.headers as Record<string, string>).Authorization).toBeUndefined();
  });

  it('404s for unknown kinds, bad ids and missing channels; 502 for an upstream error', async () => {
    expect((await call('/feeds/ch1/nope.xml', 'ch1', 'nope.xml')).status).toBe(404);
    expect((await call('/feeds/x/all.xml', 'a b', 'all.xml')).status).toBe(404);
    expect(fetchMock).not.toHaveBeenCalled();
    fetchMock.mockResolvedValueOnce(new Response('', { status: 404 }));
    expect((await call('/feeds/ch1/all.xml', 'ch1', 'all.xml')).status).toBe(404);
    fetchMock.mockResolvedValueOnce(new Response('', { status: 500 }));
    expect((await call('/feeds/ch1/all.xml', 'ch1', 'all.xml')).status).toBe(502);
    fetchMock.mockRejectedValueOnce(new Error('down'));
    expect((await call('/feeds/ch1/all.xml', 'ch1', 'all.xml')).status).toBe(502);
  });
});

describe('GET /studio-download/clip/<channelId>/<shortId>.mp4', () => {
  const call = (channelId: string, file: string) =>
    clipRoute.GET(new Request(`https://${HOST}/studio-download/clip/${channelId}/${file}`), { params: Promise.resolve({ channelId, file }) });

  it('streams the Short as an attachment, never cached', async () => {
    api.apiRequestServerResult.mockResolvedValue({ status: 200, data: { url: 'https://vz-1.b-cdn.net/s1/play_720p.mp4' } });
    fetchMock.mockResolvedValue(new Response('MP4', { status: 200, headers: { 'content-length': '3' } }));
    const response = await call('ch1', 's1.mp4');
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('video/mp4');
    expect(response.headers.get('content-disposition')).toBe('attachment; filename="s1.mp4"');
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(response.headers.get('content-length')).toBe('3');
    expect(await response.text()).toBe('MP4');
    expect(api.apiRequestServerResult.mock.calls[0][0].url).toBe('https://api.test/api/social/channel/ch1/share-kit/s1/clip-source');
  });

  it('passes on no access and not found, refuses foreign hosts, and bad names never reach the API', async () => {
    expect((await call('ch1', 's1.mov')).status).toBe(404);
    expect(api.apiRequestServerResult).not.toHaveBeenCalled();
    api.apiRequestServerResult.mockResolvedValueOnce({ status: 403, data: null });
    expect((await call('ch1', 's1.mp4')).status).toBe(403);
    api.apiRequestServerResult.mockResolvedValueOnce({ status: 404, data: null });
    expect((await call('ch1', 's1.mp4')).status).toBe(404);
    api.apiRequestServerResult.mockResolvedValueOnce({ status: 200, data: { url: 'https://evil.example/x.mp4' } });
    expect((await call('ch1', 's1.mp4')).status).toBe(502);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('GET /studio-download/captions/<videoId>/<track|draft>/<lang>.<vtt|srt>', () => {
  const call = (videoId: string, source: string, file: string) =>
    captionsRoute.GET(new Request(`https://${HOST}/studio-download/captions/${videoId}/${source}/${file}`), { params: Promise.resolve({ videoId, source, file }) });
  const FILE = 'WEBVTT\n\nNOTE\nQuran data provided by Quran Foundation (https://quran.foundation/)\n\n00:00.000 --> 00:01.000\n﴿قُلْ هُوَ ٱللَّهُ أَحَدٌ﴾\n';

  beforeEach(() => serverAuth.getServerAuthContext.mockReset().mockResolvedValue({ accessToken: 'tok' }));

  it('passes the published track through with the creator\'s token, the API\'s name, never cached', async () => {
    fetchMock.mockResolvedValue(new Response(FILE, { status: 200, headers: { 'content-disposition': 'attachment; filename="v1-ar.vtt"' } }));
    const response = await call('v1', 'track', 'ar.vtt');
    expect(response.status).toBe(200);
    expect(fetchMock.mock.calls[0][0]).toBe('https://api.test/api/videos/v1/subtitles/ar/download?format=vtt');
    expect(fetchMock.mock.calls[0][1].headers).toEqual({ Authorization: 'Bearer tok' });
    expect(response.headers.get('content-type')).toBe('text/vtt; charset=utf-8');
    expect(response.headers.get('content-disposition')).toBe('attachment; filename="v1-ar.vtt"');
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(await response.text()).toBe(FILE);
  });

  it('asks the draft route for a draft; an unexpected name is replaced by our own', async () => {
    fetchMock.mockResolvedValue(new Response('1\n', { status: 200, headers: { 'content-disposition': 'attachment; filename="../x.srt"' } }));
    const response = await call('v1', 'draft', 'en.srt');
    expect(fetchMock.mock.calls[0][0]).toBe('https://api.test/api/videos/v1/captions/drafts/en/download?format=srt');
    expect(response.headers.get('content-type')).toBe('application/x-subrip; charset=utf-8');
    expect(response.headers.get('content-disposition')).toBe('attachment; filename="v1-en-draft.srt"');
  });

  it('signed out is 401, refusals pass on, failures are 502, and bad paths never reach the API', async () => {
    for (const [source, file] of [['other', 'ar.vtt'], ['track', 'ar.txt'], ['track', '../ar.vtt']]) expect((await call('v1', source, file)).status).toBe(404);
    expect((await call('v/1', 'track', 'ar.vtt')).status).toBe(404);
    expect(fetchMock).not.toHaveBeenCalled();
    serverAuth.getServerAuthContext.mockResolvedValueOnce(null);
    expect((await call('v1', 'track', 'ar.vtt')).status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
    for (const code of [403, 404, 400]) {
      fetchMock.mockResolvedValueOnce(new Response('{}', { status: code }));
      expect((await call('v1', 'draft', 'ar.vtt')).status).toBe(code);
    }
    fetchMock.mockResolvedValueOnce(new Response('{}', { status: 500 }));
    expect((await call('v1', 'track', 'ar.vtt')).status).toBe(502);
    fetchMock.mockRejectedValueOnce(new Error('down'));
    expect((await call('v1', 'track', 'ar.vtt')).status).toBe(502);
  });
});
