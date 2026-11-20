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
    // A real @handle at the source (the run's @E2Ehelp<run>… showed in the clips, which no text pass reaches)
    const handle = name.en.toLowerCase().replace(/[^a-z0-9]/g, '');
    expect((await apiFetch(user, `/api/channels/${id}`, json({ name: name.en, nameLocalized: name, description: about.en, descriptionLocalized: about, handle }, id))).status).toBeLessThan(300);
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
  // The page at its top first: an open menu locks the page's scroll, so a page left part-scrolled (a
  // title half under the header) could not be fixed afterwards
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
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
      return b.width >= window.innerWidth * 0.6 && b.height > 20 && b.height < window.innerHeight * 0.3 && (b.top <= 1 || b.bottom >= window.innerHeight - 1);
    }).map((el) => el.getBoundingClientRect());
    const top = Math.max(0, ...bars.filter((b) => b.top <= 1).map((b) => b.bottom));
    const bottom = Math.min(window.innerHeight, ...bars.filter((b) => b.bottom >= window.innerHeight - 1).map((b) => b.top));
    const targets = [...document.querySelectorAll<HTMLElement>('[data-help-target]')].map((t) => t.getBoundingClientRect());
    if (!targets.length) return;
    const uTop = Math.min(...targets.map((b) => b.top)) - 40;
    const uBottom = Math.max(...targets.map((b) => b.bottom)) + 40;
    if (uBottom > bottom) window.scrollBy(0, Math.min(uBottom - bottom, uTop - top));
    else if (uTop < top) window.scrollBy(0, uTop - top);
    // No line of text left half under the header or tab bar: a small scroll (up to 48 px either way)
    // that keeps the targets in view
    const straddle = (): number => {
      let n = 0;
      const tb = [...document.querySelectorAll<HTMLElement>('[data-help-target]')].map((t) => t.getBoundingClientRect());
      if (Math.min(...tb.map((b) => b.top)) < top + 4 || Math.max(...tb.map((b) => b.bottom)) > bottom - 4) n += 1000;
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        const el = node.parentElement;
        if (!node.textContent?.trim() || !el) continue;
        const pos = getComputedStyle(el).position;
        if (el.closest('[data-help-marker]') || pos === 'fixed' || pos === 'sticky') continue;
        const range = document.createRange();
        range.selectNodeContents(node);
        for (const b of range.getClientRects()) {
          if (b.height <= 0) continue;
          // Only an edge with a bar on it: the window's own edge is the crop's job (a desktop page has no
          // bar at the bottom, and keeping card titles whole there pushed the channel title under the header)
          if ((top > 0 && b.top < top && b.bottom > top) || (bottom < window.innerHeight && b.top < bottom && b.bottom > bottom)) {
            // In a bar itself is fine
            if (bars.some((br) => b.top >= br.top - 0.5 && b.bottom <= br.bottom + 0.5 && b.left >= br.left - 0.5 && b.right <= br.right + 0.5)) continue;
            n++;
          }
        }
      }
      return n;
    };
    // The best offset found: targets in view first, then the fewest cut lines (never the last tried)
    const y0 = window.scrollY;
    let best = y0;
    let bestN = Infinity;
    for (const d of [0, ...Array.from({ length: 24 }, (_, k) => [(k + 1) * 2, -(k + 1) * 2]).flat()]) {
      window.scrollTo(0, y0 + d);
      const n = straddle();
      if (n < bestN) { bestN = n; best = window.scrollY; }
      if (n === 0) break;
    }
    window.scrollTo(0, best);
  });
  await page.waitForTimeout(150);
  // A scrolling list that cuts an item at its own edge (the side rail's list): scrolled so no line of
  // text straddles the list's top or bottom (audit r3: the rail's last item half under its edge)
  await page.evaluate(() => {
    const lists = [...document.querySelectorAll<HTMLElement>('body *')].filter((el) => {
      const cs = getComputedStyle(el);
      return /(auto|scroll)/.test(cs.overflowY) && el.scrollHeight > el.clientHeight + 2 && el.getBoundingClientRect().height > 80;
    });
    // Lines of text and icons cut at the list's top or bottom (audit r4: the rail's last icon showed
    // cut with its label below the edge, so a text-only count saw nothing)
    const straddles = (list: HTMLElement) => {
      const lr = list.getBoundingClientRect();
      const cut = (b: DOMRect) => b.height > 0 && ((b.top < lr.top - 0.5 && b.bottom > lr.top + 0.5) || (b.top < lr.bottom - 0.5 && b.bottom > lr.bottom + 0.5));
      let n = 0;
      const walker = document.createTreeWalker(list, NodeFilter.SHOW_TEXT);
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        if (!node.textContent?.trim()) continue;
        const range = document.createRange();
        range.selectNodeContents(node);
        for (const b of range.getClientRects()) if (cut(b)) n++;
      }
      list.querySelectorAll('svg, img, [role="img"]').forEach((el) => { if (!(el.closest('svg') && el.tagName.toLowerCase() !== 'svg') && cut(el.getBoundingClientRect())) n++; });
      return n;
    };
    for (const list of lists) {
      // Every offset, nearest first: the first with nothing cut, else the one cutting least
      const start = list.scrollTop;
      const max = list.scrollHeight - list.clientHeight;
      let best = start;
      let bestN = Infinity;
      for (let d = 0; d <= max; d += 2) {
        for (const at of d ? [start + d, start - d] : [start]) {
          if (at < 0 || at > max) continue;
          list.scrollTop = at;
          const n = straddles(list);
          if (n < bestN) { bestN = n; best = list.scrollTop; }
          if (!n) break;
        }
        if (!bestN) break;
      }
      list.scrollTop = best;
    }
  });
  await page.evaluate(PAGE_HELPERS);
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
    // Clear space (owner audit rule 2026-11-19: touching counts as overlap)
    const CLEAR = 4;
    const hit = (a: Box, b: Box) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
    const grow = (b: Box, d: number): Box => ({ ...b, x: b.x - d, y: b.y - d, w: b.w + d * 2, h: b.h + d * 2 });
    const contains = (o: Box, t: Box) => t.x >= o.x && t.y >= o.y && t.x + t.w <= o.x + o.w && t.y + t.h <= o.y + o.h;
    const fromRect = (b: DOMRect, extra: Partial<Box> = {}): Box => ({ x: b.x, y: b.y, w: b.width, h: b.height, ...extra });
    const visible = (el: Element) => {
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      return r.width > 1 && r.height > 1 && cs.visibility !== 'hidden' && cs.opacity !== '0';
    };
    // Text a reader can't see: screen-reader-only labels (1 px boxes, clipped) on icon-only buttons
    const srOnly = (el: Element | null) => {
      for (let e = el; e && e !== document.body; e = e.parentElement) {
        const b = e.getBoundingClientRect();
        const cs = getComputedStyle(e);
        // A tiny box only hides what it clips (the sr-only pattern: 1 px, overflow hidden); a 0x0 menu
        // anchor or a display: contents wrapper measures 0x0 but shows its children
        const tiny = (b.width <= 2 || b.height <= 2) && cs.display !== 'contents' && (cs.overflow !== 'visible' || cs.overflowX !== 'visible' || cs.overflowY !== 'visible');
        if (tiny || (cs.clip && cs.clip !== 'auto') || (cs.clipPath && /inset\(50%/.test(cs.clipPath))) return true;
      }
      return false;
    };
    // Open menus and dialogs: what lies behind them (and is not in them) is not seen
    const overlays = [...document.querySelectorAll<HTMLElement>('[role="menu"], [role="dialog"], [role="listbox"], [data-popover], [data-testid="nav-menu"]')].filter(visible);
    // Hidden: at least 60% of it behind an open menu or dialog that does not contain it
    const hidden = (b0: Box, el: Element | null) => overlays.some((ov) => {
      const r = ov.getBoundingClientRect();
      if (ov.contains(el)) return false;
      // A part of the same open menu never hides the menu's own text (its channel list is a listbox
      // inside the menu; the menu's 'Your channels' label is not in that listbox)
      if (overlays.some((home) => home.contains(el) && (home.contains(ov) || ov.contains(home)))) return false;
      // And the overlay is really painted over it, at its centre
      const cx = Math.min(innerWidth - 1, Math.max(0, b0.x + b0.w / 2));
      const cy = Math.min(innerHeight - 1, Math.max(0, b0.y + b0.h / 2));
      const onTop = document.elementFromPoint(cx, cy);
      if (!onTop || !ov.contains(onTop)) return false;
      // The on-screen part only
      const bx = Math.max(0, b0.x); const by = Math.max(0, b0.y);
      const b = { x: bx, y: by, w: Math.min(innerWidth, b0.x + b0.w) - bx, h: Math.min(innerHeight, b0.y + b0.h) - by };
      if (b.w <= 0 || b.h <= 0) return true;
      const ix = Math.max(0, Math.min(b.x + b.w, r.right) - Math.max(b.x, r.left));
      const iy = Math.max(0, Math.min(b.y + b.h, r.bottom) - Math.max(b.y, r.top));
      return (ix * iy) / (b.w * b.h) >= 0.6;
    });
    // Every line of visible text, as its line box (ascenders and descenders included, measured, not guessed)
    const texts: Box[] = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const el = node.parentElement;
      if (!node.textContent?.trim() || !el || el.closest('[data-help-marker],script,style') || srOnly(el)) continue;
      const range = document.createRange();
      range.selectNodeContents(node);
      for (const b of range.getClientRects()) {
        if (b.width <= 0 || b.height <= 0 || b.bottom < 0 || b.top > innerHeight) continue;
        const box = fromRect(b, { what: `"${(node.textContent ?? '').trim().slice(0, 24)}"`, el });
        if (!hidden(box, el)) texts.push(box);
      }
    }
    // Pictures, icons, avatars, badges and checkboxes
    const pictures: Box[] = [...document.querySelectorAll<HTMLElement>('img, svg, input[type="checkbox"], input[type="radio"], [role="img"], span, div')]
      .filter((el) => {
        if (!visible(el) || el.closest('[data-help-marker]')) return false;
        const tag = el.tagName.toLowerCase();
        const b = el.getBoundingClientRect();
        if (b.bottom < 0 || b.top > innerHeight) return false;
        if (tag === 'svg' && el.parentElement?.closest('svg')) return false;
        if (tag === 'img' || tag === 'svg' || tag === 'input' || el.getAttribute('role') === 'img') return b.width <= 160 && b.height <= 160;
        const rr = parseFloat(getComputedStyle(el).borderTopLeftRadius) || 0;
        return b.width >= 12 && b.width <= 64 && Math.abs(b.width - b.height) < 2 && rr >= b.width / 2 - 0.5;
      })
      .map((el) => fromRect(el.getBoundingClientRect(), { el, what: `<${el.tagName.toLowerCase()}${el.getAttribute('data-testid') ? ` ${el.getAttribute('data-testid')}` : ''}>` }))
      .filter((b) => !hidden(b, b.el ?? null));
    // The sticky header and phone tab bar
    const bars: Box[] = [...document.querySelectorAll<HTMLElement>('body *')].filter((el) => {
      const pos = getComputedStyle(el).position;
      if (pos !== 'fixed' && pos !== 'sticky') return false;
      const b = el.getBoundingClientRect();
      return b.width >= innerWidth * 0.6 && b.height > 20 && b.height < innerHeight * 0.3 && (b.top <= 1 || b.bottom >= innerHeight - 1);
    }).map((el) => fromRect(el.getBoundingClientRect(), { el }));
    const straddlesBar = (b: Box) => bars.some((bar) => hit(b, bar) && !contains(bar, b));
    const onScreen = (b: Box) => b.x >= 2 && b.y >= 2 && b.x + b.w <= innerWidth - 2 && b.y + b.h <= innerHeight - 2;

    const targets = [...document.querySelectorAll<HTMLElement>('[data-help-target]')];
    const rects = targets.map((t) => t.getBoundingClientRect());
    const faults: string[] = [];
    let missed = 0;
    // Pass 1: every outline. Its dashed line and halo reach 2 px outside it and 4 px inside it.
    // Text keeps CLEAR px from that band on both sides; a picture never touches it; two outlines keep
    // CLEAR px between their bands (so each may reach at most (gap - 2*2 - CLEAR) / 2 toward a neighbour)
    const rings: Box[] = [];
    const radii: number[] = [];
    // Number-only markers: where no outline can keep the clear space (a menu row right under its label,
    // two header buttons 4 px apart), the control gets its number alone (owner, 2026-11-20)
    const bare: boolean[] = [];
    for (const [i, target] of targets.entries()) {
      const r = rects[i];
      const mine = (b: Box) => (b.el ? target.contains(b.el) : false);
      const ownText = texts.filter(mine);
      const otherText = texts.filter((t) => !mine(t));
      const otherPics = pictures.filter((p) => !mine(p) && !(p.el && p.el.contains(target)) && !contains({ x: r.x, y: r.y, w: r.width, h: r.height }, p));
      // Own text stays inside the band plus CLEAR: 4 + 4 = 8 px from the outline's edge
      const IN = 4 + CLEAR;
      const OUT = 2 + CLEAR;
      const own = ownText.length ? {
        l: Math.min(...ownText.map((b) => b.x)) - IN, t: Math.min(...ownText.map((b) => b.y)) - IN,
        r: Math.max(...ownText.map((b) => b.x + b.w)) + IN, b: Math.max(...ownText.map((b) => b.y + b.h)) + IN,
      } : null;
      const outline = (g: number): Box => {
        let l = r.x - g; let t = r.y - g; let rr = r.right + g; let bb = r.bottom + g;
        if (own) { l = Math.min(l, own.l); t = Math.min(t, own.t); rr = Math.max(rr, own.r); bb = Math.max(bb, own.b); }
        return { x: l, y: t, w: rr - l, h: bb - t };
      };
      // A neighbouring card (the next section 8 px below) is never reached by the outline either, or
      // no crop could show the outline whole without a sliver of that card (audit r4/r5)
      const otherCards = (window as unknown as { __help: { cards: () => Element[] } }).__help.cards()
        .filter((el) => !el.contains(target) && !target.contains(el))
        .map((el) => fromRect(el.getBoundingClientRect(), { el, what: `<${el.tagName.toLowerCase()}> card` }))
        .filter((b) => !contains({ x: r.x, y: r.y, w: r.width, h: r.height }, b));
      const crowded = (o: Box) => [
        ...otherText.filter((t) => hit(t, grow(o, OUT)) && !contains(grow(o, -IN), t)),
        ...otherPics.filter((p) => hit(p, grow(o, 2)) && !contains(grow(o, -4), p)),
        ...otherCards.filter((cd) => hit(cd, grow(o, 2)) && !contains(cd, grow(o, 2))),
      ];
      // Toward a neighbouring target, at most half the free space after both bands and CLEAR
      const near = rects.filter((_, j) => j !== i).reduce((min, b) => {
        const dx = Math.max(0, b.x - r.right, r.x - b.right);
        const dy = Math.max(0, b.y - r.bottom, r.y - b.bottom);
        return Math.min(min, Math.max(dx, dy));
      }, Infinity);
      const gMax = Math.min(GAP, Math.floor((near - 4 - CLEAR) / 2));
      const barClash = (b: Box) => straddlesBar(grow(b, 2));
      let o = outline(gMax);
      for (let g = gMax; g >= gMax - 16 && (crowded(o).length || barClash(o)); g--) o = outline(g);
      bare.push(crowded(o).length > 0 || straddlesBar(grow(o, 2)));
      rings.push(o);
      radii.push(parseFloat(getComputedStyle(target).borderTopLeftRadius) || 0);
    }
    // Two outlines closer than CLEAR: the later one goes number-only
    for (let i = 0; i < rings.length; i++) for (let j = i + 1; j < rings.length; j++) {
      if (bare[i] || bare[j]) continue;
      const a = grow(rings[i], 2);
      const b = grow(rings[j], 2);
      if (hit(grow(a, CLEAR), b) && !contains(a, b) && !contains(b, a)) bare[j] = true;
    }
    // A number-only marker is placed against the control itself
    for (const [i, isBare] of bare.entries()) if (isBare) rings[i] = fromRect(rects[i]);
    // The bands of every outline (2 px out, 4 px in), as four strips
    const band = (o: Box): Box[] => [
      { x: o.x - 2, y: o.y - 2, w: o.w + 4, h: 6 }, { x: o.x - 2, y: o.y + o.h - 4, w: o.w + 4, h: 6 },
      { x: o.x - 2, y: o.y - 2, w: 6, h: o.h + 4 }, { x: o.x + o.w - 4, y: o.y - 2, w: 6, h: o.h + 4 },
    ];
    // Pass 2: the numbers. A number's visible box is its circle plus the 2 px halo
    const numbers: Box[] = [];
    for (const [i, target] of targets.entries()) {
      const o = rings[i];
      const n = target.dataset.helpTarget;
      const r = rects[i];
      const round = radii[i] >= Math.min(r.width, r.height) / 2 - 0.5;
      const otherBands = rings.flatMap((ring, j) => (j === i || bare[j] ? [] : band(ring)));
      // A control in the header: its number may hang from the header's edge, under it
      const homeBar = bars.find((bar) => contains(bar, grow(o, 2)));
      // Its own control's pictures: never on them; any other picture: CLEAR px away (audit r4: the check)
      const tRect = { x: r.x, y: r.y, w: r.width, h: r.height };
      const isMine = (b: Box) => !!b.el && (target.contains(b.el) || contains(tRect, b));
      // A control in an open menu keeps its number inside that menu (audit r4: 1 out on the banner)
      const homes = overlays.filter((ov) => ov.contains(target));
      const homeMenu = homes.find((ov) => !homes.some((o2) => o2 !== ov && o2.contains(ov)));
      const menuBox = homeMenu ? fromRect(homeMenu.getBoundingClientRect()) : null;
      // ...and never shares the line of another row's text beside it (audit r4: 1 on 'Acting as')
      const otherRow = (v: Box) => texts.some((tx) => !isMine(tx) && tx.y < v.y + v.h - 1 && tx.y + tx.h > v.y + 1 && !(tx.y < r.bottom && tx.y + tx.h > r.top)
        && Math.max(tx.x - (v.x + v.w), v.x - (tx.x + tx.w)) < 24);
      // Why a spot is refused ('' = fine): listed in the run when a number finds no spot
      const why = ([x, y]: [number, number]): string => {
        const v = grow({ x, y, w: S, h: S }, 2);
        if (!onScreen(v)) return 'off screen';
        if (straddlesBar(v) && !(!!homeBar && hit(v, homeBar) && bars.every((bar) => bar === homeBar || !hit(v, bar)))) return 'bar edge';
        if (menuBox && !contains(menuBox, v)) return `outside menu ${Math.round(menuBox.x)},${Math.round(menuBox.y)} ${Math.round(menuBox.w)}x${Math.round(menuBox.h)}`;
        if (otherRow(v)) return 'another row';
        const tx = texts.find((t) => hit(grow(v, CLEAR), t));
        if (tx) return `text ${tx.what}`;
        const pc = pictures.find((p) => (isMine(p) && !bare[i] ? hit(v, p) : hit(grow(v, CLEAR), p)));
        if (pc) return `picture ${pc.what}`;
        if (numbers.some((q) => hit(grow(v, CLEAR), q))) return 'number';
        if (otherBands.some((b) => hit(v, b))) return 'outline';
        return '';
      };
      const ok = (c: [number, number]) => !why(c);
      const midY = o.y + o.h / 2 - S / 2;
      const startX = rtl ? o.x + o.w - S / 2 : o.x - S / 2;
      const endX = rtl ? o.x - S / 2 : o.x + o.w - S / 2;
      const k = round ? (1 - Math.SQRT1_2) * (o.w / 2) : 0;
      const cands: Array<[number, number]> = [];
      // On the outline first: its corners and edge middles, inline start before end
      if (above) cands.push([rtl ? startX - k : startX + k, o.y - S / 2 + k], [rtl ? endX + k : endX - k, o.y - S / 2 + k]);
      cands.push([startX, midY], [endX, midY]);
      cands.push([rtl ? startX - k : startX + k, o.y - S / 2 + k], [rtl ? startX - k : startX + k, o.y + o.h - S / 2 - k], [rtl ? endX + k : endX - k, o.y - S / 2 + k], [rtl ? endX + k : endX - k, o.y + o.h - S / 2 - k]);
      // Then inside, on its middle line, inward from the end: the number reads as the row's own (a
      // spot just outside the outline sat beside the next row's text, e.g. 3 beside 'Studio')
      for (let d = 6; d <= o.w / 2; d += 4) cands.push([rtl ? o.x + d : o.x + o.w - S - d, midY]);
      // Then anywhere along the outline, every 4 px, on it, just outside it or just inside it
      for (let d = 0; d <= o.w - S; d += 4) {
        const ax = rtl ? o.x + o.w - S - d : o.x + d;
        cands.push([ax, o.y - S / 2], [ax, o.y + o.h - S / 2], [ax, o.y - S - 2], [ax, o.y + o.h + 2], [ax, o.y + 6], [ax, o.y + o.h - S - 6]);
      }
      for (let d = 0; d <= o.h - S; d += 4) {
        cands.push([startX, o.y + d], [endX, o.y + d], [rtl ? o.x + o.w + 2 : o.x - S - 2, o.y + d], [rtl ? o.x - S - 2 : o.x + o.w + 2, o.y + d], [rtl ? o.x + o.w - S - 6 : o.x + 6, o.y + d], [rtl ? o.x + 6 : o.x + o.w - S - 6, o.y + d]);
      }
      // ...and its middle line, inward from the end (a row with icons at both ends)
      for (let d = 12; d <= o.w / 2; d += 4) cands.push([rtl ? o.x + d : o.x + o.w - S - d, midY]);
      // A number must touch its own outline (on it, or within 6 px of it)
      const touches = ([x, y]: [number, number]) => hit(grow({ x, y, w: S, h: S }, 6), grow(o, 2)) && !contains(grow(o, -10), { x, y, w: S, h: S });
      // A number-only marker sits on its control's middle line (inward from the end, then from the
      // start) or right beside it, centred on it: never in the gap between two rows
      const bareCands: Array<[number, number]> = [];
      for (let d = 4; d <= o.w / 2; d += 4) bareCands.push([rtl ? o.x + d : o.x + o.w - S - d, midY]);
      for (let d = 4; d <= o.w / 2; d += 4) bareCands.push([rtl ? o.x + o.w - S - d : o.x + d, midY]);
      bareCands.push([rtl ? o.x - S - 4 : o.x + o.w + 4, midY], [rtl ? o.x + o.w + 4 : o.x - S - 4, midY]);
      // A header control: under it, centred, hanging from the header (no room beside it)
      bareCands.push([o.x + o.w / 2 - S / 2, o.y + o.h + 2]);
      const spot = bare[i] ? bareCands.find(ok) : cands.filter(touches).find(ok);
      if (!spot) {
        missed++;
        const tried = (bare[i] ? bareCands : cands.filter(touches)).slice(0, 4).map((c) => `${Math.round(c[0])},${Math.round(c[1])}: ${why(c)}`);
        faults.push(`number ${n} has no spot clear of text, pictures, other numbers and outlines (target ${Math.round(r.x)},${Math.round(r.y)} ${Math.round(r.width)}x${Math.round(r.height)}; ${tried.join('; ')})`);
      }
      const [x, y] = spot ?? [startX, midY];
      numbers.push(grow({ x, y, w: S, h: S }, 2));
      const ring = document.createElement('span');
      ring.dataset.helpMarker = '';
      ring.dataset.helpRing = n;
      Object.assign(ring.style, {
        position: 'fixed', left: `${o.x}px`, top: `${o.y}px`, width: `${o.w}px`, height: `${o.h}px`, boxSizing: 'border-box',
        border: `2px dashed ${INK}`, borderRadius: round ? '9999px' : `${Math.max(4, radii[i] + 4)}px`,
        boxShadow: `0 0 0 2px ${HALO}, inset 0 0 0 2px ${HALO}`, zIndex: '2147483646', pointerEvents: 'none',
      });
      const m = document.createElement('span');
      m.dataset.helpMarker = '';
      m.dataset.helpNum = n;
      m.textContent = Number(n).toLocaleString(rtl ? 'ar-u-nu-arab' : 'en');
      Object.assign(m.style, {
        position: 'fixed', left: `${x}px`, top: `${y}px`, zIndex: '2147483647',
        width: `${S}px`, height: `${S}px`, borderRadius: '50%', display: 'grid', placeItems: 'center',
        font: '700 13px/1 system-ui, sans-serif', background: INK, color: ON_INK,
        boxShadow: `0 0 0 2px ${HALO}, 0 2px 6px rgb(0 0 0 / 0.35)`, pointerEvents: 'none',
      });
      if (bare[i]) m.dataset.helpBare = '';
      document.body.append(...(bare[i] ? [m] : [ring, m]));
    }
    const bareList = targets.filter((_, i) => bare[i]).map((t) => t.dataset.helpTarget);
    return { missed, faults, bareList };
  }, { rtl: lang === 'ar', above: place === 'above' });
  // Not silent: the run lists every picture whose number had to sit on another control
  if (unplaced.missed) note(`${unplaced.missed} marker(s) found no spot clear of other controls`);
  if (unplaced.bareList.length) note(`number-only markers: ${unplaced.bareList.join(', ')}`);
  if (unplaced.faults.length) throw new Error(`markers: ${unplaced.faults.join('; ')}`);
}

/**
 * The final check, separate from the placement (audit r3: a checker that reuses the placer's own
 * estimates passed pictures that broke its rules). Right before the screenshot it measures the page as
 * it is, inside the crop: line boxes of visible text, pictures, icons and checkboxes, the drawn
 * outlines and numbers (from the DOM, after any reflow), and the header and tab bar. Any break of a
 * rule fails the picture:
 * - a number (circle + 2 px halo) within 4 px of a letter, or on a picture, another number or another
 *   outline's band;
 * - text within 4 px of an outline's band (2 px out, 4 px in) unless it sits well inside it; a picture
 *   touching a band; two outline bands within 4 px of each other;
 * - a marker straddling the header or tab bar edge;
 * - a line of text cut by the crop edge, half under a bar, half covered by another element, or cut by a
 *   scrolling list's edge.
 */
async function verifyFrame(page: Page, clip: { x: number; y: number; width: number; height: number } | undefined, name = ''): Promise<void> {
  await page.evaluate(PAGE_HELPERS);
  const { problems, skipped } = await page.evaluate((c) => {
    type Box = { x: number; y: number; w: number; h: number; what?: string; el?: Element | null };
    const CLEAR = 4;
    const frame: Box = c ? { x: c.x, y: c.y, w: c.width, h: c.height } : { x: 0, y: 0, w: innerWidth, h: innerHeight };
    const hit = (a: Box, b: Box) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
    const grow = (b: Box, d: number): Box => ({ ...b, x: b.x - d, y: b.y - d, w: b.w + d * 2, h: b.h + d * 2 });
    const contains = (o: Box, t: Box) => t.x >= o.x - 0.5 && t.y >= o.y - 0.5 && t.x + t.w <= o.x + o.w + 0.5 && t.y + t.h <= o.y + o.h + 0.5;
    const fromRect = (b: DOMRect, extra: Partial<Box> = {}): Box => ({ x: b.x, y: b.y, w: b.width, h: b.height, ...extra });
    const visible = (el: Element) => {
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      return r.width > 1 && r.height > 1 && cs.visibility !== 'hidden' && cs.opacity !== '0';
    };
    const srOnly = (el: Element | null) => {
      for (let e = el; e && e !== document.body; e = e.parentElement) {
        const b = e.getBoundingClientRect();
        const cs = getComputedStyle(e);
        // A tiny box only hides what it clips (the sr-only pattern: 1 px, overflow hidden); a 0x0 menu
        // anchor or a display: contents wrapper measures 0x0 but shows its children
        const tiny = (b.width <= 2 || b.height <= 2) && cs.display !== 'contents' && (cs.overflow !== 'visible' || cs.overflowX !== 'visible' || cs.overflowY !== 'visible');
        if (tiny || (cs.clip && cs.clip !== 'auto') || (cs.clipPath && /inset\(50%/.test(cs.clipPath))) return true;
      }
      return false;
    };
    const overlays = [...document.querySelectorAll<HTMLElement>('[role="menu"], [role="dialog"], [role="listbox"], [data-popover], [data-testid="nav-menu"]')].filter(visible);
    // Hidden: at least 60% of it behind an open menu or dialog that does not contain it
    const hidden = (b0: Box, el: Element | null) => overlays.some((ov) => {
      const r = ov.getBoundingClientRect();
      if (ov.contains(el)) return false;
      // A part of the same open menu never hides the menu's own text (its channel list is a listbox
      // inside the menu; the menu's 'Your channels' label is not in that listbox)
      if (overlays.some((home) => home.contains(el) && (home.contains(ov) || ov.contains(home)))) return false;
      // And the overlay is really painted over it, at its centre
      const cx = Math.min(innerWidth - 1, Math.max(0, b0.x + b0.w / 2));
      const cy = Math.min(innerHeight - 1, Math.max(0, b0.y + b0.h / 2));
      const onTop = document.elementFromPoint(cx, cy);
      if (!onTop || !ov.contains(onTop)) return false;
      // The on-screen part only
      const bx = Math.max(0, b0.x); const by = Math.max(0, b0.y);
      const b = { x: bx, y: by, w: Math.min(innerWidth, b0.x + b0.w) - bx, h: Math.min(innerHeight, b0.y + b0.h) - by };
      if (b.w <= 0 || b.h <= 0) return true;
      const ix = Math.max(0, Math.min(b.x + b.w, r.right) - Math.max(b.x, r.left));
      const iy = Math.max(0, Math.min(b.y + b.h, r.bottom) - Math.max(b.y, r.top));
      return (ix * iy) / (b.w * b.h) >= 0.6;
    });
    const bars: Box[] = [...document.querySelectorAll<HTMLElement>('body *')].filter((el) => {
      const pos = getComputedStyle(el).position;
      if (pos !== 'fixed' && pos !== 'sticky') return false;
      const b = el.getBoundingClientRect();
      return b.width >= innerWidth * 0.6 && b.height > 20 && b.height < innerHeight * 0.3 && (b.top <= 1 || b.bottom >= innerHeight - 1);
    }).map((el) => fromRect(el.getBoundingClientRect(), { el }));
    // Is (x, y) covered by something that isn't `el` or part of it? Markers ignore the pointer, so
    // they never count; a bar does
    // Covered: under a fixed or sticky strip (the header, tab bar) or an open menu or dialog, never by a
    // neighbouring line's box (a heading's and its subtitle's line boxes overlap)
    const coverer = (top: Element | null, el: Element) => {
      if (!top || top === el || el.contains(top) || top.contains(el)) return false;
      for (let e: Element | null = top; e && e !== document.body; e = e.parentElement) {
        if (e.contains(el)) return false;
        const cs = getComputedStyle(e);
        if (cs.position === 'fixed' || cs.position === 'sticky' || e.matches('[role="menu"], [role="dialog"], [role="listbox"], [data-popover], [data-testid="nav-menu"]')) return true;
      }
      return false;
    };
    const coveredAt = (el: Element, x: number, y: number) => {
      if (x < 0 || y < 0 || x >= innerWidth || y >= innerHeight) return false;
      return coverer(document.elementFromPoint(x, y), el);
    };
    const out: string[] = [];
    const texts: Box[] = [];
    // Text the check leaves out, listed in the log when it sits near a marker (so a wrong skip shows)
    const skippedNodes: { el: Element; node: Node; why: string }[] = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const el = node.parentElement;
      if (!node.textContent?.trim() || !el || el.closest('[data-help-marker],script,style')) continue;
      if (srOnly(el)) { skippedNodes.push({ el, node, why: 'screen-reader-only' }); continue; }
      const range = document.createRange();
      range.selectNodeContents(node);
      for (const b of range.getClientRects()) {
        if (b.width <= 0 || b.height <= 0) continue;
        const box = fromRect(b, { what: `"${(node.textContent ?? '').trim().slice(0, 24)}"`, el });
        // Less than a pixel of it inside the frame shows nothing (a tab strip's next tab starting at the
        // screen's edge): not a line in the picture
        const inW = Math.min(box.x + box.w, frame.x + frame.w) - Math.max(box.x, frame.x);
        const inH = Math.min(box.y + box.h, frame.y + frame.h) - Math.max(box.y, frame.y);
        if (inW < 1 || inH < 1) continue;
        // Out of sight inside its list or clipping box (the rail's item below the list's edge): not shown
        const helpV = (window as unknown as { __help: { visible: (e: Element, r: { l: number; t: number; r: number; b: number }) => unknown } }).__help;
        const seenPart = helpV.visible(el, { l: b.left, t: b.top, r: b.right, b: b.bottom }) as { l: number; t: number; r: number; b: number } | null;
        if (!seenPart) continue;
        if (hidden(box, el)) { skippedNodes.push({ el, node, why: 'hidden' }); continue; }
        texts.push(box);
        // Cut by the frame's edge
        // Its visible part: a line half behind the open menu shows only below the menu
        if (!contains(frame, { x: seenPart.l, y: seenPart.t, w: seenPart.r - seenPart.l, h: seenPart.b - seenPart.t })) out.push(`text ${box.what} at ${Math.round(box.x)},${Math.round(box.y)} ${Math.round(box.w)}x${Math.round(box.h)} is cut by the picture's edge (frame ${Math.round(frame.x)},${Math.round(frame.y)} ${Math.round(frame.w)}x${Math.round(frame.h)})`);
        // Half under a bar (not in it)
        const bar = bars.find((br) => hit(box, br) && !contains(br, box) && !(br.el && br.el.contains(el)));
        if (bar) out.push(`text ${box.what} is half under the header or tab bar`);
        // Cut by a scrolling list or clipping box around it
        for (let a = el.parentElement; a && a !== document.body; a = a.parentElement) {
          const cs = getComputedStyle(a);
          if (cs.overflowY === 'visible' && cs.overflowX === 'visible') continue;
          const ar = a.getBoundingClientRect();
          const abox = { x: ar.x, y: ar.y, w: ar.width, h: ar.height };
          // A scrolling list cuts at its edge; a clipping box (overflow hidden, e.g. the one-line logo)
          // only cuts letters when its content really overflows it (more than 3 px of layout past
          // it), not when the font's box (ascent and descent, taller in Arabic) pokes past
          const scrolls = /auto|scroll/.test(cs.overflowY);
          const over = Math.max(abox.y - box.y, box.y + box.h - (abox.y + abox.h));
          // For a clipping box, the letters' ink (canvas metrics for this font), not the font's box
          const ink = (() => {
            const ctx = document.createElement('canvas').getContext('2d');
            if (!ctx) return box;
            const ecs = getComputedStyle(el);
            ctx.font = `${ecs.fontStyle} ${ecs.fontWeight} ${ecs.fontSize} ${ecs.fontFamily}`;
            const m = ctx.measureText((node.textContent ?? '').trim());
            const top = box.y + (m.fontBoundingBoxAscent - m.actualBoundingBoxAscent) + (box.h - m.fontBoundingBoxAscent - m.fontBoundingBoxDescent) / 2;
            return { ...box, y: top, h: m.actualBoundingBoxAscent + m.actualBoundingBoxDescent };
          })();
          const clips = scrolls ? over > 0 : ink.y < abox.y - 0.5 || ink.y + ink.h > abox.y + abox.h + 0.5;
          if (hit(box, abox) && !contains(abox, box) && cs.overflowY !== 'visible' && clips) { out.push(`text ${box.what} is cut by its list's edge`); break; }
        }
        // Half covered by another element (sampled across the line, inside the frame)
        const ys = [box.y + 2, box.y + box.h / 2, box.y + box.h - 2];
        const xs = [box.x + 2, box.x + box.w / 2, box.x + box.w - 2];
        let seen = 0;
        let covered = 0;
        let by = '';
        for (const y of ys) for (const x of xs) {
          if (!contains(frame, { x, y, w: 0, h: 0 })) continue;
          if (coveredAt(el, x, y)) { covered++; const top = document.elementFromPoint(x, y); by = by || (top ? `<${top.tagName.toLowerCase()}${typeof top.className === 'string' && top.className ? ` .${top.className.split(' ')[0]}` : ''}>` : ''); } else seen++;
        }
        if (covered && seen) out.push(`text ${box.what} is half covered by ${by}`);
      }
    }
    const pictures: Box[] = [...document.querySelectorAll<HTMLElement>('img, svg, input[type="checkbox"], input[type="radio"], [role="img"], span, div')]
      .filter((el) => {
        if (!visible(el) || el.closest('[data-help-marker]')) return false;
        const tag = el.tagName.toLowerCase();
        const b = el.getBoundingClientRect();
        if (tag === 'svg' && el.parentElement?.closest('svg')) return false;
        if (tag === 'img' || tag === 'svg' || tag === 'input' || el.getAttribute('role') === 'img') return b.width <= 160 && b.height <= 160;
        const rr = parseFloat(getComputedStyle(el).borderTopLeftRadius) || 0;
        return b.width >= 12 && b.width <= 64 && Math.abs(b.width - b.height) < 2 && rr >= b.width / 2 - 0.5;
      })
      .map((el) => fromRect(el.getBoundingClientRect(), { el, what: `<${el.tagName.toLowerCase()}${el.getAttribute('data-testid') ? ` ${el.getAttribute('data-testid')}` : ''}>` }))
      .filter((b) => hit(b, frame) && !hidden(b, b.el ?? null));
    const rings = [...document.querySelectorAll<HTMLElement>('[data-help-ring]')].map((el) => fromRect(el.getBoundingClientRect(), { what: el.dataset.helpRing, el: document.querySelector(`[data-help-target="${el.dataset.helpRing}"]`) }));
    const ownOf = (o: Box, p: Box) => {
      if (!o.el || !p.el) return false;
      if (o.el === p.el || o.el.contains(p.el) || p.el.contains(o.el)) return true;
      const tr = o.el.getBoundingClientRect();
      return contains({ x: tr.x, y: tr.y, w: tr.width, h: tr.height }, p);
    };
    const ringOf = (n?: string) => rings.find((o) => o.what === n);
    const nums = [...document.querySelectorAll<HTMLElement>('[data-help-num]')].map((el) => grow(fromRect(el.getBoundingClientRect()), 2)).map((b, i) => ({ ...b, what: [...document.querySelectorAll<HTMLElement>('[data-help-num]')][i].dataset.helpNum }));
    const band = (o: Box): Box[] => [
      { x: o.x - 2, y: o.y - 2, w: o.w + 4, h: 6 }, { x: o.x - 2, y: o.y + o.h - 4, w: o.w + 4, h: 6 },
      { x: o.x - 2, y: o.y - 2, w: 6, h: o.h + 4 }, { x: o.x + o.w - 4, y: o.y - 2, w: 6, h: o.h + 4 },
    ];
    const straddlesBar = (b: Box) => bars.some((bar) => hit(b, bar) && !contains(bar, b));
    for (const v of nums) {
      if (!contains(frame, v)) out.push(`number ${v.what} is cut by the picture's edge`);
      // A number-only marker has no outline: its own control stands in for it
      const target = document.querySelector(`[data-help-target="${v.what}"]`);
      const own = ringOf(v.what) ?? (target ? fromRect(target.getBoundingClientRect()) : undefined);
      const home = own && bars.find((bar) => contains(bar, grow(own, 2)));
      if (straddlesBar(v) && !(home && bars.every((bar) => bar === home || !hit(v, bar)))) out.push(`number ${v.what} sits on the header or tab bar's edge`);
      const t = texts.find((x) => hit(grow(v, CLEAR), x));
      if (t) out.push(`number ${v.what} is within ${CLEAR} px of ${t.what}`);
      // Its own control's pictures: never on them; anything else: CLEAR px away (audit r4: 2 within 3 px
      // of the check mark)
      const mine = (x: Box) => !!target && !!x.el && (target.contains(x.el) || contains(fromRect(target.getBoundingClientRect()), x));
      // (a number-only marker keeps CLEAR from its own control's pictures too: nothing ties it to them)
      const isBare = !!document.querySelector(`[data-help-num="${v.what}"][data-help-bare]`);
      const p = pictures.find((x) => (mine(x) && !isBare ? hit(v, x) : hit(grow(v, CLEAR), x)));
      if (p) out.push(`number ${v.what} is ${mine(p) && !isBare ? 'on' : `within ${CLEAR} px of`} ${p.what}`);
      // A control in an open menu keeps its number in that menu (audit r4: 1 on the banner beside it)
      const homes = target ? overlays.filter((ov) => ov.contains(target)) : [];
      const home2 = homes.find((ov) => !homes.some((o2) => o2 !== ov && o2.contains(ov)));
      if (home2 && !contains(grow(fromRect(home2.getBoundingClientRect()), 0.5), v)) out.push(`number ${v.what} sits outside its menu`);
      // A number reads as its own row's: it never shares the line of another row's text beside it
      // (audit r4: 1 hanging on the 'Acting as' line)
      if (own && target) {
        const tr = target.getBoundingClientRect();
        const row = texts.find((x) => !mine(x) && x.y < v.y + v.h - 1 && x.y + x.h > v.y + 1 && !(x.y < tr.bottom && x.y + x.h > tr.top)
          && Math.max(x.x - (v.x + v.w), v.x - (x.x + x.w)) < 24);
        if (row) out.push(`number ${v.what} sits on the line of ${row.what}, not its own row`);
      }
      const q = nums.find((x) => x !== v && hit(grow(v, CLEAR), x));
      if (q) out.push(`numbers ${v.what} and ${q.what} are within ${CLEAR} px`);
      const other = rings.find((o) => o.what !== v.what && band(o).some((b) => hit(v, b)));
      if (other) out.push(`number ${v.what} is on outline ${other.what}`);
    }
    for (const o of rings) {
      const outer = grow(o, 2);
      if (!contains(frame, outer)) out.push(`outline ${o.what} is cut by the picture's edge`);
      if (straddlesBar(outer)) out.push(`outline ${o.what} runs under the header or tab bar`);
      const t = texts.find((x) => hit(x, grow(outer, CLEAR)) && !contains(grow(o, -(4 + CLEAR)), x));
      if (t) out.push(`outline ${o.what} is within ${CLEAR} px of ${t.what}`);
      const p = pictures.find((x) => hit(x, outer) && !contains(grow(o, -4), x) && !ownOf(o, x));
      if (p) out.push(`outline ${o.what} touches ${p.what}`);
      for (const o2 of rings) {
        if (o2 === o || Number(o2.what) < Number(o.what)) continue;
        const a = grow(o, 2);
        const b = grow(o2, 2);
        if (hit(grow(a, CLEAR), b) && !contains(a, b) && !contains(b, a)) out.push(`outlines ${o.what} and ${o2.what} are within ${CLEAR} px`);
      }
    }
    // Nothing whole is cut by the picture's edge: a picture, an icon, a control, or a card that fits
    // the room (audit r4: the email field, the hero, the next card, thumbnails, rail icons, a sliver)
    const help = (window as unknown as { __help: { visible: (el: Element) => { l: number; t: number; r: number; b: number } | null; cards: () => Element[]; overlays: () => Element[]; pictureSel: string } }).__help;
    const barTop = Math.max(0, ...bars.filter((br) => br.y <= 1).map((br) => br.y + br.h));
    const barBottom = Math.min(innerHeight, ...bars.filter((br) => br.y + br.h >= innerHeight - 1).map((br) => br.y));
    const cutBy = (vb: { l: number; t: number; r: number; b: number }) => {
      const b = { x: vb.l, y: vb.t, w: vb.r - vb.l, h: vb.b - vb.t };
      // More than a pixel of it inside the frame: a card starting at the edge's own sub-pixel isn't cut
      return b.w > 0.5 && b.h > 0.5 && hit(b, grow(frame, -1)) && !contains(grow(frame, 0.5), b) ? b : null;
    };
    const whatOf = (el: Element) => `<${el.tagName.toLowerCase()}${el.getAttribute('data-testid') ? ` ${el.getAttribute('data-testid')}` : ''}${el.getAttribute('aria-label') ? ` "${el.getAttribute('aria-label')!.slice(0, 20)}"` : ''}>`;
    document.querySelectorAll(help.pictureSel).forEach((el) => {
      if (el.closest('[data-help-marker]') || (el.closest('svg') && el.tagName.toLowerCase() !== 'svg')) return;
      const vb = help.visible(el);
      if (!vb || bars.some((br) => br.el && br.el.contains(el))) return;
      const b = cutBy(vb);
      if (b) out.push(`${whatOf(el)} at ${Math.round(b.x)},${Math.round(b.y)} is cut by the picture's edge`);
    });
    const keyEls = [...document.querySelectorAll('[data-help-target]')];
    for (const el of [...help.cards(), ...help.overlays()]) {
      if (bars.some((br) => br.el && (br.el.contains(el) || el.contains(br.el)))) continue;
      // The container a control sits in (a long post, the comments card) may run past the room: the
      // control is what must be whole
      if (keyEls.some((k) => el.contains(k))) continue;
      const vb = help.visible(el);
      if (!vb) continue;
      const b = cutBy(vb);
      if (!b) continue;
      const cutY = b.y < frame.y - 0.5 || b.y + b.h > frame.y + frame.h + 0.5;
      const cutX = b.x < frame.x - 0.5 || b.x + b.w > frame.x + frame.w + 0.5;
      const full = el.getBoundingClientRect();
      if ((cutY && full.height <= barBottom - barTop) || (cutX && full.width < innerWidth - 1 && full.height <= barBottom - barTop)) out.push(`card ${whatOf(el)} at ${Math.round(b.x)},${Math.round(b.y)} ${Math.round(b.w)}x${Math.round(b.h)} is cut by the picture's edge`);
    }
    // A scrolling list never cuts an icon or picture at its edge (audit r4: the rail's last icon)
    document.querySelectorAll<HTMLElement>('body *').forEach((list) => {
      const cs = getComputedStyle(list);
      if (!/(auto|scroll)/.test(cs.overflowY) || list.scrollHeight <= list.clientHeight + 2) return;
      const lr = list.getBoundingClientRect();
      if (!hit({ x: lr.x, y: lr.y, w: lr.width, h: lr.height }, frame)) return;
      list.querySelectorAll('svg, img, [role="img"]').forEach((el) => {
        if (el.closest('svg') && el.tagName.toLowerCase() !== 'svg') return;
        const r = el.getBoundingClientRect();
        if ((r.top < lr.top - 0.5 && r.bottom > lr.top + 0.5) || (r.top < lr.bottom - 0.5 && r.bottom > lr.bottom + 0.5)) out.push(`${whatOf(el)} is cut by its list's edge`);
      });
    });
    const markerBoxes = [...rings, ...nums].map((m) => grow(m, 24));
    const skipped = skippedNodes.flatMap(({ node, why }) => {
      const range = document.createRange();
      range.selectNodeContents(node);
      return [...range.getClientRects()].map((b) => fromRect(b)).filter((b) => b.w > 0 && markerBoxes.some((m) => hit(m, b)))
        .map((b) => `${why} "${(node.textContent ?? '').trim().slice(0, 24)}" at ${Math.round(b.x)},${Math.round(b.y)}`);
    });
    return { problems: [...new Set(out)], skipped: [...new Set(skipped)] };
  }, clip ?? null);
  if (skipped.length) console.log(`help check ${name} skipped near markers: ${skipped.join('; ')}`);
  if (problems.length) throw new Error(`picture check: ${problems.slice(0, 8).join('; ')}${problems.length > 8 ? ` (+${problems.length - 8} more)` : ''}`);
}

/**
 * Page-side measures shared by the crop and the final check (one definition, so the two agree):
 * - overlays: open menus and dialogs;
 * - visible(el): an element's box clipped by its scrolling/clipping ancestors and by any overlay
 *   painted over it from one side (a button half under the account menu shows only below it);
 * - cards: boxes a reader sees as one thing (a background picture, a border, a shadow or a fill unlike
 *   what is behind it), at least 16 px each way. A crop edge never cuts one (audit r4: the next card,
 *   the hero picture, a sliver of a card).
 */
const PAGE_HELPERS = `(() => {
  const overlaySel = '[role="menu"], [role="dialog"], [role="listbox"], [data-popover], [data-testid="nav-menu"]';
  const shown = (el) => { const r = el.getBoundingClientRect(); const cs = getComputedStyle(el); return r.width > 1 && r.height > 1 && cs.visibility !== 'hidden' && cs.opacity !== '0'; };
  const overlays = () => [...document.querySelectorAll(overlaySel)].filter(shown);
  const box = (r) => ({ l: r.left, t: r.top, r: r.right, b: r.bottom });
  const visible = (el, rect) => {
    let v = rect ? { ...rect } : box(el.getBoundingClientRect());
    for (let a = el.parentElement; a && a !== document.body; a = a.parentElement) {
      const cs = getComputedStyle(a);
      if (cs.overflowX === 'visible' && cs.overflowY === 'visible') continue;
      const ar = a.getBoundingClientRect();
      v = { l: Math.max(v.l, ar.left), t: Math.max(v.t, ar.top), r: Math.min(v.r, ar.right), b: Math.min(v.b, ar.bottom) };
    }
    for (const ov of overlays()) {
      if (ov.contains(el) || el.contains(ov)) continue;
      const o = box(ov.getBoundingClientRect());
      if (o.r <= v.l || o.l >= v.r || o.b <= v.t || o.t >= v.b) continue;
      const acrossX = o.l <= v.l + 1 && o.r >= v.r - 1;
      const acrossY = o.t <= v.t + 1 && o.b >= v.b - 1;
      if (acrossX && acrossY) return null;
      if (acrossX && o.t <= v.t + 1) v.t = o.b; else if (acrossX && o.b >= v.b - 1) v.b = o.t;
      else if (acrossY && o.l <= v.l + 1) v.l = o.r; else if (acrossY && o.r >= v.r - 1) v.r = o.l;
    }
    return v.r - v.l > 0.5 && v.b - v.t > 0.5 ? v : null;
  };
  const alpha = (c) => { const m = c.match(/rgba?\\(([^)]+)\\)/); if (!m) return c === 'transparent' ? 0 : 1; const p = m[1].split(/[ ,\\/]+/).filter(Boolean); return p.length > 3 ? parseFloat(p[3]) : 1; };
  const behind = (el) => { for (let a = el.parentElement; a; a = a.parentElement) { const c = getComputedStyle(a).backgroundColor; if (alpha(c) > 0.05) return c; } return 'rgb(255, 255, 255)'; };
  const isCard = (el) => {
    if (el.closest('[data-help-marker]')) return false;
    const r = el.getBoundingClientRect();
    if (r.width < 16 || r.height < 16) return false;
    const cs = getComputedStyle(el);
    if (cs.visibility === 'hidden' || cs.opacity === '0' || cs.display === 'contents') return false;
    if (cs.backgroundImage && cs.backgroundImage !== 'none') return true;
    if (cs.boxShadow && cs.boxShadow !== 'none') return true;
    const bw = ['Top', 'Right', 'Bottom', 'Left'].filter((s) => parseFloat(cs['border' + s + 'Width']) >= 1 && alpha(cs['border' + s + 'Color']) > 0.2).length;
    if (bw >= 3) return true;
    return alpha(cs.backgroundColor) > 0.3 && cs.backgroundColor !== behind(el);
  };
  const cards = () => [...document.querySelectorAll('body *')].filter((el) => !(el.closest('svg') && el.tagName.toLowerCase() !== 'svg') && isCard(el));
  const pictureSel = 'img, svg, video, canvas, [role="img"], input, select, textarea, button';
  window.__help = { overlays, visible, cards, isCard, pictureSel };
})()`;

/** Fails when a run account, run handle or run address is anywhere a reader can see (pictures and clips) */
/**
 * Clips: the same check every 200 ms in the page while it records, so a frame between the first and
 * the last can't show test data either (owner: every frame of a clip is checked). Survives navigation
 * through an init script; the hits are read back with readClipLeaks.
 */
const CLIP_LEAK_WATCH = `(() => {
  const bad = /e2e\\+|e2e\\.alummahnow\\.net|@\\s*E2E[\\w-]|\\bE2E[a-z]+\\d{6,}|[\\w-]+-\\d{10,}\\.(mp4|mov|webm)/i;
  // Kept in sessionStorage too, so a hit on a page the clip then leaves isn't lost
  let kept = [];
  try { kept = JSON.parse(sessionStorage.getItem('__clipLeaks') || '[]'); } catch (e) { kept = []; }
  const seen = (window.__clipLeaks = window.__clipLeaks || kept);
  const save = () => { try { sessionStorage.setItem('__clipLeaks', JSON.stringify(seen.slice(-50))); } catch (e) { /* storage off */ } };
  const scan = () => {
    if (!document.body) return;
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const el = node.parentElement;
      if (!el || !bad.test(node.textContent || '') || el.closest('script,style')) continue;
      const r = el.getBoundingClientRect();
      if (r.width > 0 && r.height > 0 && r.bottom > 0 && r.top < innerHeight) { seen.push(location.pathname + ': ' + (node.textContent || '').trim().slice(0, 60)); save(); }
    }
    document.querySelectorAll('input, textarea').forEach((el) => { if (bad.test(el.value)) { seen.push(location.pathname + ' field: ' + el.value.slice(0, 60)); save(); } });
  };
  setInterval(scan, 200);
})()`;

/**
 * Clips: the example address and handle in place of the run's, as the pictures have them (AUDIT:
 * amina@example.com is fine), kept up while the clip records: a MutationObserver rewrites any run
 * address or handle the moment it renders, before the next frame is painted
 */
const CLIP_SCRUB = `(() => {
  const fix = (root) => {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const t = node.textContent || '';
      if (/e2e\\.alummahnow\\.net|e2e\\+/.test(t)) node.textContent = t.replace(/e2e\\+[^@\\s]*/g, 'amina').replace(/@?e2e\\.alummahnow\\.net/g, '@example.com');
      const u = node.textContent || '';
      if (/@\\s*E2E[\\w-]+/i.test(u)) node.textContent = u.replace(/@\\s*E2E[\\w-]+/gi, '@communitycorner');
    }
    if (root.querySelectorAll) root.querySelectorAll('input, textarea').forEach((el) => { if (/e2e\\+|e2e\\.alummahnow\\.net/.test(el.value)) el.value = 'amina@example.com'; });
    // An avatar initial taken from the run address ('E' of e2e+…) belongs to the example address too:
    // 'A' (the account-switch clip showed 'E' beside amina@example.com while the name loaded)
    const scope = root.querySelectorAll ? root : document.body;
    scope.querySelectorAll('[class*="avatar"]').forEach((el) => { if (el.childElementCount === 0 && (el.textContent || '').trim() === 'E') el.textContent = 'A'; });
    if (root.closest && root.closest('[class*="avatar"]') && (root.textContent || '').trim() === 'E') root.textContent = 'A';
  };
  const start = () => {
    if (!document.body) return void setTimeout(start, 10);
    fix(document.body);
    new MutationObserver((list) => { for (const m of list) { if (m.type === 'characterData') fix(m.target.parentNode || document.body); else m.addedNodes.forEach((n) => fix(n.nodeType === 3 ? (n.parentNode || document.body) : n)); } })
      .observe(document.body, { subtree: true, childList: true, characterData: true });
  };
  start();
})()`;

async function readClipLeaks(page: Page): Promise<string[]> {
  const all = await page.evaluate(() => (window as unknown as { __clipLeaks?: string[] }).__clipLeaks ?? []).catch(() => [] as string[]);
  return [...new Set(all as string[])];
}

async function expectNoLeaks(page: Page): Promise<void> {
  const leaks = await page.evaluate(() => {
    const bad = /e2e\+|e2e\.alummahnow\.net|@\s*E2E[\w-]|\bE2E[a-z]+\d{6,}|[\w-]+-\d{10,}\.(mp4|mov|webm)/i;
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
  await expectNoLeaks(page);
  const viewport = page.viewportSize()!;
  let clip: { x: number; y: number; width: number; height: number } | undefined;
  {
    // The numbers too: a header control's number sits just under the header
    const markers = await page.locator('[data-help-marker]').all();
    const all = (await Promise.all([...region, ...markers].map((r) => r.boundingBox()))).filter(Boolean) as { x: number; y: number; width: number; height: number }[];
    // No region: the whole viewport, trimmed only where a line would be cut
    const boxes = region.length ? all : [{ x: 0, y: 0, width: viewport.width, height: viewport.height }];
    const pad = region.length ? 24 : 0;
    const x = Math.max(0, Math.min(...boxes.map((b) => b.x)) - pad);
    const y = Math.max(0, Math.min(...boxes.map((b) => b.y)) - pad);
    const right = Math.min(viewport.width, Math.max(...boxes.map((b) => b.x + b.width)) + pad);
    const bottom = Math.min(viewport.height, Math.max(...boxes.map((b) => b.y + b.height)) + pad);
    clip = { x, y, width: right - x, height: bottom - y };
    // No edge cuts through anything (audit r2: a title cut in half, tab-bar labels cut off, the logo
    // clipped at the right): each edge moves out past every text line, picture, control or marker it
    // crosses, and a sticky bar it crosses is taken whole, with the full width
    // The core that must stay whole: the region (or, without one, the markers)
    const coreBoxes = region.length ? all : (markers.length ? (await Promise.all(markers.map((m) => m.boundingBox()))).filter(Boolean) as typeof all : all);
    const core = { l: Math.min(...coreBoxes.map((b) => b.x)), t: Math.min(...coreBoxes.map((b) => b.y)), r: Math.max(...coreBoxes.map((b) => b.x + b.width)), b: Math.max(...coreBoxes.map((b) => b.y + b.height)) };
    await page.evaluate(PAGE_HELPERS);
    clip = await page.evaluate(({ c, core }) => {
      // Each edge goes to the nearest clean line, searched directly so it never stops mid-line (audit
      // r3). Clean, best first: (1) crosses no line of text, control, picture, marker or card (a card
      // that could fit is never cut, audit r4); (2) crosses no text, control or picture; (3) no text.
      // Everything is measured by its visible part: what the account menu covers ends at the menu.
      type R = { l: number; t: number; r: number; b: number };
      const help = (window as unknown as { __help: { overlays: () => Element[]; visible: (el: Element, r?: R) => R | null; cards: () => Element[]; pictureSel: string } }).__help;
      const W = innerWidth;
      const H = innerHeight;
      const items: R[] = [];
      const words: R[] = [];
      const avoid: R[] = [];
      const avoidWhat: string[] = [];
      const onScreen = (v: R) => v.r > 0 && v.l < W && v.b > 0 && v.t < H;
      // The header and tab bar (fixed/sticky strips at the window's top or bottom). Only these cover:
      // the open menu's transparent full-screen backdrop is fixed too, and counted as covering it made
      // every line of the page 'covered' (r5: the crop then fell back through the rail and rows)
      const barEls = [...document.querySelectorAll<HTMLElement>('body *')].filter((el) => {
        const pos = getComputedStyle(el).position;
        if (pos !== 'fixed' && pos !== 'sticky') return false;
        const b = el.getBoundingClientRect();
        return b.width >= W * 0.6 && b.height > 20 && b.height < H * 0.3 && (b.top <= 1 || b.bottom >= H - 1);
      });
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        const el = node.parentElement;
        if (!node.textContent?.trim() || !el || el.closest('[data-help-marker]')) continue;
        const range = document.createRange();
        range.selectNodeContents(node);
        for (const b of range.getClientRects()) {
          if (b.width <= 0 || b.height <= 0) continue;
          const v = help.visible(el, { l: b.left, t: b.top, r: b.right, b: b.bottom });
          if (!v || !onScreen(v)) continue;
          // Under a bar or a fade (fixed/sticky): an edge never crosses it, nor goes past it
          let covered = 0;
          let seen = 0;
          let by = '';
          for (const y of [v.t + 2, (v.t + v.b) / 2, v.b - 2]) for (const x of [v.l + 2, (v.l + v.r) / 2, v.r - 2]) {
            if (x < 0 || y < 0 || x >= W || y >= H) continue;
            const top = document.elementFromPoint(x, y);
            let cov = false;
            if (top && top !== el && !el.contains(top) && !top.contains(el)) {
              for (let e: Element | null = top; e && e !== document.body; e = e.parentElement) {
                if (e.contains(el)) break;
                // Under a bar only; behind an open menu is not 'covered' (the menu is the picture)
                if (e.matches('[role="menu"], [role="dialog"], [role="listbox"], [data-popover], [data-testid="nav-menu"]')) break;
                if (barEls.includes(e as HTMLElement)) { cov = true; by = by || `${e.tagName.toLowerCase()}.${String(e.className).split(' ')[0]}`; break; }
              }
            }
            if (cov) covered++; else seen++;
          }
          if (covered) { avoid.push(v); if (avoidWhat.length < 3) avoidWhat.push(`"${(node.textContent ?? '').trim().slice(0, 16)}" ${Math.round(v.t)}..${Math.round(v.b)} under ${by}`); }
          if (seen && !covered) { items.push(v); words.push(v); }
        }
      }
      document.querySelectorAll(`${help.pictureSel}, [data-help-marker]`).forEach((el) => {
        if (el.closest('svg') && el.tagName.toLowerCase() !== 'svg') return;
        const v = help.visible(el);
        if (v && onScreen(v)) items.push(v);
      });
      const bars: R[] = barEls.map((el) => { const b = el.getBoundingClientRect(); return { l: 0, t: b.top, r: W, b: b.bottom }; });
      // What must stay whole whatever happens: the controls and their markers. The region (core) is
      // what the picture would like to show
      const must = [...document.querySelectorAll('[data-help-marker], [data-help-target]')].map((m) => m.getBoundingClientRect())
        .reduce((a, r) => ({ l: Math.min(a.l, r.left), t: Math.min(a.t, r.top), r: Math.max(a.r, r.right), b: Math.max(a.b, r.bottom) }), { l: Infinity, t: Infinity, r: -Infinity, b: -Infinity });
      // A long region (a card running on under the tab bar) is only its visible part: the core stops
      // at a bar no marker is in
      const marks = [...document.querySelectorAll('[data-help-marker]')].map((m) => m.getBoundingClientRect());
      for (const bar of bars) {
        if (marks.some((m) => m.bottom > bar.t && m.top < bar.b)) continue;
        if (bar.t >= H - 1 - (bar.b - bar.t) && core.b > bar.t) core.b = Math.max(core.t + 1, bar.t);
        if (bar.t <= 1 && core.t < bar.b) core.t = Math.min(core.b - 1, bar.b);
      }
      let l = c.x; let t = c.y; let r = c.x + c.width; let b = c.y + c.height;
      // A bar the core is in is taken whole, full width; a bar the core is not in is left out
      for (const bar of bars) {
        if (core.b > bar.t && core.t < bar.b) { t = Math.min(t, bar.t); b = Math.max(b, bar.b); l = 0; r = W; }
        else if (bar.t >= core.b) b = Math.min(b, bar.t);
        else if (bar.b <= core.t) t = Math.max(t, bar.b);
      }
      const topLimit = Math.max(0, ...bars.filter((bar) => bar.b <= core.t && !(core.b > bar.t && core.t < bar.b)).map((bar) => bar.b));
      const bottomLimit = Math.min(H, ...bars.filter((bar) => bar.t >= core.b && !(core.b > bar.t && core.t < bar.b)).map((bar) => bar.t));
      // Cards and open menus that could be shown whole; one taller (or wider) than the room, or one the
      // bar it sits in is taken with, can't be, so it doesn't count
      const cards: R[] = [];
      for (const el of [...help.cards(), ...help.overlays()]) {
        const v = help.visible(el);
        if (!v || !onScreen(v) || bars.some((bar) => v.t >= bar.t - 0.5 && v.b <= bar.b + 0.5)) continue;
        // A card that can't fit, or a layout column (the side rail, as tall as the window), never counts
        if (v.b - v.t > bottomLimit - topLimit || v.b - v.t >= H * 0.9) continue;
        cards.push(v);
      }
      const crosses = (set: R[], axis: 'y' | 'x', at: number) => set.some((it) => axis === 'y'
        ? it.r > l && it.l < r && it.t < at - 0.5 && it.b > at + 0.5
        : it.b > t && it.t < b && it.l < at - 0.5 && it.r > at + 0.5);
      const cardsCross = (axis: 'y' | 'x', at: number) => crosses(cards, axis, at);
      const avoidIn = (lo: number, hi: number, axis: 'y' | 'x') => avoid.some((a) => axis === 'y'
        ? a.r > l && a.l < r && a.b > lo && a.t < hi
        : a.b > t && a.t < b && a.r > lo && a.l < hi);
      // Outward from `want` first (more room), then inward, down to what must stay whole; tier by tier
      // Which edge had to fall back, and what blocked it there (listed in the run)
      const notes: string[] = [];
      // Top and bottom: outward first (more room), then inward. Sides: the nearest line either way, so
      // a picture of one column doesn't widen to take in the rail (r5: privacy ar took the rail's icons)
      const pick = (want: number, min: number, max: number, outward: number, tiers: Array<(v: number) => boolean>, edge = '', nearest = false) => {
        for (const [k, ok] of tiers.entries()) {
          let found: number | null = null;
          if (nearest) {
            for (let d = 0; found === null && d <= max - min; d++) for (const v of d ? [want - d * outward, want + d * outward] : [want]) if (found === null && v >= min && v <= max && ok(v)) found = v;
          }
          for (let v = want; v >= min && v <= max && found === null; v += outward) if (ok(v)) found = v;
          for (let v = want - outward; v >= min && v <= max && found === null; v -= outward) if (ok(v)) found = v;
          if (found !== null) {
            if (k > 0 && edge) {
              const axis = edge === 'top' || edge === 'bottom' ? 'y' : 'x';
              const at = Math.round((min + max) / 2);
              const blockers = [...cards, ...items].filter((it) => (axis === 'y' ? it.r > l && it.l < r && it.t < at && it.b > at : it.b > t && it.t < b && it.l < at && it.r > at)).slice(0, 3)
                .map((it) => `${Math.round(it.l)},${Math.round(it.t)} ${Math.round(it.r - it.l)}x${Math.round(it.b - it.t)}`);
              notes.push(`${edge} edge fell back to tier ${k + 1} at ${found} (range ${Math.round(min)}..${Math.round(max)}; at ${at}: ${blockers.join(' | ')})`);
            }
            return found;
          }
        }
        notes.push(`${edge} edge found no line in ${Math.round(min)}..${Math.round(max)}`);
        return want;
      };
      const tiersFor = (axis: 'y' | 'x', between: (v: number) => boolean) => [
        (v: number) => !crosses(items, axis, v) && !cardsCross(axis, v) && between(v),
        (v: number) => !crosses(items, axis, v) && between(v),
        (v: number) => !crosses(words, axis, v) && between(v),
      ];
      const has = Number.isFinite(must.t);
      const mustT = has ? must.t : core.t;
      const mustB = has ? must.b : core.b;
      const mustL = has ? must.l : core.l;
      const mustR = has ? must.r : core.r;
      for (let pass = 0; pass < 2; pass++) {
        const last = pass === 1;
        t = pick(Math.max(topLimit, Math.min(t, core.t)), topLimit, mustT, -1, tiersFor('y', (y) => !avoidIn(y, mustT, 'y')), last ? 'top' : '');
        b = pick(Math.min(bottomLimit, Math.max(b, core.b)), mustB, bottomLimit, 1, tiersFor('y', (y) => !avoidIn(mustB, y, 'y')), last ? 'bottom' : '');
        if (l > 0 || r < W) {
          l = pick(Math.max(0, Math.min(l, core.l)), 0, mustL, -1, tiersFor('x', (x) => !avoidIn(x, mustL, 'x')), last ? 'left' : '', true);
          r = pick(Math.min(W, Math.max(r, core.r)), mustR, W, 1, tiersFor('x', (x) => !avoidIn(mustR, x, 'x')), last ? 'right' : '', true);
        }
      }
      if (notes.length) notes.push(`covered: ${avoidWhat.join(', ')}`);
      return { x: l, y: t, width: r - l, height: b - t, notes, avoid: avoid.length };
    }, { c: clip, core });
    if (clip && 'notes' in clip) {
      const { notes: cropNotes, avoid: avoidN, ...box } = clip as typeof clip & { notes: string[]; avoid: number };
      if (cropNotes.length) console.log(`help crop ${file}: ${cropNotes.join('; ')} (avoid ${avoidN})`);
      clip = box;
    }
  }
  await verifyFrame(page, clip, file);
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
    run: async (page, lang, device) => {
      // Desktop: over the About page. Its number hangs just under the header; on the home page the
      // welcome banner sits there and no crop line clears both it and the rail (r5)
      await settle(page, device === 'desktop' ? '/about' : '', lang);
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
      // Over the library page: plain text rows behind the menu, so the crop can end at the menu with
      // nothing half shown (audit r4: the channel page's thumbnails were cut under it; on phones its
      // tab strip showed a half-cut tab, site bug #1669)
      await settle(page, '/library', lang);
      const menu = await openMenu(page);
      return [[menu.getByTestId('nav-profile-link'), menu.getByTestId('nav-active-channel'), menu.getByTestId('nav-switch-channel')], [header(page), menu]];
    },
  },
  {
    // Markers: you (tagged Personal), then your channel (tagged Channel). One control per marker,
    // never a heading row by itself (owner review 2026-11-16)
    id: 'identity-switch',
    run: async (page, lang) => {
      // Over the library page, like identity-menu: plain rows behind the menu (audit r4/r5: the
      // channel header, share button and tab strip were cut under it)
      await settle(page, '/library', lang);
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
    await context.addInitScript(CLIP_SCRUB);
    // Recorded clips move: only they keep motion on
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    let offset = 0;
    try {
      await prepare(page);
      // Clips get no text pass: the data itself must be clean (audit r4: @E2Ehelp<run> in a clip)
      await expectNoLeaks(page);
      await page.context().addInitScript(CLIP_LEAK_WATCH);
      await page.evaluate(CLIP_LEAK_WATCH);
      await page.screenshot({ path: join(CLIPS, `${id}.${lang}.${mode}.png`) });
      offset = (Date.now() - started) / 1000;
      await act(page);
      await page.waitForTimeout(1200);
      await expectNoLeaks(page);
      const during = await readClipLeaks(page);
      if (during.length) throw new Error(`test data showed during the clip: ${during.join(' | ')}`);
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
      // A file name a person would have (the run's timestamped name showed in the clip, audit r4); a
      // timestamp in the metadata keeps each copy's content unique
      const dir = mkdtempSync(join(tmpdir(), 'help-upload-'));
      const copy = join(dir, lang === 'ar' ? 'شارع-الفوانيس.mp4' : 'lantern-street.mp4');
      execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', clipPath, '-c', 'copy', '-metadata', `comment=help ${lang} ${mode} ${Date.now()}`, copy]);
      await page.locator('[data-testid="batch-file-input"], input[type="file"]').first().setInputFiles(copy);
      await page.waitForTimeout(5000);
      rmSync(dir, { recursive: true, force: true });
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
  if (notes.length) console.log(`Marker notes:\n${notes.join('\n')}`);
  expect(problems, problems.join('\n')).toEqual([]);
});

test.afterAll(() => rmSync(MEDIA, { recursive: true, force: true }));
