/**
 * @jest-environment node
 */
import { classifyVisit, recordServerVisit, visitFromRequest } from '../site-visit';
import { landingKindOf, visitSourceOf } from '@al-ummah/shared-types';

describe('landingKindOf', () => {
  it.each([
    ['/en', 'home'], ['/ar/', 'home'], ['/en/video/abc', 'watch'], ['/ar/shorts/abc', 'shorts'], ['/en/@chan', 'channel'],
    ['/en/channels/c1', 'channel'], ['/en/channels', 'channels'], ['/en/playlist/p1', 'playlist'], ['/en/search?q=x', 'search'],
    ['/en/explore', 'explore'], ['/en/videos', 'videos'], ['/en/live', 'live'], ['/en/history', 'library'], ['/en/upload', 'other'],
  ])('%s → %s', (path, kind) => expect(landingKindOf(path)).toBe(kind));
});

describe('visitSourceOf', () => {
  it.each([
    [null, 'direct'], ['www.google.com', 'search:google'], ['www.google.co.uk', 'search:google'], ['www.bing.com', 'search:bing'],
    ['duckduckgo.com', 'search:duckduckgo'], ['gemini.google.com', 'search:ai'], ['chatgpt.com', 'search:ai'],
    ['t.co', 'social:x'], ['l.facebook.com', 'social:facebook'], ['wa.me', 'social:whatsapp'], ['t.me', 'social:telegram'],
    ['www.alummahnow.net', 'platform'], ['mustafa.alummahnow.net', 'platform'], ['example.org', 'site'],
  ])('%s → %s', (host, source) => expect(visitSourceOf(host)).toBe(source));
});

describe('classifyVisit', () => {
  it('classifies the landing path and referrer, keeping only the referrer host', () => {
    expect(classifyVisit('/ar/video/abc', 'https://www.google.com/search?q=secret')).toEqual({ landing: 'watch', source: 'search:google', referrerHost: 'www.google.com' });
  });
  it('no referrer, or an unreadable one, is a direct visit', () => {
    expect(classifyVisit('/en', '')).toEqual({ landing: 'home', source: 'direct' });
    expect(classifyVisit('/en', 'not a url')).toEqual({ landing: 'home', source: 'direct' });
  });
});

const nav = (path: string, headers: Record<string, string> = {}, method = 'GET') => ({
  method,
  url: `https://videos.alummahnow.net${path}`,
  headers: new Headers({ 'sec-fetch-mode': 'navigate', 'sec-fetch-dest': 'document', 'user-agent': 'Mozilla/5.0 (Macintosh) Safari/605.1.15', ...headers }),
});

describe('visitFromRequest (server-side, cookieless)', () => {
  it('counts a page load from a search engine or another site, and a direct one', () => {
    expect(visitFromRequest(nav('/en/video/abc', { referer: 'https://www.google.com/' }))).toEqual({ landing: 'watch', source: 'search:google', referrerHost: 'www.google.com' });
    expect(visitFromRequest(nav('/ar/@chan', { referer: 'https://www.alummahnow.net/ar/' }))).toEqual({ landing: 'channel', source: 'platform', referrerHost: 'www.alummahnow.net' });
    expect(visitFromRequest(nav('/en'))).toEqual({ landing: 'home', source: 'direct' });
  });
  it('a page load coming from this site (a link, a reload) is the same visit', () => {
    expect(visitFromRequest(nav('/en/video/x', { referer: 'https://videos.alummahnow.net/en' }))).toBeNull();
  });
  it('never counts data requests, prefetches, subresources, non-GET, other paths or crawlers', () => {
    expect(visitFromRequest(nav('/en/video/x', { rsc: '1' }))).toBeNull();
    expect(visitFromRequest(nav('/en/video/x?_rsc=abc'))).toBeNull();
    expect(visitFromRequest(nav('/en/video/x', { 'sec-purpose': 'prefetch' }))).toBeNull();
    expect(visitFromRequest(nav('/en/video/x', { 'sec-fetch-mode': 'cors', 'sec-fetch-dest': 'empty' }))).toBeNull();
    expect(visitFromRequest(nav('/en/video/x', {}, 'POST'))).toBeNull();
    expect(visitFromRequest(nav('/embed/v/x'))).toBeNull();
    expect(visitFromRequest(nav('/en', { 'user-agent': 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)' }))).toBeNull();
    expect(visitFromRequest(nav('/en', { 'user-agent': 'facebookexternalhit/1.1' }))).toBeNull();
  });
  it('without Fetch Metadata headers, only an HTML request counts', () => {
    const plain = (accept: string) => ({ method: 'GET', url: 'https://videos.alummahnow.net/en', headers: new Headers({ accept, 'user-agent': 'Mozilla/5.0' }) });
    expect(visitFromRequest(plain('text/html,application/xhtml+xml'))).toEqual({ landing: 'home', source: 'direct' });
    expect(visitFromRequest(plain('*/*'))).toBeNull();
  });
});

describe('recordServerVisit', () => {
  const realFetch = global.fetch;
  afterEach(() => { global.fetch = realFetch; delete process.env.API_URL; });
  it('sends the visit to api-videos in the background, and nothing for non-visits', async () => {
    process.env.API_URL = 'https://videos.api.example/';
    const fetchMock = jest.fn(async () => new Response(null, { status: 202 }));
    global.fetch = fetchMock as never;
    const pending: Promise<unknown>[] = [];
    recordServerVisit(nav('/en', { referer: 'https://t.co/x' }), (p) => pending.push(p));
    recordServerVisit(nav('/en', { referer: 'https://videos.alummahnow.net/en' }), (p) => pending.push(p));
    await Promise.all(pending);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://videos.api.example/api/analytics/events');
    expect(JSON.parse(String(init.body))).toEqual({ kind: 'visit', events: [{ landing: 'home', source: 'social:x', referrerHost: 't.co' }] });
  });
});
