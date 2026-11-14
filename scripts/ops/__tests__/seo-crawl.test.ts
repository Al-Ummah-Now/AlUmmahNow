import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { checkPage, crawl, issueBody, sample, sitemapLocs } from '../seo-crawl.ts';

const URL_EN = 'https://videos.alummahnow.net/en/video/v1';
const good = (url = URL_EN, extra = '') =>
  `<html><head><title>Talk | Al Ummah Now</title><meta name="description" content="About it"><meta name="robots" content="index, follow">` +
  `<link rel="canonical" href="${url}"><script type="application/ld+json">{"@type":"VideoObject","name":"Talk","description":"d","thumbnailUrl":["https://x/thumb/v1.jpg"],"uploadDate":"2026-11-10","embedUrl":"https://x/embed/v/v1"}</script>${extra}</head><body></body></html>`;
const h = (init: Record<string, string> = {}) => new Headers(init);

describe('weekly SEO crawl (wiki AUN-SEO, Monitoring 4)', () => {
  it('reads sitemap and index locs, decoding entities', () => {
    assert.deepEqual(sitemapLocs('<urlset><url><loc>https://a/x?b=1&amp;c=2</loc></url><url><loc> https://a/y </loc></url></urlset>'), ['https://a/x?b=1&c=2', 'https://a/y']);
    // Decoded once: an escaped entity stays as written
    assert.deepEqual(sitemapLocs('<loc>https://a/?q=&amp;lt;b</loc>'), ['https://a/?q=&lt;b']);
  });

  it('a good page has no findings', () => {
    assert.deepEqual(checkPage(URL_EN, 200, h(), good()), []);
  });

  it('flags redirects, errors, noindex, missing title/description, canonical and JSON-LD problems', () => {
    assert.match(checkPage(URL_EN, 301, h({ location: '/x' }), '')[0], /301 redirect to \/x/);
    assert.deepEqual(checkPage(URL_EN, 404, h(), ''), ['HTTP 404']);
    assert.ok(checkPage(URL_EN, 200, h({ 'x-robots-tag': 'noindex' }), good()).some((p) => /X-Robots-Tag/.test(p)));
    const bad =
      '<title> </title><meta name="robots" content="noindex"><meta name="robots" content="index">' +
      '<link rel="canonical" href="https://videos.alummahnow.net/en">' +
      '<script type="application/ld+json">{oops</script>' +
      '<script type="application/ld+json">[{"@type":"VideoObject","name":"x"}]</script>' +
      '<img src="https://cdn.example/t.jpg?token=abc&amp;expires=1">';
    const problems = checkPage(URL_EN, 200, h(), bad);
    for (const re of [/2 robots meta/, /says noindex/, /<title>/, /meta description/, /canonical is https:\/\/videos.alummahnow.net\/en,/, /does not parse/, /VideoObject without description, thumbnailUrl, uploadDate, embedUrl/, /signed media URL/]) {
      assert.ok(problems.some((p) => re.test(p)), `${re} in ${JSON.stringify(problems)}`);
    }
    assert.ok(checkPage(URL_EN, 200, h(), good(URL_EN).replace(/<link rel="canonical"[^>]*>/, '')).includes('0 canonical links (expected 1)'));
  });

  it('samples round-robin over groups, without duplicates, the same for the same seed', () => {
    const groups = [Array.from({ length: 100 }, (_, i) => `a${i}`), ['b1', 'b2'], ['a1']];
    const s = sample(groups, 10, 20261114);
    assert.equal(s.length, 10);
    assert.equal(new Set(s).size, 10);
    assert.ok(s.includes('b1') && s.includes('b2'));
    assert.deepEqual(sample(groups, 10, 20261114), s);
    assert.equal(sample([['x']], 10, 1).length, 1);
  });

  it('crawls robots.txt, the sitemap index and files, then the sampled pages', async () => {
    const O = 'https://videos.alummahnow.net';
    const pages: Record<string, { status: number; text: string; headers?: Record<string, string> }> = {
      [`${O}/robots.txt`]: { status: 200, text: `User-agent: *\nAllow: /\nSitemap: ${O}/sitemap.xml\n` },
      [`${O}/sitemap.xml`]: { status: 200, text: `<sitemapindex><sitemap><loc>${O}/sitemaps/static.xml</loc></sitemap><sitemap><loc>${O}/sitemaps/videos-0.xml</loc></sitemap><sitemap><loc>${O}/sitemaps/gone.xml</loc></sitemap></sitemapindex>` },
      [`${O}/sitemaps/static.xml`]: { status: 200, text: `<urlset><url><loc>${O}/en</loc></url></urlset>` },
      [`${O}/sitemaps/videos-0.xml`]: { status: 200, text: `<urlset><url><loc>${URL_EN}</loc></url><url><loc>${O}/en/video/v2</loc></url></urlset>` },
      [`${O}/sitemaps/gone.xml`]: { status: 404, text: '' },
      [`${O}/en`]: { status: 200, text: good(`${O}/en`) },
      [URL_EN]: { status: 200, text: good() },
      [`${O}/en/video/v2`]: { status: 308, text: '', headers: { location: `${O}/en/shorts/v2` } },
      'https://www.alummahnow.net/robots.txt': { status: 200, text: 'User-agent: *\nAllow: /\n' },
      'https://www.alummahnow.net/sitemap.xml': { status: 500, text: '' },
    };
    const requested: string[] = [];
    const get = async (url: string) => {
      requested.push(url);
      const p = pages[url];
      if (!p) throw new Error(`unexpected ${url}`);
      return { status: p.status, headers: new Headers(p.headers ?? {}), text: p.text };
    };
    const { checked, findings } = await crawl(['videos.alummahnow.net', 'www.alummahnow.net'], 50, 1, get);
    assert.equal(checked, 3);
    assert.deepEqual(findings.map((f) => `${f.url} ${f.problem}`).sort(), [
      `${O}/en/video/v2 308 redirect to ${O}/en/shorts/v2 (sitemaps must list final URLs)`,
      `${O}/sitemaps/gone.xml sitemap file HTTP 404`,
      'https://www.alummahnow.net/robots.txt no Sitemap: line (HTTP 200)',
      'https://www.alummahnow.net/sitemap.xml sitemap HTTP 500',
    ]);
    assert.ok(requested.every((u) => u.startsWith('https://')));
  });

  it('the issue body is a table that escapes pipes and is capped', () => {
    const body = issueBody([{ url: 'https://a/x|y', problem: 'HTTP 500' }], 200, ['a'], 'https://run', '2026-11-14');
    assert.match(body, /sampled 200 pages from the sitemaps of a and found 1 problem\./);
    assert.match(body, /\| https:\/\/a\/x\\\|y \| HTTP 500 \|/);
    const many = issueBody(Array.from({ length: 205 }, (_, i) => ({ url: `u${i}`, problem: 'p' })), 200, ['a'], 'r', 'd');
    assert.match(many, /…and 5 more/);
  });
});
