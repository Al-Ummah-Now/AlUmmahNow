/**
 * What a search engine sees (wiki AUN-SEO): the server HTML of the indexable pages, their status
 * codes, robots.txt and the sitemaps, fetched like a crawler (no browser, no JavaScript), in English
 * and in Arabic.
 *
 *   watch, channel (@handle), playlist and post permalink pages:
 *     200, a title with the site suffix, one meta description of at most 160 characters, exactly one
 *     absolute canonical on this host with no query, en/ar/x-default hreflang that point at each
 *     other, at most one robots meta, an og:image that is a real image of the size it declares,
 *     and JSON-LD with the fields Google needs (VideoObject, SocialMediaPosting)
 *   missing, private and deleted videos: 404, purged ones 410; the legacy ?vid= URL 301s and
 *     /channels/<id> 308s to the @handle
 *   non-production: every page says noindex and robots.txt disallows everything
 *   sitemap.xml lists its files, and they list this spec's own video, channel, playlist and post
 *
 * Everything it reads is its own: one creator with a video, a private video, a deleted video, a
 * playlist and a post, removed by the data scope.
 */
import { expect } from '@playwright/test';
import { test, ns, useOwnData, onLocalStack, type Creator, type CreatedVideo } from './builders';
import { releaseEnv, target } from './targets';
import { apiFetch } from './web-session';

// Signs a user up through the auth server: traces would hold the password and code
test.use({ trace: 'off' });

const LOCALES = ['en', 'ar'] as const;
type Locale = (typeof LOCALES)[number];
const SITE_NAME: Record<Locale, string> = { en: 'Al Ummah Now', ar: 'الأمة الآن' };
const DESCRIPTION_MAX = 160;
/** Longer than any meta description may be: the page must clip it. */
const LONG_DESCRIPTION = `${'This description runs well past the length a search result shows, so the page has to clip it at a word. '.repeat(4)}End.`;

const decode = (s: string) =>
  s
    .replace(/&quot;/g, '"')
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');

/** Every tag of one name with its attributes (lower-cased names, decoded values). */
function tags(html: string, name: 'meta' | 'link'): Record<string, string>[] {
  const out: Record<string, string>[] = [];
  for (const match of html.matchAll(new RegExp(`<${name}\\s([^>]*?)\\/?>`, 'gi'))) {
    const attrs: Record<string, string> = {};
    for (const a of match[1].matchAll(/([a-zA-Z:-]+)="([^"]*)"/g)) attrs[a[1].toLowerCase()] = decode(a[2]);
    out.push(attrs);
  }
  return out;
}

const metas = (html: string, key: 'name' | 'property', value: string) => tags(html, 'meta').filter((m) => m[key] === value).map((m) => m.content ?? '');

/** Every JSON-LD node in the page, @graph and arrays flattened. */
function jsonLd(html: string): Record<string, unknown>[] {
  const nodes: Record<string, unknown>[] = [];
  const walk = (v: unknown) => {
    if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === 'object') {
      const node = v as Record<string, unknown>;
      if (Array.isArray(node['@graph'])) walk(node['@graph']);
      if (node['@type']) nodes.push(node);
    }
  };
  for (const m of html.matchAll(/<script type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g)) walk(JSON.parse(m[1]));
  return nodes;
}

/** Width and height of a JPEG, PNG or WebP; null for anything else. */
function imageSize(b: Buffer): { width: number; height: number } | null {
  if (b.length > 24 && b.readUInt32BE(0) === 0x89504e47) return { width: b.readUInt32BE(16), height: b.readUInt32BE(20) };
  if (b.length > 30 && b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP') {
    const chunk = b.toString('ascii', 12, 16);
    if (chunk === 'VP8 ') return { width: b.readUInt16LE(26) & 0x3fff, height: b.readUInt16LE(28) & 0x3fff };
    if (chunk === 'VP8L') {
      const bits = b.readUInt32LE(21);
      return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
    }
    if (chunk === 'VP8X') return { width: 1 + b.readUIntLE(24, 3), height: 1 + b.readUIntLE(27, 3) };
    return null;
  }
  if (b[0] !== 0xff || b[1] !== 0xd8) return null;
  let i = 2;
  while (i + 9 < b.length) {
    if (b[i] !== 0xff) return null;
    const marker = b[i + 1];
    const length = b.readUInt16BE(i + 2);
    // Start of frame (baseline, progressive, ...), not DHT/JPG/DAC
    if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) return { width: b.readUInt16BE(i + 7), height: b.readUInt16BE(i + 5) };
    i += 2 + length;
  }
  return null;
}

/** A crawler's GET: no redirects followed, no cache. */
const crawl = (url: string) => fetch(url, { redirect: 'manual', cache: 'no-store', headers: { 'User-Agent': 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)' } });

async function expectImage(url: string, what: string): Promise<{ width: number; height: number }> {
  const res = await fetch(url, { cache: 'no-store' });
  expect(res.status, `${what} ${url}`).toBe(200);
  expect(res.headers.get('content-type') ?? '', `${what} content type`).toMatch(/^image\//);
  const size = imageSize(Buffer.from(await res.arrayBuffer()));
  expect(size, `${what} is a readable JPEG/PNG/WebP`).not.toBeNull();
  return size as { width: number; height: number };
}

interface PageCheck {
  html: string;
  canonical: string;
  alternates: Record<string, string>;
}

/**
 * The checks every indexable page passes: status, robots, title, description, canonical, hreflang,
 * og:image. Returns the parsed page for the page-specific checks.
 */
async function expectIndexablePage(locale: Locale, path: string, what: string): Promise<PageCheck> {
  const web = target().web;
  const url = `${web}/${locale}${path}`;
  const res = await crawl(url);
  expect(res.status, `${what}: ${url}`).toBe(200);
  const html = await res.text();
  const label = `${what} (${locale})`;

  // Robots: non-production says noindex in the header; a page never carries two robots metas
  const robotsMetas = metas(html, 'name', 'robots');
  expect(robotsMetas.length, `${label}: robots metas`).toBeLessThanOrEqual(1);
  if (releaseEnv() !== 'production') expect(res.headers.get('x-robots-tag') ?? '', `${label}: X-Robots-Tag`).toContain('noindex');
  else expect(robotsMetas[0] ?? '', `${label}: robots meta`).not.toContain('noindex');

  const title = decode(/<title[^>]*>([^<]*)<\/title>/.exec(html)?.[1] ?? '');
  expect(title.endsWith(` | ${SITE_NAME[locale]}`), `${label}: title "${title}"`).toBe(true);
  expect(title.length, `${label}: title has more than the suffix`).toBeGreaterThan(` | ${SITE_NAME[locale]}`.length);
  expect(html.match(/<title[^>]*>/g)?.length, `${label}: one <title>`).toBe(1);

  const descriptions = metas(html, 'name', 'description');
  expect(descriptions.length, `${label}: meta descriptions`).toBe(1);
  expect(descriptions[0].length, `${label}: description "${descriptions[0]}"`).toBeGreaterThan(0);
  expect(descriptions[0].length, `${label}: description length`).toBeLessThanOrEqual(DESCRIPTION_MAX);

  const links = tags(html, 'link');
  const canonicals = links.filter((l) => l.rel === 'canonical').map((l) => l.href);
  expect(canonicals.length, `${label}: canonicals`).toBe(1);
  const canonical = new URL(canonicals[0]);
  expect(canonical.origin, `${label}: canonical host`).toBe(new URL(web).origin);
  expect(canonical.search, `${label}: canonical has no query`).toBe('');
  expect(canonical.pathname.startsWith(`/${locale}/`), `${label}: canonical ${canonical.href} is this language's`).toBe(true);

  const alternates: Record<string, string> = {};
  for (const l of links.filter((x) => x.rel === 'alternate' && x.hreflang)) alternates[l.hreflang] = l.href;
  expect(Object.keys(alternates).sort(), `${label}: hreflang set`).toEqual(['ar', 'en', 'x-default']);
  expect(alternates[locale], `${label}: hreflang ${locale} is the canonical`).toBe(canonical.href);
  expect(alternates['x-default'], `${label}: x-default is English`).toBe(alternates.en);

  const ogImages = metas(html, 'property', 'og:image');
  expect(ogImages.length, `${label}: og:image`).toBeGreaterThanOrEqual(1);
  const declaredWidth = Number(metas(html, 'property', 'og:image:width')[0]);
  const declaredHeight = Number(metas(html, 'property', 'og:image:height')[0]);
  const actual = await expectImage(new URL(ogImages[0], web).href, `${label}: og:image`);
  // A declared size is what a share card lays out: the image must have that shape (±2%)
  if (declaredWidth && declaredHeight) {
    expect(Math.abs(actual.width / actual.height - declaredWidth / declaredHeight), `${label}: og:image ${actual.width}x${actual.height} vs declared ${declaredWidth}x${declaredHeight}`).toBeLessThan(
      0.02 * (declaredWidth / declaredHeight),
    );
  }
  return { html, canonical: canonical.href, alternates };
}

/** Both languages of one page name the same en/ar pair, each its own canonical. */
async function expectReciprocal(path: string, what: string): Promise<Record<Locale, PageCheck>> {
  const pages = {} as Record<Locale, PageCheck>;
  for (const locale of LOCALES) pages[locale] = await expectIndexablePage(locale, path, what);
  expect(pages.en.alternates, `${what}: en and ar pages name the same hreflang set`).toEqual(pages.ar.alternates);
  expect(pages.ar.alternates.en, `${what}: the ar page's en alternate is the en canonical`).toBe(pages.en.canonical);
  expect(pages.en.alternates.ar, `${what}: the en page's ar alternate is the ar canonical`).toBe(pages.ar.canonical);
  return pages;
}

/** All <loc>s of the sitemap files of one kind (the index lists them). */
async function sitemapLocs(kind: 'videos' | 'channels' | 'playlists' | 'posts'): Promise<string[]> {
  const index = await (await crawl(`${target().web}/sitemap.xml`)).text();
  const files = [...index.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => decode(m[1])).filter((loc) => new URL(loc).pathname.includes(`/${kind}-`));
  const locs: string[] = [];
  for (const file of files) {
    const xml = await (await crawl(file)).text();
    locs.push(...[...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => decode(m[1])));
  }
  return locs;
}

test.describe.serial('SEO: what crawlers see', () => {
  test.skip(!onLocalStack(), 'own-data crawler checks run on the local stack against this PR\'s build; stage gets them through Local E2E in the release');

  const data = useOwnData(test);
  let creator: Creator;
  let channelId: string;
  let handle: string | undefined;
  let video: CreatedVideo;
  let playlistId: string;
  let postId: string;

  test.beforeAll(async ({ browser }) => {
    test.setTimeout(300000);
    creator = await data.createCreator(browser, 'seo');
    channelId = creator.channelIds[0];
    video = await data.createVideo(creator.user, channelId, { title: `SEO watch ${ns()}` });
    const update = await apiFetch(creator.user, `/api/videos/${video.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', channelId },
      body: JSON.stringify({ description: LONG_DESCRIPTION }),
    });
    expect(update.status, `PUT description: ${await update.clone().text()}`).toBeLessThan(300);
    playlistId = await data.createPlaylist(creator.user, channelId, { title: `SEO playlist ${ns()}`, videoIds: [video.id], isPublic: true });
    postId = await data.createPost(creator.user, channelId, { text: `SEO post ${ns()} with enough words to make a headline and a description.` });
    const channel = (await (await apiFetch(creator.user, `/api/channels/${channelId}`)).json()) as { result?: { handle?: string }; handle?: string };
    handle = channel.result?.handle ?? channel.handle;
  });

  test('watch page: canonical, hreflang, description, VideoObject, player card', async () => {
    const pages = await expectReciprocal(`/video/${video.id}`, 'watch');
    for (const locale of LOCALES) {
      const { html } = pages[locale];
      const description = metas(html, 'name', 'description')[0];
      // The long description is clipped at a word with an ellipsis, not cut mid-word
      expect(description.endsWith('…'), `watch (${locale}): clipped description "${description}"`).toBe(true);
      expect(metas(html, 'name', 'twitter:card')[0], `watch (${locale}): twitter:card`).toBe('player');

      const videoNode = jsonLd(html).find((n) => n['@type'] === 'VideoObject');
      expect(videoNode, `watch (${locale}): VideoObject`).toBeTruthy();
      for (const field of ['name', 'description', 'thumbnailUrl', 'uploadDate', 'embedUrl']) {
        expect(videoNode?.[field], `watch (${locale}): VideoObject.${field}`).toBeTruthy();
      }
      expect(videoNode?.name).toBe(video.title);
      const thumbs = ([] as unknown[]).concat(videoNode?.thumbnailUrl).map(String);
      for (const thumb of thumbs) {
        // A thumbnail URL Google keeps must not carry a signed token that expires
        expect(new URL(thumb).search, `watch (${locale}): thumbnailUrl ${thumb} has no token`).not.toMatch(/token|expires|signature/i);
        await expectImage(thumb, `watch (${locale}): VideoObject.thumbnailUrl`);
      }
      expect(Number.isNaN(Date.parse(String(videoNode?.uploadDate))), `watch (${locale}): uploadDate parses`).toBe(false);

      // Server HTML has the title heading and the channel link (no JavaScript needed)
      expect(html, `watch (${locale}): SSR <h1> with the title`).toMatch(new RegExp(`<h1[^>]*>[^<]*${video.title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));
      expect(html, `watch (${locale}): SSR channel link`).toMatch(new RegExp(`href="/${locale}/(@[^"/]+|channels/${channelId})"`));
    }
  });

  test('channel page: the @handle URL is canonical; /channels/<id> 308s to it', async () => {
    expect(handle, 'the creator\'s channel has a handle').toBeTruthy();
    await expectReciprocal(`/@${handle}`, 'channel');
    for (const locale of LOCALES) {
      const res = await crawl(`${target().web}/${locale}/channels/${channelId}`);
      expect(res.status, `/${locale}/channels/<id>`).toBe(308);
      expect(new URL(res.headers.get('location') ?? '', target().web).pathname).toBe(`/${locale}/@${encodeURIComponent(handle as string)}`);
    }
  });

  test('playlist page', async () => {
    await expectReciprocal(`/playlist/${playlistId}`, 'playlist');
  });

  test('post permalink: SocialMediaPosting', async () => {
    // The post id alone finds its channel once the post is indexed
    await expect.poll(async () => (await crawl(`${target().web}/en/post/${postId}`)).status, { timeout: 60000 }).toBe(200);
    const pages = await expectReciprocal(`/post/${postId}`, 'post');
    for (const locale of LOCALES) {
      const post = jsonLd(pages[locale].html).find((n) => n['@type'] === 'SocialMediaPosting');
      expect(post, `post (${locale}): SocialMediaPosting`).toBeTruthy();
      for (const field of ['headline', 'datePublished', 'author', 'url']) expect(post?.[field], `post (${locale}): SocialMediaPosting.${field}`).toBeTruthy();
      expect(post?.url).toBe(pages[locale].canonical);
    }
  });

  test('missing, private and deleted pages are 404, purged 410; legacy ?vid= 301s', async () => {
    test.setTimeout(180000);
    const web = target().web;
    const priv = await data.createVideo(creator.user, channelId, { title: `SEO private ${ns()}`, isPublic: false, waitReady: false });
    const doomed = await data.createVideo(creator.user, channelId, { title: `SEO deleted ${ns()}`, waitReady: false });
    const trash = await apiFetch(creator.user, `/api/videos/${doomed.id}`, { method: 'DELETE', headers: { channelId } });
    expect(trash.status, 'trash').toBeLessThan(300);

    for (const locale of LOCALES) {
      for (const [path, what] of [
        [`/video/does-not-exist-${Date.now().toString(36)}`, 'missing video'],
        [`/video/${priv.id}`, 'private video'],
        [`/video/${doomed.id}`, 'deleted (restorable) video'],
        [`/playlist/does-not-exist-${Date.now().toString(36)}`, 'missing playlist'],
        [`/post/does-not-exist-${Date.now().toString(36)}`, 'missing post'],
      ]) {
        const res = await crawl(`${web}/${locale}${path}`);
        expect(res.status, `${what} (${locale})`).toBe(404);
        expect(await res.text(), `${what} (${locale}) names nothing`).not.toContain(priv.title);
      }
      const legacy = await crawl(`${web}/${locale}/video?vid=${video.id}`);
      expect(legacy.status, `legacy ?vid= (${locale})`).toBe(301);
      expect(new URL(legacy.headers.get('location') ?? '', web).pathname).toBe(`/${locale}/video/${video.id}`);
    }

    // Deleted for good: 410 so crawlers drop it
    const purge = await apiFetch(creator.user, `/api/videos/${doomed.id}/permanent`, { method: 'DELETE', headers: { channelId } });
    expect(purge.status, 'permanent delete').toBeLessThan(300);
    for (const locale of LOCALES) {
      await expect.poll(async () => (await crawl(`${web}/${locale}/video/${doomed.id}`)).status, { message: `purged video (${locale})`, timeout: 60000 }).toBe(410);
    }
  });

  test('robots.txt and sitemaps list this spec\'s own pages', async () => {
    test.setTimeout(240000);
    const web = target().web;
    const robots = await crawl(`${web}/robots.txt`);
    expect(robots.status).toBe(200);
    const robotsText = await robots.text();
    if (releaseEnv() !== 'production') {
      expect(robotsText).toMatch(/User-agent: \*\s*\nDisallow: \/\s*$/m);
      expect(robotsText).not.toMatch(/Sitemap:/i);
    }

    const index = await crawl(`${web}/sitemap.xml`);
    expect(index.status).toBe(200);
    expect(index.headers.get('content-type') ?? '').toMatch(/xml/);
    const indexXml = await index.text();
    expect(indexXml).toContain('<sitemapindex');

    // Sitemap files are cached for an hour at the edge: poll until the new items are listed
    const expected: [Parameters<typeof sitemapLocs>[0], RegExp][] = [
      ['videos', new RegExp(`/(en|ar)/video/${video.id}$`)],
      ['channels', handle ? new RegExp(`/(en|ar)/@${encodeURIComponent(handle)}$`) : new RegExp(`/(en|ar)/channels/${channelId}$`)],
      ['playlists', new RegExp(`/(en|ar)/playlist/${playlistId}$`)],
      ['posts', new RegExp(`/(en|ar)/post/${postId}$`)],
    ];
    for (const [kind, pattern] of expected) {
      let own: string[] = [];
      await expect
        .poll(
          async () => {
            own = (await sitemapLocs(kind)).filter((loc) => pattern.test(loc));
            return own.length;
          },
          { message: `${kind} sitemap lists this spec's item in en and ar`, timeout: 120000, intervals: [2000, 5000, 10000] },
        )
        .toBe(2);
      for (const loc of own) {
        expect(new URL(loc).origin, `${kind} <loc> host`).toBe(new URL(web).origin);
        const res = await crawl(loc);
        expect(res.status, `${kind} <loc> ${loc}`).toBe(200);
      }
    }
  });
});
