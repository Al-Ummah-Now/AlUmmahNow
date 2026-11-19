/**
 * Owner review shots for #1465 (Acting as: Personal and Channel identities). Not a test suite and
 * not for main: it lives on the throwaway integration branch and runs only with REVIEW_SHOTS=1
 * (help-pictures.yml, workflow_dispatch input review_shots), on the CI local stack: a production
 * build, real sign-in, real data made here and deleted at the end, the demo media of capture.help.ts.
 *
 * Viewport frames only (never fullPage); light and dark through the browser's colour scheme
 * (Playwright colorScheme), never html[data-theme] (that is the site theme).
 * Output: test-results/review-shots/{menu,picker,composer,tour}/<screen>-<lang>-<device>-<mode>[-frame].png
 * plus digits.json: every visible run of 0-9 on an Arabic page (rule 2 audit aid).
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { devices, expect, test, type Browser, type BrowserContext, type Page, type Route } from '@playwright/test';
import { useOwnData, type Creator } from '../release/builders';
import { apiFetch } from '../release/web-session';
import { target } from '../release/targets';

type Lang = 'en' | 'ar';
type Mode = 'light' | 'dark';
type Device = 'desktop' | 'phone';
const LANGS: Lang[] = ['en', 'ar'];
const MODES: Mode[] = ['light', 'dark'];
const DEVICES: Device[] = ['desktop', 'phone'];
const PIXEL7 = devices['Pixel 7'];

const OUT = join(__dirname, '../../test-results/review-shots');
const NAMES = {
  user: { en: 'Amina Yusuf', ar: 'أمينة يوسف' },
  channel: { en: 'Community Corner', ar: 'ركن المجتمع' },
  second: { en: 'Weekend Sessions', ar: 'لقاءات نهاية الأسبوع' },
  comment: { en: 'Thank you, this was really clear.', ar: 'شكرًا، كان الشرح واضحًا جدًا.' },
};
const ART = join(__dirname, '../../../../packages/app-icons/assets/crops');
const FAKE_CDN_HOST = 'vz-local-stack.b-cdn.net';
const DEMOS = [
  // Crops without a drawn play button (videos.webp has one: it doubled the player's)
  { key: 'tour', art: 'videos-admin.webp', title: { en: 'Site tour', ar: 'جولة في الموقع' } },
  { key: 'street', art: 'tools.webp', title: { en: 'Lantern street', ar: 'فوانيس رمضان' } },
  { key: 'evening', art: 'auth.webp', title: { en: 'Evening lights', ar: 'أضواء المساء' } },
  { key: 'writing', art: 'cms.webp', title: { en: 'Writing by lantern light', ar: 'الكتابة على ضوء الفانوس' } },
] as const;
const MEDIA = mkdtempSync(join(tmpdir(), 'review-media-'));
const demoByGuid = new Map<string, string>();
const demoIds: string[] = [];
/** Video id → its demo: cards load /thumb/<id>.jpg, which the web worker fetches from the fake CDN */
const demoById = new Map<string, string>();
const digits: Record<string, string[]> = {};
const problems: string[] = [];

function makeDemoMedia(key: string, art: string): void {
  const dir = join(MEDIA, key);
  mkdirSync(dir, { recursive: true });
  const src = join(ART, art);
  const pan = "scale=1280:1280,crop=1280:720:0:220,zoompan=z='1+0.0003*on':x='(iw-iw/zoom)*0.5':y='(ih-ih/zoom)*(0.2+on/1000)':d=1:s=640x360:fps=25,format=yuv420p";
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-loop', '1', '-i', src, '-vf', pan, '-t', '20', '-c:v', 'libx264', '-profile:v', 'main', '-level', '3.0', '-g', '50',
    '-hls_time', '4', '-hls_playlist_type', 'vod', '-hls_segment_filename', join(dir, '0_%03d.ts'), join(dir, '0.m3u8')]);
  writeFileSync(join(dir, 'master.m3u8'), '#EXTM3U\n#EXT-X-VERSION:3\n#EXT-X-STREAM-INF:BANDWIDTH=400000,RESOLUTION=640x360,CODECS="avc1.4d401e"\n0.m3u8\n');
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', src, '-vf', 'scale=960:960,crop=960:540:0:165', '-q:v', '3', join(dir, 'thumbnail.jpg')]);
}

async function serveDemo(route: Route): Promise<void> {
  const url = new URL(route.request().url());
  const parts = url.pathname.split('/').filter(Boolean);
  const at = parts.findIndex((p) => demoByGuid.has(p));
  const other = parts.find((p) => /^[0-9a-f-]{36}$/i.test(p));
  const key = at >= 0 ? demoByGuid.get(parts[at]) : other ? DEMOS[parseInt(other.slice(0, 2), 16) % DEMOS.length].key : undefined;
  const file = parts[parts.length - 1] ?? '';
  if (!key) return route.continue();
  const dir = join(MEDIA, key);
  let path = '';
  let type = '';
  if (/^thumbnail(_\d+)?\.jpg$|^preview\.webp$/.test(file)) [path, type] = [join(dir, 'thumbnail.jpg'), 'image/jpeg'];
  else if (file === 'playlist.m3u8' || file === 'master.m3u8') [path, type] = [join(dir, 'master.m3u8'), 'application/vnd.apple.mpegurl'];
  else if (/^\d+\.m3u8$/.test(file)) [path, type] = [join(dir, '0.m3u8'), 'application/vnd.apple.mpegurl'];
  else if (/^\d+_\d+\.ts$/.test(file)) [path, type] = [join(dir, file.replace(/^\d+_/, '0_')), 'video/mp2t'];
  if (!path || !existsSync(path)) return route.continue();
  return route.fulfill({ status: 200, headers: { 'access-control-allow-origin': '*', 'cache-control': 'no-store', 'content-type': type }, body: readFileSync(path) });
}

/** /thumb/<id>.jpg (server-rendered cards) answered with the demo's thumbnail, never the test pattern */
async function serveThumb(route: Route): Promise<void> {
  const id = decodeURIComponent(new URL(route.request().url()).pathname.split('/').pop() ?? '').replace(/\.jpg$/, '');
  const key = demoById.get(id) ?? DEMOS[(id.charCodeAt(0) || 0) % DEMOS.length].key;
  const path = join(MEDIA, key, 'thumbnail.jpg');
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

/** A square JPEG of one lantern crop (owner art, crop and resize only) for a channel logo */
function logo(art: string): Blob {
  const out = join(MEDIA, `logo-${art}.jpg`);
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', join(ART, art), '-vf', 'scale=400:400', '-q:v', '3', out]);
  return new Blob([readFileSync(out)], { type: 'image/jpeg' });
}

const data = useOwnData(test as never);
let creator: Creator;
let channelId = '';
let videoId = '';

test.describe.configure({ mode: 'serial' });

test.beforeAll(async ({ browser }) => {
  test.setTimeout(10 * 60_000);
  for (const d of DEMOS) makeDemoMedia(d.key, d.art);
  creator = await data.createCreator(browser, 'review', { channels: 2 });
  [channelId] = creator.channelIds;
  const user = creator.user;
  const json = (body: unknown, channel?: string) => ({ method: 'PUT', headers: { 'Content-Type': 'application/json', ...(channel ? { channelId: channel } : {}) }, body: JSON.stringify(body) });
  expect((await apiFetch(user, '/api/profile', json({ displayName: NAMES.user.en, displayNameLocalized: NAMES.user, firstName: 'Amina', lastName: 'Yusuf' }))).status).toBeLessThan(300);
  const about = { en: 'Short videos about our neighbourhood and the people in it.', ar: 'مرئيات قصيرة عن حيّنا وأهله.' };
  for (const [id, name, art] of [[creator.channelIds[0], NAMES.channel, 'cms.webp'], [creator.channelIds[1], NAMES.second, 'tools.webp']] as const) {
    expect((await apiFetch(user, `/api/channels/${id}`, json({ name: name.en, nameLocalized: name, description: about.en, descriptionLocalized: about }, id))).status).toBeLessThan(300);
    const form = new FormData();
    form.append('photo', logo(art), 'logo.jpg');
    const res = await apiFetch(user, `/api/channels/${id}/avatar`, { method: 'PUT', body: form, headers: { channelId: id } });
    if (res.status !== 200) problems.push(`channel logo ${id}: ${res.status} ${(await res.text()).slice(0, 160)}`);
  }
  for (const d of [...DEMOS].reverse()) {
    const video = await data.createVideo(user, channelId, { clip: 'landscape40', isPublic: true, title: d.title.en, waitReady: true });
    expect((await apiFetch(user, `/api/videos/${video.id}`, json({ titleLocalized: d.title, description: 'A short walk through the site: where to watch, comment and switch who you act as.', descriptionLocalized: { en: 'A short walk through the site: where to watch, comment and switch who you act as.', ar: 'جولة قصيرة في الموقع: أين تشاهد وتعلّق وتبدّل الهوية التي تتصرّف بها.' } }, channelId))).status).toBeLessThan(300);
    const guid = await cdnGuid(video.id);
    if (guid) demoByGuid.set(guid, d.key);
    demoIds.push(video.id);
    demoById.set(video.id, d.key);
    if (d.key === 'tour') videoId = video.id;
  }
  // A mixed community: one comment in each language (each keeps its own direction on either page)
  await data.createComment(user, videoId, channelId, NAMES.comment.en);
  await data.createComment(user, videoId, channelId, NAMES.comment.ar);
});

async function open(browser: Browser, lang: Lang, device: Device, mode: Mode): Promise<{ context: BrowserContext; page: Page }> {
  const phone = device === 'phone';
  const context = await browser.newContext({
    proxy: { server: 'http://127.0.0.1:3191', bypass: 'localhost,127.0.0.1' },
    ignoreHTTPSErrors: true,
    storageState: creator.state,
    ...(phone
      ? { viewport: PIXEL7.viewport, deviceScaleFactor: PIXEL7.deviceScaleFactor, isMobile: true, hasTouch: true, userAgent: PIXEL7.userAgent }
      : { viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 }),
    colorScheme: mode,
    reducedMotion: 'reduce',
    locale: lang === 'ar' ? 'ar' : 'en-US',
  });
  await context.addCookies([{ name: 'aun_consent', value: `v1.a0.e0.p0.${Date.now()}`, url: target().web, sameSite: 'Lax' }]);
  await context.route((url) => url.hostname === FAKE_CDN_HOST, serveDemo);
  await context.route((url) => url.pathname.startsWith('/thumb/'), serveThumb);
  await context.addInitScript((ids: string[]) => {
    const idOf = (el: Element) => el.getAttribute('data-video-id') || decodeURIComponent((el.getAttribute('href') ?? el.querySelector('a[href*="/video/"]')?.getAttribute('href') ?? '').split('/video/')[1]?.split(/[?#/]/)[0] ?? '');
    const hide = () => document.querySelectorAll<HTMLElement>('[data-testid="related-video"], [data-testid="video-card"]').forEach((el) => {
      const id = idOf(el);
      if (id && !ids.includes(id)) ((el.closest('li') as HTMLElement | null) ?? el).style.display = 'none';
    });
    new MutationObserver(hide).observe(document, { subtree: true, childList: true });
  }, demoIds);
  const page = await context.newPage();
  // No step waits forever: a stuck shot fails alone and the run goes on
  page.setDefaultTimeout(30_000);
  return { context, page };
}

async function settle(page: Page, path: string, lang: Lang): Promise<void> {
  await page.goto(`/${lang}${path}`, { waitUntil: 'domcontentloaded' });
  // A watch page streams its video: never idle, so this wait is bounded
  await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => undefined);
  await expect(page.locator('[data-testid="nav-menu-trigger"]:visible').first()).toBeVisible({ timeout: 30_000 });
  await page.evaluate(() => document.fonts.ready);
  // Every image on screen has loaded (no half-drawn avatar or thumbnail)
  await page.waitForFunction(() => [...document.images].filter((i) => i.getBoundingClientRect().bottom > 0 && i.getBoundingClientRect().top < innerHeight).every((i) => i.complete), undefined, { timeout: 10_000 }).catch(() => undefined);
}

async function openMenu(page: Page, view: 'main' | 'channels' = 'main') {
  const menu = page.getByTestId('nav-menu');
  await expect(async () => {
    if (!(await menu.isVisible())) await page.locator('[data-testid="nav-menu-trigger"]:visible').first().click();
    await expect(menu).toBeVisible({ timeout: 2000 });
  }).toPass({ timeout: 30_000 });
  if (view === 'channels') {
    await menu.getByTestId('nav-switch-channel').click();
    await expect(menu.getByTestId('nav-channel-option-none')).toBeVisible();
  }
  return menu;
}

/** Acting as yourself or as the first channel, through the Acting as menu (the only place to choose) */
async function actAs(page: Page, who: 'personal' | 'channel'): Promise<void> {
  const name = page.getByTestId('nav-trigger-name').first();
  if ((await name.getAttribute('data-identity')) === who) return;
  const menu = await openMenu(page, 'channels');
  await (who === 'personal' ? menu.getByTestId('nav-channel-option-none') : menu.locator(`[data-testid="nav-channel-option"][data-channel-id="${channelId}"]`)).click();
  await expect(name).toHaveAttribute('data-identity', who, { timeout: 30_000 });
  if (await page.getByTestId('nav-menu').isVisible()) await page.keyboard.press('Escape');
  await expect(page.getByTestId('nav-menu')).toHaveCount(0);
}

/** Masks the run account's address; records visible 0-9 on Arabic pages */
async function shoot(page: Page, dir: string, file: string, lang: Lang): Promise<void> {
  await page.evaluate(() => {
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (node.textContent && /e2e\.alummahnow\.net|^e2e\+/.test(node.textContent)) node.textContent = node.textContent.replace(/e2e\+[^@\s]*/g, 'amina').replace(/@?e2e\.alummahnow\.net/g, '@example.com');
      if (node.textContent && /@E2E[\w-]+/i.test(node.textContent)) node.textContent = node.textContent.replace(/@E2E[\w-]+/gi, '@communitycorner');
    }
  });
  await page.mouse.move(1, 1);
  await page.waitForTimeout(300);
  if (lang === 'ar') {
    const found = await page.evaluate(() => {
      const out: string[] = [];
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        const text = node.textContent ?? '';
        if (!/[0-9]/.test(text)) continue;
        const el = node.parentElement;
        if (!el || el.closest('script,style,[aria-hidden="true"] svg,code')) continue;
        const r = el.getBoundingClientRect();
        const cs = getComputedStyle(el);
        if (r.width < 1 || r.height < 1 || r.bottom < 0 || r.top > innerHeight || cs.visibility === 'hidden' || cs.display === 'none') continue;
        out.push(`${el.tagName.toLowerCase()}${el.dataset.testid ? `[${el.dataset.testid}]` : ''}: ${text.trim().slice(0, 80)}`);
      }
      return out;
    });
    if (found.length) digits[`${dir}/${file}`] = found;
  }
  mkdirSync(join(OUT, dir), { recursive: true });
  await page.screenshot({ path: join(OUT, dir, `${file}.png`), animations: 'disabled', caret: 'hide' });
}

function each(name: string, body: (page: Page, lang: Lang, device: Device, mode: Mode, tag: string) => Promise<void>) {
  for (const lang of LANGS) test(`${name} ${lang}`, async ({ browser }) => {
    test.setTimeout(30 * 60_000);
    for (const device of DEVICES) for (const mode of MODES) {
      const tag = `${lang}-${device}-${mode}`;
      const { context, page } = await open(browser, lang, device, mode);
      try {
        await body(page, lang, device, mode, tag);
      } catch (error) {
        problems.push(`${name} ${tag}: ${(error as Error).message.split('\n').slice(0, 3).join(' ')}`);
        await page.screenshot({ path: test.info().outputPath(`${name}-${tag}.failed.png`) }).catch(() => undefined);
      } finally {
        await context.close();
      }
    }
  });
}

each('menu', async (page, lang, _device, _mode, tag) => {
  await settle(page, '', lang);
  await actAs(page, 'channel');
  await page.reload();
  await settle(page, '', lang);
  await shoot(page, 'menu', `home-channel-${tag}-top`, lang);
  await openMenu(page);
  await shoot(page, 'menu', `menu-channel-${tag}`, lang);
  await openMenu(page, 'channels');
  await shoot(page, 'picker', `picker-channel-${tag}`, lang);
  await page.keyboard.press('Escape');
  await actAs(page, 'personal');
  await page.reload();
  await settle(page, '', lang);
  await shoot(page, 'menu', `home-personal-${tag}-top`, lang);
  await openMenu(page);
  await shoot(page, 'menu', `menu-personal-${tag}`, lang);
  await openMenu(page, 'channels');
  await shoot(page, 'picker', `picker-personal-${tag}`, lang);
  await page.keyboard.press('Escape');
  await actAs(page, 'channel');
});

each('composer', async (page, lang, _device, _mode, tag) => {
  for (const who of ['channel', 'personal'] as const) {
    await settle(page, `/video/${videoId}`, lang);
    await actAs(page, who);
    await page.reload();
    await settle(page, `/video/${videoId}`, lang);
    await expect(page.getByTestId('comment-identity').first()).toHaveAttribute('data-as', who === 'channel' ? 'channel' : 'member', { timeout: 30_000 });
    // The player shows its first frame (no error screen)
    await expect(page.getByTestId('video-error')).toHaveCount(0);
    await shoot(page, 'composer', `composer-${who}-${tag}-top`, lang);
    const composer = page.getByTestId('comment-input').first();
    await composer.scrollIntoViewIfNeeded();
    await page.evaluate(() => window.scrollBy(0, Math.round(innerHeight * 0.25)));
    await composer.click();
    await shoot(page, 'composer', `composer-${who}-${tag}-composer`, lang);
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    await page.waitForTimeout(600);
    await shoot(page, 'composer', `composer-${who}-${tag}-end`, lang);
  }
  await actAs(page, 'channel');
});

each('tour', async (page, lang, _device, _mode, tag) => {
  await settle(page, '/help', lang);
  await actAs(page, 'channel');
  await page.getByTestId('help-take-tour').click();
  const card = page.getByTestId('tour-card');
  for (let i = 1; i <= 6; i++) {
    const step = await card.getAttribute('data-step');
    await page.waitForTimeout(700); // placement runs every 200 ms; the menu opens a frame later
    await shoot(page, 'tour', `tour-${i}-${step}-${tag}`, lang);
    const next = card.getByTestId('tour-next');
    const last = (await next.innerText()).trim() === (lang === 'ar' ? 'تم' : 'Done') || step === 'help';
    await next.click();
    if (last) break;
  }
  await expect(card).toHaveCount(0);
});

test('every shot was made', () => {
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, 'digits.json'), JSON.stringify(digits, null, 2));
  expect(problems, problems.join('\n')).toEqual([]);
});

test.afterAll(() => rmSync(MEDIA, { recursive: true, force: true }));
