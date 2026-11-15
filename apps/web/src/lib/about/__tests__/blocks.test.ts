/**
 * @jest-environment node
 *
 * The About page built from page-builder blocks (wiki AUN-CMS-PAGE-BUILDER): the shared sample page
 * (one of every block type) through this site's link rules, in English and Arabic.
 */
import { normalizePageBlocks, samplePageBlocks, sampleServeRefs, SAMPLE_TYPES, servePageBlocks, type ServedBlock } from '@al-ummah/shared-types';
import { isBuiltPage, renderAboutBlocks } from '../blocks';

const WWW = 'https://www.qa.alummahnow.net';
const sample = (locale: 'en' | 'ar'): ServedBlock[] =>
  servePageBlocks(normalizePageBlocks(samplePageBlocks(locale)), sampleServeRefs(locale, (id) => `https://cms.example/media/${id}.png`, () => null));
const ctx = (locale: 'en' | 'ar', wwwUrl = WWW) => ({ locale, slug: 'about', title: 'About', wwwUrl, cardsLink: 'See the card posts' });
const types = (html: string) => [...new Set([...html.matchAll(/data-block-type="([a-z]+)"/g)].map((m) => m[1]))];

describe('isBuiltPage', () => {
  it('a page that is only text keeps the prose card; anything else was built', () => {
    expect(isBuiltPage([])).toBe(false);
    expect(isBuiltPage([{ id: 'body', type: 'markdown', text: 'Hi' } as ServedBlock])).toBe(false);
    expect(isBuiltPage(sample('en'))).toBe(true);
  });
});

describe('renderAboutBlocks', () => {
  it.each(['en', 'ar'] as const)('renders every block type of the sample page (%s)', (locale) => {
    const out = renderAboutBlocks(sample(locale), ctx(locale));
    expect(out.hero).toBe(true);
    expect(out.html).toContain(`lang="${locale}" dir="${locale === 'ar' ? 'rtl' : 'ltr'}"`);
    // The card-post grid is www's: here it is a call to action to the www page that shows it
    expect(types(out.html).sort()).toEqual(SAMPLE_TYPES.filter((t) => t !== 'cards').sort());
    expect(out.html).toContain(`href="${WWW}/${locale}/about/"`);
    expect(out.html).toContain('See the card posts');
    expect(out.html.match(/<h1/g)).toHaveLength(1);
    expect(out.html).not.toMatch(/<script|javascript:|\son[a-z]+=/i);
  });

  it('site paths go to www; videos, playlists and channels open on this site; posts on www', () => {
    const out = renderAboutBlocks(sample('en'), ctx('en'));
    expect(out.html).toContain(`href="${WWW}/en/videos/"`);
    expect(out.html).toMatch(/href="\/en\/(video|playlist|channels)\/[^"]+"/);
    expect(out.html).toContain(`href="${WWW}/en/articles/`);
  });

  it('without www’s address the card-post call to action is left out and site paths stay on this site', () => {
    const out = renderAboutBlocks(sample('en'), ctx('en', ''));
    expect(out.html).not.toContain('See the card posts');
    expect(out.html).toContain('href="/en/videos/"');
  });

  it('only https images (the CSP’s img-src)', () => {
    const image = (url: string): ServedBlock => ({ id: 'i', type: 'image', image: { id: 1, url, alt: 'A', width: 10, height: 10, mime: 'image/png' }, caption: null, size: 'content', appearance: { align: 'start', width: 'content', tone: 'none', space: 'm' } }) as ServedBlock;
    expect(renderAboutBlocks([image('https://cms.example/a.png')], ctx('en')).html).toContain('src="https://cms.example/a.png"');
    expect(renderAboutBlocks([image('http://cms.example/a.png')], ctx('en')).html).not.toContain('<img');
  });

  it('writes image dimensions only when they are whole numbers (no attribute injection)', () => {
    const bad = { id: 'i', type: 'image', image: { id: 1, url: 'https://cms.example/a.png', alt: 'A', width: '1" onerror="alert(1)', height: 10, mime: 'image/png' }, caption: null, size: 'content', appearance: { align: 'start', width: 'content', tone: 'none', space: 'm' } } as unknown as ServedBlock;
    const html = renderAboutBlocks([bad], ctx('en')).html;
    expect(html).toContain('src="https://cms.example/a.png"');
    expect(html).not.toContain('onerror');
    expect(html).not.toContain('width="1');
  });

  it('a page that does not open with a hero keeps its own header', () => {
    const out = renderAboutBlocks(sample('en').filter((b) => b.type !== 'hero'), ctx('en'));
    expect(out.hero).toBe(false);
    expect(out.html).not.toContain('<h1');
  });
});
