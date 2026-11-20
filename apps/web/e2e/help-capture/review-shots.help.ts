/**
 * Owner review shots for #1669 (tab and chip strips never half cut on phones). Throwaway review
 * branches only (REVIEW_SHOTS=1 in help-pictures.yml), run once on main (before) and once on the PR
 * (after): CI local stack, production build, NEXTJS_ENV=production, real sign-in, data made here and
 * deleted at the end. Viewport frames only; light/dark through Playwright colorScheme.
 * Output: test-results/review-shots/<area>/<screen>-<lang>-<device>-<mode>.png, strips.json (every
 * tab/chip's box and whether it is cut) and digits.json (Latin digits on Arabic frames).
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test, type Browser, type BrowserContext, type Page, type Route } from '@playwright/test';
import { useOwnData, type Creator } from '../release/builders';
import { apiFetch } from '../release/web-session';
import { target } from '../release/targets';
import { tabsAndChipsInView } from '../test-utils/tabs-in-viewport';

type Lang = 'en' | 'ar';
type Device = 'desktop' | 'phone';
type Mode = 'light' | 'dark';
const LANGS: Lang[] = ['en', 'ar'];
const DEVICES: Device[] = ['phone', 'desktop'];
const MODES: Mode[] = ['light', 'dark'];
const OUT = join(__dirname, '../../test-results/review-shots');
const CHANNEL = {
  name: { en: 'Community Corner', ar: 'ركن المجتمع' },
  description: { en: 'Weekly talks, Q&A and news from our community.', ar: 'لقاءات أسبوعية وأسئلة وأجوبة وأخبار من مجتمعنا.' },
};
const ALL_TABS = ['home', 'videos', 'shorts', 'live', 'playlists', 'community', 'channels', 'about'];
/**
 * Real-looking content (audit r1: an empty channel read as broken): four published videos whose
 * thumbnails are the owner's lantern art (packages/app-icons/assets/crops, crop and resize only),
 * served in place of the fake CDN's test pattern, as capture.help.ts does, and some views.
 */
const ART = join(__dirname, '../../../../packages/app-icons/assets/crops');
const FAKE_CDN_HOST = 'vz-local-stack.b-cdn.net';
const DEMOS = [
  { key: 'street', art: 'tools.webp', title: { en: 'Lantern street at night', ar: 'شارع الفوانيس ليلًا' }, views: 34 },
  { key: 'evening', art: 'auth.webp', title: { en: 'Evening lights in the old town', ar: 'أضواء المساء في البلدة القديمة' }, views: 21 },
  { key: 'writing', art: 'cms.webp', title: { en: 'Writing by lantern light', ar: 'الكتابة على ضوء الفانوس' }, views: 12 },
  { key: 'tour', art: 'videos-admin.webp', title: { en: 'A walk through the market', ar: 'جولة في السوق' }, views: 8 },
] as const;
const MEDIA = mkdtempSync(join(tmpdir(), 'tabs-media-'));
const demoByGuid = new Map<string, string>();
const demoById = new Map<string, string>();
const demoIds: string[] = [];
function makeThumb(key: string, art: string): void {
  mkdirSync(join(MEDIA, key), { recursive: true });
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', join(ART, art), '-vf', 'scale=960:960,crop=960:540:0:165', '-q:v', '3', join(MEDIA, key, 'thumbnail.jpg')]);
}
const keyFor = (id: string) => DEMOS[(id.charCodeAt(0) || 0) % DEMOS.length].key;
async function serveCdn(route: Route): Promise<void> {
  const parts = new URL(route.request().url()).pathname.split('/').filter(Boolean);
  const file = parts[parts.length - 1] ?? '';
  if (!/^thumbnail(_\d+)?\.jpg$|^preview\.webp$/.test(file)) return route.continue();
  const guid = parts.find((p) => demoByGuid.has(p)) ?? parts.find((p) => /^[0-9a-f-]{36}$/i.test(p));
  if (!guid) return route.continue();
  const path = join(MEDIA, demoByGuid.get(guid) ?? keyFor(guid), 'thumbnail.jpg');
  if (!existsSync(path)) return route.continue();
  return route.fulfill({ status: 200, headers: { 'content-type': 'image/jpeg', 'access-control-allow-origin': '*', 'cache-control': 'no-store' }, body: readFileSync(path) });
}
async function serveThumb(route: Route): Promise<void> {
  const id = decodeURIComponent(new URL(route.request().url()).pathname.split('/').pop() ?? '').replace(/\.jpg$/, '');
  const path = join(MEDIA, demoById.get(id) ?? keyFor(id), 'thumbnail.jpg');
  if (!existsSync(path)) return route.continue();
  return route.fulfill({ status: 200, headers: { 'content-type': 'image/jpeg', 'cache-control': 'no-store' }, body: readFileSync(path) });
}
async function cdnGuid(id: string): Promise<string | null> {
  const body = (await (await fetch(`${target().api}/api/videos/${id}`, { cache: 'no-store' })).json().catch(() => ({}))) as Record<string, unknown> & { result?: Record<string, unknown> };
  const video = (body.result ?? body) as Record<string, unknown>;
  for (const field of ['playUrl', 'thumbnailUrl', 'hlsUrl', 'thumbnail']) {
    const value = video[field];
    if (typeof value !== 'string') continue;
    const parts = new URL(value, target().web).pathname.split('/').filter((p) => p && !p.startsWith('bcdn_token='));
    if (parts.length >= 2) return parts[parts.length - 2];
  }
  return null;
}
const data = useOwnData(test as never);
let creator: Creator;
const digits: Record<string, string[]> = {};
const strips: Record<string, unknown> = {};
const problems: string[] = [];

test.describe.configure({ mode: 'serial' });

test.beforeAll(async ({ browser }) => {
  test.setTimeout(10 * 60_000);
  for (const demo of DEMOS) makeThumb(demo.key, demo.art);
  creator = await data.createCreator(browser, 'tabs', { channels: 1 });
  const user = creator.user;
  const put = (path: string, body: unknown, channelId?: string) => apiFetch(user, path, { method: 'PUT', headers: { 'Content-Type': 'application/json', ...(channelId ? { channelId } : {}) }, body: JSON.stringify(body) });
  expect((await put('/api/profile', { displayName: 'Amina Yusuf', displayNameLocalized: { en: 'Amina Yusuf', ar: 'أمينة يوسف' }, firstName: 'Amina', lastName: 'Yusuf' })).status).toBeLessThan(300);
  const channel = creator.channelIds[0];
  const named = await put(`/api/channels/${channel}`, { name: CHANNEL.name.en, nameLocalized: CHANNEL.name, description: CHANNEL.description.en, descriptionLocalized: CHANNEL.description }, channel);
  expect(named.status, await named.clone().text()).toBeLessThan(300);
  const tabs = await put(`/api/channels/${channel}/tabs`, { defaultTab: 'home', tabs: ALL_TABS.map((id, position) => ({ id, visible: true, position })) }, channel);
  expect(tabs.status, await tabs.clone().text()).toBeLessThan(300);
  for (const demo of [...DEMOS].reverse()) {
    const video = await data.createVideo(user, channel, { clip: 'landscape40', isPublic: true, title: demo.title.en, waitReady: true });
    expect((await put(`/api/videos/${video.id}`, { titleLocalized: demo.title }, channel)).status).toBeLessThan(300);
    const guid = await cdnGuid(video.id);
    if (guid) demoByGuid.set(guid, demo.key);
    else problems.push(`no CDN guid for ${demo.key}: its thumbnail is the test pattern`);
    demoById.set(video.id, demo.key);
    demoIds.push(video.id);
    for (let i = 0; i < demo.views; i++) {
      await apiFetch(user, `/api/videos/${video.id}/view`, { method: 'POST', headers: { 'Content-Type': 'application/json', channelId: channel }, body: JSON.stringify({ watchTime: 25 }) });
    }
  }
  // Let the processor count the views (analytics) and the search index take the videos
  await new Promise((r) => setTimeout(r, 20_000));
});

async function open(browser: Browser, lang: Lang, device: Device, mode: Mode, signedIn: boolean): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext({
    proxy: { server: 'http://127.0.0.1:3191', bypass: 'localhost,127.0.0.1' },
    ignoreHTTPSErrors: true,
    storageState: signedIn ? creator.state : { cookies: [], origins: [] },
    ...(device === 'phone'
      ? { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true }
      : { viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 }),
    colorScheme: mode,
    reducedMotion: 'reduce',
    locale: lang === 'ar' ? 'ar' : 'en-US',
  });
  await context.addCookies([{ name: 'aun_consent', value: `v1.a0.e0.p0.${Date.now()}`, url: target().web, sameSite: 'Lax' }]);
  await context.route((url) => url.hostname === FAKE_CDN_HOST, serveCdn);
  await context.route((url) => url.pathname.startsWith('/thumb/'), serveThumb);
  // Only this run's videos (the stack's seed videos carry test titles)
  await context.addInitScript((ids: string[]) => {
    const idOf = (el: Element) => el.getAttribute('data-video-id') || decodeURIComponent((el.getAttribute('href') ?? el.querySelector('a[href*="/video/"]')?.getAttribute('href') ?? '').split('/video/')[1]?.split(/[?#/]/)[0] ?? '');
    const hide = () => document.querySelectorAll<HTMLElement>('[data-testid="related-video"], [data-testid="video-card"], [data-testid="search-result-video"]').forEach((el) => {
      const id = idOf(el);
      if (id && !ids.includes(id)) ((el.closest('li') as HTMLElement | null) ?? el).style.display = 'none';
    });
    new MutationObserver(hide).observe(document, { subtree: true, childList: true });
  }, demoIds);
  const page = await context.newPage();
  page.setDefaultTimeout(30_000);
  return { context, page };
}

async function settle(page: Page, path: string, lang: Lang): Promise<void> {
  await page.goto(`/${lang}${path}`, { waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => undefined);
  // Signed in: the account menu; signed out: the header's Sign in
  await expect(page.locator('[data-testid="nav-menu-trigger"]:visible, [data-testid="header-sign-in"]:visible').first()).toBeVisible({ timeout: 30_000 });
  await page.evaluate(() => document.fonts.ready);
}

async function shoot(page: Page, dir: string, file: string, lang: Lang): Promise<void> {
  await page.evaluate(() => {
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (node.textContent && /e2e\.alummahnow\.net|^e2e\+/.test(node.textContent)) node.textContent = node.textContent.replace(/e2e\+[^@\s]*/g, 'amina').replace(/@?e2e\.alummahnow\.net/g, '@example.com');
    }
    document.querySelectorAll<HTMLElement>('body *').forEach((el) => { if (el.childElementCount === 0 && /@\s*E2E[\w-]+/i.test(el.textContent ?? '')) el.textContent = (el.textContent ?? '').replace(/@\s*E2E[\w-]+/gi, '@communitycorner'); });
  });
  await page.mouse.move(1, 1);
  await page.waitForTimeout(300);
  const sideways = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  if (sideways > 0) problems.push(`${dir}/${file}: page scrolls sideways by ${sideways}px`);
  strips[`${dir}/${file}`] = await tabsAndChipsInView(page);
  if (lang === 'ar') {
    const found = await page.evaluate(() => {
      const out: string[] = [];
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        const text = node.textContent ?? '';
        if (!/[0-9]/.test(text)) continue;
        const el = node.parentElement;
        if (!el || el.closest('script,style,code')) continue;
        const r = el.getBoundingClientRect();
        if (r.width < 1 || r.height < 1 || r.bottom < 0 || r.top > innerHeight) continue;
        out.push(`${el.tagName.toLowerCase()}: ${text.trim().slice(0, 80)}`);
      }
      return out;
    });
    if (found.length) digits[`${dir}/${file}`] = found;
  }
  mkdirSync(join(OUT, dir), { recursive: true });
  await page.screenshot({ path: join(OUT, dir, `${file}.png`), animations: 'disabled', caret: 'hide' });
}

function each(name: string, signedIn: boolean, body: (page: Page, lang: Lang, tag: string) => Promise<void>) {
  for (const lang of LANGS) test(`${name} ${lang}`, async ({ browser }) => {
    test.setTimeout(20 * 60_000);
    for (const device of DEVICES) for (const mode of MODES) {
      const tag = `${lang}-${device}-${mode}`;
      const { context, page } = await open(browser, lang, device, mode, signedIn);
      try {
        await body(page, lang, tag);
      } catch (error) {
        problems.push(`${name} ${tag}: ${(error as Error).message.split('\n').slice(0, 3).join(' ')}`);
      } finally {
        await context.close();
      }
    }
  });
}

// Public page: signed out. The tab strip just under the channel header, the whole strip in view
each('channel', false, async (page, lang, tag) => {
  await settle(page, `/channels/${creator.channelIds[0]}`, lang);
  await expect(page.getByTestId('channel-tabs').getByRole('tab')).toHaveCount(ALL_TABS.length, { timeout: 15_000 });
  await page.waitForTimeout(400);
  await shoot(page, 'channel', `channel-tabs-${tag}`, lang);
});

each('search', false, async (page, lang, tag) => {
  await settle(page, `/search?q=${encodeURIComponent(lang === 'ar' ? 'الفوانيس' : 'lantern')}`, lang);
  await expect(page.getByTestId('search-type-all')).toBeVisible();
  await page.waitForTimeout(400);
  await shoot(page, 'search', `search-type-chips-${tag}`, lang);
});

each('studio-analytics', true, async (page, lang, tag) => {
  await settle(page, `/studio/${creator.channelIds[0]}/analytics`, lang);
  await expect(page.getByTestId('studio-analytics')).toBeVisible();
  await expect(page.getByTestId('studio-analytics-loading')).toHaveCount(0, { timeout: 30_000 });
  // The metric chips (no test id on main): the group of toggle buttons, mid-window, no line half
  // under the header or the bottom tab bar (audit r1)
  const metrics = page.locator('[data-testid="studio-analytics"] [role="group"]:has(> button[aria-pressed])').first();
  await expect(metrics).toBeVisible();
  await metrics.evaluate((el) => el.setAttribute('data-review-centre', ''));
  await centre(page, '[data-review-centre]');
  await shoot(page, 'studio-analytics', `analytics-metrics-${tag}`, lang);
});

async function centre(page: Page, selector: string): Promise<void> {
  await page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!el) return;
    // The element that actually scrolls (the page, or an inner scroll box around the field)
    let scroller: Element = document.scrollingElement ?? document.documentElement;
    for (let e = el.parentElement; e && e !== document.body; e = e.parentElement) {
      const cs = getComputedStyle(e);
      if (/(auto|scroll)/.test(cs.overflowY) && e.scrollHeight > e.clientHeight + 2) { scroller = e; break; }
    }
    el.scrollIntoView({ block: 'center' });
    const bars = [...document.querySelectorAll<HTMLElement>('body *')].filter((e) => {
      const pos = getComputedStyle(e).position;
      if (pos !== 'fixed' && pos !== 'sticky') return false;
      const b = e.getBoundingClientRect();
      return b.width >= innerWidth * 0.6 && b.height > 20 && b.height < innerHeight * 0.3 && (b.top <= 1 || b.bottom >= innerHeight - 1);
    }).map((e) => e.getBoundingClientRect());
    const top = Math.max(0, ...bars.filter((b) => b.top <= 1).map((b) => b.bottom));
    const bottom = Math.min(innerHeight, ...bars.filter((b) => b.bottom >= innerHeight - 1).map((b) => b.top));
    const cut = (): number => {
      let n = 0;
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        const p = node.parentElement;
        if (!node.textContent?.trim() || !p) continue;
        const pos = getComputedStyle(p).position;
        if (pos === 'fixed' || pos === 'sticky' || p.closest('[style*="position: fixed"]')) continue;
        if (bars.some((b) => { const r2 = p.getBoundingClientRect(); return r2.top >= b.top && r2.bottom <= b.bottom && b.height < innerHeight * 0.3 && (p.closest('header, nav') !== null); })) continue;
        const range = document.createRange();
        range.selectNodeContents(node);
        for (const b of range.getClientRects()) {
          if (b.height <= 0 || b.width <= 0) continue;
          if ((b.top < top && b.bottom > top) || (b.top < bottom && b.bottom > bottom)) n++;
        }
      }
      for (const f of document.querySelectorAll('input, select, textarea')) {
        const b = f.getBoundingClientRect();
        if (b.height > 0 && ((b.top < top && b.bottom > top) || (b.top < bottom && b.bottom > bottom))) n++;
      }
      // Buttons and other controls too
      for (const f of document.querySelectorAll('button, a[href]')) {
        const b = f.getBoundingClientRect();
        const pos = getComputedStyle(f).position;
        if (b.height > 0 && pos !== 'fixed' && !f.closest('header, nav, [role="banner"]') && ((b.top < top && b.bottom > top) || (b.top < bottom && b.bottom > bottom))) n++;
      }
      return n;
    };
    // The field stays in the middle half of the window
    const keep = () => { const r2 = el.getBoundingClientRect(); return r2.top > innerHeight * 0.25 && r2.bottom < innerHeight * 0.75; };
    const y0 = scroller.scrollTop;
    let best = y0;
    let bestN = Infinity;
    for (const d of [0, ...Array.from({ length: 100 }, (_, k) => [(k + 1) * 2, -(k + 1) * 2]).flat()]) {
      scroller.scrollTop = y0 + d;
      if (!keep()) continue;
      const n = cut();
      if (n < bestN) { bestN = n; best = scroller.scrollTop; }
      if (n === 0) break;
    }
    scroller.scrollTop = best;
  }, selector);
  await page.waitForTimeout(200);
}


test('every shot was made', () => {
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, 'digits.json'), JSON.stringify(digits, null, 2));
  writeFileSync(join(OUT, 'strips.json'), JSON.stringify(strips, null, 2));
  expect(problems, problems.join('\n')).toEqual([]);
});
