/**
 * @jest-environment node
 */
import { canonicalWatchUrl, shortsPageUrl } from '@/lib/embed/snippets';
import { videosSitemapXml } from '../sitemaps';
import { videoObjectLd } from '../structured-data';
import { watchIdFromPath } from '@/components/video/WatchShell';
import { nextShortId } from '@/components/shorts/ShortsNav';

const O = 'https://videos.alummahnow.net';

describe('Shorts URLs (D-SEO-10)', () => {
  it('a Short is canonical on /shorts/{id}, everything else on /video/{id}', () => {
    expect(shortsPageUrl(O, 'ar', 's1')).toBe(`${O}/ar/shorts/s1`);
    expect(canonicalWatchUrl(O, 'en', { id: 's1', isShort: true })).toBe(`${O}/en/shorts/s1`);
    expect(canonicalWatchUrl(O, 'en', { id: 'v1' })).toBe(`${O}/en/video/v1`);
  });
  it('sitemaps and JSON-LD name the Shorts page', () => {
    const xml = videosSitemapXml(O, [{ id: 's1', title: 'S', duration: 30, isShort: true, isLive: false, publishedAt: null, lastModified: null }]);
    expect(xml).toContain(`<loc>${O}/en/shorts/s1</loc>`);
    expect(xml).toContain(`hreflang="ar" href="${O}/ar/shorts/s1"`);
    expect(videoObjectLd({ id: 's1', title: 'S', playUrl: 'x', isShort: true }, 'en', O).url).toBe(`${O}/en/shorts/s1`);
  });
  it('the watch shell plays /shorts/{id} like /video/{id}', () => {
    expect(watchIdFromPath('/en/shorts/s1')).toBe('s1');
    expect(watchIdFromPath('/ar/video/v1')).toBe('v1');
    expect(watchIdFromPath('/en/shorts')).toBeNull();
  });
});

describe('nextShortId', () => {
  it('takes the first other Short of the public feed, null at the end or on an error', async () => {
    const answer = (body: unknown, status = 200) => (async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;
    expect(await nextShortId('https://api.test/', 's1', answer({ items: [{ id: 's1' }, { id: 's2' }] }))).toBe('s2');
    expect(await nextShortId('https://api.test', 's1', answer({ items: [] }))).toBeNull();
    expect(await nextShortId('https://api.test', 's1', answer({}, 500))).toBeNull();
  });
});
