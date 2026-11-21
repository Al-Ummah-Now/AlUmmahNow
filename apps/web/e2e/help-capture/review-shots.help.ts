/**
 * Owner review shots for #1669 (tab and chip strips never half cut on phones). Throwaway review
 * branches only (REVIEW_SHOTS=1 in help-pictures.yml), run once on main (before) and once on the PR
 * (after): CI local stack, production build, NEXTJS_ENV=production, real sign-in, data made here and
 * deleted at the end. Viewport frames only; light/dark through Playwright colorScheme.
 * Output: test-results/review-shots/<area>/<screen>-<lang>-<device>-<mode>.png, strips.json (every
 * tab/chip's box and whether it is cut) and digits.json (Latin digits on Arabic frames).
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test, type Browser, type BrowserContext, type Page, type Route } from '@playwright/test';
import { useOwnData, type Creator } from '../release/builders';
import { apiFetch } from '../release/web-session';
import { target } from '../release/targets';
import { tabsAndChipsInView } from '../test-utils/tabs-in-viewport';

type Lang = 'en' | 'ar';
type Device = 'phone360' | 'phone390' | 'desktop';
type Mode = 'light' | 'dark';
const LANGS: Lang[] = ['en', 'ar'];
const DEVICES: Device[] = ['phone360', 'phone390', 'desktop'];
const VIEWPORT: Record<Device, { width: number; height: number; scale: number; mobile: boolean }> = {
  phone360: { width: 360, height: 780, scale: 3, mobile: true },
  phone390: { width: 390, height: 844, scale: 3, mobile: true },
  desktop: { width: 1280, height: 800, scale: 1, mobile: false },
};
const MODES: Mode[] = ['light', 'dark'];
const OUT = join(__dirname, '../../test-results/review-shots');
// Two channels (r4, owner 2026-11-20): one with every section filled (More is used on phones) and
// one with few (videos only: its empty tabs are hidden, so no More)
const CHANNEL = {
  name: { en: 'Community Corner', ar: 'ركن المجتمع' },
  description: { en: 'Weekly talks, Q&A and news from our community.', ar: 'لقاءات أسبوعية وأسئلة وأجوبة وأخبار من مجتمعنا.' },
};
const SECOND = {
  name: { en: 'Lantern Market', ar: 'سوق الفوانيس' },
  description: { en: 'Stalls, crafts and evenings at the old market.', ar: 'أكشاك وحِرف وأمسيات في السوق القديم.' },
};
const ALL_TABS = ['home', 'videos', 'shorts', 'live', 'playlists', 'community', 'channels', 'about'];
/**
 * Real-looking content (audit r1: an empty channel read as broken): four published videos with
 * title-card thumbnails (the review sets' style, as #1513: the video's title in the page's language
 * over a lantern-glow gradient, one hue per video), served in place of the fake CDN's test pattern.
 */
const FAKE_CDN_HOST = 'vz-local-stack.b-cdn.net';
// Each uploaded some days ago, with views spread over the days since (audit r2: one spike on today)
type Demo = { key: string; channel: 'a' | 'b'; short?: boolean; hue: readonly [string, string]; card: { en: string; ar: string }; title: { en: string; ar: string }; views: number; age: number };
const DEMOS: readonly Demo[] = [
  { key: 'street', channel: 'a', hue: ['#0e4f4c', '#1f8a80'], card: { en: 'Lantern street', ar: 'شارع الفوانيس' }, title: { en: 'Lantern street at night', ar: 'شارع الفوانيس ليلًا' }, views: 34, age: 24 },
  { key: 'evening', channel: 'a', hue: ['#5a3208', '#c98a2b'], card: { en: 'Evening lights', ar: 'أضواء المساء' }, title: { en: 'Evening lights in the old town', ar: 'أضواء المساء في البلدة القديمة' }, views: 21, age: 17 },
  { key: 'writing', channel: 'a', hue: ['#1b2f5a', '#3f73b8'], card: { en: 'By lantern light', ar: 'ضوء الفانوس' }, title: { en: 'Writing by lantern light', ar: 'الكتابة على ضوء الفانوس' }, views: 12, age: 9 },
  { key: 'tour', channel: 'a', hue: ['#3a1b56', '#8a4fc0'], card: { en: 'The market', ar: 'السوق' }, title: { en: 'A walk through the market', ar: 'جولة في السوق' }, views: 8, age: 3 },
  { key: 'short-tea', channel: 'a', short: true, hue: ['#4a1d1d', '#b4533c'], card: { en: 'Mint tea', ar: 'شاي بالنعناع' }, title: { en: 'Mint tea in one minute', ar: 'شاي بالنعناع في دقيقة' }, views: 15, age: 6 },
  { key: 'short-bread', channel: 'a', short: true, hue: ['#2b3a12', '#7a9a2e'], card: { en: 'Fresh bread', ar: 'خبز طازج' }, title: { en: 'Fresh bread at dawn', ar: 'خبز طازج عند الفجر' }, views: 9, age: 2 },
  { key: 'spices', channel: 'b', hue: ['#5a1f0a', '#d0782c'], card: { en: 'Spice stalls', ar: 'أكشاك التوابل' }, title: { en: 'The spice stalls', ar: 'أكشاك التوابل' }, views: 11, age: 12 },
  { key: 'crafts', channel: 'b', hue: ['#123b44', '#2f8aa0'], card: { en: 'Brass crafts', ar: 'حِرف النحاس' }, title: { en: 'Brass lanterns by hand', ar: 'فوانيس نحاسية يدوية' }, views: 6, age: 5 },
];
const CONTROL = process.env.LOCAL_STACK_CONTROL_URL || 'http://127.0.0.1:3190';
const q = (v: string) => `'${v.replace(/'/g, "''")}'`;
async function sql(db: string, text: string): Promise<Array<Record<string, unknown>>> {
  const res = await fetch(`${CONTROL}/__stack/d1/${db}`, { method: 'POST', body: text });
  const body = (await res.json().catch(() => ({}))) as { results?: Array<Record<string, unknown>>; error?: string };
  if (!res.ok) throw new Error(`stack sql ${db}: ${res.status} ${JSON.stringify(body).slice(0, 300)}`);
  return body.results ?? [];
}
const DAY = 86_400_000;
const dayOf = (ms: number) => new Date(ms).toISOString().slice(0, 10);
/** Rewrites the date fields a stored video or index payload has (string ISO or epoch ms) */
function backdate(obj: Record<string, unknown>, ms: number, views?: number): Record<string, unknown> {
  for (const k of ['dateCreated', 'createdAt', 'publishedAt', 'datePublished', 'uploadDate', 'dateModified', 'updatedAt']) {
    if (typeof obj[k] === 'string') obj[k] = new Date(ms).toISOString();
    else if (typeof obj[k] === 'number') obj[k] = (obj[k] as number) > 1e11 ? ms : Math.floor(ms / 1000);
  }
  if (views !== undefined) for (const k of ['views', 'viewCount', 'viewsCount']) if (k in obj) obj[k] = views;
  return obj;
}
/** Daily weights from upload day to today: most views in the first days, a long tail after */
function curve(days: number, seed: number): number[] {
  return Array.from({ length: days + 1 }, (_, i) => Math.exp(-i / 5) * (0.75 + 0.5 * Math.abs(Math.sin((i + 1) * (seed + 1.7)))));
}
function split(total: number, weights: number[], integer: boolean): number[] {
  const sum = weights.reduce((a, b) => a + b, 0);
  const raw = weights.map((w) => (total * w) / sum);
  if (!integer) return raw;
  const out = raw.map(Math.floor);
  let left = Math.round(total) - out.reduce((a, b) => a + b, 0);
  const order = raw.map((r, i) => [r - Math.floor(r), i] as const).sort((a, b) => b[0] - a[0]);
  for (let k = 0; left > 0; k = (k + 1) % order.length, left--) out[order[k][1]]++;
  return out;
}
/**
 * Moves today's analytics rows of each video (and its channel's sums) onto the days since its
 * upload date, and the uploads themselves back to that date (R2 video, ownership and search index),
 * with the search index's view counts matching the videos'.
 */
async function backdateDemos(videos: Array<{ id: string; channelId: string; age: number; views: number }>): Promise<void> {
  const now = Date.now();
  const today = dayOf(now);
  const ids = videos.map((v) => q(v.id)).join(',');
  const rows = await sql('al-ummah-now-notifications', `SELECT entity_type, entity_id, day, metric, dim, value FROM analytics_daily WHERE entity_type = 'video' AND entity_id IN (${ids})`);
  const inserts: string[] = [];
  const channelSums = new Map<string, number>();
  for (const [n, v] of videos.entries()) {
    for (const row of rows.filter((r) => r.entity_id === v.id)) {
      const metric = String(row.metric);
      const dim = String(row.dim ?? '');
      const parts = split(Number(row.value), curve(v.age, n), metric !== 'watch_time');
      parts.forEach((value, i) => {
        if (!value) return;
        const day = dayOf(now - (v.age - i) * DAY);
        inserts.push(`('video', ${q(v.id)}, ${q(day)}, ${q(metric)}, ${q(dim)}, ${value})`);
        const key = `${v.channelId}|${day}|${metric}|${dim}`;
        channelSums.set(key, (channelSums.get(key) ?? 0) + value);
      });
    }
  }
  const metrics = [...new Set(rows.map((r) => String(r.metric)))].map(q).join(',');
  if (rows.length) {
    await sql('al-ummah-now-notifications', `DELETE FROM analytics_daily WHERE entity_type = 'video' AND entity_id IN (${ids})`);
    const channels = [...new Set(videos.map((v) => v.channelId))].map(q).join(',');
    await sql('al-ummah-now-notifications', `DELETE FROM analytics_daily WHERE entity_type = 'channel' AND entity_id IN (${channels}) AND metric IN (${metrics})`);
    for (const [key, value] of channelSums) {
      const [channelId, day, metric, dim] = key.split('|');
      inserts.push(`('channel', ${q(channelId)}, ${q(day)}, ${q(metric)}, ${q(dim)}, ${value})`);
    }
    for (let i = 0; i < inserts.length; i += 100) await sql('al-ummah-now-notifications', `INSERT INTO analytics_daily (entity_type, entity_id, day, metric, dim, value) VALUES ${inserts.slice(i, i + 100).join(',')}`);
  } else problems.push(`no analytics rows for the demo videos on ${today}`);
  for (const v of videos) {
    const ms = now - v.age * DAY - 5 * 3_600_000;
    // The stored video (R2): its key is found by listing
    // The video's own record: a key holding its id whose JSON is that video (not a side record)
    let key = '';
    let obj: Record<string, unknown> = {};
    const seen: string[] = [];
    for (const prefix of [v.id, `videos/${v.id}`, `video/${v.id}`]) {
      const list = (await (await fetch(`${CONTROL}/__stack/r2/videos?prefix=${encodeURIComponent(prefix)}`)).json().catch(() => ({}))) as { keys?: string[] };
      for (const k of list.keys ?? []) {
        seen.push(k);
        const got = (await (await fetch(`${CONTROL}/__stack/r2/videos/${k.split('/').map(encodeURIComponent).join('/')}`)).json().catch(() => null)) as Record<string, unknown> | null;
        if (got && got.id === v.id && 'dateCreated' in got) { key = k; obj = got; break; }
      }
      if (key) break;
    }
    if (!key) notes.push(`R2 keys seen for ${v.id}: ${seen.join(', ') || 'none'}`);
    if (key) {
      const put = await fetch(`${CONTROL}/__stack/r2/videos/${key.split('/').map(encodeURIComponent).join('/')}`, { method: 'PUT', body: JSON.stringify(backdate(obj, ms)) });
      if (!put.ok) problems.push(`R2 back-date ${v.id}: ${put.status}`);
    } else problems.push(`no R2 object found for video ${v.id}`);
    await sql('al-ummah-now-search', `UPDATE content_ownership SET created_at = ${ms}, views = ${v.views} WHERE kind = 'video' AND id = ${q(v.id)}`);
    for (const row of await sql('al-ummah-now-search', `SELECT created_at, payload FROM search_videos WHERE id = ${q(v.id)}`)) {
      const created = Number(row.created_at) > 1e11 ? ms : Math.floor(ms / 1000);
      const payload = JSON.stringify(backdate(JSON.parse(String(row.payload)) as Record<string, unknown>, ms, v.views));
      await sql('al-ummah-now-search', `UPDATE search_videos SET created_at = ${created}, views = ${v.views}, payload = ${q(payload)} WHERE id = ${q(v.id)}`);
    }
  }
}
const MEDIA = mkdtempSync(join(tmpdir(), 'tabs-cards-'));
const demoByGuid = new Map<string, string>();
const demoById = new Map<string, string>();
const demoIds: string[] = [];
/** A 1280x720 title card: the title over a lantern glow in the video's hue, a thin inset frame */
async function makeCards(browser: Browser, demo: Demo): Promise<void> {
  mkdirSync(join(MEDIA, demo.key), { recursive: true });
  const [deep, glow] = demo.hue;
  const [w, h] = demo.short ? [720, 1280] : [1280, 720];
  const context = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
  const page = await context.newPage();
  for (const lang of LANGS) {
    const title = demo.card[lang].replace(/&/g, '&amp;').replace(/</g, '&lt;');
    await page.setContent(`<!doctype html><html><body style="margin:0">
      <div style="width:${w}px;height:${h}px;position:relative;display:grid;place-items:center;
        background:radial-gradient(ellipse 60% 70% at 50% 42%, ${glow} 0%, ${deep} 62%, #070d14 100%);font-family:'Noto Sans Arabic','Noto Sans','DejaVu Sans',sans-serif">
        <div style="position:absolute;inset:28px;border:2px solid #ffffff2e;border-radius:28px"></div>
        <div dir="${lang === 'ar' ? 'rtl' : 'ltr'}" style="color:#fff8ec;font-size:${demo.short ? 104 : 118}px;font-weight:700;letter-spacing:${lang === 'ar' ? '0' : '-0.01em'};text-shadow:0 4px 28px #0008;text-align:center;max-width:${w - 160}px;line-height:1.15">${title}</div>
      </div></body></html>`);
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({ path: join(MEDIA, demo.key, `${lang}.jpg`), type: 'jpeg', quality: 90 });
  }
  await context.close();
}
const keyFor = (id: string) => DEMOS[(id.charCodeAt(0) || 0) % DEMOS.length].key;
const cardPath = (key: string, lang: Lang) => join(MEDIA, key, `${lang}.jpg`);
async function serveCdn(route: Route, lang: Lang): Promise<void> {
  const parts = new URL(route.request().url()).pathname.split('/').filter(Boolean);
  const file = parts[parts.length - 1] ?? '';
  if (!/^thumbnail(_\d+)?\.jpg$|^preview\.webp$/.test(file)) return route.continue();
  const guid = parts.find((p) => demoByGuid.has(p)) ?? parts.find((p) => /^[0-9a-f-]{36}$/i.test(p));
  if (!guid) return route.continue();
  const path = cardPath(demoByGuid.get(guid) ?? keyFor(guid), lang);
  if (!existsSync(path)) return route.continue();
  return route.fulfill({ status: 200, headers: { 'content-type': 'image/jpeg', 'access-control-allow-origin': '*', 'cache-control': 'no-store' }, body: readFileSync(path) });
}
async function serveThumb(route: Route, lang: Lang): Promise<void> {
  const id = decodeURIComponent(new URL(route.request().url()).pathname.split('/').pop() ?? '').replace(/\.jpg$/, '');
  const path = cardPath(demoById.get(id) ?? keyFor(id), lang);
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
/** Each channel's run handle and the handle shown in its place (audit r4: both read @communitycorner) */
const handles: Array<[string, string]> = [];
const digits: Record<string, string[]> = {};
const strips: Record<string, unknown> = {};
const problems: string[] = [];
const notes: string[] = [];

test.describe.configure({ mode: 'serial' });

test.beforeAll(async ({ browser }) => {
  test.setTimeout(10 * 60_000);
  for (const demo of DEMOS) await makeCards(browser, demo);
  creator = await data.createCreator(browser, 'tabs', { channels: 2 });
  const user = creator.user;
  const send = (method: string, path: string, body: unknown, channelId?: string) => apiFetch(user, path, { method, headers: { 'Content-Type': 'application/json', ...(channelId ? { channelId } : {}) }, body: JSON.stringify(body) });
  const put = (path: string, body: unknown, channelId?: string) => send('PUT', path, body, channelId);
  expect((await put('/api/profile', { displayName: 'Amina Yusuf', displayNameLocalized: { en: 'Amina Yusuf', ar: 'أمينة يوسف' }, firstName: 'Amina', lastName: 'Yusuf' })).status).toBeLessThan(300);
  const [full, few] = creator.channelIds;
  for (const [id, c] of [[full, CHANNEL], [few, SECOND]] as const) {
    const named = await put(`/api/channels/${id}`, { name: c.name.en, nameLocalized: c.name, description: c.description.en, descriptionLocalized: c.description }, id);
    expect(named.status, await named.clone().text()).toBeLessThan(300);
    // Every tab on in the config: what a visitor sees is then down to the content
    const stored = (await (await apiFetch(user, `/api/channels/${id}`, { headers: { channelId: id } })).json().catch(() => ({}))) as { result?: { handle?: string }; handle?: string; data?: { handle?: string } };
    const handle = (stored.result?.handle ?? stored.data?.handle ?? stored.handle ?? '').replace(/^@+/, '');
    if (handle) handles.push([handle, id === full ? 'communitycorner' : 'lanternmarket']);
    else problems.push(`no handle read for channel ${id}`);
    const tabs = await put(`/api/channels/${id}/tabs`, { defaultTab: 'home', tabs: ALL_TABS.map((tab, position) => ({ id: tab, visible: true, position })) }, id);
    expect(tabs.status, await tabs.clone().text()).toBeLessThan(300);
  }
  const channelOf = (d: Demo) => (d.channel === 'a' ? full : few);
  const idOf = new Map<string, string>();
  for (const demo of [...DEMOS].reverse()) {
    const channel = channelOf(demo);
    const video = await data.createVideo(user, channel, { clip: demo.short ? 'vertical' : 'landscape40', isPublic: true, title: demo.title.en, waitReady: true });
    expect((await put(`/api/videos/${video.id}`, { titleLocalized: demo.title }, channel)).status).toBeLessThan(300);
    const guid = await cdnGuid(video.id);
    if (guid) demoByGuid.set(guid, demo.key);
    else problems.push(`no CDN guid for ${demo.key}: its thumbnail is the test pattern`);
    demoById.set(video.id, demo.key);
    demoIds.push(video.id);
    idOf.set(demo.key, video.id);
    for (let i = 0; i < demo.views; i++) {
      await apiFetch(user, `/api/videos/${video.id}/view`, { method: 'POST', headers: { 'Content-Type': 'application/json', channelId: channel }, body: JSON.stringify({ watchTime: 25 + ((i * 37) % 90) }) });
    }
  }
  // The full channel: a playlist, two posts and the second channel featured
  const playlist = await send('POST', '/api/playlists', { title: 'Evenings in the old town', titleLocalized: { en: 'Evenings in the old town', ar: 'أمسيات في البلدة القديمة' }, description: '', videos: [idOf.get('street'), idOf.get('evening')], isPublic: true }, full);
  expect(playlist.status, await playlist.clone().text()).toBeLessThan(300);
  const playlistId = ((await playlist.json()) as { result?: { playlist?: { id?: string } } }).result?.playlist?.id;
  if (playlistId) data.onCleanup(`playlist ${playlistId}`, () => apiFetch(user, `/api/playlists/${playlistId}`, { method: 'DELETE', headers: { channelId: full } }));
  await data.createPost(user, full, { text: 'This Friday after maghrib: a lantern walk through the old town. Everyone is welcome.' });
  await data.createPost(user, full, { text: 'جولة الفوانيس يوم الجمعة بعد المغرب في البلدة القديمة. الجميع مرحَّب بهم.' });
  const section = await send('POST', `/api/channels/${full}/sections`, { type: 'featured_channels', title: 'Neighbours', titleLocalized: { en: 'Neighbours', ar: 'جيراننا' }, channelIds: [few] }, full);
  expect(section.status, await section.clone().text()).toBeLessThan(300);
  // The views reach the stored videos (counter flush) and the processor's analytics rows
  for (const demo of DEMOS) {
    const id = idOf.get(demo.key)!;
    await expect.poll(async () => {
      const body = (await (await fetch(`${target().api}/api/videos/${id}`, { cache: 'no-store' })).json().catch(() => ({}))) as { result?: { views?: number }; views?: number };
      return (body.result ?? body).views ?? 0;
    }, { timeout: 120_000, message: `views of ${demo.key}` }).toBeGreaterThanOrEqual(demo.views);
  }
  await expect.poll(async () => Number((await sql('al-ummah-now-notifications', `SELECT COALESCE(SUM(value), 0) AS n FROM analytics_daily WHERE entity_type = 'video' AND metric = 'views' AND entity_id IN (${demoIds.map(q).join(',')})`))[0]?.n ?? 0), { timeout: 120_000, message: 'analytics views' }).toBeGreaterThanOrEqual(DEMOS.reduce((a, d) => a + d.views, 0));
  await backdateDemos(DEMOS.map((d) => ({ id: idOf.get(d.key)!, channelId: channelOf(d), age: d.age, views: d.views })));
});

async function open(browser: Browser, lang: Lang, device: Device, mode: Mode, signedIn: boolean): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext({
    proxy: { server: 'http://127.0.0.1:3191', bypass: 'localhost,127.0.0.1' },
    ignoreHTTPSErrors: true,
    storageState: signedIn ? creator.state : { cookies: [], origins: [] },
    viewport: { width: VIEWPORT[device].width, height: VIEWPORT[device].height },
    deviceScaleFactor: VIEWPORT[device].scale,
    isMobile: VIEWPORT[device].mobile,
    hasTouch: VIEWPORT[device].mobile,
    colorScheme: mode,
    reducedMotion: 'reduce',
    locale: lang === 'ar' ? 'ar' : 'en-US',
  });
  await context.addCookies([{ name: 'aun_consent', value: `v1.a0.e0.p0.${Date.now()}`, url: target().web, sameSite: 'Lax' }]);
  await context.route((url) => url.hostname === FAKE_CDN_HOST, (route) => serveCdn(route, lang));
  await context.route((url) => url.pathname.startsWith('/thumb/'), (route) => serveThumb(route, lang));
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
  await page.evaluate((pairs: Array<[string, string]>) => {
    // Each channel's run handle becomes its own stand-in handle
    const escape = (v: string) => v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    for (const [from, to] of pairs) {
      const has = new RegExp(escape(from), 'i');
      const all = new RegExp(escape(from), 'gi');
      const walkerH = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      for (let node = walkerH.nextNode(); node; node = walkerH.nextNode()) if (node.textContent && has.test(node.textContent)) node.textContent = node.textContent.replace(all, to);
    }
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (node.textContent && /e2e\.alummahnow\.net|^e2e\+/.test(node.textContent)) node.textContent = node.textContent.replace(/e2e\+[^@\s]*/g, 'amina').replace(/@?e2e\.alummahnow\.net/g, '@example.com');
    }
    document.querySelectorAll<HTMLElement>('body *').forEach((el) => { if (el.childElementCount === 0 && /@\s*E2E[\w-]+/i.test(el.textContent ?? '')) el.textContent = (el.textContent ?? '').replace(/@\s*E2E[\w-]+/gi, '@communitycorner'); });
  }, handles);
  await page.mouse.move(1, 1);
  await page.waitForTimeout(300);
  const sideways = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  if (sideways > 0) {
    // Which elements stick out of the window, to find the cause: scrolled back to the start, the
    // innermost non-fixed elements past either edge
    const wide = await page.evaluate(() => {
      window.scrollTo(0, window.scrollY);
      const w = document.documentElement.clientWidth;
      const out: string[] = [];
      const fixed = (el: Element) => { for (let e: Element | null = el; e; e = e.parentElement) if (getComputedStyle(e).position === 'fixed') return true; return false; };
      const sticks = (el: Element) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && (r.left < -1 || r.right > w + 1); };
      for (const el of Array.from(document.querySelectorAll<HTMLElement>('body *'))) {
        if (!sticks(el) || fixed(el) || Array.from(el.children).some(sticks)) continue;
        const r = el.getBoundingClientRect();
        const owner = el.closest('[data-testid]')?.getAttribute('data-testid') ?? '';
        out.push(`${el.tagName.toLowerCase()}.${String(el.className).slice(0, 60)} in [${owner}] ${Math.round(r.left)}..${Math.round(r.right)}`);
        if (out.length >= 12) break;
      }
      return out;
    });
    // And what is wider than the window or overflows its own box (#1695)
    const wider = await page.evaluate(() => {
      const w = document.documentElement.clientWidth;
      const out: string[] = [`doc ${document.documentElement.scrollWidth} body ${document.body.scrollWidth} vw ${innerWidth}`];
      for (const el of Array.from(document.querySelectorAll<HTMLElement>('body *'))) {
        const r = el.getBoundingClientRect();
        const overflows = el.scrollWidth > el.clientWidth + 1 && getComputedStyle(el).overflowX === 'visible' && el.clientWidth > 0;
        if (r.width <= w + 1 && !overflows) continue;
        const owner = el.closest('[data-testid]')?.getAttribute('data-testid') ?? '';
        out.push(`${el.tagName.toLowerCase()}.${String(el.className).slice(0, 50)} in [${owner}] w${Math.round(r.width)} sw${el.scrollWidth}/cw${el.clientWidth}`);
        if (out.length >= 25) break;
      }
      return out;
    });
    problems.push(`${dir}/${file}: page scrolls sideways by ${sideways}px: ${wide.join(' | ')} || wider: ${wider.join(' | ')}`);
  }
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

function each(name: string, signedIn: boolean, body: (page: Page, lang: Lang, tag: string, device: Device) => Promise<void>) {
  for (const lang of LANGS) test(`${name} ${lang}`, async ({ browser }) => {
    test.setTimeout(20 * 60_000);
    for (const device of DEVICES) for (const mode of MODES) {
      const tag = `${lang}-${device}-${mode}`;
      const { context, page } = await open(browser, lang, device, mode, signedIn);
      try {
        await body(page, lang, tag, device);
      } catch (error) {
        problems.push(`${name} ${tag}: ${(error as Error).message.split('\n').slice(0, 3).join(' ')}`);
      } finally {
        await context.close();
      }
    }
  });
}

/** The tab strip has settled: measured (PriorityStrip), or the old scroll strip's tabs are in */
async function tabsSettled(page: Page): Promise<void> {
  await expect(page.getByTestId('channel-tabs').getByRole('tab').first()).toBeVisible({ timeout: 15_000 });
  await expect(page.locator('[data-testid="channel-tabs-strip"][data-measuring]')).toHaveCount(0);
  await page.waitForTimeout(500);
}

// Public pages: signed out. The full channel: every section has content (More on phones)
each('channel-full', false, async (page, lang, tag, device) => {
  await settle(page, `/channels/${creator.channelIds[0]}`, lang);
  await tabsSettled(page);
  await shoot(page, 'channel-full', `channel-full-${tag}`, lang);
  // The More menu open (phones)
  const more = page.getByTestId('channel-tabs-strip-more');
  if (device !== 'desktop' && (await more.isVisible())) {
    await more.click();
    await expect(page.getByRole('menu')).toBeVisible();
    await page.waitForTimeout(300);
    await shoot(page, 'channel-full', `channel-full-menu-${tag}`, lang);
    // A tab from the menu: it is current and takes the row's last slot
    await page.getByRole('menuitem').last().click();
    await expect(page).toHaveURL(/tab=/);
    await tabsSettled(page);
    await page.evaluate(() => window.scrollTo(0, 0));
    await shoot(page, 'channel-full', `channel-full-chosen-${tag}`, lang);
  }
});

// The channel with few sections: its empty tabs are hidden, so no More
each('channel-few', false, async (page, lang, tag) => {
  await settle(page, `/channels/${creator.channelIds[1]}`, lang);
  await tabsSettled(page);
  await shoot(page, 'channel-few', `channel-few-${tag}`, lang);
});

// Studio's content tabs (signed in, the full channel): one row + More since #1669 (before: wrapped, #1659)
each('studio-tabs', true, async (page, lang, tag, device) => {
  await settle(page, `/studio/${creator.channelIds[0]}/content/videos`, lang);
  await expect(page.getByTestId('studio-tab-videos')).toBeVisible();
  await expect(page.locator('[data-testid="studio-tabs-strip"][data-measuring]')).toHaveCount(0);
  await page.waitForTimeout(500);
  await shoot(page, 'studio-tabs', `studio-tabs-${tag}`, lang);
  const more = page.getByTestId('studio-tabs-strip-more');
  if (device !== 'desktop' && (await more.isVisible())) {
    await more.click();
    await expect(page.getByRole('menu')).toBeVisible();
    await page.waitForTimeout(300);
    await shoot(page, 'studio-tabs', `studio-tabs-menu-${tag}`, lang);
  }
});

each('search', false, async (page, lang, tag) => {
  await settle(page, `/search?q=${encodeURIComponent(lang === 'ar' ? 'الفوانيس' : 'lantern')}`, lang);
  await expect(page.getByTestId('search-type-all')).toBeVisible();
  await page.waitForTimeout(400);
  await shoot(page, 'search', `search-type-chips-${tag}`, lang);
});

each('studio-analytics', true, async (page, lang, tag, device) => {
  await settle(page, `/studio/${creator.channelIds[0]}/analytics`, lang);
  await expect(page.getByTestId('studio-analytics')).toBeVisible();
  await expect(page.getByTestId('studio-analytics-loading')).toHaveCount(0, { timeout: 30_000 });
  // The metric chips (no test id on main): the group of toggle buttons, mid-window, no line half
  // under the header or the bottom tab bar (audit r1)
  const metrics = page.locator('[data-testid="studio-analytics"] [role="group"]:has(> button[aria-pressed])').first();
  await expect(metrics).toBeVisible();
  // From the top in every size (audit r4: 360 was scrolled past the title and range), with the
  // chips in view under the cards
  await page.evaluate(() => window.scrollTo(0, 0));
  const box = await metrics.boundingBox();
  if (!box || box.y + box.height > page.viewportSize()!.height - 80) {
    await metrics.evaluate((el) => el.setAttribute('data-review-centre', ''));
    await centre(page, '[data-review-centre]');
  }
  await shoot(page, 'studio-analytics', `analytics-metrics-${tag}`, lang);
  // The Top content table (#1695, audit r5): titles truncate in the space the numbers leave; a table
  // still wider than its box scrolls inside it with the far edge faded. Phones only
  if (device === 'desktop') return;
  const heading = page.locator('#studio-top');
  await expect(heading).toBeVisible();
  await heading.evaluate((el) => el.scrollIntoView({ block: 'start' }));
  await page.evaluate(() => window.scrollBy(0, -72));
  await page.waitForTimeout(300);
  await shoot(page, 'studio-analytics', `analytics-top-${tag}`, lang);
  const scrollBox = page.getByTestId('studio-top-scroll');
  if ((await scrollBox.getAttribute('data-scrolls')) === 'end') {
    await scrollBox.evaluate((el) => el.scrollBy({ left: (getComputedStyle(el).direction === 'rtl' ? -1 : 1) * el.scrollWidth }));
    await page.waitForTimeout(300);
    await shoot(page, 'studio-analytics', `analytics-top-scrolled-${tag}`, lang);
  }
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
  writeFileSync(join(OUT, 'notes.txt'), notes.join('\n'));
  expect(problems, problems.join('\n')).toEqual([]);
});
