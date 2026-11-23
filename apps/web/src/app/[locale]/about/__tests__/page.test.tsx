/**
 * @jest-environment node
 *
 * /{locale}/about: the CMS About page in this site's theme, canonical to www's /{l}/about/ (CMS pages
 * belong to www, wiki AUN-SEO), the built-in copy when the CMS is down, the other language's page
 * when there is no translation, 404 when the page is gone from the CMS.
 */
import { renderToStaticMarkup } from 'react-dom/server';
import AboutRoute, { generateMetadata } from '../page';
import { loadPage } from '@/lib/about/cms-page';
import { ABOUT_FALLBACK } from '@/lib/about/fallback';

jest.mock('react', () => ({ ...jest.requireActual('react'), cache: <T,>(fn: T) => fn }));
jest.mock('@/lib/logger', () => ({ logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() } }));
jest.mock('next/navigation', () => ({ notFound: jest.fn(() => { throw new Error('NEXT_NOT_FOUND'); }) }));
jest.mock('@/lib/about/cms-page', () => ({ ...jest.requireActual('@/lib/about/cms-page'), loadPage: jest.fn() }));

const load = loadPage as jest.Mock;
const params = (locale: string) => ({ params: Promise.resolve({ locale }) });
const WWW = 'https://www.qa.alummahnow.net';

describe('About page', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.OPENAUTH_ISSUER = 'https://auth.qa.alummahnow.net';
    delete process.env.WWW_URL;
  });

  it('metadata: title, description, canonical and hreflang on www', async () => {
    load.mockResolvedValue({ status: 'ok', source: 'cms', page: ABOUT_FALLBACK.ar });
    const meta = await generateMetadata(params('ar'));
    expect(meta.title).toEqual({ absolute: 'عن الأمة الآن | الأمة الآن' });
    expect(meta.description).toBe('منصة إسلامية للمرئيات والمجتمع، بالعربية والإنجليزية.');
    expect(meta.alternates).toEqual({
      canonical: `${WWW}/ar/about/`,
      languages: { en: `${WWW}/en/about/`, ar: `${WWW}/ar/about/`, 'x-default': `${WWW}/en/about/` },
    });
    expect(load).toHaveBeenCalledWith('ar', 'about', ABOUT_FALLBACK.ar);
  });

  it('renders the CMS page in the theme: one h1, the lead, the body, its source', async () => {
    load.mockResolvedValue({ status: 'ok', source: 'cms', page: { ...ABOUT_FALLBACK.en, title: 'About (from the CMS)', body: 'Hello [videos](/videos/)\n\n## Section\n\n- **one**' } });
    const html = renderToStaticMarkup(await AboutRoute(params('en')));
    expect(html).toContain('data-source="cms"');
    expect(html.match(/<h1/g)).toHaveLength(1);
    expect(html).toContain('<h1 class="ab-title">About (from the CMS)</h1>');
    expect(html).toContain('<p class="ab-lead">An Islamic video and community platform, in Arabic and English.</p>');
    expect(html).toContain(`<a href="${WWW}/en/videos/" rel="noopener">videos</a>`);
    expect(html).toContain('<h2>Section</h2>');
    expect(html).toContain('<li><strong>one</strong></li>');
    expect(html).toContain('dir="ltr"');
  });

  it('a page built from blocks: the shared renderer, the hero is the only h1, no header of its own', async () => {
    const appearance = { align: 'start', width: 'content', tone: 'none', space: 'm' };
    const blocks = [
      { id: 'h', type: 'hero', eyebrow: null, title: 'Welcome', subtitle: null, background: 'gradient', image: null, height: 'm', buttons: [{ label: 'Watch', url: '/videos/', variant: 'primary' }], appearance },
      { id: 'm', type: 'markdown', text: 'Hello **world** <script>x</script>', appearance },
      { id: 'c', type: 'cards', heading: 'Card posts', tag: null, page_size: 6, filter: false, appearance },
    ];
    load.mockResolvedValue({ status: 'ok', source: 'cms', page: { ...ABOUT_FALLBACK.ar, blocks } });
    const html = renderToStaticMarkup(await AboutRoute(params('ar')));
    expect(html).not.toContain('ab-head');
    expect(html.match(/<h1/g)).toHaveLength(1);
    expect(html).toMatch(/<h1[^>]*>Welcome<\/h1>/);
    expect(html).toContain('data-testid="about-body"');
    expect(html).toContain('<strong>world</strong>');
    expect(html).not.toContain('<script>x');
    expect(html).toContain(`href="${WWW}/ar/videos/"`);
    expect(html).toContain(`href="${WWW}/ar/about/"`);
    expect(html).toContain('شاهد منشورات البطاقات');
  });

  it('a page that is only text (served as one markdown block) keeps the prose cards, one frosted-glass box per section', async () => {
    const body = 'Plain **text**\n\n## First\n\nOne\n\n## Second\n\nTwo';
    load.mockResolvedValue({ status: 'ok', source: 'cms', page: { ...ABOUT_FALLBACK.en, body, blocks: [{ id: 'body', type: 'markdown', text: body }] } });
    const html = renderToStaticMarkup(await AboutRoute(params('en')));
    expect(html).toContain('ab-head');
    expect(html).toContain('<div class="ab-sections" data-testid="about-body"><section class="ab-card pb-glass"><div class="ab-prose"><p>Plain <strong>text</strong></p></div></section>');
    expect(html.match(/class="ab-card pb-glass"/g)).toHaveLength(3);
    expect(html).toContain('<section class="ab-card pb-glass"><div class="ab-prose"><h2>Second</h2><p>Two</p></div></section>');
  });

  it('Arabic is right to left', async () => {
    load.mockResolvedValue({ status: 'ok', source: 'builtin', page: ABOUT_FALLBACK.ar });
    const html = renderToStaticMarkup(await AboutRoute(params('ar')));
    expect(html).toContain('dir="rtl"');
    expect(html).toContain('data-source="builtin"');
    expect(html).toContain('ماذا تجد هنا؟');
  });

  it('no translation: the other language\'s page, canonical to the original', async () => {
    load.mockImplementation(async (l: string) => (l === 'ar' ? { status: 'not_found' } : { status: 'ok', source: 'cms', page: { ...ABOUT_FALLBACK.en, alternates: [] } }));
    const meta = await generateMetadata(params('ar'));
    expect(meta.alternates).toEqual({ canonical: `${WWW}/en/about/`, languages: { en: `${WWW}/en/about/` } });
    const html = renderToStaticMarkup(await AboutRoute(params('ar')));
    expect(html).toContain('lang="en"');
    expect(html).toContain('About Al Ummah Now');
  });

  it('gone from the CMS in both languages: 404 with the 404 page\'s title and one robots meta', async () => {
    load.mockResolvedValue({ status: 'not_found' });
    // No robots of its own: Next's noindex on the 404 is the page's only one (lib/seo/error-robots.ts)
    expect(await generateMetadata(params('en'))).toEqual({ title: { absolute: 'Page not found | Al Ummah Now' }, robots: null });
    await expect(AboutRoute(params('en'))).rejects.toThrow('NEXT_NOT_FOUND');
  });

  it('local dev (no www URL): its own canonical', async () => {
    process.env.OPENAUTH_ISSUER = 'http://localhost:3001';
    load.mockResolvedValue({ status: 'ok', source: 'cms', page: ABOUT_FALLBACK.en });
    expect((await generateMetadata(params('en'))).alternates).toEqual({ canonical: '/en/about', languages: { en: '/en/about', ar: '/ar/about', 'x-default': '/en/about' } });
  });
});
