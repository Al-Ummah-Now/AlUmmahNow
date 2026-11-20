/**
 * Makes Help's pictures and clips from the real site (docs/features/HELP-AND-TOUR.md): every
 * picture in English and Arabic, desktop and phone, light and dark, with numbered markers drawn on
 * the controls the Help text explains; every clip on desktop in both languages and modes.
 * Output: apps/web/public/help (pictures) and public/help/clips (clips and their stills), WebP/WebM.
 *
 * Runs on the local stack (E2E_ENV=local) with its own data, deleted at the end (DataScope):
 *   pnpm --filter @al-ummah/web exec playwright test -c playwright.help.config.ts
 * CI: .github/workflows/help-pictures.yml (by hand, for every release, and on PRs that change
 * Help's pictures or this script). Needs ffmpeg (PNG → WebP, clip trimming) and Google Chrome
 * (the mini-player clip plays H.264).
 *
 * Names are fixed (exactNames), never run-tagged, because they show in the pictures. They are
 * generic on purpose: no real person or channel.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test, type Browser, type BrowserContext, type Locator, type Page, type Route } from '@playwright/test';
import { useOwnData, type Creator } from '../release/builders';
import { apiFetch } from '../release/web-session';
import { playFor } from '../release/videos';
import { target } from '../release/targets';
import { HELP_AR, HELP_EN, type HelpTranslations } from '@al-ummah/shared-types';

type Lang = 'en' | 'ar';
type Mode = 'light' | 'dark';
type Device = 'desktop' | 'phone';

const OUT = join(__dirname, '../../public/help');
const CLIPS = join(OUT, 'clips');
const LANGS: Lang[] = ['en', 'ar'];
const MODES: Mode[] = ['light', 'dark'];
const DEVICES: Device[] = ['desktop', 'phone'];
const VIEWPORT: Record<Device, { width: number; height: number; scale: number; mobile: boolean }> = {
  desktop: { width: 1280, height: 800, scale: 1, mobile: false },
  phone: { width: 390, height: 844, scale: 2, mobile: true },
};

const NAMES = {
  user: { en: 'Amina Yusuf', ar: 'أمينة يوسف' },
  channel: { en: 'Community Corner', ar: 'ركن المجتمع' },
  second: { en: 'Weekend Sessions', ar: 'لقاءات نهاية الأسبوع' },
  video: { en: 'Site tour', ar: 'جولة في الموقع' },
  comment: { en: 'Thank you, this was really clear.', ar: 'شكرًا، كان الشرح واضحًا جدًا.' },
  // One post shows in both languages' pictures: it says it in both
  post: { en: 'New videos every Friday · مرئيات جديدة كل جمعة', ar: 'New videos every Friday · مرئيات جديدة كل جمعة' },
  playlist: { en: 'Weekend projects', ar: 'مشاريع نهاية الأسبوع' },
};

/**
 * Demo media for the pictures (owner, 2026-11-13): the local stack's fake CDN serves a colour-bar
 * test pattern for every video, so this script answers the browser's CDN requests for its own
 * videos itself, with short clips and thumbnails made from the owner's lantern art
 * (packages/app-icons/assets/crops, used as is: a slow pan and zoom is only crop and resize over
 * time; nothing drawn on it). Only here: the general test fixtures stay as they are.
 */
const ART = join(__dirname, '../../../../packages/app-icons/assets/crops');
/** The local stack's fake Bunny CDN (scripts/local-stack/fake-external.ts FAKE_CDN_HOST): exactly this host */
const FAKE_CDN_HOST = 'vz-local-stack.b-cdn.net';
const DEMOS = [
  // A crop with no drawn play button (videos.webp has one: it doubled the player's own)
  { key: 'tour', art: 'videos-admin.webp', title: NAMES.video },
  // Full-bleed crops only (www.webp is round, with black corners)
  { key: 'street', art: 'tools.webp', title: { en: 'Lantern street', ar: 'فوانيس رمضان' } },
  { key: 'evening', art: 'auth.webp', title: { en: 'Evening lights', ar: 'أضواء المساء' } },
  { key: 'writing', art: 'cms.webp', title: { en: 'Writing by lantern light', ar: 'الكتابة على ضوء الفانوس' } },
] as const;
const MEDIA = mkdtempSync(join(tmpdir(), 'help-media-'));
/** CDN guid → the demo it shows */
const demoByGuid = new Map<string, (typeof DEMOS)[number]['key']>();
/** Our demo videos' ids: listings show only these (the stack's seed videos have test titles) */
const demoIds: string[] = [];
/** Video id → its demo: cards load /thumb/<id>.jpg, which the web worker fetches from the fake CDN */
const demoById = new Map<string, (typeof DEMOS)[number]['key']>();

/** A 20 s 640x360 HLS clip (one rendition, no audio) and a 960x540 thumbnail of one lantern crop */
function makeDemoMedia(key: string, art: string): void {
  const dir = join(MEDIA, key);
  mkdirSync(dir, { recursive: true });
  const src = join(ART, art);
  // The square crop seen through a 16:9 window that drifts down and zooms in slowly
  // Cropped to 16:9 first, so the zoom never stretches the art
  const pan = "scale=1280:1280,crop=1280:720:0:220,zoompan=z='1+0.0003*on':x='(iw-iw/zoom)*0.5':y='(ih-ih/zoom)*(0.2+on/1000)':d=1:s=640x360:fps=25,format=yuv420p";
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-loop', '1', '-i', src, '-vf', pan, '-t', '20', '-c:v', 'libx264', '-profile:v', 'main', '-level', '3.0', '-g', '50',
    '-hls_time', '4', '-hls_playlist_type', 'vod', '-hls_segment_filename', join(dir, '0_%03d.ts'), join(dir, '0.m3u8')]);
  writeFileSync(join(dir, 'master.m3u8'), '#EXTM3U\n#EXT-X-VERSION:3\n#EXT-X-STREAM-INF:BANDWIDTH=400000,RESOLUTION=640x360,CODECS="avc1.4d401e"\n0.m3u8\n');
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', src, '-vf', 'scale=960:960,crop=960:540:0:165', '-q:v', '3', join(dir, 'thumbnail.jpg')]);
}

/** Serves a demo's clip and thumbnail in place of the fake CDN's test pattern */
async function serveDemo(route: Route): Promise<void> {
  const url = new URL(route.request().url());
  const parts = url.pathname.split('/').filter(Boolean);
  const at = parts.findIndex((p) => demoByGuid.has(p));
  // Another video on the stack (the seed's) gets a demo too, chosen by its guid: no test pattern anywhere
  const other = parts.find((p) => /^[0-9a-f-]{36}$/i.test(p));
  const key = at >= 0 ? demoByGuid.get(parts[at]) : other ? DEMOS[parseInt(other.slice(0, 2), 16) % DEMOS.length].key : undefined;
  const file = parts[parts.length - 1] ?? '';
  if (!key) return route.continue();
  const dir = join(MEDIA, key);
  const headers = { 'access-control-allow-origin': '*', 'cache-control': 'no-store' };
  let path = '';
  let type = '';
  if (/^thumbnail(_\d+)?\.jpg$|^preview\.webp$/.test(file)) [path, type] = [join(dir, 'thumbnail.jpg'), 'image/jpeg'];
  else if (file === 'playlist.m3u8' || file === 'master.m3u8') [path, type] = [join(dir, 'master.m3u8'), 'application/vnd.apple.mpegurl'];
  else if (/^\d+\.m3u8$/.test(file)) [path, type] = [join(dir, '0.m3u8'), 'application/vnd.apple.mpegurl'];
  else if (/^\d+_\d+\.ts$/.test(file)) [path, type] = [join(dir, file.replace(/^\d+_/, '0_')), 'video/mp2t'];
  if (!path || !existsSync(path)) return route.continue();
  return route.fulfill({ status: 200, headers: { ...headers, 'content-type': type }, body: readFileSync(path) });
}

/**
 * /thumb/<id>.jpg (server-rendered cards and the channel grid: lib/embed/share-image.ts) is fetched
 * by the web worker from the fake CDN, out of the browser's reach: answered here with the demo's
 * thumbnail, never the test pattern (owner audit 2026-11-16: colour bars in identity-menu)
 */
async function serveThumb(route: Route): Promise<void> {
  const id = decodeURIComponent(new URL(route.request().url()).pathname.split('/').pop() ?? '').replace(/\.jpg$/, '');
  const key = demoById.get(id) ?? DEMOS[(id.charCodeAt(0) || 0) % DEMOS.length].key;
  const path = join(MEDIA, key, 'thumbnail.jpg');
  if (!existsSync(path)) return route.continue();
  return route.fulfill({ status: 200, headers: { 'content-type': 'image/jpeg', 'cache-control': 'no-store' }, body: readFileSync(path) });
}

/** The CDN guid of one of our videos, from its playback or thumbnail URL */
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

/** Every scene runs whatever another one did; the last test lists all problems at once */
const problems: string[] = [];
const notes: string[] = [];

const data = useOwnData(test as never);
let creator: Creator;
let channelId = '';
let videoId = '';

test.describe.configure({ mode: 'serial' });

test.beforeAll(async ({ browser }) => {
  test.setTimeout(10 * 60_000);
  mkdirSync(CLIPS, { recursive: true });
  // Every clip is made before the first request: ffmpeg blocks the event loop for seconds, and a
  // keep-alive socket the stack closed meanwhile failed the next POST (not retried: not idempotent),
  // as on v2026.11.13.7 ("fetch failed: other side closed" in createVideo)
  for (const demo of DEMOS) makeDemoMedia(demo.key, demo.art);
  creator = await data.createCreator(browser, 'help', { channels: 2 });
  [channelId] = creator.channelIds;
  const user = creator.user;
  const json = (body: unknown, channel?: string) => ({ method: 'PUT', headers: { 'Content-Type': 'application/json', ...(channel ? { channelId: channel } : {}) }, body: JSON.stringify(body) });
  expect((await apiFetch(user, '/api/profile', json({ displayName: NAMES.user.en, displayNameLocalized: NAMES.user, firstName: 'Amina', lastName: 'Yusuf' }))).status).toBeLessThan(300);
  const about = { en: 'Short videos about our neighbourhood and the people in it.', ar: 'مرئيات قصيرة عن حيّنا وأهله.' };
  for (const [id, name, art] of [[creator.channelIds[0], NAMES.channel, 'cms.webp'], [creator.channelIds[1], NAMES.second, 'tools.webp']] as const) {
    expect((await apiFetch(user, `/api/channels/${id}`, json({ name: name.en, nameLocalized: name, description: about.en, descriptionLocalized: about }, id))).status).toBeLessThan(300);
    // A real logo (a crop of the owner's lantern art, resized): channels on the site have one, and
    // without it the watch page showed the stock grey silhouette (audit r2)
    const logo = join(MEDIA, `logo-${art}.jpg`);
    execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', join(ART, art), '-vf', 'scale=400:400', '-q:v', '3', logo]);
    const form = new FormData();
    form.append('photo', new Blob([readFileSync(logo)], { type: 'image/jpeg' }), 'logo.jpg');
    const res = await apiFetch(user, `/api/channels/${id}/avatar`, { method: 'PUT', body: form, headers: { channelId: id } });
    expect(res.status, `channel logo: ${await res.clone().text()}`).toBe(200);
  }
  // The demo videos, oldest first so "Site tour" is the newest (the home page's featured video)
  for (const demo of [...DEMOS].reverse()) {
    const video = await data.createVideo(user, channelId, { clip: 'landscape40', isPublic: true, title: demo.title.en, waitReady: true });
    expect((await apiFetch(user, `/api/videos/${video.id}`, json({ titleLocalized: demo.title, description: 'A short walk through the site: where to watch, comment and switch who you act as.', descriptionLocalized: { en: 'A short walk through the site: where to watch, comment and switch who you act as.', ar: 'جولة قصيرة في الموقع: أين تشاهد وتعلّق وتبدّل الهوية التي تتصرّف بها.' } }, channelId))).status).toBeLessThan(300);
    const guid = await cdnGuid(video.id);
    if (guid) demoByGuid.set(guid, demo.key);
    else problems.push(`no CDN guid for demo video ${demo.key}: it shows the test pattern`);
    demoIds.push(video.id);
    demoById.set(video.id, demo.key);
    if (demo.key === 'tour') videoId = video.id;
  }
  await data.createComment(user, videoId, channelId, NAMES.comment.en);
  await data.createPost(user, channelId, { text: NAMES.post.en });
  // A personal playlist (no channel header: the member's own, #1183)
  const res = await apiFetch(user, '/api/playlists', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: NAMES.playlist.en, titleLocalized: NAMES.playlist, description: '', videos: [videoId], isPublic: false }) });
  // Before #1183 the API wants a channel: the playlists picture then fails alone (listed at the end)
  const playlistId = res.ok ? ((await res.json()) as { result?: { playlist?: { id?: string } } }).result?.playlist?.id : undefined;
  if (!res.ok) problems.push(`personal playlist not created (${res.status}): ${(await res.text()).slice(0, 200)}`);
  if (playlistId) data.onCleanup(`playlist ${playlistId}`, () => apiFetch(user, `/api/playlists/${playlistId}`, { method: 'DELETE' }));
});

async function open(browser: Browser, lang: Lang, device: Device, mode: Mode, opts: { signedIn?: boolean; record?: string } = {}): Promise<{ context: BrowserContext; page: Page }> {
  const v = VIEWPORT[device];
  const context = await browser.newContext({
    // New contexts do not inherit the config's `use`: the stack's proxy for the faked CDN (video, images)
    proxy: { server: 'http://127.0.0.1:3191', bypass: 'localhost,127.0.0.1' },
    ignoreHTTPSErrors: true,
    storageState: opts.signedIn === false ? { cookies: [], origins: [] } : creator.state,
    viewport: { width: v.width, height: v.height },
    deviceScaleFactor: v.scale,
    isMobile: v.mobile,
    hasTouch: v.mobile,
    colorScheme: mode,
    // Still pictures: the lantern street and every transition stand still
    reducedMotion: 'reduce',
    locale: lang === 'ar' ? 'ar' : 'en-US',
    ...(opts.record ? { recordVideo: { dir: opts.record, size: { width: v.width, height: v.height } } } : {}),
  });
  // No consent banner over the pictures (optional tracking declined); the tour stays away by
  // itself in an automated browser
  await context.addCookies([{ name: 'aun_consent', value: `v1.a0.e0.p0.${Date.now()}`, url: target().web, sameSite: 'Lax' }]);
  await context.route((url) => url.hostname === FAKE_CDN_HOST, serveDemo);
  await context.route((url) => url.pathname.startsWith('/thumb/'), serveThumb);
  // Video cards and Up next show only the demo videos: the stack's seed videos carry test titles
  await context.addInitScript((ids: string[]) => {
    const idOf = (el: Element) => el.getAttribute('data-video-id') || decodeURIComponent((el.getAttribute('href') ?? el.querySelector('a[href*="/video/"]')?.getAttribute('href') ?? '').split('/video/')[1]?.split(/[?#/]/)[0] ?? '');
    const hide = () => document.querySelectorAll<HTMLElement>('[data-testid="related-video"], [data-testid="video-card"]').forEach((el) => {
      const id = idOf(el);
      if (id && !ids.includes(id)) ((el.closest('li') as HTMLElement | null) ?? el).style.display = 'none';
    });
    new MutationObserver(hide).observe(document, { subtree: true, childList: true });
  }, demoIds);
  const page = await context.newPage();
  return { context, page };
}

async function settle(page: Page, path: string, lang: Lang): Promise<void> {
  await page.goto(`/${lang}${path}`, { waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('networkidle').catch(() => undefined);
  // The header has settled: the account button, or signed out the solid Sign in
  await expect(page.locator('[data-testid="nav-menu-trigger"]:visible, [data-testid="header-sign-in"]:visible').first()).toBeVisible({ timeout: 30_000 });
  await page.evaluate(() => document.fonts.ready);
}

async function openMenu(page: Page, view: 'main' | 'channels' = 'main'): Promise<Locator> {
  const menu = page.getByTestId('nav-menu');
  await expect(async () => {
    if (!(await menu.isVisible())) await page.getByTestId('nav-menu-trigger').click();
    await expect(menu).toBeVisible({ timeout: 2000 });
  }).toPass({ timeout: 30_000 });
  if (view === 'channels') {
    await menu.getByTestId('nav-switch-channel').click();
    await expect(menu.getByTestId('nav-channel-option-none')).toBeVisible();
  }
  return menu;
}

/**
 * Numbered annotations (Arabic digits in Arabic): one dashed outline per control, in the shape of the
 * control and offset from it, with its number attached to the outline: on the inline-start edge
 * ('side') or the inline-start top corner ('above'), else the next free spot on the outline (on
 * screen, off every other control and number). Never a bare heading. Mirrored in Arabic.
 */
async function mark(page: Page, lang: Lang, targets: Locator[], note: (msg: string) => void, place: 'side' | 'above' = 'side'): Promise<void> {
  await page.evaluate(() => document.querySelectorAll('[data-help-target]').forEach((n) => n.removeAttribute('data-help-target')));
  let shownAny = false;
  for (const [i, t] of targets.entries()) {
    // A control this size or language hides (labels drop to icons, overflow menus) keeps its number
    // free rather than failing the whole picture; the run lists what was skipped
    const shown = await t.waitFor({ state: 'visible', timeout: 10_000 }).then(() => true, () => false);
    if (!shown) {
      note(`marker ${i + 1} not shown: ${t}`);
      continue;
    }
    shownAny = true;
    await t.evaluate((el, n) => el.setAttribute('data-help-target', String(n)), i + 1);
  }
  if (!shownAny) throw new Error('no marker target was shown');
  // One outline per marker, around one control: a bare heading or label is never a marker's target
  const bare = await page.evaluate(() => [...document.querySelectorAll<HTMLElement>('[data-help-target]')]
    .filter((el) => el.matches('h1,h2,h3,h4,h5,h6,[role="heading"],legend,label,.aun-menu-label') || (el.tagName === 'P' && !el.querySelector('a,button,input,select,textarea')))
    .map((el) => `${el.dataset.helpTarget}: <${el.tagName.toLowerCase()}> "${(el.textContent ?? '').trim().slice(0, 40)}"`));
  if (bare.length) throw new Error(`a marker targets a heading, not a control (${bare.join('; ')})`);
  // The targets clear of the sticky header and phone tab bar, and no text left half under either bar
  // (audit r2: privacy-settings' outline ran through the tab bar and covered "Type DELETE to confirm";
  // a page title showed half under the header)
  await page.evaluate(() => {
    const bars = [...document.querySelectorAll<HTMLElement>('body *')].filter((el) => {
      const pos = getComputedStyle(el).position;
      if (pos !== 'fixed' && pos !== 'sticky') return false;
      const b = el.getBoundingClientRect();
      return b.width >= window.innerWidth * 0.6 && b.height > 20 && b.height < window.innerHeight * 0.3;
    }).map((el) => el.getBoundingClientRect());
    const top = Math.max(0, ...bars.filter((b) => b.top <= 1).map((b) => b.bottom));
    const bottom = Math.min(window.innerHeight, ...bars.filter((b) => b.bottom >= window.innerHeight - 1).map((b) => b.top));
    const targets = [...document.querySelectorAll<HTMLElement>('[data-help-target]')].map((t) => t.getBoundingClientRect());
    if (!targets.length) return;
    const uTop = Math.min(...targets.map((b) => b.top)) - 40;
    const uBottom = Math.max(...targets.map((b) => b.bottom)) + 40;
    if (uBottom > bottom) window.scrollBy(0, Math.min(uBottom - bottom, uTop - top));
    else if (uTop < top) window.scrollBy(0, uTop - top);
    // A line of text cut by a bar's edge: move it fully clear when the targets stay in view
    const t2 = [...document.querySelectorAll<HTMLElement>('[data-help-target]')].map((t) => t.getBoundingClientRect());
    const vTop = Math.min(...t2.map((b) => b.top)) - 12;
    const vBottom = Math.max(...t2.map((b) => b.bottom)) + 12;
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (!node.textContent?.trim()) continue;
      const el = node.parentElement;
      if (!el || bars.length === 0 || el.closest('[style*="position: fixed"]')) continue;
      const range = document.createRange();
      range.selectNodeContents(node);
      const b = range.getBoundingClientRect();
      if (b.height <= 0) continue;
      if (b.top < top && b.bottom > top) {
        const down = b.bottom - top + 4; // hide it under the header
        const up = top - b.top + 4; // or show it whole below the header
        if (vBottom + up <= bottom) window.scrollBy(0, -up);
        else if (vTop - down >= top) window.scrollBy(0, down);
        break;
      }
    }
  });
  await page.waitForTimeout(150);
  const unplaced = await page.evaluate(({ rtl, above }) => {
    document.querySelectorAll('[data-help-marker]').forEach((n) => n.remove());
    type Box = { x: number; y: number; w: number; h: number; what?: string; el?: Element | null };
    // An annotation, never UI (owner review 2026-11-16): a dashed outline in annotation red with a
    // white halo, offset from the control, and its number attached to the outline. A fixed red, not a
    // theme token: in Fawanees the 'live' colour is gold, which reads as the site's own focus ring
    // (design audit 2026-11-19). No control on the site is drawn this way.
    const S = 24;
    const GAP = 6;
    const INK = '#d92418';
    const ON_INK = '#ffffff';
    const HALO = 'rgb(255 255 255 / 0.92)';
    const hit = (a: Box, b: Box) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
    const visible = (el: Element) => {
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      return r.width > 1 && r.height > 1 && cs.visibility !== 'hidden' && cs.opacity !== '0';
    };
    const targets = [...document.querySelectorAll<HTMLElement>('[data-help-target]')];
    const controls = [...document.querySelectorAll('a[href], button, input, select, textarea, [role="menuitem"], [role="menuitemradio"], [role="button"], [role="tab"], [role="switch"]')]
      .filter(visible)
      .map((el) => ({ el, r: el.getBoundingClientRect() }));
    // Every visible letter on screen is an obstacle, not only the target's own: a number never covers
    // text, a section label included (#1654: ② sat on «قنواتك» in the glass menu)
    // The letters, not the line box: about 0.8 em tall, centred in the line, full width (Arabic
    // letters overhang their box, so nothing is shaved off the sides)
    const glyphBox = (b: DOMRect, el: Element | null) => {
      const fs = parseFloat(el ? getComputedStyle(el).fontSize : '16') || 16;
      const h = Math.min(b.height, fs * 0.8);
      return { x: b.x, y: b.y + (b.height - h) / 2, w: b.width, h };
    };
    // Text a reader can't see: screen-reader-only labels (1 px boxes, clipped) on icon-only buttons
    const srOnly = (el: Element | null) => {
      for (let e = el; e && e !== document.body; e = e.parentElement) {
        const b = e.getBoundingClientRect();
        const cs = getComputedStyle(e);
        if (b.width <= 2 || b.height <= 2 || (cs.clip && cs.clip !== 'auto') || (cs.clipPath && cs.clipPath !== 'none' && /inset\(50%/.test(cs.clipPath))) return true;
      }
      return false;
    };
    const allText: Box[] = [];
    // ...and the sticky header, for page text scrolled under it
    const overlays = [...document.querySelectorAll<HTMLElement>('[role="menu"], [role="dialog"], [role="listbox"], [data-popover], [data-testid="nav-menu"], [role="banner"], body > header, .ah')].filter(visible);
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (!node.textContent?.trim() || node.parentElement?.closest('[data-help-marker],script,style')) continue;
      const range = document.createRange();
      range.selectNodeContents(node);
      for (const b of range.getClientRects()) {
        if (!(b.width > 0 && b.height > 0 && b.bottom > 0 && b.top < window.innerHeight && b.right > 0 && b.left < window.innerWidth)) continue;
        // Only text a reader can see: not text behind an open menu, dialog or popover that does not
        // contain it (elementFromPoint is no help: it skips pointer-events:none, as menu labels are)
        const cx = b.x + b.width / 2;
        const cy = b.y + b.height / 2;
        const behind = overlays.some((ov) => {
          const r = ov.getBoundingClientRect();
          return cx > r.left && cx < r.right && cy > r.top && cy < r.bottom && !ov.contains(node.parentElement);
        });
        if (!behind && !srOnly(node.parentElement)) allText.push({ ...glyphBox(b, node.parentElement), what: `"${(node.textContent ?? '').trim().slice(0, 24)}"`, el: node.parentElement });
      }
    }
    // Pictures, icons and checkboxes anywhere on screen: a number never sits on one (audit r2: ① on
    // the «أ» avatar, ③ on the TV icon, ① on a row checkbox)
    const pictures: Box[] = [...document.querySelectorAll<HTMLElement>('img, svg, input[type="checkbox"], input[type="radio"], [role="img"], span, div')]
      .filter((el) => {
        if (!visible(el) || el.closest('[data-help-marker]')) return false;
        // Not pictures behind an open menu or dialog (page images under the account menu)
        const pb = el.getBoundingClientRect();
        const pcx = pb.x + pb.width / 2;
        const pcy = pb.y + pb.height / 2;
        if (overlays.some((ov) => { const r = ov.getBoundingClientRect(); return pcx > r.left && pcx < r.right && pcy > r.top && pcy < r.bottom && !ov.contains(el); })) return false;
        const tag = el.tagName.toLowerCase();
        const b = el.getBoundingClientRect();
        if (b.bottom < 0 || b.top > window.innerHeight) return false;
        if (tag === 'img' || tag === 'svg' || tag === 'input' || el.getAttribute('role') === 'img') return b.width <= 160 && b.height <= 160;
        // An avatar or badge drawn as a round box (a letter on a filled circle)
        const rr = parseFloat(getComputedStyle(el).borderTopLeftRadius) || 0;
        return b.width >= 12 && b.width <= 64 && Math.abs(b.width - b.height) < 2 && rr >= b.width / 2 - 0.5;
      })
      .map((el) => { const b = el.getBoundingClientRect(); return { x: b.x, y: b.y, w: b.width, h: b.height, el, what: `<${el.tagName.toLowerCase()}${el.getAttribute('data-testid') ? ` ${el.getAttribute('data-testid')}` : ''}${typeof el.className === 'string' && el.className ? ` .${el.className.split(' ')[0]}` : ''}>` }; });
    const placed: Box[] = [];
    // Outline bands already drawn (the dashed line and its halo): a later number never sits on one
    const bands: Box[] = [];
    let missed = 0;
    const faults: string[] = [];
    for (const target of targets) {
      const r = target.getBoundingClientRect();
      // The outline: the control's own shape (round around an avatar), GAP px outside it
      const radius = parseFloat(getComputedStyle(target).borderTopLeftRadius) || 0;
      const round = radius >= Math.min(r.width, r.height) / 2 - 0.5;
      // Neighbouring targets (rows of one menu) keep their outlines apart: the gap shrinks to half
      // the space between them (design audit 2026-11-19: the rows' outlines overlapped)
      const near = targets.filter((t) => t !== target).map((t) => t.getBoundingClientRect()).reduce((min, b) => {
        const dx = Math.max(0, b.x - (r.x + r.width), r.x - (b.x + b.width));
        const dy = Math.max(0, b.y - (r.y + r.height), r.y - (b.y + b.height));
        return Math.min(min, Math.max(dx, dy));
      }, Infinity);
      const gap = Math.max(1, Math.min(GAP, Math.floor(near / 2) - 1));
      // The target's own letters (also used for the number below)
      const ownText: Box[] = [];
      const words = document.createTreeWalker(target, NodeFilter.SHOW_TEXT);
      for (let node = words.nextNode(); node; node = words.nextNode()) {
        if (!node.textContent?.trim() || srOnly(node.parentElement)) continue;
        const range = document.createRange();
        range.selectNodeContents(node);
        ownText.push(...[...range.getClientRects()].filter((b) => b.width > 0 && b.height > 0).map((b) => glyphBox(b, node.parentElement)));
      }
      // The outline keeps 4 px of clear space from every letter (audit r2: it cut through "Site tour",
      // which is wider than its link box, and hugged "English"). Its visible band is 4 px deep inside
      // (2 px dash + 2 px halo) and 2 px outside (halo), so own letters stay 8 px inside its edge and
      // any other text 6 px outside it.
      const IN = 8;
      const OUT = 6;
      const rect = (l: number, t: number, rr: number, b: number) => ({ x: l, y: t, w: rr - l, h: b - t });
      const textL = Math.min(...ownText.map((b) => b.x)) - IN;
      const textT = Math.min(...ownText.map((b) => b.y)) - IN;
      const textR = Math.max(...ownText.map((b) => b.x + b.w)) + IN;
      const textB = Math.max(...ownText.map((b) => b.y + b.h)) + IN;
      const outline = (g: number) => rect(Math.min(r.x - g, textL), Math.min(r.y - g, textT), Math.max(r.x + r.width + g, textR), Math.max(r.y + r.height + g, textB));
      const within = (t: Box, o: Box) => t.x >= o.x + IN && t.y >= o.y + IN && t.x + t.w <= o.x + o.w - IN && t.y + t.h <= o.y + o.h - IN;
      const centreIn = (t: Box) => { const cx = t.x + t.w / 2; const cy = t.y + t.h / 2; return cx > r.x && cx < r.x + r.width && cy > r.y && cy < r.y + r.height; };
      const mine = (t: Box) => (t.el ? target.contains(t.el) : false) || centreIn(t);
      const foreign = allText.filter((t) => !mine(t));
      // Anything meaningful outside the target: other text, and pictures, icons, avatars and badges
      const foreignPics = pictures.filter((p) => !mine(p));
      // Text keeps 4 px from the band; a picture or icon only may not touch it (2 px halo)
      const near4 = (o: Box) => [
        ...foreign.filter((t) => hit(t, { x: o.x - OUT, y: o.y - OUT, w: o.w + OUT * 2, h: o.h + OUT * 2 }) && !within(t, o)),
        ...foreignPics.filter((t) => hit(t, { x: o.x - 2, y: o.y - 2, w: o.w + 4, h: o.h + 4 }) && !(t.x >= o.x + 4 && t.y >= o.y + 4 && t.x + t.w <= o.x + o.w - 4 && t.y + t.h <= o.y + o.h - 4)),
      ];
      // Loose first (the usual gap), else as tight as the target's own letters allow
      let o = outline(gap);
      if (near4(o).length) o = outline(-1);
      const crowd = near4(o);
      if (crowd.length) faults.push(`outline ${target.dataset.helpTarget} is within 4 px of ${crowd.slice(0, 2).map((c) => c.what ?? '?').join(', ')}`);
      if (ownText.some((t) => !within(t, o))) faults.push(`outline ${target.dataset.helpTarget} is within 4 px of its own text`);
      const ring = document.createElement('span');
      ring.dataset.helpMarker = '';
      Object.assign(ring.style, {
        position: 'fixed', left: `${o.x}px`, top: `${o.y}px`, width: `${o.w}px`, height: `${o.h}px`, boxSizing: 'border-box',
        border: `2px dashed ${INK}`, borderRadius: round ? '9999px' : `${radius + gap}px`,
        boxShadow: `0 0 0 2px ${HALO}, inset 0 0 0 2px ${HALO}`, zIndex: '2147483646', pointerEvents: 'none',
      });
      // The number sits on the outline (centred on its edge or corner), so it reads as part of it
      const startX = rtl ? o.x + o.w - S / 2 : o.x - S / 2;
      const endX = rtl ? o.x - S / 2 : o.x + o.w - S / 2;
      const topY = o.y - S / 2;
      const bottomY = o.y + o.h - S / 2;
      const midY = o.y + o.h / 2 - S / 2;
      // A round outline has no corner: the number goes on the circle at 45°
      const k = round ? (1 - Math.SQRT1_2) * (o.w / 2) : 0;
      const cornerStartX = rtl ? startX - k : startX + k;
      const cornerEndX = rtl ? endX + k : endX - k;
      // A small round target (an avatar) keeps its face clear: the number sits just outside the
      // circle, touching it, above or below (design audit 2026-11-19: '1' covered the composer avatar)
      const centreX = o.x + o.w / 2 - S / 2;
      const outside: Array<[number, number]> = round && o.w <= 64 ? [[centreX, o.y - S + 2], [centreX, o.y + o.h - 2]] : [];
      // Last resorts, still touching the outline: just outside its start or end edge, or above/below
      // its start corner
      // (touching the outline from outside, so a text-only target keeps the outline's gap as clear space)
      const beyond: Array<[number, number]> = [
        [rtl ? o.x - S : o.x + o.w, midY], [rtl ? o.x + o.w : o.x - S, midY],
        [rtl ? o.x + o.w - S : o.x, o.y - S], [rtl ? o.x + o.w - S : o.x, o.y + o.h],
      ];
      // Inside the outline, at its inline-start or inline-end side: full-width rows of a phone menu
      // have no free edge (the start edge is off screen, the corners touch the next row), but their
      // ends are empty (#1654)
      const inside: Array<[number, number]> = round ? [] : [
        [rtl ? o.x + o.w - S - 4 : o.x + 4, midY], [rtl ? o.x + 4 : o.x + o.w - S - 4, midY],
      ];
      // ...and along the row's middle line, moving in from its end past an end icon or chevron
      // (a menu row with icons at both ends: "Switch channel")
      if (!round && o.h >= S + 8) {
        for (let d = 12; d <= o.w / 2; d += 8) inside.push([rtl ? o.x + d : o.x + o.w - S - d, midY]);
      }
      // Then anywhere along the outline, on it or just outside it, every 8 px from the inline start
      const along: Array<[number, number]> = [];
      for (let d = 0; d <= o.w - S; d += 8) {
        const ax = rtl ? o.x + o.w - S - d : o.x + d;
        along.push([ax, topY], [ax, bottomY], [ax, o.y - S], [ax, o.y + o.h]);
      }
      for (let d = 0; d <= o.h - S; d += 8) along.push([startX, o.y + d], [endX, o.y + d], [rtl ? o.x + o.w : o.x - S, o.y + d], [rtl ? o.x - S : o.x + o.w, o.y + d]);
      const candidates: Array<[number, number]> = above
        ? [...outside, [cornerStartX, topY + k], [cornerEndX, topY + k], [cornerStartX, bottomY - k], [cornerEndX, bottomY - k], ...inside, ...beyond, ...along]
        : [...outside, [startX, midY], [endX, midY], [cornerStartX, topY + k], [cornerStartX, bottomY - k], ...inside, ...beyond, ...along];
      // The target's own avatar or logo stays clear too: a number on it hides who the row is
      // (design audit 2026-11-19: '١' over «أ» in the phone picker)
      const ownPictures = [...target.querySelectorAll<HTMLElement>('img, svg, span, div')]
        .filter((el) => {
          if (!visible(el)) return false;
          const b = el.getBoundingClientRect();
          const rr = parseFloat(getComputedStyle(el).borderTopLeftRadius) || 0;
          // Icons too (the ✓ on the active row), any shape
          if (el.tagName.toLowerCase() === 'svg') return b.width >= 8 && b.width <= 40;
          return b.width >= 16 && b.width <= 64 && Math.abs(b.width - b.height) < 2 && (el.tagName === 'IMG' || rr >= b.width / 2 - 0.5);
        })
        .map((el) => el.getBoundingClientRect());
      // (the target's own text is an obstacle too: ownText, above)
      const shrink = (b: DOMRect) => ({ x: b.x + 2, y: b.y + 2, w: Math.max(0, b.width - 4), h: Math.max(0, b.height - 4) });
      // Text boxes are the letters (glyphBox), so a number in the line spacing above a heading is clear
      // Clear space (owner audit rule 2026-11-19: touching counts as overlap): at least 4 px between a
      // number's visible edge, its 2 px white halo included, and any letter
      const HALO_PX = 2 + 4;
      const reach = (b: Box) => ({ x: b.x - HALO_PX, y: b.y - HALO_PX, w: b.w + HALO_PX * 2, h: b.h + HALO_PX * 2 });
      const texts = [...ownText, ...allText];
      const others = [
        ...controls.filter((c) => c.el !== target && !c.el.contains(target) && !target.contains(c.el)).map((c) => shrink(c.r)),
        ...ownPictures.map(shrink),
        ...pictures.map((b) => ({ x: b.x - 2, y: b.y - 2, w: b.w + 4, h: b.h + 4 })),
        ...bands,
        ...texts,
      ];
      const fits = ([x, y]: [number, number]) => {
        const box = { x, y, w: S, h: S };
        return x >= 2 && y >= 2 && x + S <= window.innerWidth - 2 && y + S <= window.innerHeight - 2
          && !others.some((c) => hit(box, c)) && !texts.some((t) => hit(reach(box), t)) && !placed.some((q) => hit(box, q));
      };
      const spot = candidates.find(fits);
      if (!spot) missed++;
      // No clean spot: the on-screen spot that covers the least, and never another number (#1654: the
      // old fallback put ① and ② on the same corner, so ① vanished under ②)
      const area = (a: Box, b: Box) => Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
      const cost = ([cx, cy]: [number, number]) => {
        const box = { x: cx, y: cy, w: S, h: S };
        if (cx < 2 || cy < 2 || cx + S > window.innerWidth - 2 || cy + S > window.innerHeight - 2) return Infinity;
        if (placed.some((q) => hit(box, q))) return Infinity;
        return texts.reduce((n, t) => n + area(reach(box), t) * 10, 0) + others.reduce((n, t) => n + area(box, t), 0);
      };
      const [x, y] = spot ?? [...candidates].sort((a, b) => cost(a) - cost(b))[0];
      // Checked, not hoped: a number on text or on another number fails the picture (checked before
      // this number joins the placed ones, so it is never compared with itself)
      const box = { x, y, w: S, h: S };
      const nearText = texts.find((t) => hit(reach(box), t));
      if (nearText) faults.push(`number ${target.dataset.helpTarget} is within 4 px of text ${nearText.what ?? ''}`);
      const onPic = pictures.find((p) => hit(box, { x: p.x + 1, y: p.y + 1, w: Math.max(0, p.w - 2), h: Math.max(0, p.h - 2) }));
      if (onPic) faults.push(`number ${target.dataset.helpTarget} covers ${onPic.what ?? 'a picture'}`);
      if (cost([x, y]) === Infinity) faults.push(`number ${target.dataset.helpTarget} has no spot on screen clear of the other numbers`);
      placed.push({ x, y, w: S, h: S });
      // This outline's band (the four edges, 4 px either side of the dashed line) for the next numbers
      for (const e of [{ x: o.x - 4, y: o.y - 4, w: o.w + 8, h: 8 }, { x: o.x - 4, y: o.y + o.h - 4, w: o.w + 8, h: 8 }, { x: o.x - 4, y: o.y - 4, w: 8, h: o.h + 8 }, { x: o.x + o.w - 4, y: o.y - 4, w: 8, h: o.h + 8 }]) bands.push(e);
      const m = document.createElement('span');
      m.dataset.helpMarker = '';
      m.textContent = Number(target.dataset.helpTarget).toLocaleString(rtl ? 'ar-u-nu-arab' : 'en');
      Object.assign(m.style, {
        position: 'fixed', left: `${Math.min(window.innerWidth - S - 2, Math.max(2, x))}px`, top: `${Math.max(2, y)}px`, zIndex: '2147483647',
        width: `${S}px`, height: `${S}px`, borderRadius: '50%', display: 'grid', placeItems: 'center',
        font: '700 13px/1 system-ui, sans-serif', background: INK, color: ON_INK,
        boxShadow: `0 0 0 2px ${HALO}, 0 2px 6px rgb(0 0 0 / 0.35)`, pointerEvents: 'none',
      });
      document.body.append(ring, m);
    }
    return { missed, faults };
  }, { rtl: lang === 'ar', above: place === 'above' });
  // Not silent: the run lists every picture whose number had to sit on another control
  if (unplaced.missed) note(`${unplaced.missed} marker(s) found no spot clear of other controls`);
  if (unplaced.faults.length) throw new Error(`markers: ${unplaced.faults.join('; ')}`);
}

/** A screenshot of the area around `region` (the whole viewport when empty), saved as WebP */
async function shoot(page: Page, file: string, region: Locator[] = []): Promise<void> {
  // The run account's address (e2e+<run>…@e2e.alummahnow.net) reads as noise: show an example one
  await page.evaluate(() => {
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (node.textContent && /e2e\.alummahnow\.net|^e2e\+/.test(node.textContent)) {
        node.textContent = node.textContent.replace(/e2e\+[^@\s]*/g, 'amina').replace(/@?e2e\.alummahnow\.net/g, '@example.com');
      }
      // Run-tagged handles (@E2Ehelp<run>…) read as noise too
      if (node.textContent && /@E2E[\w-]+/i.test(node.textContent)) node.textContent = node.textContent.replace(/@E2E[\w-]+/gi, '@communitycorner');
    }
    document.querySelectorAll<HTMLElement>('[title*="e2e.alummahnow.net"]').forEach((el) => { el.title = 'amina@example.com'; });
    // A handle rendered as two text nodes ("@" + "E2Ehelp<run>…", e.g. <bdi>@{handle}</bdi>) slips past
    // the per-node pass: rewrite the smallest element whose whole text is a run handle
    document.querySelectorAll<HTMLElement>('body *').forEach((el) => {
      if (el.children.length === 0 && /^\s*E2E[\w-]+\s*$/i.test(el.textContent ?? '')) el.textContent = 'communitycorner';
      else if (el.childElementCount === 0 && /@\s*E2E[\w-]+/i.test(el.textContent ?? '')) el.textContent = (el.textContent ?? '').replace(/@\s*E2E[\w-]+/gi, '@communitycorner');
    });
    // Field values are not text nodes: the profile's (read-only) email field showed the run address
    document.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>('input, textarea').forEach((el) => {
      if (/e2e\+|e2e\.alummahnow\.net/.test(el.value)) el.value = 'amina@example.com';
      else if (/@?E2E[\w-]+/i.test(el.value)) el.value = el.value.replace(/@?E2E[\w-]+/gi, (m) => (m.startsWith('@') ? '@communitycorner' : 'communitycorner'));
    });
  });
  // Checked, not hoped: no run account, run handle or run address anywhere a reader can see
  const leaks = await page.evaluate(() => {
    const bad = /e2e\+|e2e\.alummahnow\.net|@\s*E2E[\w-]|\bE2E[a-z]+\d{6,}/i;
    const out: string[] = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const el = node.parentElement;
      if (!el || !bad.test(node.textContent ?? '') || el.closest('script,style')) continue;
      const r = el.getBoundingClientRect();
      if (r.width > 0 && r.height > 0 && r.bottom > 0 && r.top < innerHeight) out.push((node.textContent ?? '').trim().slice(0, 60));
    }
    document.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>('input, textarea').forEach((el) => { if (bad.test(el.value)) out.push(`field: ${el.value.slice(0, 60)}`); });
    return out;
  });
  if (leaks.length) throw new Error(`test data shows: ${leaks.join(' | ')}`);
  const viewport = page.viewportSize()!;
  let clip: { x: number; y: number; width: number; height: number } | undefined;
  if (region.length) {
    // The numbers too: a header control's number sits just under the header
    const markers = await page.locator('[data-help-marker]').all();
    const boxes = (await Promise.all([...region, ...markers].map((r) => r.boundingBox()))).filter(Boolean) as { x: number; y: number; width: number; height: number }[];
    const pad = 24;
    const x = Math.max(0, Math.min(...boxes.map((b) => b.x)) - pad);
    const y = Math.max(0, Math.min(...boxes.map((b) => b.y)) - pad);
    const right = Math.min(viewport.width, Math.max(...boxes.map((b) => b.x + b.width)) + pad);
    const bottom = Math.min(viewport.height, Math.max(...boxes.map((b) => b.y + b.height)) + pad);
    clip = { x, y, width: right - x, height: bottom - y };
    // No edge cuts through anything (audit r2: a title cut in half, tab-bar labels cut off, the logo
    // clipped at the right): each edge moves out past every text line, picture, control or marker it
    // crosses, and a sticky bar it crosses is taken whole, with the full width
    clip = await page.evaluate((c) => {
      type R = { l: number; t: number; r: number; b: number };
      const items: R[] = [];
      const add = (b: DOMRect) => { if (b.width > 0 && b.height > 0 && b.bottom > 0 && b.top < innerHeight) items.push({ l: b.left, t: b.top, r: b.right, b: b.bottom }); };
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        if (!node.textContent?.trim()) continue;
        const range = document.createRange();
        range.selectNodeContents(node);
        for (const b of range.getClientRects()) add(b);
      }
      document.querySelectorAll('img, svg, input, select, textarea, button, [role="img"], [data-help-marker]').forEach((el) => add(el.getBoundingClientRect()));
      const bars: R[] = [];
      document.querySelectorAll<HTMLElement>('body *').forEach((el) => {
        const pos = getComputedStyle(el).position;
        if (pos !== 'fixed' && pos !== 'sticky') return;
        const b = el.getBoundingClientRect();
        if (b.width >= innerWidth * 0.6 && b.height > 20 && b.height < innerHeight * 0.3) bars.push({ l: 0, t: b.top, r: innerWidth, b: b.bottom });
      });
      let l = c.x; let t = c.y; let r = c.x + c.width; let b = c.y + c.height;
      for (let pass = 0; pass < 12; pass++) {
        let moved = false;
        for (const bar of bars) {
          if (bar.b > t && bar.t < b && (bar.t < t || bar.b > b || l > 0 || r < innerWidth)) {
            if (bar.t < t) { t = Math.max(0, bar.t); moved = true; }
            if (bar.b > b) { b = Math.min(innerHeight, bar.b); moved = true; }
            if (l > 0 || r < innerWidth) { l = 0; r = innerWidth; moved = true; }
          }
        }
        for (const it of items) {
          const xOver = it.r > l && it.l < r;
          const yOver = it.b > t && it.t < b;
          if (xOver && it.t < t && it.b > t) { t = Math.max(0, it.t - 4); moved = true; }
          if (xOver && it.t < b && it.b > b) { b = Math.min(innerHeight, it.b + 4); moved = true; }
          if (yOver && it.l < l && it.r > l) { l = Math.max(0, it.l - 4); moved = true; }
          if (yOver && it.l < r && it.r > r) { r = Math.min(innerWidth, it.r + 4); moved = true; }
        }
        if (!moved) break;
      }
      return { x: l, y: t, width: r - l, height: b - t };
    }, clip);
  }
  const png = join(OUT, `${file}.png`);
  await page.screenshot({ path: png, clip, animations: 'disabled' });
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', png, '-c:v', 'libwebp', '-quality', '82', '-compression_level', '6', join(OUT, `${file}.webp`)]);
  rmSync(png);
}

interface Scene {
  id: string;
  signedIn?: boolean;
  /** Where the numbers go (see mark) */
  markers?: 'side' | 'above';
  /** Puts the page in the state the picture shows; returns [markers, region] */
  run: (page: Page, lang: Lang, device: Device) => Promise<[Locator[], Locator[]]>;
}

const header = (page: Page) => page.locator('header.ah');

const SCENES: Scene[] = [
  {
    id: 'start-signin',
    signedIn: false,
    run: async (page, lang) => {
      await settle(page, '', lang);
      return [[page.getByTestId('header-sign-in')], [header(page)]];
    },
  },
  {
    id: 'start-profile',
    run: async (page, lang) => {
      await settle(page, '/profile/edit', lang);
      const field = page.locator('#profile-displayName');
      await field.scrollIntoViewIfNeeded();
      return [[field], [field.locator('xpath=ancestor::section[1]')]];
    },
  },
  {
    id: 'watching-actions',
    markers: 'above',
    run: async (page, lang) => {
      await settle(page, `/video/${videoId}`, lang);
      const like = page.getByTestId('video-like-button').first();
      const later = page.getByTestId('watch-later-button').first();
      // The playlist button (#1183 gives it a test id; before, its ListPlus icon tells it apart from Share)
      const save = page.getByTestId('save-to-playlist-button').or(page.locator('.watch-actions button:has(svg.lucide-list-plus)')).first();
      await like.scrollIntoViewIfNeeded();
      return [[like, later, save], [page.locator('.watch-actions').first(), page.getByTestId('watch-channel').first()]];
    },
  },
  {
    id: 'watching-library',
    run: async (page, lang) => {
      await settle(page, '/library', lang);
      // The shelves themselves, never their headings alone (annotations mark controls, owner review)
      const later = page.getByTestId('library-section-watch-later');
      const history = page.getByTestId('library-section-history');
      return [[later, history], []];
    },
  },
  {
    id: 'watching-playlists',
    run: async (page, lang) => {
      await settle(page, '/library/playlists', lang);
      const item = page.getByTestId('playlist-manager-item').first();
      const create = page.getByTestId('new-playlist-link');
      return [[item, create], []];
    },
  },
  {
    id: 'identity-menu',
    run: async (page, lang) => {
      await settle(page, `/channels/${channelId}`, lang);
      const menu = await openMenu(page);
      return [[menu.getByTestId('nav-profile-link'), menu.getByTestId('nav-active-channel'), menu.getByTestId('nav-switch-channel')], [header(page), menu]];
    },
  },
  {
    // Markers: you (tagged Personal), then your channel (tagged Channel). One control per marker,
    // never a heading row by itself (owner review 2026-11-16)
    id: 'identity-switch',
    run: async (page, lang) => {
      await settle(page, `/channels/${channelId}`, lang);
      const menu = await openMenu(page, 'channels');
      return [[menu.getByTestId('nav-channel-option-none'), menu.getByTestId('nav-channel-option').first()], [header(page), menu]];
    },
  },
  {
    id: 'identity-comment',
    markers: 'above',
    run: async (page, lang) => {
      await settle(page, `/video/${videoId}`, lang);
      const line = page.getByTestId('comment-identity').first();
      await line.scrollIntoViewIfNeeded();
      const box = page.getByTestId('comment-input').first();
      // The whole composer card with its buttons, and the section's heading row above it in full: the
      // crop never slices a heading or a button (owner audit 2026-11-16)
      const composer = line.locator('xpath=ancestor::div[contains(concat(" ", normalize-space(@class), " "), " space-y-3 ")][1]');
      const headingRow = page.getByTestId('comments-count').first().locator('xpath=..');
      // The avatar of whoever you act as (no 'Commenting as' text, no Switch: owner 2026-11-15), then the box
      return [[line, box], [headingRow, composer]];
    },
  },
  {
    id: 'creating-upload',
    run: async (page, lang) => {
      await settle(page, `/upload?channel=${channelId}`, lang);
      const drop = page.locator('[data-testid="batch-dropzone"], [data-testid="upload-dropzone"]').first();
      // The page's channel picker, not the header's search
      const picker = page.getByRole('main').getByRole('combobox').first();
      return [[picker, drop], []];
    },
  },
  {
    id: 'creating-studio',
    run: async (page, lang) => {
      await settle(page, `/studio/${channelId}/content/videos`, lang);
      // Studio lists the title in the page language when the creator wrote one
      const row = page.getByRole('row').filter({ hasText: NAMES.video[lang] }).first();
      const edit = row.getByRole('link').or(row.getByRole('button')).first();
      return [[row, edit], []];
    },
  },
  {
    id: 'community-tab',
    run: async (page, lang) => {
      await settle(page, `/channels/${channelId}?tab=community`, lang);
      const post = page.locator('article').filter({ hasText: NAMES.post.en }).first();
      await post.getByRole('button', { name: /comment|تعليق/i }).first().click();
      const line = post.getByTestId('comment-identity').first();
      await line.scrollIntoViewIfNeeded();
      await post.scrollIntoViewIfNeeded();
      return [[line], [post]];
    },
  },
  {
    id: 'privacy-settings',
    run: async (page, lang) => {
      await settle(page, '/settings/privacy', lang);
      const exportCard = page.locator('section[aria-labelledby="privacy-export"]');
      const deleteCard = page.locator('section').filter({ has: page.getByRole('heading', { name: /^(Delete your data|حذف بياناتك)$/ }) }).first();
      await exportCard.scrollIntoViewIfNeeded();
      // The two cards, never their headings alone
      return [[exportCard, deleteCard], []];
    },
  },
  {
    id: 'appearance-rail',
    markers: 'above',
    run: async (page, lang) => {
      // The home page: its featured picture sits under the header, so the numbers below the toggles have
      // clear space (a channel page put its name right under them, within 4 px)
      // No unread badge beside the language pill: it can't be 4 px clear of that outline (audit r2)
      await apiFetch(creator.user, '/api/notifications/read-all', { method: 'POST' });
      await settle(page, '', lang);
      // Language and light/dark are in the top bar at every width (docs/design/NAV.md "Header")
      const theme = header(page).getByTestId('theme-toggle');
      const language = header(page).getByTestId('language-toggle');
      return [[theme, language], [header(page)]];
    },
  },
];


/** How many numbered items Help lists under this picture (every figure that shows it) */
function listedMarkers(help: HelpTranslations, picture: string): number[] {
  return Object.values(help.topics).flatMap((topic) => topic.sections.flatMap((section) => section.blocks))
    .filter((block): block is Extract<typeof block, { type: 'figure' }> => block.type === 'figure' && block.picture === picture)
    .map((block) => block.markers?.length ?? 0);
}

for (const scene of SCENES) {
  test(`picture ${scene.id}`, async ({ browser }) => {
    test.setTimeout(8 * 60_000);
    for (const lang of LANGS) for (const device of DEVICES) for (const mode of MODES) {
      const name = `${scene.id}.${lang}.${device}.${mode}`;
      const { context, page } = await open(browser, lang, device, mode, { signedIn: scene.signedIn });
      try {
        const [markers, region] = await scene.run(page, lang, device);
        // Each picture's numbers match the numbered list Help shows under it
        const listed = listedMarkers(lang === 'ar' ? HELP_AR : HELP_EN, scene.id);
        if (listed.some((n) => n !== markers.length)) throw new Error(`${markers.length} markers, but Help lists ${listed.join('/')} under this picture`);
        await mark(page, lang, markers, (msg) => notes.push(`${name}: ${msg}`), scene.markers);
        await shoot(page, name, region);
      } catch (error) {
        problems.push(`${name}: ${(error as Error).message.split('\n').slice(0, 4).join(' ')}`);
        await page.screenshot({ path: test.info().outputPath(`${name}.failed.png`), fullPage: false }).catch(() => undefined);
      } finally {
        await context.close();
      }
    }
  });
}

/** Records `act` in a fresh desktop context; keeps from `act` on, trimmed to `seconds`, plus a still */
async function clip(browser: Browser, id: string, lang: Lang, mode: Mode, prepare: (page: Page) => Promise<void>, act: (page: Page) => Promise<void>, seconds = 10): Promise<void> {
  try {
    await recordClip(browser, id, lang, mode, prepare, act, seconds);
  } catch (error) {
    problems.push(`clip ${id}.${lang}.${mode}: ${(error as Error).message.split('\n').slice(0, 4).join(' ')}`);
  }
}

async function recordClip(browser: Browser, id: string, lang: Lang, mode: Mode, prepare: (page: Page) => Promise<void>, act: (page: Page) => Promise<void>, seconds: number): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), 'help-clip-'));
  try {
    const started = Date.now();
    const { context, page } = await open(browser, lang, 'desktop', mode, { record: dir });
    // Recorded clips move: only they keep motion on
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    let offset = 0;
    try {
      await prepare(page);
      await page.screenshot({ path: join(CLIPS, `${id}.${lang}.${mode}.png`) });
      offset = (Date.now() - started) / 1000;
      await act(page);
      await page.waitForTimeout(1200);
    } finally {
      await context.close();
    }
    const raw = readdirSync(dir).find((f) => f.endsWith('.webm'))!;
    execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-ss', offset.toFixed(2), '-t', String(seconds), '-i', join(dir, raw), '-an', '-c:v', 'libvpx-vp9', '-b:v', '0', '-crf', '40', '-row-mt', '1', join(CLIPS, `${id}.${lang}.${mode}.webm`)]);
    const png = join(CLIPS, `${id}.${lang}.${mode}.png`);
    execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', png, '-c:v', 'libwebp', '-quality', '80', join(CLIPS, `${id}.${lang}.${mode}.webp`)]);
    rmSync(png);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('clip identity-switch', async ({ browser }) => {
  test.setTimeout(6 * 60_000);
  for (const lang of LANGS) for (const mode of MODES) {
    await clip(browser, 'identity-switch', lang, mode, async (page) => {
      await settle(page, `/video/${videoId}`, lang);
      await page.getByTestId('comment-identity').first().scrollIntoViewIfNeeded();
    }, async (page) => {
      const menu = await openMenu(page, 'channels');
      await page.waitForTimeout(600);
      await menu.getByTestId('nav-channel-option-none').click();
      await expect(page.getByTestId('comment-identity').first()).toHaveAttribute('data-as', 'member', { timeout: 30_000 });
      await page.waitForTimeout(1500);
      // Back to the channel, so every other picture shows it active
      const again = await openMenu(page, 'channels');
      await again.locator(`[data-testid="nav-channel-option"][data-channel-id="${channelId}"]`).click();
      await expect(page.getByTestId('comment-identity').first()).toHaveAttribute('data-as', 'channel', { timeout: 30_000 });
    }, 12);
  }
});

test('clip creating-upload', async ({ browser }) => {
  test.setTimeout(6 * 60_000);
  const uploaded: string[] = [];
  data.onCleanup('help clip uploads', async () => {
    for (const id of uploaded) await apiFetch(creator.user, `/api/videos/${id}`, { method: 'DELETE', headers: { channelId } });
  });
  for (const lang of LANGS) for (const mode of MODES) {
    await clip(browser, 'creating-upload', lang, mode, async (page) => {
      await settle(page, `/upload?channel=${channelId}`, lang);
    }, async (page) => {
      page.on('response', async (res) => {
        if (/\/api\/videos\/upload\/initiate$/.test(res.url()) && res.ok()) {
          const body = (await res.json().catch(() => ({}))) as { videoId?: string; result?: { videoId?: string } };
          const id = body.videoId ?? body.result?.videoId;
          if (id) uploaded.push(id);
        }
      });
      // A fresh copy each time: the same file twice is "Already uploaded"
      const clipPath = join(__dirname, '../test-fixtures/e2e-sample-40s.mp4');
      const copy = join(tmpdir(), `help-upload-${lang}-${mode}-${Date.now()}.mp4`);
      execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', clipPath, '-c', 'copy', '-metadata', `comment=${copy}`, copy]);
      await page.locator('[data-testid="batch-file-input"], input[type="file"]').first().setInputFiles(copy);
      await page.waitForTimeout(5000);
      rmSync(copy, { force: true });
    }, 9);
  }
});

test('clip watching-mini-player', async ({ browser }) => {
  test.setTimeout(6 * 60_000);
  for (const lang of LANGS) for (const mode of MODES) {
    await clip(browser, 'watching-mini-player', lang, mode, async (page) => {
      await settle(page, `/video/${videoId}`, lang);
      await playFor(page, 0.5);
    }, async (page) => {
      await page.waitForTimeout(1500);
      // Down to the comments: the player floats in the corner (lib/video/mini-player.ts)
      await page.getByTestId('comment-input').first().scrollIntoViewIfNeeded();
      await page.mouse.wheel(0, 400);
      await expect(page.getByTestId('player-mini-return').first()).toBeVisible({ timeout: 15_000 });
      await page.waitForTimeout(3500);
    }, 9);
  }
});

test('every picture and clip was made', () => {
  if (notes.length) console.log(`Skipped markers:\n${notes.join('\n')}`);
  expect(problems, problems.join('\n')).toEqual([]);
});

test.afterAll(() => rmSync(MEDIA, { recursive: true, force: true }));
