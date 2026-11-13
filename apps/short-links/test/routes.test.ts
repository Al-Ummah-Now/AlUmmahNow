/**
 * Short links (wiki AUN-SHORT-LINKS): path parsing, the URL builder and host per environment, the
 * redirect for every link type with ?lang= and the kept parameters, 404 for unknown / private /
 * deleted ids with nothing leaked, the edge cache, click counting (no id, crawlers and HEAD not
 * counted), robots.txt and noindex, and the fallback when the API is down.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  isShortLinkClickEvent,
  keptShortLinkParams,
  parseShortLinkPath,
  shortLinkOriginFor,
  shortLinkUrl,
} from '@al-ummah/shared-types';
import { handle, type Env } from '../src/index';
import { robotsTxt } from '../src/pages';

const ENV: Env = {
  SITE_ORIGIN: 'https://videos.alummahnow.net',
  WWW_ORIGIN: 'https://www.alummahnow.net',
  API_ORIGIN: 'https://videos.api.alummahnow.net',
  SHORTS_PATH: 'video',
  ENVIRONMENT: 'production',
};

const VID = '3f1c2b9e-1a2b-4c3d-8e9f-0123456789ab';
const SHORT = '9a8b7c6d-1a2b-4c3d-8e9f-0123456789ab';
const PRIVATE = '00000000-dead-4c3d-8e9f-0123456789ab';

interface Call {
  url: string;
  init?: RequestInit;
}

/** A fake public API: what an anonymous visitor would get. */
function fakeApi(overrides: Record<string, { status: number; body?: unknown }> = {}) {
  const calls: Call[] = [];
  const routes: Record<string, { status: number; body?: unknown }> = {
    [`/api/videos/${VID}`]: { status: 200, body: { id: VID, title: 'A video', isShort: false } },
    [`/api/videos/${SHORT}`]: { status: 200, body: { id: SHORT, title: 'A short', isShort: true } },
    [`/api/videos/${PRIVATE}`]: { status: 404, body: { success: false, error: 'Object not found' } },
    '/api/channels/ch_1': { status: 200, body: { success: true, result: { id: 'ch_1', name: 'Chan' } } },
    '/api/channels/by-handle/scholar.one': { status: 200, body: { success: true, result: { id: 'ch_1', handle: 'Scholar.One' } } },
    '/api/playlists/pl_1': { status: 200, body: { success: true, result: { id: 'pl_1' } } },
    '/api/playlists/pl_private': { status: 404, body: { success: false, error: 'Playlist not found' } },
    '/api/playlists/pl_purged': { status: 410, body: { success: false, error: 'Gone' } },
    '/api/community/posts/post_1': { status: 200, body: { id: 'post_1', channelId: 'ch_1' } },
    ...overrides,
  };
  const fetch = async (input: string, init?: RequestInit) => {
    calls.push({ url: input, init });
    const path = new URL(input).pathname;
    if (path === '/api/analytics/events') return new Response('{}', { status: 202 });
    const r = routes[path] ?? { status: 404, body: { error: 'not found' } };
    return new Response(JSON.stringify(r.body ?? {}), { status: r.status, headers: { 'Content-Type': 'application/json' } });
  };
  return { fetch, calls };
}

function memoryCache() {
  const store = new Map<string, Response>();
  return {
    store,
    match: async (key: RequestInfo | URL) => store.get(String(key))?.clone() as Response | undefined,
    put: async (key: RequestInfo | URL, res: Response) => {
      store.set(String(key), res.clone());
    },
  };
}

async function run(path: string, init: { headers?: Record<string, string>; method?: string } = {}, api = fakeApi(), cache: ReturnType<typeof memoryCache> | null = null) {
  const pending: Promise<unknown>[] = [];
  const ctx = { waitUntil: (p: Promise<unknown>) => void pending.push(p) };
  const req = new Request(`https://alummahnow.link${path}`, { method: init.method ?? 'GET', headers: { 'user-agent': 'Mozilla/5.0 (Macintosh) Safari/605', ...init.headers } });
  const res = await handle(req, ENV, ctx, { fetch: api.fetch, cache });
  await Promise.all(pending);
  const clicks = api.calls.filter((c) => c.url.endsWith('/api/analytics/events')).map((c) => JSON.parse(String(c.init?.body)));
  return { res, calls: api.calls, clicks };
}

describe('shared-types: short link paths and URLs', () => {
  it('parses every link type and refuses anything else', () => {
    assert.deepEqual(parseShortLinkPath('/v/abc-1'), { kind: 'video', id: 'abc-1' });
    assert.deepEqual(parseShortLinkPath('/s/abc'), { kind: 'short', id: 'abc' });
    assert.deepEqual(parseShortLinkPath('/c/ch_1'), { kind: 'channel', id: 'ch_1' });
    assert.deepEqual(parseShortLinkPath('/p/post_1/'), { kind: 'post', id: 'post_1' });
    assert.deepEqual(parseShortLinkPath('/l/pl_1'), { kind: 'playlist', id: 'pl_1' });
    assert.deepEqual(parseShortLinkPath('/@scholar.one'), { kind: 'handle', handle: 'scholar.one' });
    assert.deepEqual(parseShortLinkPath('/'), { kind: 'home' });
    for (const bad of ['/x/abc', '/v/', '/v/a/b', '/v/..', '/v/%2e%2e', '/@ab', '/@-bad', '/v/<script>', '/v/' + 'a'.repeat(65), '/%E0%A4%A']) {
      assert.equal(parseShortLinkPath(bad), null, bad);
    }
  });

  it('builds short links with t, list and lang, and none for a bad id', () => {
    assert.equal(shortLinkUrl('https://alummahnow.link', { kind: 'video', id: VID }), `https://alummahnow.link/v/${VID}`);
    assert.equal(
      shortLinkUrl('https://alummahnow.link', { kind: 'video', id: VID }, { t: 75.6, list: { id: 'pl_1', index: 2 }, lang: 'ar' }),
      `https://alummahnow.link/v/${VID}?list=pl_1&index=2&t=75&lang=ar`,
    );
    assert.equal(shortLinkUrl('https://alummahnow.link', { kind: 'handle', handle: '@scholar.one' }), 'https://alummahnow.link/@scholar.one');
    assert.equal(shortLinkUrl('https://alummahnow.link', { kind: 'video', id: 'a/b' }), null);
    assert.equal(shortLinkUrl(null, { kind: 'video', id: VID }), null);
  });

  it('maps every environment to its short link host', () => {
    assert.equal(shortLinkOriginFor('https://videos.alummahnow.net'), 'https://alummahnow.link');
    assert.equal(shortLinkOriginFor('www.alummahnow.net'), 'https://alummahnow.link');
    assert.equal(shortLinkOriginFor('https://videos.qa.alummahnow.net'), 'https://qa.alummahnow.link');
    assert.equal(shortLinkOriginFor('videos.api.stage.alummahnow.net'), 'https://stage.alummahnow.link');
    assert.equal(shortLinkOriginFor('http://localhost:3001'), null);
    assert.equal(shortLinkOriginFor('https://example.com'), null);
  });

  it('keeps t, list, index and utm_* only', () => {
    const kept = keptShortLinkParams(new URLSearchParams('t=90s&list=pl_1&index=3&utm_source=wa&utm_campaign=x&foo=bar&lang=ar&redirect=https://evil'));
    assert.equal(kept.toString(), 't=90&list=pl_1&index=3&utm_source=wa&utm_campaign=x');
    assert.equal(keptShortLinkParams(new URLSearchParams('t=abc&list=a/b')).toString(), '');
  });
});

describe('redirects', () => {
  it('video → watch page, 301, noindex, the site default language', async () => {
    const { res } = await run(`/v/${VID}`);
    assert.equal(res.status, 301);
    assert.equal(res.headers.get('location'), `https://videos.alummahnow.net/video/${VID}`);
    assert.match(res.headers.get('x-robots-tag') ?? '', /noindex/);
  });

  it('?lang=ar and ?lang=en pick the locale; t and utm are kept', async () => {
    const ar = await run(`/v/${VID}?lang=ar&t=42&utm_source=whatsapp`);
    assert.equal(ar.res.headers.get('location'), `https://videos.alummahnow.net/ar/video/${VID}?t=42&utm_source=whatsapp`);
    const en = await run(`/v/${VID}?lang=EN&list=pl_1&index=0`);
    assert.equal(en.res.headers.get('location'), `https://videos.alummahnow.net/en/video/${VID}?list=pl_1&index=0`);
  });

  it('never reads Accept-Language', async () => {
    const { res } = await run(`/v/${VID}`, { headers: { 'accept-language': 'ar-SA,ar;q=0.9' } });
    assert.equal(res.headers.get('location'), `https://videos.alummahnow.net/video/${VID}`);
  });

  it('a Short opens on /video until SHORTS_PATH is shorts, then on /shorts', async () => {
    const before = await run(`/s/${SHORT}`);
    assert.equal(before.res.headers.get('location'), `https://videos.alummahnow.net/video/${SHORT}`);
    const pending: Promise<unknown>[] = [];
    const res = await handle(new Request(`https://alummahnow.link/v/${SHORT}?lang=ar`), { ...ENV, SHORTS_PATH: 'shorts' }, { waitUntil: (p) => void pending.push(p) }, { fetch: fakeApi().fetch });
    assert.equal(res.headers.get('location'), `https://videos.alummahnow.net/ar/shorts/${SHORT}`);
  });

  it('channel by id and by handle, playlist, post, home', async () => {
    assert.equal((await run('/c/ch_1')).res.headers.get('location'), 'https://videos.alummahnow.net/channels/ch_1');
    assert.equal((await run('/@scholar.one?lang=ar')).res.headers.get('location'), 'https://videos.alummahnow.net/ar/@Scholar.One');
    assert.equal((await run('/l/pl_1')).res.headers.get('location'), 'https://videos.alummahnow.net/playlist/pl_1');
    assert.equal(
      (await run('/p/post_1?lang=en')).res.headers.get('location'),
      'https://videos.alummahnow.net/en/channels/ch_1?tab=community&post=post_1#post-post_1',
    );
    assert.equal((await run('/')).res.headers.get('location'), 'https://www.alummahnow.net/');
    assert.equal((await run('/?lang=ar')).res.headers.get('location'), 'https://www.alummahnow.net/ar/');
  });
});

describe('not found', () => {
  for (const path of [`/v/${PRIVATE}`, '/l/pl_private', '/l/pl_purged', '/p/missing', '/c/nope', '/x/whatever', '/v/a.b']) {
    it(`${path} → 404 page, noindex, nothing about the item`, async () => {
      const { res } = await run(path);
      assert.equal(res.status, 404);
      assert.match(res.headers.get('x-robots-tag') ?? '', /noindex/);
      const html = await res.text();
      assert.match(html, /Link not found/);
      assert.match(html, /الرابط غير موجود/);
      assert.doesNotMatch(html, /Object not found|Playlist not found|A video/);
    });
  }

  it('the Arabic page leads with Arabic for ?lang=ar', async () => {
    const html = await (await run(`/v/${PRIVATE}?lang=ar`)).res.text();
    assert.match(html, /<html lang="ar" dir="rtl">/);
  });
});

describe('edge cache', () => {
  it('a second click does not call the API again', async () => {
    const api = fakeApi();
    const cache = memoryCache();
    await run(`/v/${VID}`, {}, api, cache);
    await run(`/v/${VID}?lang=ar`, {}, api, cache);
    const lookups = api.calls.filter((c) => c.url.includes('/api/videos/'));
    assert.equal(lookups.length, 1);
  });
});

describe('click counting', () => {
  it('counts one aggregate click with type and source, no id', async () => {
    const { clicks } = await run(`/v/${VID}`, { headers: { referer: 'https://web.whatsapp.com/' } });
    assert.equal(clicks.length, 1);
    assert.equal(clicks[0].kind, 'short_link');
    assert.deepEqual(clicks[0].events, [{ type: 'video', source: 'social:whatsapp' }]);
    assert.ok(isShortLinkClickEvent(clicks[0].events[0]));
    assert.doesNotMatch(JSON.stringify(clicks), new RegExp(VID));
  });

  it('a Short counts as short, an unknown link as unknown', async () => {
    assert.deepEqual((await run(`/v/${SHORT}`)).clicks[0].events, [{ type: 'short', source: 'direct' }]);
    assert.deepEqual((await run(`/v/${PRIVATE}`)).clicks[0].events, [{ type: 'unknown', source: 'direct' }]);
  });

  it('crawlers, previewers, prefetches and HEAD are not counted (but still redirected)', async () => {
    for (const ua of ['Twitterbot/1.0', 'WhatsApp/2.23', 'facebookexternalhit/1.1', 'Googlebot/2.1']) {
      const { res, clicks } = await run(`/v/${VID}`, { headers: { 'user-agent': ua } });
      assert.equal(res.status, 301);
      assert.equal(clicks.length, 0, ua);
    }
    assert.equal((await run(`/v/${VID}`, { headers: { 'sec-purpose': 'prefetch' } })).clicks.length, 0);
    const head = await run(`/v/${VID}`, { method: 'HEAD' });
    assert.equal(head.res.status, 301);
    assert.equal(head.clicks.length, 0);
  });
});

describe('robots and other requests', () => {
  it('robots.txt refuses search crawlers and lets card previewers read', async () => {
    const { res } = await run('/robots.txt');
    const text = await res.text();
    assert.equal(res.status, 200);
    assert.match(text, /User-agent: \*\nDisallow: \//);
    assert.match(text, /User-agent: Twitterbot\nAllow: \//);
    assert.equal(text, robotsTxt());
  });

  it('POST is refused', async () => {
    assert.equal((await run(`/v/${VID}`, { method: 'POST' })).res.status, 405);
  });
});

describe('API down', () => {
  it('a video still redirects (302, not cached); a post answers 503', async () => {
    const down = fakeApi({ [`/api/videos/${VID}`]: { status: 502 }, '/api/community/posts/post_1': { status: 500 } });
    const v = await run(`/v/${VID}?lang=ar`, {}, down);
    assert.equal(v.res.status, 302);
    assert.equal(v.res.headers.get('location'), `https://videos.alummahnow.net/ar/video/${VID}`);
    assert.equal(v.res.headers.get('cache-control'), 'no-store');
    assert.equal((await run('/p/post_1', {}, down)).res.status, 503);
  });
});
