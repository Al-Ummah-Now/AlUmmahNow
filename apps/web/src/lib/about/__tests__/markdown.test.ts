import { parseInline, parseMarkdown, plainText, resolveHref } from '../markdown';
import { ABOUT_FALLBACK } from '../fallback';

const ctx = { wwwUrl: 'https://www.alummahnow.net', locale: 'en' as const };

describe('About markdown', () => {
  it("parses the owner's About copy: intro, two section headings, a five-item list with bold", () => {
    const blocks = parseMarkdown(ABOUT_FALLBACK.en.body, ctx);
    expect(blocks.map((b) => b.t)).toEqual(['p', 'h', 'ul', 'h', 'p']);
    expect(blocks[1]).toEqual({ t: 'h', level: 2, c: [{ t: 'text', v: "What you’ll find here" }] });
    const list = blocks[2] as { t: 'ul'; items: unknown[][] };
    expect(list.items).toHaveLength(5);
    expect(list.items[0]).toEqual([{ t: 'text', v: 'Watch and share ' }, { t: 'strong', c: [{ t: 'text', v: 'videos and Shorts' }] }, { t: 'text', v: '.' }]);
    const ar = parseMarkdown(ABOUT_FALLBACK.ar.body, { ...ctx, locale: 'ar' });
    expect(ar.map((b) => b.t)).toEqual(['p', 'h', 'ul', 'h', 'p']);
  });

  it('headings: # and ## are h2 (the title is the h1), ### h3, deeper h4', () => {
    expect(parseMarkdown('# A\n## B\n### C\n###### D', ctx).map((b) => (b.t === 'h' ? b.level : 0))).toEqual([2, 2, 3, 4]);
  });

  it('numbered lists, quotes, rules, paragraphs joined across lines; ::video lines left out', () => {
    const blocks = parseMarkdown('1. one\n2. two\n\n> quoted\n> more\n\n---\n\nline one\nline two\n\n::video[abc123]', ctx);
    expect(blocks.map((b) => b.t)).toEqual(['ol', 'quote', 'hr', 'p']);
    expect(blocks[3]).toEqual({ t: 'p', c: [{ t: 'text', v: 'line one line two' }] });
  });

  it('raw HTML is text, never markup', () => {
    expect(parseInline('<script>alert(1)</script> <b>x</b>', ctx)).toEqual([{ t: 'text', v: '<script>alert(1)</script> <b>x</b>' }]);
  });

  it('links: external as they are, site paths on www in the page language, unsafe ones become text', () => {
    expect(resolveHref('https://example.org/a', ctx)).toEqual({ href: 'https://example.org/a', external: true });
    expect(resolveHref('/videos/', ctx)).toEqual({ href: 'https://www.alummahnow.net/en/videos/', external: true });
    expect(resolveHref('/ar/articles/', ctx)).toEqual({ href: 'https://www.alummahnow.net/ar/articles/', external: true });
    expect(resolveHref('/videos', { wwwUrl: '', locale: 'ar' })).toEqual({ href: '/ar/videos', external: false });
    expect(resolveHref('javascript:alert(1)', ctx)).toBeNull();
    expect(resolveHref('//evil.example', ctx)).toBeNull();
    expect(parseInline('[x](javascript:void0)', ctx)).toEqual([{ t: 'text', v: 'x' }]);
    expect(parseInline('see *this* and `code`', ctx)).toEqual([{ t: 'text', v: 'see ' }, { t: 'em', c: [{ t: 'text', v: 'this' }] }, { t: 'text', v: ' and ' }, { t: 'code', v: 'code' }]);
  });

  it('plain text for a description, cut at a word with an ellipsis', () => {
    const text = plainText(parseMarkdown(ABOUT_FALLBACK.en.body, ctx), 60);
    expect(text.length).toBeLessThanOrEqual(60);
    expect(text.startsWith('Al Ummah Now is a platform')).toBe(true);
    expect(text.endsWith('…')).toBe(true);
  });
});
