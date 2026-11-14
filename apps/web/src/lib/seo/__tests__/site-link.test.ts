/**
 * @jest-environment node
 *
 * Scholar-site canonicals on the videos site (wiki AUN-SCHOLAR-SITES §4.4, #1215): posts follow any
 * live site, videos only a site on the scholar's own domain; an API problem keeps this site canonical.
 */
// React.cache exists in Next's server React build, not in the react@18 test copy
jest.mock('react', () => ({ ...jest.requireActual('react'), cache: <T,>(fn: T) => fn }));
jest.mock('@/lib/logger-server', () => ({ logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() } }));
jest.mock('@/lib/api/api-client', () => ({ buildApiUrl: (path: string) => `https://api.test${path}` }));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { loadSiteLink, resetSiteLinkMemo, sitePostCanonical, siteWatchCanonical } = require('../site-link') as typeof import('../site-link');

const custom = { channelId: 'ch1', primaryHost: 'scholar.example', primaryKind: 'custom' as const, locales: ['en' as const, 'ar' as const] };
const subdomain = { ...custom, primaryHost: 'scholar.alummahnow.org', primaryKind: 'subdomain' as const, locales: ['ar' as const] };

function mockFetch(answer: () => Promise<Response> | Response) {
  const fn = jest.fn(async () => answer());
  global.fetch = fn as never;
  return fn;
}

beforeEach(() => resetSiteLinkMemo());

describe('loadSiteLink', () => {
  it('returns the live site and memoises it per isolate', async () => {
    const fetch = mockFetch(() => Response.json(custom));
    expect(await loadSiteLink('ch1')).toEqual(custom);
    expect(await loadSiteLink('ch1')).toEqual(custom);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls[0]).toBeTruthy();
  });

  it('404 = no site (memoised); 5xx, network errors and bad bodies keep this site canonical', async () => {
    mockFetch(() => new Response('{}', { status: 404 }));
    expect(await loadSiteLink('ch1')).toBeNull();
    resetSiteLinkMemo();
    mockFetch(() => new Response('oops', { status: 503 }));
    expect(await loadSiteLink('ch1')).toBeNull();
    mockFetch(() => Promise.reject(new Error('down')));
    expect(await loadSiteLink('ch1')).toBeNull();
    mockFetch(() => Response.json({ ...custom, channelId: 'someone-else' }));
    expect(await loadSiteLink('ch1')).toBeNull();
    resetSiteLinkMemo();
    mockFetch(() => Response.json({ ...custom, primaryHost: 'evil.example/"><script>' }));
    expect(await loadSiteLink('ch1')).toBeNull();
    expect(await loadSiteLink(null)).toBeNull();
  });
});

describe('canonicals on the site', () => {
  it('videos: only a site on its own domain, in the page language or the site default', () => {
    expect(siteWatchCanonical(custom, 'ar', 'v1')).toEqual({
      canonical: 'https://scholar.example/ar/watch/v1/',
      languages: { en: 'https://scholar.example/en/watch/v1/', ar: 'https://scholar.example/ar/watch/v1/', 'x-default': 'https://scholar.example/en/watch/v1/' },
    });
    expect(siteWatchCanonical(subdomain, 'en', 'v1')).toBeNull();
    expect(siteWatchCanonical(null, 'en', 'v1')).toBeNull();
  });

  it('posts: any live site; a single-language site has one hreflang and no x-default', () => {
    expect(sitePostCanonical(subdomain, 'en', 'p1')).toEqual({
      canonical: 'https://scholar.alummahnow.org/ar/posts/p1/',
      languages: { ar: 'https://scholar.alummahnow.org/ar/posts/p1/' },
    });
    expect(sitePostCanonical(custom, 'en', 'p1')?.canonical).toBe('https://scholar.example/en/posts/p1/');
    expect(sitePostCanonical(null, 'en', 'p1')).toBeNull();
  });
});
