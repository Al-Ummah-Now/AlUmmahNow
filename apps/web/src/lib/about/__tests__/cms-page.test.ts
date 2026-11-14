/**
 * @jest-environment node
 *
 * The CMS page loader's fallback chain: fresh edge copy → CMS → last good edge copy → built-in copy.
 */
import { CMS_TIMEOUT_MS, FRESH_MS, STALE_MS, loadCmsPage, toCmsPage, type PageDeps } from '../cms-page';
import { ABOUT_FALLBACK } from '../fallback';

jest.mock('@/lib/logger', () => ({ logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() } }));

const CMS = 'https://cms.qa.alummahnow.net';
const URL_EN = `${CMS}/api/public/v1/pages/about?locale=en`;
const cmsPage = (over: Record<string, unknown> = {}) => ({
  slug: 'about', locale: 'en', title: 'About Al Ummah Now (edited)', summary: 'S', body: 'Body', seo_title: null, seo_description: null,
  cover: null, published_at: '2026-11-14T00:00:00.000Z', updated_at: '2026-11-14T00:00:00.000Z', alternates: [{ locale: 'ar', slug: 'about' }],
  images: [], blocks: [{ id: 'body', type: 'markdown', text: 'Body' }], list_kind: null, ...over,
});

class MemoryCache {
  store = new Map<string, Response>();
  async match(key: string) {
    const r = this.store.get(key);
    return r ? r.clone() : undefined;
  }
  async put(key: string, res: Response) {
    this.store.set(key, res.clone());
  }
}

function deps(fetchImpl: (url: string) => Promise<Response>, start = 1_000_000) {
  let now = start;
  const cache = new MemoryCache();
  const fetchMock = jest.fn(async (url: RequestInfo | URL) => fetchImpl(String(url)));
  const d: PageDeps = { cmsUrl: CMS, fetch: fetchMock as unknown as typeof fetch, cache: cache as unknown as Cache, now: () => now };
  return { d, cache, fetchMock, advance: (ms: number) => (now += ms) };
}
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('loadCmsPage', () => {
  it('reads the page from the CMS public API and keeps a copy at the edge', async () => {
    const { d, cache, fetchMock } = deps(async () => json(cmsPage()));
    const r = await loadCmsPage(d, 'en', 'about', ABOUT_FALLBACK.en);
    expect(r).toMatchObject({ status: 'ok', source: 'cms', page: { title: 'About Al Ummah Now (edited)', alternates: [{ locale: 'ar', slug: 'about' }] } });
    expect(fetchMock).toHaveBeenCalledWith(URL_EN, expect.objectContaining({ headers: { accept: 'application/json' } }));
    expect(cache.store.has(URL_EN)).toBe(true);
  });

  it('a fresh edge copy answers without asking the CMS', async () => {
    const { d, fetchMock, advance } = deps(async () => json(cmsPage()));
    await loadCmsPage(d, 'en', 'about', ABOUT_FALLBACK.en);
    advance(FRESH_MS - 1);
    expect(await loadCmsPage(d, 'en', 'about', ABOUT_FALLBACK.en)).toMatchObject({ status: 'ok', source: 'cms' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['a 5xx', async () => json({ error: 'boom' }, 503)],
    ['bad JSON', async () => new Response('<html>oops</html>', { status: 200 })],
    ['a network error', async () => { throw new TypeError('fetch failed'); }],
    ['a timeout', async () => { throw new DOMException('The operation was aborted due to timeout', 'TimeoutError'); }],
  ])('CMS down (%s): the last good copy, then the built-in copy', async (_why, failing) => {
    let down = false;
    const { d, advance } = deps(async () => (down ? failing() : json(cmsPage())));
    await loadCmsPage(d, 'en', 'about', ABOUT_FALLBACK.en);
    down = true;
    advance(FRESH_MS + 1);
    expect(await loadCmsPage(d, 'en', 'about', ABOUT_FALLBACK.en)).toMatchObject({ status: 'ok', source: 'cache', page: { title: 'About Al Ummah Now (edited)' } });
    advance(STALE_MS);
    expect(await loadCmsPage(d, 'en', 'about', ABOUT_FALLBACK.en)).toMatchObject({ status: 'ok', source: 'builtin', page: { title: 'About Al Ummah Now' } });
  });

  it('never blank: no CMS URL, no cache and the CMS down all give the built-in copy', async () => {
    const { d } = deps(async () => json({}, 500));
    expect(await loadCmsPage({ ...d, cmsUrl: '' }, 'ar', 'about', ABOUT_FALLBACK.ar)).toMatchObject({ status: 'ok', source: 'builtin', page: { title: 'عن الأمة الآن' } });
    expect(await loadCmsPage({ ...d, cache: null }, 'ar', 'about', ABOUT_FALLBACK.ar)).toMatchObject({ status: 'ok', source: 'builtin' });
  });

  it('a 404 is an answer (removed or unpublished), cached like a page', async () => {
    const { d, fetchMock } = deps(async () => json({ error: 'not_found' }, 404));
    expect(await loadCmsPage(d, 'en', 'about', ABOUT_FALLBACK.en)).toEqual({ status: 'not_found' });
    expect(await loadCmsPage(d, 'en', 'about', ABOUT_FALLBACK.en)).toEqual({ status: 'not_found' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('times out after 2.5 s', () => {
    expect(CMS_TIMEOUT_MS).toBe(2_500);
  });
});

describe('toCmsPage', () => {
  it('accepts a content page and refuses list pages and malformed ones', () => {
    expect(toCmsPage(cmsPage())).toMatchObject({ slug: 'about', locale: 'en', body: 'Body' });
    expect(toCmsPage(cmsPage({ list_kind: 'filter' }))).toBeNull();
    expect(toCmsPage(cmsPage({ title: '' }))).toBeNull();
    expect(toCmsPage(cmsPage({ locale: 'fr' }))).toBeNull();
    expect(toCmsPage(cmsPage({ body: null }))).toBeNull();
    expect(toCmsPage(cmsPage({ alternates: [{ locale: 'xx', slug: 'a' }, { locale: 'ar', slug: 'about' }] }))?.alternates).toEqual([{ locale: 'ar', slug: 'about' }]);
  });

  it('keeps the page-builder blocks this build knows, and none when there are none', () => {
    expect(toCmsPage(cmsPage({ blocks: undefined }))?.blocks).toEqual([]);
    expect(toCmsPage(cmsPage({ blocks: 'nope' }))?.blocks).toEqual([]);
    const md = { id: 'a', type: 'markdown', text: 'Hi', appearance: { align: 'start', width: 'content', tone: 'none', space: 'm' } };
    const blocks = [md, { id: 'b', type: 'hologram' }, { type: 'markdown', text: 'no id' }, null];
    expect(toCmsPage(cmsPage({ blocks }))?.blocks).toEqual([md]);
  });
});
