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
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
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
/** Clips' window height (desktop width): the side rail's every item shows */
const CLIP_HEIGHT = 920;
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
  { key: 'street', art: 'tools.webp', title: { en: 'Lantern street', ar: 'شارع الفوانيس' } },
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
  // Inside the icon art's frame: videos-admin.webp and tools.webp carry gold diagonal frame lines near
  // their corners, and the old full-width crop showed them as gold triangles in both top corners of
  // the player and every card (AUDIT-2 re-audit 8, item 12). The middle 80% clears them in every crop
  const pan = "scale=1280:1280,crop=1024:576:128:225,scale=1280:720,zoompan=z='1+0.0003*on':x='(iw-iw/zoom)*0.5':y='(ih-ih/zoom)*(0.2+on/1000)':d=1:s=640x360:fps=25,format=yuv420p";
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-loop', '1', '-i', src, '-vf', pan, '-t', '20', '-c:v', 'libx264', '-profile:v', 'main', '-level', '3.0', '-g', '50',
    '-hls_time', '4', '-hls_playlist_type', 'vod', '-hls_segment_filename', join(dir, '0_%03d.ts'), join(dir, '0.m3u8')]);
  writeFileSync(join(dir, 'master.m3u8'), '#EXTM3U\n#EXT-X-VERSION:3\n#EXT-X-STREAM-INF:BANDWIDTH=400000,RESOLUTION=640x360,CODECS="avc1.4d401e"\n0.m3u8\n');
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', src, '-vf', 'scale=960:960,crop=768:432:96:169,scale=960:540', '-q:v', '3', join(dir, 'thumbnail.jpg')]);
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
/** The pages' fixed clock (set once the demos exist) */
let CLOCK = 0;

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
  // Every picture's clock: a fixed moment just after the demos were made, so a card reads the same
  // age in English and Arabic, whenever each was taken (AUDIT-2 2026-11-21: "now" next to «قبل دقيقة
  // واحدة» on the same card)
  CLOCK = Date.now() + 2 * 60_000;
});

async function open(browser: Browser, lang: Lang, device: Device, mode: Mode, opts: { signedIn?: boolean; record?: string; height?: number } = {}): Promise<{ context: BrowserContext; page: Page }> {
  const v = { ...VIEWPORT[device], ...(opts.height ? { height: opts.height } : {}) };
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
  // Dates and times stand still at CLOCK (timers keep running)
  if (CLOCK) await context.clock.setFixedTime(CLOCK);
  // No consent banner over the pictures (optional tracking declined), given before the fixed clock's
  // moment: a later stamp read as a choice from the future and the banner came back; the tour stays away by
  // itself in an automated browser
  await context.addCookies([{ name: 'aun_consent', value: `v1.a0.e0.p0.${(CLOCK || Date.now()) - 1000}`, url: target().web, sameSite: 'Lax' }]);
  // Images may be cached (the local stack sends no-store): the account menu remounts when you switch
  // who you act as, and its app icons were refetched, blank for a frame of the clip (AUDIT-2
  // 2026-11-21). Registered before every other route: the last registered answers first, so the demo
  // CDN and /thumb/ routes still serve their pictures (registered after them, it showed test bars)
  await context.route('**/*', async (route) => {
    if (route.request().resourceType() !== 'image') return route.fallback();
    const res = await route.fetch();
    return route.fulfill({ response: res, headers: { ...res.headers(), 'cache-control': 'public, max-age=3600' } });
  });
  await context.route((url) => url.hostname === FAKE_CDN_HOST, serveDemo);
  await context.route((url) => url.pathname.startsWith('/thumb/'), serveThumb);
  // No view beacons: each capture visit counted as a view, so the watch page read "No views" in one
  // picture and "1 view" in its Light/Dark twin (r5 check)
  await context.route((url) => url.pathname.startsWith('/api/analytics/video'), (route) => route.fulfill({ status: 204, body: '' }));
  // Video cards and Up next show only the demo videos: the stack's seed videos carry test titles
  await context.addInitScript((ids: string[]) => {
    const idOf = (el: Element) => el.getAttribute('data-video-id') || decodeURIComponent((el.getAttribute('href') ?? el.querySelector('a[href*="/video/"]')?.getAttribute('href') ?? '').split('/video/')[1]?.split(/[?#/]/)[0] ?? '');
    const hide = () => document.querySelectorAll<HTMLElement>('[data-testid="related-video"], [data-testid="video-card"]').forEach((el) => {
      const id = idOf(el);
      if (id && !ids.includes(id)) ((el.closest('li') as HTMLElement | null) ?? el).style.display = 'none';
    });
    new MutationObserver(hide).observe(document, { subtree: true, childList: true });
  }, demoIds);
  // The example address and handle from the first paint, for pictures and clips alike: markers are
  // placed on the page as shown (r5: the long run address filled the profile row, so 1 found no spot)
  await context.addInitScript(CLIP_SCRUB);
  // Arabic pictures show the demo comment in Arabic (AUDIT-2 2026-11-21: an English comment under
  // «ركن المجتمع»); comments carry no translation, so the text is swapped where it is shown
  if (lang === 'ar') {
    await context.addInitScript(([from, to]: string[]) => {
      const swap = (root: Node) => {
        const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
        for (let n = walker.nextNode(); n; n = walker.nextNode()) if (n.textContent?.includes(from)) n.textContent = n.textContent.replace(from, to);
      };
      new MutationObserver((ms) => ms.forEach((m) => swap(m.target))).observe(document, { subtree: true, childList: true, characterData: true });
    }, [NAMES.comment.en, NAMES.comment.ar]);
  }
  const page = await context.newPage();
  return { context, page };
}

/** The watch page's "views • when" line as the first picture of each language showed it */
const watchMeta = new Map<Lang, string[]>();

/**
 * One "views • when" line per language across devices and Light/Dark: the run's later pictures
 * came minutes after the upload, so "now" turned into "1 minute ago" between twins (r5 check)
 */
async function pinWatchMeta(page: Page, lang: Lang): Promise<void> {
  const parts = page.locator('summary[aria-describedby]').first().locator(':scope > span:not([hidden]):not([aria-hidden]), :scope > time');
  if ((await parts.count()) === 0) return;
  const seen = watchMeta.get(lang);
  // innerHTML: the date keeps its screen-reader text
  if (!seen) { watchMeta.set(lang, await parts.evaluateAll((els) => els.map((el) => el.innerHTML))); return; }
  await parts.evaluateAll((els, html) => els.forEach((el, i) => { if (html[i] !== undefined) el.innerHTML = html[i]; }), seen);
}

async function settle(page: Page, path: string, lang: Lang): Promise<void> {
  await page.goto(`/${lang}${path}`, { waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('networkidle').catch(() => undefined);
  // The header has settled: the account button, or signed out the solid Sign in
  await expect(page.locator('[data-testid="nav-menu-trigger"]:visible, [data-testid="header-sign-in"]:visible').first()).toBeVisible({ timeout: 30_000 });
  await page.evaluate(() => document.fonts.ready);
}

/**
 * Opens the menu with blank page under its foot: the page is scrolled (before opening, as an open
 * menu locks it) so no line, picture or control lies from 24 px above the menu's bottom edge to
 * 20 px below it, and no line sits half under the header. The picture then gets room under the menu
 * and no text shows through its glass by its last row (AUDIT-2 2026-11-21: «المشاهدة لاحقًا» under
 * «إنشاء قناة», the menu flush with the picture's edge)
 */
async function openMenuOverBlank(page: Page, view: 'main' | 'channels'): Promise<Locator> {
  const first = await openMenu(page, view);
  const box = (await first.boundingBox())!;
  const head = (await header(page).boundingBox())?.height ?? 0;
  await closeMenu(page);
  const offset = await page.evaluate(({ foot, head, l, r: right }) => {
    // A phone's Library is shorter than the screen, so it can't scroll at all (every offset was
    // rejected, room -1): blank page added at its end gives the menu's foot somewhere empty to sit
    const need = 600 - (document.documentElement.scrollHeight - innerHeight);
    if (need > 0) {
      const spacer = document.createElement('div');
      spacer.dataset.helpSpacer = '';
      spacer.style.height = `${need}px`;
      document.body.append(spacer);
    }
    const spans: Array<{ t: number; b: number; l: number; r: number }> = [];
    const skip = (el: Element) => !!el.closest('header, [data-testid="nav-menu"]') || ['fixed', 'sticky'].includes(getComputedStyle(el).position);
    const add = (r: DOMRect) => { if (r.width > 0 && r.height > 0) spans.push({ t: r.top + scrollY, b: r.bottom + scrollY, l: r.left, r: r.right }); };
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const el = n.parentElement;
      if (!n.textContent?.trim() || !el || skip(el)) continue;
      const range = document.createRange();
      range.selectNodeContents(n);
      for (const r of range.getClientRects()) add(r);
    }
    document.querySelectorAll('img, svg, input').forEach((el) => { if (!skip(el)) add(el.getBoundingClientRect()); });
    // Under the menu (and 24 px either side) only: the desktop rail's labels are beside it, not under it
    const under = spans.filter((sp) => sp.r > l - 24 && sp.l < right + 24);
    // The offset with the most blank page around the foot (the smaller of the room above and below
    // it, up to 24 px): a phone's Library has no 44 px gap, so the best one, not the first perfect one
    const max = Math.min(600, document.documentElement.scrollHeight - innerHeight);
    let best = { s: 0, room: -1 };
    for (let s = 0; s <= max; s++) {
      if (spans.some((sp) => sp.t < s + head && sp.b > s + head)) continue;
      const f = foot + s;
      if (under.some((sp) => sp.t < f && sp.b > f)) continue;
      const above = Math.min(24, f - Math.max(-Infinity, ...under.filter((sp) => sp.b <= f).map((sp) => sp.b)));
      const below = Math.min(24, Math.min(Infinity, ...under.filter((sp) => sp.t >= f).map((sp) => sp.t)) - f);
      const room = Math.min(above, below);
      if (room > best.room) best = { s, room };
      if (room >= 24) break;
    }
    return { ...best, max };
  }, { foot: box.y + box.height, head, l: box.x, r: box.x + box.width });
  console.log(`help menu over blank: scrolled ${offset.s} of ${offset.max} px, ${offset.room} px clear around the menu's foot`);
  await page.evaluate((y) => window.scrollTo({ top: y, behavior: 'instant' }), offset.s);
  return openMenu(page, view, true);
}

async function closeMenu(page: Page): Promise<void> {
  const menu = page.getByTestId('nav-menu');
  await expect(async () => {
    if (await menu.isVisible()) await page.keyboard.press('Escape');
    await expect(menu).toBeHidden({ timeout: 1000 });
  }).toPass({ timeout: 15_000 });
}

/**
 * The pointer moved off everything that reacts to it: a row left under the pointer after a click stays
 * shaded (AUDIT-2 2026-11-21: Weekend Sessions shaded beside the ticked channel, a related video
 * highlighted for the rest of the clip). An open menu's full-screen backdrop is fine: it hovers nothing
 */
async function parkPointer(page: Page): Promise<void> {
  const spot = await page.evaluate(() => {
    const live = 'a, button, input, textarea, select, label, summary, video, img, li, article, [role="button"], [role="link"], [role="menuitem"], [role="option"], [role="tab"], [role="row"], [tabindex], [data-testid="nav-menu"]';
    // What lies under an open menu's backdrop counts too: when the menu closes the pointer is over it
    // (AUDIT-2 re-audit 8: Weekend Sessions shaded again, en 1.2 s / ar 1.04 s)
    const isBackdrop = (el: Element) => { const r = el.getBoundingClientRect(); return getComputedStyle(el).position === 'fixed' && r.width >= innerWidth - 1 && r.height >= innerHeight - 1; };
    for (let y = innerHeight - 6; y > 6; y -= 12) for (let x = 6; x < innerWidth - 6; x += 12) {
      const stack = document.elementsFromPoint(x, y);
      if (!stack.length || stack.some((el) => el.closest('[data-testid="nav-menu"]'))) continue;
      const el = stack.find((e) => !isBackdrop(e));
      if (!el) continue;
      if (!el.closest(live) && !el.closest('header') && getComputedStyle(el).cursor !== 'pointer') return { x, y };
    }
    return null;
  });
  if (spot) await page.mouse.move(spot.x, spot.y);
}

async function openMenu(page: Page, view: 'main' | 'channels' = 'main', keepScroll = false): Promise<Locator> {
  const menu = page.getByTestId('nav-menu');
  // The page at its top first: an open menu locks the page's scroll, so a page left part-scrolled (a
  // title half under the header) could not be fixed afterwards
  if (!keepScroll) {
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
  }
  await expect(async () => {
    if (!(await menu.isVisible())) await page.getByTestId('nav-menu-trigger').click();
    await expect(menu).toBeVisible({ timeout: 2000 });
  }).toPass({ timeout: 30_000 });
  if (view === 'channels') {
    await menu.getByTestId('nav-switch-channel').click();
    await expect(menu.getByTestId('nav-channel-option-none')).toBeVisible();
  }
  await parkPointer(page);
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
      return b.width >= window.innerWidth * 0.6 && b.height > 20 && b.height < window.innerHeight * 0.3 && (b.top <= 1 || b.bottom >= window.innerHeight - 1 || !!el.closest("[data-pinned]"));
    }).map((el) => el.getBoundingClientRect());
    const top = Math.max(0, ...bars.filter((b) => b.bottom < window.innerHeight / 2).map((b) => b.bottom));
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
    type Box = { x: number; y: number; w: number; h: number; what?: string; el?: Element | null; r?: number };
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
    const EXEMPT_MAX = 24;
    const hit = (a: Box, b: Box) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
    const grow = (b: Box, d: number): Box => ({ ...b, x: b.x - d, y: b.y - d, w: b.w + d * 2, h: b.h + d * 2 });
    const contains = (o: Box, t: Box) => t.x >= o.x && t.y >= o.y && t.x + t.w <= o.x + o.w && t.y + t.h <= o.y + o.h;
    const fromRect = (b: DOMRect, extra: Partial<Box> = {}): Box => ({ x: b.x, y: b.y, w: b.width, h: b.height, ...extra });
    // A card's box with its corner radius, and why a segment may not cross card edges (PAGE_HELPERS)
    const helpX = window as unknown as { __help: { radiusOf: (el: Element) => number; crossWhy: (boxes: Box[], x1: number, y1: number, x2: number, y2: number, near: number) => string } };
    const withRadius = (el: Element, b: Box): Box => ({ ...b, r: helpX.__help.radiusOf(el) });
    const crossWhy = (boxes: Box[], x1: number, y1: number, x2: number, y2: number, near: number) => helpX.__help.crossWhy(boxes, x1, y1, x2, y2, near);
    const arcWhy = (boxes: Box[], px: number, py: number, near: number) => (helpX.__help as unknown as { arcWhy: (b: Box[], x: number, y: number, n: number) => string }).arcWhy(boxes, px, py, near);
    const visible = (el: Element) => {
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      return r.width > 1 && r.height > 1 && cs.visibility !== 'hidden' && cs.opacity !== '0';
    };
    // Text a reader can't see: screen-reader-only labels (1 px boxes, clipped) on icon-only buttons
    const srOnly = (el: Element | null) => {
      // Laid out inside a closed <details> (not its summary), never shown: the watch page's collapsed
      // description and exact date
      if (el && el.closest('details:not([open])') && !el.closest('summary')) return true;
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
    // Every line of visible text, as its letters' ink (measured with its own font: __help.ink)
    const texts: Box[] = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const el = node.parentElement;
      if (!node.textContent?.trim() || !el || el.closest('[data-help-marker],script,style') || srOnly(el)) continue;
      const range = document.createRange();
      range.selectNodeContents(node);
      for (const b of range.getClientRects()) {
        if (b.width <= 0 || b.height <= 0 || b.bottom < 0 || b.top > innerHeight) continue;
        const inked = (window as unknown as { __help: { ink: (e: Element, t: string, r: DOMRect) => DOMRect } }).__help.ink(el, node.textContent ?? '', b);
        const box = fromRect(inked, { what: `"${(node.textContent ?? '').trim().slice(0, 24)}"`, el });
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
    // Drawn borders (a form's gold frame, a card's line): an outline or a number never runs on one
    // (AUDIT-2 2026-11-21: number 1 crossed the comment form's top border, 2 sat on its corner)
    // Only the sides it draws: a table row with a line under it has no right edge (its number at the row's
    // end was refused, moved beside the title and left the title's own number no spot)
    const drawnSides = new WeakMap<Element, { t: boolean; b: boolean; l: boolean; r: boolean }>();
    const edgeBoxes: Box[] = [...document.querySelectorAll<HTMLElement>('body *')].filter((el) => {
      if (el.closest('[data-help-marker]') || !visible(el)) return false;
      const b = el.getBoundingClientRect();
      // A page-wide container (its line is the page's edge, not a frame round a control) never counts
      if (b.width < 40 || b.height < 24 || b.width >= innerWidth * 0.95 || b.bottom < 0 || b.top > innerHeight) return false;
      const cs = getComputedStyle(el);
      const drawn = (w: string, st: string, c: string) => parseFloat(w) >= 1 && st !== 'none' && st !== 'hidden' && !/rgba\([^)]*,\s*0\)|transparent/.test(c);
      const sides = {
        t: drawn(cs.borderTopWidth, cs.borderTopStyle, cs.borderTopColor), b: drawn(cs.borderBottomWidth, cs.borderBottomStyle, cs.borderBottomColor),
        l: drawn(cs.borderLeftWidth, cs.borderLeftStyle, cs.borderLeftColor), r: drawn(cs.borderRightWidth, cs.borderRightStyle, cs.borderRightColor),
      };
      if (!sides.t && !sides.b && !sides.l && !sides.r) return false;
      drawnSides.set(el, sides);
      return true;
    }).map((el) => fromRect(el.getBoundingClientRect(), { el, what: `the border of <${el.tagName.toLowerCase()}${el.getAttribute('data-testid') ? ` ${el.getAttribute('data-testid')}` : ''}>` }));
    /** A box (already grown by its clear space) runs over a drawn border: neither inside it nor outside it */
    // The header and tab bar's own lines never count: a header control's number hangs from the header
    const inBar = (el: Element) => bars.some((bar) => !!bar.el && (bar.el.contains(el) || el.contains(bar.el)));
    // ...nor a box that starts flush under a bar (a header control's number hangs over that line)
    const underBar = (e: Box) => bars.some((bar) => Math.abs(e.y - (bar.y + bar.h)) <= 2);
    const crossesDrawn = (g: Box, e: Box) => {
      const s = e.el ? drawnSides.get(e.el) : undefined;
      if (!s) return true;
      const acrossY = (y: number) => g.y <= y && g.y + g.h >= y;
      const acrossX = (x: number) => g.x <= x && g.x + g.w >= x;
      return (s.t && acrossY(e.y)) || (s.b && acrossY(e.y + e.h)) || (s.l && acrossX(e.x)) || (s.r && acrossX(e.x + e.w));
    };
    const onEdge = (g: Box, skip: (el: Element) => boolean) => edgeBoxes.find((e) => !(e.el && (skip(e.el) || inBar(e.el))) && !underBar(e) && hit(g, e) && !contains(grow(e, -1), g) && !contains(g, e) && crossesDrawn(g, e));
    // The sticky header and phone tab bar
    const bars: Box[] = [...document.querySelectorAll<HTMLElement>('body *')].filter((el) => {
      const pos = getComputedStyle(el).position;
      if (pos !== 'fixed' && pos !== 'sticky') return false;
      const b = el.getBoundingClientRect();
      return b.width >= innerWidth * 0.6 && b.height > 20 && b.height < innerHeight * 0.3 && (b.top <= 1 || b.bottom >= innerHeight - 1 || !!el.closest("[data-pinned]"));
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
    const bareWhy: string[] = [];
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
      // The frame a control nearly fills (an upload drop zone in its card) reads as the control's own:
      // its outline can't keep clear of it. The comment form, twice its box's height, still counts
      const fills = (el: Element) => {
        if (!el.contains(target)) return false;
        const e = el.getBoundingClientRect();
        return (r.width * r.height) / Math.max(1, e.width * e.height) >= 0.7;
      };
      const ownEdge = (el: Element) => el === target || target.contains(el) || fills(el);
      const crowded = (o: Box) => [
        ...[onEdge(grow(o, OUT), ownEdge)].filter((e): e is Box => !!e),
        ...otherText.filter((t) => hit(t, grow(o, OUT)) && !contains(grow(o, -IN), t)),
        ...otherPics.filter((p) => hit(p, grow(o, 2)) && !contains(grow(o, -4), p)),
        // ...with room for a crop line between them: halo, the line's 4 px and one to spare (AUDIT-2
        // 2026-11-22: an outline 1 px above the next card left creating-upload ar no clean edge)
        // Above and below only: a crop's top or bottom line runs there; beside, 2 px as before (a card
        // 12 px beside a title left creating-studio no outline)
        ...otherCards.filter((cd) => { const g = { x: o.x - 2, y: o.y - 7, w: o.w + 4, h: o.h + 14 }; return hit(cd, g) && !contains(cd, g); }),
      ];
      // Toward a neighbouring target, at most half the free space after both bands and CLEAR
      const near = rects.filter((_, j) => j !== i).reduce((min, b) => {
        const dx = Math.max(0, b.x - r.right, r.x - b.right);
        const dy = Math.max(0, b.y - r.bottom, r.y - b.bottom);
        return Math.min(min, Math.max(dx, dy));
      }, Infinity);
      const gMax = Math.min(GAP, Math.floor((near - 4 - CLEAR) / 2));
      // A bar the open menu is drawn over ends at the menu's top for its rows: the Arabic desktop
      // account row starts 3 px inside the header's strip, under nothing (the menu covers the
      // header's line), and went number-only while the English row, inset, was outlined
      const myBars = (window as unknown as { __help: { barsFor: (e: Element, b: Box[]) => Box[] } }).__help.barsFor(target, bars);
      const myStraddle = (b: Box) => myBars.some((bar) => hit(b, bar) && !contains(bar, b));
      const barClash = (b: Box) => myStraddle(grow(b, 2));
      // A row in an open menu keeps its outline inside the menu, clear of its border (AUDIT-2
      // 2026-11-21: the full-width account rows' boxes ran 4-8 px past the menu's rounded edge)
      const menuOf = target.closest('[data-testid="nav-menu"]');
      const menuBox = menuOf ? fromRect(menuOf.getBoundingClientRect()) : null;
      const escapes = (b: Box) => !!menuBox && !contains(grow(menuBox, -3), grow(b, 2));
      let o = outline(gMax);
      for (let g = gMax; g >= gMax - 16 && (crowded(o).length || barClash(o) || escapes(o)); g--) o = outline(g);
      // A row in an open menu is numbered, never outlined: the rows sit edge to edge under labels and
      // chips, so whether an outline fitted came down to a pixel and differed between English and
      // Arabic (AUDIT-2 2026-11-21, re-audit 3). One rule for every menu picture
      const menuRow = !!menuOf;
      bare.push(menuRow || crowded(o).length > 0 || myStraddle(grow(o, 2)) || escapes(o));
      // Why it went number-only, in the run's notes (AUDIT-2: an outline in English, none in Arabic)
      bareWhy.push(menuRow ? 'a menu row (numbered, never outlined)' : bare[bare.length - 1] ? [...(escapes(o) ? ["its menu's edge"] : []), ...crowded(o).map((c) => `${c.what ?? 'a box'} ${Math.round(c.x)},${Math.round(c.y)} ${Math.round(c.w)}x${Math.round(c.h)}`), ...myBars.filter((bar) => hit(grow(o, 2), bar) && !contains(bar, grow(o, 2))).map((bar) => `a bar ${Math.round(bar.y)}+${Math.round(bar.h)} (outline ${Math.round(o.y)}+${Math.round(o.h)}, target ${Math.round(r.top)}+${Math.round(r.height)})`)].slice(0, 3).join(' | ') : '');
      rings.push(o);
      radii.push(parseFloat(getComputedStyle(target).borderTopLeftRadius) || 0);
    }
    // Two outlines closer than CLEAR: the later one goes number-only
    for (let i = 0; i < rings.length; i++) for (let j = i + 1; j < rings.length; j++) {
      if (bare[i] || bare[j]) continue;
      const a = grow(rings[i], 2);
      const b = grow(rings[j], 2);
      if (hit(grow(a, CLEAR), b) && !contains(a, b) && !contains(b, a)) { bare[j] = true; bareWhy[j] = `outline ${i + 1}`; }
    }
    // A number-only marker is placed against the control itself
    for (const [i, isBare] of bare.entries()) if (isBare) rings[i] = fromRect(rects[i]);
    // The bands of every outline (2 px out, 4 px in), as four strips
    const band = (o: Box): Box[] => [
      { x: o.x - 2, y: o.y - 2, w: o.w + 4, h: 6 }, { x: o.x - 2, y: o.y + o.h - 4, w: o.w + 4, h: 6 },
      { x: o.x - 2, y: o.y - 2, w: 6, h: o.h + 4 }, { x: o.x + o.w - 4, y: o.y - 2, w: 6, h: o.h + 4 },
    ];
    // Pass 2: the numbers. A number's visible box is its circle plus the 2 px halo
    const placed: string[] = [];
    // One pass places every number in the given order, each clear of those before it
    const runPass = (order: number[]) => {
      const numbers: Box[] = [];
      const spots: Array<[number, number]> = [];
      const leaders: Array<number[] | undefined> = [];
      const failed: number[] = [];
      const passFaults: string[] = [];
      const passPlaced: string[] = [];
      for (const i of order) {
      const target = targets[i];
      const o = rings[i];
      const n = target.dataset.helpTarget;
      const r = rects[i];
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
        // 72 px beside its own control's row; over or under the control 24 px (AUDIT-2 re-audit 7: en
        // phone's 2 was refused above its button for the subscriber line 33 px away)
        && Math.max(tx.x - (v.x + v.w), v.x - (tx.x + tx.w)) < (above || !(v.y < r.bottom && v.y + v.h > r.top) ? 24 : 72));
      // A control in an open menu: only that menu's own cards (the solid menu hides the page's: the home
      // page's library cards behind the phone menu refused identity-menu's 2, run 45079234722)
      const cardsNear = (window as unknown as { __help: { cards: () => Element[] } }).__help.cards()
        .filter((el) => !el.contains(target) && !target.contains(el) && !inBar(el) && (!homeMenu || homeMenu.contains(el)))
        .map((el) => fromRect(el.getBoundingClientRect()))
        .filter((b) => !contains(tRect, b));
      // Why a spot is refused ('' = fine): listed in the run when a number finds no spot
      // `lead`: a spot for a number on a leader line, which its line ties to its control, so it may share
      // a line with another row's text (ar: the rail's labels were within 24 px of every corridor spot)
      const why = ([x, y]: [number, number], lead = false): string => {
        const v = grow({ x, y, w: S, h: S }, 2);
        if (!onScreen(v)) return 'off screen';
        if (straddlesBar(v) && !(!!homeBar && hit(v, homeBar) && bars.every((bar) => bar === homeBar || !hit(v, bar)))) return 'bar edge';
        // Inside its menu with room: the number's halo 4 px from the menu's border (AUDIT-2 re-audit 4: 2 px)
        if (menuBox && !contains(grow(menuBox, -4), v)) return `outside menu ${Math.round(menuBox.x)},${Math.round(menuBox.y)} ${Math.round(menuBox.w)}x${Math.round(menuBox.h)}`;
        if (!lead && otherRow(v)) return 'another row';
        const tx = texts.find((t) => hit(grow(v, CLEAR), t));
        if (tx) return `text ${tx.what}`;
        // Its own control's pictures too keep CLEAR (AUDIT-2 re-audit 4: 1 touched the avatar's ring)
        const pc = pictures.find((p) => hit(grow(v, CLEAR), p));
        if (pc) return `picture ${pc.what}`;
        if (numbers.some((q) => hit(grow(v, CLEAR), q))) return 'number';
        // Never on a line, its own outline's included: the circle CLEAR px from the dashed line (AUDIT-2
        // re-audit 5: 2 sat on its outline's corner)
        // ...halo to halo: the number's 2 px halo CLEAR px from the outline's (AUDIT-2 re-audit 8: 1 sat
        // 1 px from the channel search's outline, the circle 4 px from the dashed line)
        if (!bare[i] && band(o).some((l) => hit(grow(v, CLEAR), l))) return 'its own outline';
        const fillsIt = (el: Element) => el.contains(target) && (r.width * r.height) / Math.max(1, el.getBoundingClientRect().width * el.getBoundingClientRect().height) >= 0.7;
        // An outlined control's own border counts: its number sits on the outline, never on the control's
        // corner (AUDIT-2 re-audit 4: 2 on the comment box's corner); a number-only marker sits inside it
        // ...and so do the lines inside it (a comment field's own border): a number-only marker, on its
        // control's middle line, skips them
        // A frame the control nearly fills (the upload drop zone's dashed border) counts too: its outline
        // may hug that frame, its number never touches it
        const edge = onEdge(grow(v, CLEAR), (el) => (el === target || target.contains(el) || fillsIt(el) ? bare[i] : false) || (!!homeMenu && el === homeMenu));
        if (edge) return edge.what ?? 'a border';
        // A neighbouring card: the number keeps the same room from it as an outline does
        const vg = { x: v.x, y: v.y - 5, w: v.w, h: v.h + 10 };
        // A header control's number hangs from the header: the page's first card is right under it
        const nextCard = !homeBar && cardsNear.find((cd) => hit(vg, cd) && !contains(cd, vg));
        if (nextCard) return 'a neighbouring card';
        if (otherBands.some((b) => hit(v, b))) return 'outline';
        return '';
      };
      const ok = (c: [number, number]) => !why(c);
      const midY = o.y + o.h / 2 - S / 2;
      const startX = rtl ? o.x + o.w - S / 2 : o.x - S / 2;
      const cands: Array<[number, number]> = [];
      // Off the outline, CLEAR px and one more from its line (AUDIT-2 re-audit 5: never on it). Outside
      // first: beside its middle, then under or over its corners, inline start before end
      const sx = rtl ? o.x + o.w - S : o.x;
      const ex = rtl ? o.x : o.x + o.w - S;
      const off = CLEAR + 2 + 2 + 1;
      const outStart = rtl ? o.x + o.w + off : o.x - S - off;
      const outEnd = rtl ? o.x - S - off : o.x + o.w + off;
      const up = o.y - S - off;
      const down = o.y + o.h + off;
      if (above) cands.push([sx, up], [ex, up]);
      cands.push([outStart, midY], [outEnd, midY], [sx, down], [ex, down], [sx, up], [ex, up]);
      // Then inside, on its middle line, inward from the end: the number reads as the row's own (a
      // spot just outside the outline sat beside the next row's text, e.g. 3 beside 'Studio')
      const inset = 2 + off;
      for (let d = inset; d <= o.w / 2; d += 4) cands.push([rtl ? o.x + d : o.x + o.w - S - d, midY]);
      // Then anywhere along it, every 4 px, outside it or inside it, from half a number past its end
      // corner back to half past its start (a row's end under its menu button: clear just past the
      // corner). End first: from the start, a row's number found the gap beside its title and sat next
      // to the title's own number
      for (let d = -S / 2; d <= o.w - S / 2; d += 4) {
        const ax = rtl ? o.x + d : o.x + o.w - S - d;
        cands.push([ax, up], [ax, down], [ax, o.y + inset], [ax, o.y + o.h - S - inset]);
      }
      for (let d = -S / 2; d <= o.h - S / 2; d += 4) {
        cands.push([outStart, o.y + d], [outEnd, o.y + d], [rtl ? o.x + o.w - S - inset : o.x + inset, o.y + d], [rtl ? o.x + inset : o.x + o.w - S - inset, o.y + d]);
      }
      // A number must touch its own outline (on it, or within 6 px of it)
      // (inside it up to 16 px: clear of a frame the control fills, 6 px inside the outline)
      // (both halos count: the circle sits up to 10 px from the outline's dashed line, 6 px halo to halo)
      const touches = ([x, y]: [number, number]) => hit(grow({ x, y, w: S, h: S }, 10), grow(o, 2)) && !contains(grow(o, -16), { x, y, w: S, h: S });
      // A number-only marker sits on its control's middle line (inward from the end, then from the
      // start) or right beside it, centred on it: never in the gap between two rows
      const bareCands: Array<[number, number]> = [];
      for (let d = 4; d <= o.w / 2; d += 4) bareCands.push([rtl ? o.x + d : o.x + o.w - S - d, midY]);
      for (let d = 4; d <= o.w / 2; d += 4) bareCands.push([rtl ? o.x + o.w - S - d : o.x + d, midY]);
      bareCands.push([rtl ? o.x - S - 4 : o.x + o.w + 4, midY], [rtl ? o.x + o.w + 4 : o.x - S - 4, midY]);
      // A header control: under it, centred, hanging from the header (no room beside it)
      if (homeBar) bareCands.push([o.x + o.w / 2 - S / 2, o.y + o.h + 2]);
      let spot = bare[i] ? bareCands.find(ok) : cands.filter(touches).find(ok);
      // No room at its outline (the Like pill: the channel's row over it, the card's edge before it, the
      // details card under it): the number goes in the nearest clear space with a short leader line to
      // its outline, the line as clear of everything as the number (owner 2026-11-22: never a made-up gap)
      // Its leader: the points it runs through, number end first (one bend at most)
      let leader: number[] | undefined;
      let leaderNote = '';
      let leaderExempt = 0;
      if (!spot && !bare[i]) {
        // The number and its line stay on its control's own card (run 45043851942: 1 went into the
        // navigation rail, its line across the rail's edge): the smallest card holding the control
        const homeCard = (window as unknown as { __help: { cards: () => Element[] } }).__help.cards()
          .filter((el) => el.contains(target) && el !== target && !inBar(el))
          .map((el) => fromRect(el.getBoundingClientRect()))
          // a surface, not the control's own pill group or its row (the action row's scroll fade
          // counts as a card: run 45047089562 found no spot anywhere)
          .filter((cb) => cb.w * cb.h >= 4 * r.width * r.height && cb.h >= 3 * r.height)
          .sort((p1, p2) => p1.w * p1.h - p2.w * p2.h)[0];
        // Next best, when its card has no room (a phone's Like pill): the page's own background, never
        // inside another card or the navigation rail
        const elsewhere = [...(window as unknown as { __help: { cards: () => Element[] } }).__help.cards(), ...document.querySelectorAll('nav, aside, header, footer, [role="navigation"]')]
          .filter((el) => !el.contains(target) && !target.contains(el))
          .map((el) => fromRect(el.getBoundingClientRect()));
        let offCard = false;
        const onCard = (bx: Box) => !homeCard || contains(grow(homeCard, -CLEAR), bx)
          || (offCard && !hit(grow(homeCard, CLEAR), bx) && !elsewhere.some((eb) => hit(grow(eb, CLEAR), bx)));
        // Its line, from the background, crosses its own card's edge (a soft edge) to reach it
        const lineOnCard = (bx: Box) => onCard(bx) || (offCard && !!homeCard && hit(grow(homeCard, CLEAR), bx) && !elsewhere.some((eb) => hit(grow(eb, CLEAR), bx)));
        // Cards' edges, soft ones included: the line crosses one straight across or keeps CLEAR px from
        // it, never runs beside it (AUDIT-2 re-audit 7: 1's line ran 0-2 px beside the details card)
        const edgeCards = (window as unknown as { __help: { cards: () => Element[] } }).__help.cards()
          .filter((el) => el !== target && !target.contains(el) && !inBar(el))
          .map((el) => withRadius(el, fromRect(el.getBoundingClientRect())));
        let dirX = 0;
        let dirY = 0;
        // The exempt end stretch (AUDIT-2 ruling 2026-11-22, item 1 of re-audit 7): only the last 24 px
        // into its outline may come nearer a card edge than 4 px, and there its centre is never further in
        // than the outline's own side, its halo never touches the card (1 px of fill between)
        const EXEMPT = EXEMPT_MAX;
        let exemptUsed = 0;
        const edgeWhy = (px: number, py: number, fromEnd: number): string => {
          const near = 3 + CLEAR;
          for (const cb of edgeCards) {
            // Beside a rounded corner the edge is its curve: outside the end stretch, arcWhy measures that
            const rr = fromEnd > EXEMPT ? Math.min(cb.r ?? 0, cb.w / 2, cb.h / 2) : 0;
            const inX = px > cb.x - near && px < cb.x + cb.w + near && !(rr >= 1 && (px < cb.x + rr || px > cb.x + cb.w - rr));
            const inY = py > cb.y - near && py < cb.y + cb.h + near && !(rr >= 1 && (py < cb.y + rr || py > cb.y + cb.h - rr));
            const sides: Array<{ e: number; p: number; mine: number[]; flat: boolean }> = [];
            if (inX && Math.abs(dirY) < 0.7) sides.push({ e: cb.y, p: py, mine: [o.y, o.y + o.h], flat: true }, { e: cb.y + cb.h, p: py, mine: [o.y, o.y + o.h], flat: true });
            if (inY && Math.abs(dirX) < 0.7) sides.push({ e: cb.x, p: px, mine: [o.x, o.x + o.w], flat: false }, { e: cb.x + cb.w, p: px, mine: [o.x, o.x + o.w], flat: false });
            for (const sd of sides) {
              const d = Math.abs(sd.p - sd.e);
              if (d >= near) continue;
              const holds = cb.x <= o.x && cb.y <= o.y && cb.x + cb.w >= o.x + o.w && cb.y + cb.h >= o.y + o.h;
              if (fromEnd > EXEMPT || holds) return `along a card edge at ${Math.round(sd.e)} (${(d - 3).toFixed(1)} px)`;
              // In the end stretch: no nearer the edge than its outline's own side, and 1 px off the card
              const own = Math.min(...sd.mine.map((m) => Math.abs(m - sd.e)));
              if (own >= near) return `along a card edge at ${Math.round(sd.e)} (${(d - 3).toFixed(1)} px, end stretch, outline clear of it)`;
              // (half a pixel of slack, as the final check allows: a round outline's end on its curve)
              if (d < own - 0.5) return `end stretch further in than its outline (${d.toFixed(1)} < ${own.toFixed(1)} px)`;
              if (hit(grow({ x: px - 3, y: py - 3, w: 6, h: 6 }, 1), cb)) return 'end stretch halo touching a card';
              exemptUsed = Math.max(exemptUsed, fromEnd);
            }
          }
          return '';
        };
        // How far a point is outside its outline's drawn line (negative: inside), the outline a rounded
        // box of its corner radius
        const ownR = Math.min(o.w / 2, o.h / 2, radii[i] >= Math.min(r.width, r.height) / 2 - 0.5 ? Infinity : Math.max(4, radii[i] + 4));
        const ownRingDist = (px: number, py: number) => {
          const qx = Math.min(Math.max(px, o.x + ownR), o.x + o.w - ownR);
          const qy = Math.min(Math.max(py, o.y + ownR), o.y + o.h - ownR);
          return Math.hypot(px - qx, py - qy) - (ownR - 1);
        };
        // A point of the line, its 2 px stroke and 2 px halo, CLEAR px from everything; near its own end
        // it may meet its own outline
        const pointWhy = (px: number, py: number, nearEnd: boolean, fromEnd = 0): string => {
          const b = { x: px - 3, y: py - 3, w: 6, h: 6 };
          const g = grow(b, CLEAR);
          if (!onScreen(b)) return 'off screen';
          if (!lineOnCard(b)) return 'off its card';
          if (straddlesBar(b)) return 'bar edge';
          if (menuBox && !contains(grow(menuBox, -4), b)) return 'outside menu';
          if (texts.some((t) => hit(g, t))) return 'text';
          if (pictures.some((pc) => hit(g, pc))) return 'picture';
          if (numbers.some((q) => hit(g, q))) return 'number';
          if (otherBands.some((bd) => hit(g, bd))) return 'outline';
          // Its own outline as drawn (a round one's corners are curves, not its box's corners): the line's
          // centre 8 px from the dashed line's centre (half the line, the halo, CLEAR), never inside it
          if (!nearEnd) {
            const rd = ownRingDist(px, py);
            if (rd < 0) return 'inside its outline';
            if (rd < 8) return 'its own outline';
          }
          const ew = !nearEnd || fromEnd > 0 ? edgeWhy(px, py, fromEnd) : '';
          if (ew) return ew;
          const aw = fromEnd > EXEMPT && arcCards.length ? arcWhy(arcCards, px, py, 3 + CLEAR) : '';
          if (aw) return aw;
          // Drawn lines only: a card's soft edge (the details card) may be crossed
          if (onEdge(g, (el) => (!!homeMenu && el === homeMenu))) return 'a border';
          return '';
        };
        // Only rounded cards near its outline have corners a line could pass (every point is checked)
        const arcCards = edgeCards.filter((cb) => (cb.r ?? 0) >= 1 && hit(grow(o, 220), cb));
        // Card edges crossed square on, past their rounded corners; the end stretch (the last 24 px into
        // its outline, which has its own rules above) is left out
        const crossTrim = (x1: number, y1: number, x2: number, y2: number, last: boolean): string => {
          const len = Math.hypot(x2 - x1, y2 - y1);
          if (!last) return crossWhy(edgeCards, x1, y1, x2, y2, 3 + CLEAR);
          if (len <= EXEMPT) return '';
          const k = (len - EXEMPT) / len;
          return crossWhy(edgeCards, x1, y1, x1 + (x2 - x1) * k, y1 + (y2 - y1) * k, 3 + CLEAR);
        };
        // The first point of a segment that is refused, and why (for the run log)
        const lineWhy = (x1: number, y1: number, x2: number, y2: number, last = true): string => {
          const len = Math.hypot(x2 - x1, y2 - y1);
          if (len < 1) return '';
          const cw = crossTrim(x1, y1, x2, y2, last);
          if (cw) return cw;
          dirX = (x2 - x1) / len;
          dirY = (y2 - y1) / len;
          for (let t = 0; t <= len; t += 1.5) {
            const px = x1 + ((x2 - x1) * t) / len;
            const py = y1 + ((y2 - y1) * t) / len;
            const w = pointWhy(px, py, last && len - t <= 2 + CLEAR + 3, last ? len - t : 1e9);
            if (w) return `${w} at ${px.toFixed(1)},${py.toFixed(1)}`;
          }
          return '';
        };
        // One straight segment; `last` is the one into its outline (its last 24 px the end stretch),
        // any other is held to the full rule throughout
        const lineClear = (x1: number, y1: number, x2: number, y2: number, last = true) => {
          const len = Math.hypot(x2 - x1, y2 - y1);
          if (len < 1) return true;
          if (crossTrim(x1, y1, x2, y2, last)) return false;
          dirX = (x2 - x1) / len;
          dirY = (y2 - y1) / len;
          if (last) exemptUsed = 0;
          for (let t = 0; t <= len; t += 1.5) {
            if (pointWhy(x1 + ((x2 - x1) * t) / len, y1 + ((y2 - y1) * t) / len, last && len - t <= 2 + CLEAR + 3, last ? len - t : 1e9)) return false;
          }
          return true;
        };
        const far: Array<{ c: [number, number]; d: number }> = [];
        const R = 160;
        for (let yy = o.y - R; yy <= o.y + o.h + R; yy += 4) {
          for (let xx = o.x - R; xx <= o.x + o.w + R; xx += 4) {
            const cx = xx + S / 2;
            const cy = yy + S / 2;
            const nx = Math.min(Math.max(cx, o.x), o.x + o.w);
            const ny = Math.min(Math.max(cy, o.y), o.y + o.h);
            const d = Math.hypot(cx - nx, cy - ny);
            // Off its outline by more than a touching spot would be, and not across the picture
            if (d >= S / 2 + 2 + CLEAR + 4 && d <= R) far.push({ c: [xx, yy], d });
          }
        }
        // ...and spots centred in a corridor between two card edges (the 14 px run between its card's edge
        // and the details card's: only its exact middle keeps 4 px from both)
        const gridEnd = far.length;
        const vEdges = [...new Set(edgeCards.flatMap((cb) => [cb.x, cb.x + cb.w]))].filter((e) => Math.abs(e - (o.x + o.w / 2)) <= R).sort((p1, p2) => p1 - p2);
        const hEdges = [...new Set(edgeCards.flatMap((cb) => [cb.y, cb.y + cb.h]))].filter((e) => Math.abs(e - (o.y + o.h / 2)) <= R).sort((p1, p2) => p1 - p2);
        const mids = (es: number[]) => es.flatMap((e1, k) => es.slice(k + 1).filter((e2) => e2 - e1 >= 2 * (3 + CLEAR) && e2 - e1 <= 3 * S).map((e2) => (e1 + e2) / 2));
        const vMids = mids(vEdges);
        const hMids = mids(hEdges);
        // A bend at a corridor's exact middle, its end stretch dB long into the outline
        const corridorBends = (ex2: number, ey2: number, dB: number): Array<[number, number]> => [
          ...vMids.filter((mx) => Math.abs(mx - ex2) < dB).flatMap((mx): Array<[number, number]> => [-1, 1].map((sg): [number, number] => [mx, ey2 + sg * Math.sqrt(dB * dB - (mx - ex2) ** 2)])),
          ...hMids.filter((my) => Math.abs(my - ey2) < dB).flatMap((my): Array<[number, number]> => [-1, 1].map((sg): [number, number] => [ex2 + sg * Math.sqrt(dB * dB - (my - ey2) ** 2), my])),
        ];
        let multiTried = 0;
        // The rounded corners of the cards holding its outline: a run from below the card into the
        // corridor beside it turns along the corner's curve, its centre 7 px inside it (a 45-degree cut
        // passed 5 px from the curve or the inner card's: the watch card's corner is 22 px round and the
        // corridor 14 px wide), as a few straight steps
        const turnCorners = edgeCards.filter((cb) => cb.x <= o.x && cb.y <= o.y && cb.x + cb.w >= o.x + o.w && cb.y + cb.h >= o.y + o.h)
          .flatMap((cb) => {
            const rr = Math.min(cb.r ?? 0, cb.w / 2, cb.h / 2);
            const rho = rr - (3 + CLEAR);
            if (rho < 4) return [];
            return ([[-1, -1], [1, -1], [-1, 1], [1, 1]] as const).map(([sx, sy]) => {
              const ax = sx < 0 ? cb.x + rr : cb.x + cb.w - rr;
              const ay = sy < 0 ? cb.y + rr : cb.y + cb.h - rr;
              return { ax, ay, sx, sy, rho, gx: ax + sx * rho, gy: ay + sy * rho };
            });
          });
        for (const mx of mids(vEdges)) {
          for (let yy = o.y - R; yy <= o.y + o.h + R; yy += 4) {
            const cy = yy + S / 2;
            const d = Math.hypot(Math.max(0, Math.abs(mx - (o.x + o.w / 2)) - o.w / 2), Math.max(0, Math.abs(cy - (o.y + o.h / 2)) - o.h / 2));
            if (d >= S / 2 + 2 + CLEAR + 4 && d <= R) far.push({ c: [mx - S / 2, yy], d });
          }
        }
        for (const my of mids(hEdges)) {
          for (let xx = o.x - R; xx <= o.x + o.w + R; xx += 4) {
            const cx = xx + S / 2;
            const d = Math.hypot(Math.max(0, Math.abs(cx - (o.x + o.w / 2)) - o.w / 2), Math.max(0, Math.abs(my - (o.y + o.h / 2)) - o.h / 2));
            if (d >= S / 2 + 2 + CLEAR + 4 && d <= R) far.push({ c: [xx, my - S / 2], d });
          }
        }
        // Corridor spots first (the only routes past a card's edge), then by distance
        const ranked = far.map((f, k) => ({ ...f, corridor: k >= gridEnd && f.d <= 96 }));
        ranked.sort((a, b) => Number(b.corridor) - Number(a.corridor) || a.d - b.d);
        far.splice(0, far.length, ...ranked.map(({ c, d }) => ({ c, d })));
        const corridorKeys = new Set(ranked.filter((f) => f.corridor).map((f) => `${f.c[0]},${f.c[1]}`));
        // Ends anywhere on its outline (every 6 px round it): the shortest clear line from the nearest
        // clear space (straight to the nearest point crossed the channel's row from every spot)
        const ends: Array<[number, number]> = [];
        for (let e = 0; e <= o.w; e += 6) ends.push([o.x + e, o.y], [o.x + e, o.y + o.h]);
        for (let e = 6; e < o.h; e += 6) ends.push([o.x, o.y + e], [o.x + o.w, o.y + e]);
        // ...and all four corners (stepping from the left reached the right corners only when its width
        // was a multiple of 6: ar's bottom-right corner, where its corridor meets it, was missing)
        ends.push([o.x + o.w, o.y], [o.x + o.w, o.y + o.h]);
        // ...on the outline as drawn: a round outline's corner points sit on its curve, not on its box
        // (AUDIT-2 re-audit 8: en phone's 2 ended 4 px short of the clock's round outline)
        const ringR = Math.min(o.w / 2, o.h / 2, radii[i] >= Math.min(r.width, r.height) / 2 - 0.5 ? Infinity : Math.max(4, radii[i] + 4));
        for (const e of ends) {
          const kx = e[0] < o.x + ringR ? o.x + ringR : e[0] > o.x + o.w - ringR ? o.x + o.w - ringR : null;
          const ky = e[1] < o.y + ringR ? o.y + ringR : e[1] > o.y + o.h - ringR ? o.y + o.h - ringR : null;
          if (kx === null || ky === null) continue;
          const dl = Math.hypot(e[0] - kx, e[1] - ky) || 1;
          e[0] = kx + ((e[0] - kx) * ringR) / dl;
          e[1] = ky + ((e[1] - ky) * ringR) / dl;
        }
        // ...and every 5 degrees round its corners' curves (a run into a round outline's lower curve needs
        // its end there, 6 px steps projected onto the curve missed the one spot that keeps 4 px from the
        // card beside it)
        if (ringR >= 8) {
          for (const [cx0, cy0] of [[o.x + ringR, o.y + ringR], [o.x + o.w - ringR, o.y + ringR], [o.x + ringR, o.y + o.h - ringR], [o.x + o.w - ringR, o.y + o.h - ringR]]) {
            for (let deg = 0; deg < 360; deg += 5) {
              const ex = cx0 + Math.cos((deg * Math.PI) / 180) * ringR;
              const ey = cy0 + Math.sin((deg * Math.PI) / 180) * ringR;
              if ((ex - (o.x + o.w / 2)) * (cx0 - (o.x + o.w / 2)) < 0 || (ey - (o.y + o.h / 2)) * (cy0 - (o.y + o.h / 2)) < 0) continue;
              ends.push([ex, ey]);
            }
          }
        }
        // The nearest 250 clear spots at most: past them a line is no longer short, and a number with no
        // route at all would hold the picture up for minutes (run 45060133945 timed out)
        let triedSpots = 0;
        for (const { c, off } of [...far.map((f) => ({ ...f, off: false })), ...far.map((f) => ({ ...f, off: true }))]) {
          // The cap is per pass (on its card, then the page's background) and corridor spots don't count
          // towards it: several corridors filled it before ar desktop light's, and the background pass
          // never ran (run 45069678568)
          if (off !== offCard) { triedSpots = 0; multiTried = 0; }
          offCard = off;
          // ...and never on another card inside its own (AUDIT-2 re-audit 7: en phone's 2 on the details card)
          const vb = grow({ x: c[0], y: c[1], w: S, h: S }, 2);
          if (why(c, true) || !onCard(vb) || elsewhere.some((eb) => hit(grow(eb, CLEAR), vb))) continue;
          if (!corridorKeys.has(`${c[0]},${c[1]}`) && ++triedSpots > 250) continue;
          const cx = c[0] + S / 2;
          const cy = c[1] + S / 2;
          const byLength = ends.map(([ex2, ey2]) => ({ ex2, ey2, len: Math.hypot(ex2 - cx, ey2 - cy) })).sort((a, b) => a.len - b.len).slice(0, 24);
          for (const { ex2, ey2, len } of byLength) {
            const sx0 = cx + ((ex2 - cx) * (S / 2 + 2)) / len;
            const sy0 = cy + ((ey2 - cy) * (S / 2 + 2)) / len;
            if (!lineClear(sx0, sy0, ex2, ey2)) continue;
            spot = c;
            leader = [sx0, sy0, ex2, ey2];
            leaderExempt = exemptUsed;
            break;
          }
          // No straight line: one bend, where the end stretch starts (AUDIT-2 ruling: no bend inside it).
          // A run held to its card's 14 px corridor (centre 4 px from both edges) lies off its outline's
          // side, so a straight line can never both keep the corridor and reach the outline
          for (const { ex2, ey2 } of spot ? [] : byLength.slice(0, 8)) {
            const base = Math.atan2(cy - ey2, cx - ex2);
            for (const dB of [EXEMPT, 20, 16]) {
              // The bend in line with the number's own column or row first (the first segment then runs
              // straight along a corridor), then every 10 degrees towards the number
              const bends: Array<[number, number]> = [];
              const dxB = cx - ex2;
              const dyB = cy - ey2;
              if (Math.abs(dxB) <= dB) bends.push([cx, ey2 + Math.sign(dyB || 1) * Math.sqrt(dB * dB - dxB * dxB)]);
              if (Math.abs(dyB) <= dB) bends.push([ex2 + Math.sign(dxB || 1) * Math.sqrt(dB * dB - dyB * dyB), cy]);
              for (let k = -6; k <= 6; k++) bends.push([ex2 + Math.cos(base + (k * Math.PI) / 18) * dB, ey2 + Math.sin(base + (k * Math.PI) / 18) * dB]);
              bends.push(...corridorBends(ex2, ey2, dB));
              for (const [bx, by] of bends) {
                if (spot) break;
                if (contains(grow(o, 2), { x: bx - 1, y: by - 1, w: 2, h: 2 })) continue;
                const lenA = Math.hypot(bx - cx, by - cy);
                if (lenA < S / 2 + 2 + 6) continue;
                const sx0 = cx + ((bx - cx) * (S / 2 + 2)) / lenA;
                const sy0 = cy + ((by - cy) * (S / 2 + 2)) / lenA;
                if (!lineClear(sx0, sy0, bx, by, false) || !lineClear(bx, by, ex2, ey2)) continue;
                spot = c;
                leader = [sx0, sy0, bx, by, ex2, ey2];
                leaderExempt = exemptUsed;
              }
              if (spot) break;
            }
            if (spot) break;
          }
          // Still none: the run before the end stretch turns at right angles, along corridors, so it
          // leaves a card straight across its edge and past its rounded corner (AUDIT-2 re-audit 8: 1's
          // line crossed the video card's corner on a slant). L: one turn; Z: two, along a corridor
          // between card edges. Only for the nearest spots: each one tries many routes
          // Corner routes for every spot (few, cheap); the rest only for the nearest 40
          const fullSearch = !spot && ++multiTried <= 40;
          if (!spot && (fullSearch || turnCorners.length)) {
            // ...and the ends a corner route can reach: within an end stretch of a corner's corridor
            const cornerEnds = ends.filter(([ex]) => turnCorners.some((tc) => Math.abs(ex - tc.gx) < EXEMPT + 1)).map(([ex2, ey2]) => ({ ex2, ey2, onlyCorner: true }));
            for (const { ex2, ey2, onlyCorner } of [...(fullSearch ? byLength.slice(0, 4).map((e) => ({ ...e, onlyCorner: false })) : []), ...cornerEnds]) {
              for (const dB of [EXEMPT]) {
                const base = Math.atan2(cy - ey2, cx - ex2);
                const bends: Array<[number, number]> = [...corridorBends(ex2, ey2, dB), [ex2, ey2 + Math.sign(cy - ey2 || 1) * dB], [ex2 + Math.sign(cx - ex2 || 1) * dB, ey2]];
                for (let k = -6; k <= 6; k += 2) bends.push([ex2 + Math.cos(base + (k * Math.PI) / 18) * dB, ey2 + Math.sin(base + (k * Math.PI) / 18) * dB]);
                for (const [bx, by] of bends) {
                  if (spot) break;
                  if (contains(grow(o, 2), { x: bx - 1, y: by - 1, w: 2, h: 2 })) continue;
                  // Each turn also cut at 45 degrees (k px each way): a square turn where two corridors meet
                  // sits on a card's rounded corner, a cut one clears it (the video card's bottom corner,
                  // where the corridor beside it meets the strip under the details card)
                  const sg = (v: number) => (v < 0 ? -1 : 1);
                  const cuts = [4, 6, 8, 10, 12, 14, 16];
                  // Only corridors between the number and the bend (a run never doubles back)
                  const hm = hMids.filter((gy) => gy > Math.min(cy, by) + 4 && gy < Math.max(cy, by) - 4);
                  const vm = vMids.filter((gx) => gx > Math.min(cx, bx) + 4 && gx < Math.max(cx, bx) - 4);
                  const routes: Array<Array<[number, number]>> = [[[cx, by]], [[bx, cy]], ...hm.map((gy): Array<[number, number]> => [[bx, gy], [cx, gy]]), ...vm.map((gx): Array<[number, number]> => [[gx, by], [gx, cy]])];
                  for (const tc of turnCorners) {
                    if (Math.abs(bx - tc.gx) > 1.5 || (cy - tc.gy) * tc.sy <= 0 || (cx - tc.ax) * tc.sx >= 0) continue;
                    const arc = [0, 30, 60, 90].map((deg): [number, number] => [tc.ax + tc.sx * tc.rho * Math.cos((deg * Math.PI) / 180), tc.ay + tc.sy * tc.rho * Math.sin((deg * Math.PI) / 180)]);
                    routes.unshift([...arc, [cx, tc.gy]]);
                  }
                  if (onlyCorner) routes.splice(routes.length - (2 + hm.length + vm.length), 2 + hm.length + vm.length);
                  for (const k of onlyCorner ? [] : cuts) {
                    for (const gy of hm) routes.push([[bx, gy + sg(by - gy) * k], [bx + sg(cx - bx) * k, gy], [cx, gy]]);
                    for (const gx of vm) routes.push([[gx + sg(bx - gx) * k, by], [gx, by + sg(cy - by) * k], [gx, cy]]);
                    routes.push([[cx + sg(bx - cx) * k, by], [cx, by + sg(cy - by) * k]]);
                    routes.push([[bx, cy + sg(by - cy) * k], [bx + sg(cx - bx) * k, cy]]);
                  }
                  for (const via of routes) {
                    const pts: Array<[number, number]> = [...via].reverse().filter((q, k, all) => Math.hypot(q[0] - (all[k - 1]?.[0] ?? cx), q[1] - (all[k - 1]?.[1] ?? cy)) >= 4);
                    if (!pts.length || pts.length !== via.length) continue;
                    const [qx, qy] = pts[0];
                    const lenA = Math.hypot(qx - cx, qy - cy);
                    if (lenA < S / 2 + 2 + 6) continue;
                    const sx0 = cx + ((qx - cx) * (S / 2 + 2)) / lenA;
                    const sy0 = cy + ((qy - cy) * (S / 2 + 2)) / lenA;
                    const chain: Array<[number, number]> = [[sx0, sy0], ...pts, [bx, by]];
                    if (chain.slice(1).some((q, k) => Math.hypot(q[0] - chain[k][0], q[1] - chain[k][1]) < 4)) continue;
                    if (!chain.slice(1).every((q, k) => lineClear(chain[k][0], chain[k][1], q[0], q[1], false)) || !lineClear(bx, by, ex2, ey2)) continue;
                    spot = c;
                    leader = [...chain.flat(), ex2, ey2];
                    leaderExempt = exemptUsed;
                    break;
                  }
                }
                if (spot) break;
              }
              if (spot) break;
            }
          }
          if (spot) break;
        }
        if (!spot) {
          // Why no leader spot: its card, and how many far spots each check refused
          const tally = new Map<string, number>();
          for (const { c } of far) {
            const w = why(c);
            const k = w ? w.replace(/".*"/, '"…"').replace(/ \d.*$/, '') : 'line blocked or off card';
            tally.set(k, (tally.get(k) ?? 0) + 1);
          }
          // The nearest corridor spot's route, bent into its outline's nearest corner: what refuses it
          // the nearest under its outline (a corridor beside its row sits on the row's own text)
          const cols = [...new Set(ranked.filter((f) => f.c[1] > o.y + o.h && ranked.indexOf(f) >= 0 && f.corridor).map((f) => f.c[0]))];
          const corNotes: string[] = [`edges x ${vEdges.map((e) => e.toFixed(1)).join('/')}`];
          // the columns nearest its outline's sides first (the corridor that runs past its card's edge)
          const side = (col: number) => Math.min(Math.abs(col + S / 2 - o.x), Math.abs(col + S / 2 - (o.x + o.w)));
          cols.sort((c1, c2) => side(c1) - side(c2));
          for (const col of cols.slice(0, 4)) {
            const firstOk = ranked.find((f) => f.corridor && f.c[0] === col && f.c[1] > o.y + o.h && !why(f.c, true));
            const firstAny = ranked.find((f) => f.corridor && f.c[0] === col && f.c[1] > o.y + o.h);
            corNotes.push(`column ${Math.round(col + S / 2)}: ${firstOk ? `clear at y ${Math.round(firstOk.c[1])}` : `none clear (first: ${firstAny ? why(firstAny.c, true) : '?'})`}`);
          }
          let corNote = corNotes.join(', ');
          // The route from each of the best two columns' first clear spot below the card, bent into the
          // outline's nearest corner
          for (const col of cols.slice(0, 4).filter((cl) => ranked.some((f) => f.corridor && f.c[0] === cl && f.c[1] > o.y + o.h && !why(f.c, true)))) {
            const cor = ranked.filter((f) => f.corridor && f.c[0] === col && f.c[1] > o.y + o.h && !why(f.c, true))
              .find((f) => onCard(grow({ x: f.c[0], y: f.c[1], w: S, h: S }, 2)) || (offCard = true, onCard(grow({ x: f.c[0], y: f.c[1], w: S, h: S }, 2))));
            offCard = false;
            if (!cor) { corNote += `; column ${Math.round(col + S / 2)}: no spot on its card or the page`; continue; }
            const ccx = cor.c[0] + S / 2;
            const ccy = cor.c[1] + S / 2;
            const ex2 = Math.min(Math.max(ccx, o.x), o.x + o.w);
            const ey2 = Math.min(Math.max(ccy, o.y), o.y + o.h);
            const dxB = ccx - ex2;
            const by = ey2 + Math.sign(ccy - ey2 || 1) * Math.sqrt(Math.max(0, EXEMPT * EXEMPT - dxB * dxB));
            offCard = !contains(grow(homeCard ?? o, -CLEAR), grow({ x: cor.c[0], y: cor.c[1], w: S, h: S }, 2));
            corNote += `; column ${Math.round(ccx)} spot y ${Math.round(ccy)}: run ${lineWhy(ccx, ccy + Math.sign(by - ccy) * (S / 2 + 2), ccx, by, false) || 'clear'}; end to ${Math.round(ex2)},${Math.round(ey2)} ${lineWhy(ccx, by, ex2, ey2) || 'clear'}`;
            offCard = false;
          }
          // The cards near its outline as measured (with corner radii), and the cut route from the first
          // spot below its card past the corridor, segment by segment
          corNote += `; cards near: ${edgeCards.filter((cb) => hit(grow(o, 60), cb) && cb.w < 2000).slice(0, 8).map((cb) => `${cb.x.toFixed(1)},${cb.y.toFixed(1)} ${cb.w.toFixed(1)}x${cb.h.toFixed(1)} r${(cb.r ?? 0).toFixed(1)}`).join(' | ')}; hMids ${hMids.map((v) => v.toFixed(1)).join('/')}; vMids ${vMids.map((v) => v.toFixed(1)).join('/')}`;
          const gx0 = vMids.filter((v) => Math.abs(v - (rtl ? o.x + o.w : o.x)) < 12)[0];
          const below = gx0 === undefined ? undefined : ranked.find((f) => f.c[1] > o.y + o.h + 30 && Math.abs(f.c[0] + S / 2 - gx0) >= 16 && Math.abs(f.c[0] + S / 2 - gx0) <= 48 && !why(f.c, true));
          if (gx0 !== undefined && below) {
            const qx = below.c[0] + S / 2;
            const qy = below.c[1] + S / 2;
            const ex2 = rtl ? o.x + o.w : o.x;
            const ey2 = o.y + o.h - Math.min(o.w, o.h) / 2;
            const bx = gx0;
            const by = ey2 + Math.sqrt(Math.max(0, EXEMPT * EXEMPT - (bx - ex2) ** 2));
            offCard = true;
            for (const tc of turnCorners.filter((t) => Math.abs(t.gx - (rtl ? o.x + o.w : o.x)) < EXEMPT + 1 && t.sy > 0)) {
              const qx2 = tc.ax - tc.sx * (tc.rho + 3 + CLEAR + 8);
              const by = (rtl ? o.y + o.h : o.y + o.h) + 22;
              const bx = tc.gx;
              const arc = [90, 60, 30, 0].map((deg): [number, number] => [tc.ax + tc.sx * tc.rho * Math.cos((deg * Math.PI) / 180), tc.ay + tc.sy * tc.rho * Math.sin((deg * Math.PI) / 180)]);
              const chain: Array<[number, number]> = [[qx2, tc.gy + tc.sy * 30], [qx2, tc.gy], ...arc, [bx, by]];
              const segs = chain.slice(1).map((q, j) => lineWhy(chain[j][0], chain[j][1], q[0], q[1], false));
              corNote += `; corner route x ${qx2.toFixed(1)} round ${tc.ax.toFixed(1)},${tc.ay.toFixed(1)} r${tc.rho.toFixed(1)}: ${segs.map((w, j) => `s${j + 1} ${w || 'ok'}`).join(', ')}`;
              // Its end stretch into each reachable end, and the spots below the card it could start from
              const endNotes = ends.filter(([ex]) => Math.abs(ex - tc.gx) < EXEMPT).slice(0, 8).flatMap(([ex2, ey2]) => corridorBends(ex2, ey2, EXEMPT).filter(([bx2]) => Math.abs(bx2 - tc.gx) <= 1.5).map(([bx2, by2]) => `${ex2.toFixed(0)},${ey2.toFixed(0)} from ${bx2.toFixed(0)},${by2.toFixed(0)} ${lineWhy(bx2, by2, ex2, ey2) || 'ok'}`));
              const spots = ranked.filter((f) => (f.c[0] + S / 2 - tc.ax) * tc.sx < 0 && (f.c[1] + S / 2 - tc.gy) * tc.sy > 20).slice(0, 4).map((f) => `${f.c[0] + S / 2},${f.c[1] + S / 2} ${why(f.c, true) || (onCard(grow({ x: f.c[0], y: f.c[1], w: S, h: S }, 2)) ? 'ok' : 'off card')}`);
              corNote += `; ends ${endNotes.join(' | ') || 'none'}; spots ${spots.join(' | ') || 'none'}`;
            }
            for (const gy of hMids.filter((v) => v > by + 4 && v < qy - 4)) {
              for (const k of [6, 8, 10, 12]) {
                const sgx = qx > bx ? 1 : -1;
                const chain: Array<[number, number]> = [[qx, qy - (S / 2 + 2)], [qx, gy], [bx + sgx * k, gy], [bx, gy - k], [bx, by]];
                const segs = chain.slice(1).map((q, j) => lineWhy(chain[j][0], chain[j][1], q[0], q[1], false));
                corNote += `; cut route from ${Math.round(qx)},${Math.round(qy)} via strip ${gy.toFixed(1)} k${k}: ${segs.map((w, j) => `s${j + 1} ${w || 'ok'}`).join(', ')}, end ${lineWhy(bx, by, ex2, ey2) || 'ok'}`;
              }
            }
            offCard = false;
          }
          leaderNote = `; ${corNote}; leader: card ${homeCard ? `${Math.round(homeCard.x)},${Math.round(homeCard.y)} ${Math.round(homeCard.w)}x${Math.round(homeCard.h)}` : 'none'}, ${[...tally].map(([k, v]) => `${k} ×${v}`).join(', ')}`;
        }
      }
      if (!spot) {
        failed.push(i);
        // Every distinct reason, not only the first spots' (a header number's hanging spot was refused
        // for a reason the first four never showed)
        const all = (bare[i] ? bareCands : cands.filter(touches)).map((c) => `${Math.round(c[0])},${Math.round(c[1])}: ${why(c)}`);
        const seenWhy = new Set<string>();
        const tried = [...all.slice(0, 4), ...all.filter((t) => { const w = t.slice(t.indexOf(': ') + 2).replace(/"[^"]*"/, '"…"'); if (seenWhy.has(w)) return false; seenWhy.add(w); return true; })].slice(0, 10);
        passFaults.push(`number ${n} has no spot clear of text, pictures, other numbers and outlines (target ${Math.round(r.x)},${Math.round(r.y)} ${Math.round(r.width)}x${Math.round(r.height)}; ${tried.join('; ')}${leaderNote})`);
      }
      const [x, y] = spot ?? [startX, midY];
      // A number sent to a leader line: why each spot at its outline was refused (AUDIT-2 re-audit 7:
      // en phone's 2 went to a line with room above its button)
      const atOutline = leader ? ` [at its outline: ${cands.filter(touches).slice(0, 14).map((c) => `${Math.round(c[0])},${Math.round(c[1])} ${why(c)}`).join('; ')}]` : '';
      if (spot) passPlaced.push(`${n}${bare[i] ? ' (number only)' : ''}${leader ? ` (leader line${leader.length > 4 ? ` bent at ${Math.round(leader[2])},${Math.round(leader[3])}` : ''}, exempt end stretch ${Math.round(leaderExempt)} px of ${EXEMPT_MAX})` : ''}${atOutline} at ${Math.round(x)},${Math.round(y)} for target ${Math.round(r.x)},${Math.round(r.y)} ${Math.round(r.width)}x${Math.round(r.height)}`);
      numbers.push(grow({ x, y, w: S, h: S }, 2));
      spots[i] = [x, y];
      if (leader) {
        leaders[i] = leader;
        // Later numbers keep clear of the line too
        for (let sg = 0; sg + 3 < leader.length; sg += 2) {
          const [lx1, ly1, lx2, ly2] = leader.slice(sg, sg + 4);
          const len = Math.hypot(lx2 - lx1, ly2 - ly1);
          for (let t = 0; t <= len; t += 3) numbers.push({ x: lx1 + ((lx2 - lx1) * t) / len - 3, y: ly1 + ((ly2 - ly1) * t) / len - 3, w: 6, h: 6 });
        }
      }
      }
      return { spots, leaders, failed, passFaults, passPlaced };
    };
    // In page order first; a number left with no spot goes first next time (a row's number took the one
    // spot its title's number had: creating-studio, AUDIT-2 re-audit 5), up to three more tries
    // A pass that sent a number to a leader line tries again with those numbers last, so the others
    // take the spots at their outlines first (en phone: 2's line took the spot over Save that 3 needed);
    // the pass with fewest numbers left out, then fewest leader lines, is kept
    let order = targets.map((_, i) => i);
    let result = runPass(order);
    const leadOf = (res: { leaders: Array<number[] | undefined> }) => targets.map((_, i) => i).filter((i) => !!res.leaders[i]);
    const score = (res: { failed: number[]; leaders: Array<number[] | undefined> }) => res.failed.length * 100 + leadOf(res).length;
    const tried = new Set([order.join(',')]);
    for (let tries = 0; tries < 3 && result.failed.length; tries++) {
      const failedNow = result.failed;
      order = [...failedNow, ...order.filter((i) => !failedNow.includes(i))];
      if (tried.has(order.join(','))) break;
      tried.add(order.join(','));
      const next = runPass(order);
      if (score(next) < score(result)) result = next;
    }
    // Each leader-line number placed last in turn (all of them last changed nothing when every one had
    // a line: run 45064650381)
    for (const j of leadOf(result)) {
      const base = order.filter((i) => i !== j);
      const o2 = [...base, j];
      if (tried.has(o2.join(','))) continue;
      tried.add(o2.join(','));
      const next = runPass(o2);
      if (score(next) < score(result)) { result = next; order = o2; }
    }
    missed += result.failed.length;
    faults.push(...result.passFaults);
    placed.push(...result.passPlaced);
    for (const [i, target] of targets.entries()) {
      const o = rings[i];
      const n = target.dataset.helpTarget;
      const r = rects[i];
      const round = radii[i] >= Math.min(r.width, r.height) / 2 - 0.5;
      const [x, y] = result.spots[i];
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
      if (above) m.dataset.helpPlace = 'above';
      const lead = result.leaders[i];
      // Its segments: every halo first, then every ink line over them, so a bend's halo never covers
      // the line; the segment into the outline is marked as the end stretch for the check
      const halos: HTMLElement[] = [];
      const inks: HTMLElement[] = [];
      for (let sg = 0; lead && sg + 3 < lead.length; sg += 2) {
        const [lx1, ly1, lx2, ly2] = lead.slice(sg, sg + 4);
        for (const halo of [true, false]) {
          const seg = document.createElement('span');
          seg.dataset.helpMarker = '';
          if (!halo) {
            seg.dataset.helpLeader = n;
            seg.dataset.from = `${lx1},${ly1}`;
            seg.dataset.to = `${lx2},${ly2}`;
            if (sg + 4 === lead.length) seg.dataset.endStretch = '';
          }
          Object.assign(seg.style, {
            position: 'fixed', left: `${lx1}px`, top: `${ly1 - 1}px`, width: `${Math.hypot(lx2 - lx1, ly2 - ly1)}px`, height: '2px',
            background: halo ? HALO : INK, boxShadow: halo ? `0 0 0 2px ${HALO}` : 'none', transformOrigin: '0 50%',
            transform: `rotate(${Math.atan2(ly2 - ly1, lx2 - lx1)}rad)`, zIndex: '2147483646', pointerEvents: 'none',
          });
          (halo ? halos : inks).push(seg);
        }
      }
      document.body.append(...(bare[i] ? [m] : lead ? [ring, ...halos, ...inks, m] : [ring, m]));
    }
    const bareList = targets.map((t, i) => (bare[i] ? `${t.dataset.helpTarget} (crowded by ${bareWhy[i] || '?'})` : '')).filter(Boolean);
    return { missed, faults, bareList, placed };
  }, { rtl: lang === 'ar', above: place === 'above' });
  // Not silent: the run lists every picture whose number had to sit on another control
  if (unplaced.missed) note(`${unplaced.missed} marker(s) found no spot clear of other controls`);
  if (unplaced.bareList.length) note(`number-only markers: ${unplaced.bareList.join(', ')}`);
  console.log(`help marks: ${unplaced.placed.join('; ')}`);
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
    const EXEMPT_MAX = 24;
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
      // Laid out inside a closed <details> (not its summary), never shown: the watch page's collapsed
      // description and exact date
      if (el && el.closest('details:not([open])') && !el.closest('summary')) return true;
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
      return b.width >= innerWidth * 0.6 && b.height > 20 && b.height < innerHeight * 0.3 && (b.top <= 1 || b.bottom >= innerHeight - 1 || !!el.closest("[data-pinned]"));
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
        const inked = (window as unknown as { __help: { ink: (e: Element, t: string, r: DOMRect) => DOMRect } }).__help.ink(el, node.textContent ?? '', b);
        const box = fromRect(inked, { what: `"${(node.textContent ?? '').trim().slice(0, 24)}"`, el });
        // Less than a pixel of it inside the frame shows nothing (a tab strip's next tab starting at the
        // screen's edge): not a line in the picture
        const inW = Math.min(box.x + box.w, frame.x + frame.w) - Math.max(box.x, frame.x);
        const inH = Math.min(box.y + box.h, frame.y + frame.h) - Math.max(box.y, frame.y);
        if (inW < 1 || inH < 1) continue;
        // Out of sight inside its list or clipping box (the rail's item below the list's edge): not shown
        const helpV = (window as unknown as { __help: { visible: (e: Element, r: { l: number; t: number; r: number; b: number }) => unknown } }).__help;
        const seenPart = helpV.visible(el, { l: b.left, t: b.top, r: b.right, b: b.bottom }) as { l: number; t: number; r: number; b: number } | null;
        if (!seenPart) continue;
        const inside = Math.min(seenPart.r, frame.x + frame.w) - Math.max(seenPart.l, frame.x) >= 1 && Math.min(seenPart.b, frame.y + frame.h) - Math.max(seenPart.t, frame.y) >= 1;
        if (!inside) continue;
        if (hidden(box, el)) { skippedNodes.push({ el, node, why: 'hidden' }); continue; }
        texts.push(box);
        // Cut by the frame's edge
        // Its visible part: a line half behind the open menu shows only below the menu
        // Half under an open menu (not in it): AUDIT r4/r5, a row half under the menu's edge
        if (overlays.some((ov) => !ov.contains(el) && hit(box, fromRect(ov.getBoundingClientRect())) && !contains(fromRect(ov.getBoundingClientRect()), box))) out.push(`text ${box.what} is half under the open menu`);
        // Within 2 px of the edge counts as cut: the letters' ink runs past the line box (Arabic)
        if (!contains(grow(frame, -2), { x: seenPart.l, y: seenPart.t, w: seenPart.r - seenPart.l, h: seenPart.b - seenPart.t })) out.push(`text ${box.what} at ${Math.round(box.x)},${Math.round(box.y)} ${Math.round(box.w)}x${Math.round(box.h)} is cut by the picture's edge (frame ${Math.round(frame.x)},${Math.round(frame.y)} ${Math.round(frame.w)}x${Math.round(frame.h)})`);
        // Half under a bar (not in it)
        // In a bar = inside the bar's strip, by geometry: the side rail is a DOM child of <header> but
        // lies outside its strip (r5: rail icons and labels were never checked)
        const bar = bars.find((br) => hit(box, br) && !contains(br, box) && !(br.el && br.el.contains(el) && hit(fromRect(el.getBoundingClientRect()), br)));
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
          // The line box for a scrolling list (it cuts at its edge); the letters' ink (box, already
          // measured by __help.ink) for a clipping box. Measuring the ink again here moved the box a
          // second time: the Arabic phone menu's address read as cut though it fits
          const over = Math.max(abox.y - b.top, b.bottom - (abox.y + abox.h));
          // (__help.ink pads the letters by 1 px each side, so 1.5 px here is the old 0.5 px allowance)
          const ink = box;
          const clips = scrolls ? over > 0 : ink.y < abox.y - 1.5 || ink.y + ink.h > abox.y + abox.h + 1.5;
          if (hit(box, abox) && !contains(abox, box) && cs.overflowY !== 'visible' && clips) { out.push(`text ${box.what} is cut by its list's edge (ink ${ink.y.toFixed(1)}+${ink.h.toFixed(1)}, line ${b.top.toFixed(1)}+${b.height.toFixed(1)}, box ${abox.y.toFixed(1)}+${abox.h.toFixed(1)}${scrolls ? ', scrolls' : ''})`); break; }
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
    const straddlesBar = (b: Box, list: Box[] = bars) => list.some((bar) => hit(b, bar) && !contains(bar, b));
    const barsHere = (el: Element) => (window as unknown as { __help: { barsFor: (e: Element, b: Box[]) => Box[] } }).__help.barsFor(el, bars);
    for (const v of nums) {
      if (!contains(frame, v)) out.push(`number ${v.what} is cut by the picture's edge`);
      // A number-only marker has no outline: its own control stands in for it
      const target = document.querySelector(`[data-help-target="${v.what}"]`);
      const own = ringOf(v.what) ?? (target ? fromRect(target.getBoundingClientRect()) : undefined);
      const tBars = target ? barsHere(target) : bars;
      const home = own && tBars.find((bar) => contains(bar, grow(own, 2)));
      if (tBars.some((bar) => hit(v, bar) && !contains(bar, v)) && !(home && tBars.every((bar) => bar === home || !hit(v, bar)))) out.push(`number ${v.what} sits on the header or tab bar's edge`);
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
      if (own && target && !document.querySelector(`[data-help-leader="${v.what}"]`)) {
        const tr = target.getBoundingClientRect();
        const row = texts.find((x) => !mine(x) && x.y < v.y + v.h - 1 && x.y + x.h > v.y + 1 && !(x.y < tr.bottom && x.y + x.h > tr.top)
          && Math.max(x.x - (v.x + v.w), v.x - (x.x + x.w)) < (document.querySelector('[data-help-place="above"]') || !(v.y < tr.bottom && v.y + v.h > tr.top) ? 24 : 72));
        if (row) out.push(`number ${v.what} sits on the line of ${row.what}, not its own row`);
      }
      const q = nums.find((x) => x !== v && hit(grow(v, CLEAR), x));
      if (q) out.push(`numbers ${v.what} and ${q.what} are within ${CLEAR} px`);
      const other = rings.find((o) => o.what !== v.what && band(o).some((b) => hit(v, b)));
      if (other) out.push(`number ${v.what} is on outline ${other.what}`);
      // ...nor on its own: the circle CLEAR px from the dashed line (AUDIT-2 re-audit 5)
      const mineRing = ringOf(v.what);
      const circle = grow(v, -2);
      const ownLines = mineRing ? [
        { x: mineRing.x, y: mineRing.y, w: mineRing.w, h: 2 }, { x: mineRing.x, y: mineRing.y + mineRing.h - 2, w: mineRing.w, h: 2 },
        { x: mineRing.x, y: mineRing.y, w: 2, h: mineRing.h }, { x: mineRing.x + mineRing.w - 2, y: mineRing.y, w: 2, h: mineRing.h },
      ] : [];
      if (ownLines.some((l) => hit(grow(circle, CLEAR - 0.5), l))) out.push(`number ${v.what} is within ${CLEAR} px of its own outline`);
      // ...halo to halo (AUDIT-2 re-audit 8: creating-upload's 1, its halo 1 px from the outline's)
      else if (mineRing && !document.querySelector(`[data-help-num="${v.what}"][data-help-bare]`) && band(mineRing).some((b) => hit(grow(v, CLEAR - 0.5), b))) out.push(`number ${v.what}'s halo is within ${CLEAR} px of its own outline's`);
    }
    // A leader line (a number with no room at its outline) keeps the same clear space as a number, up to
    // where it meets its outline
    const helpV = window as unknown as { __help: { cards: () => Element[]; radiusOf: (el: Element) => number; crossWhy: (boxes: Array<Box & { r: number }>, x1: number, y1: number, x2: number, y2: number, near: number) => string } };
    const edgeBoxesV = helpV.__help.cards().filter((el) => !el.closest('[data-help-target]')).map((el) => ({ ...fromRect(el.getBoundingClientRect()), r: helpV.__help.radiusOf(el) }));
    for (const el of document.querySelectorAll<HTMLElement>('[data-help-leader]')) {
      const [x1, y1] = (el.dataset.from ?? '').split(',').map(Number);
      const [x2, y2] = (el.dataset.to ?? '').split(',').map(Number);
      const len = Math.hypot(x2 - x1, y2 - y1);
      const what = el.dataset.helpLeader;
      // The segment into its outline: its last 24 px are the end stretch (AUDIT-2 ruling 2026-11-22)
      const end = 'endStretch' in el.dataset;
      const ring = ringOf(what ?? '');
      // A card's edge is crossed square on and where it is straight, never on its rounded corner
      // (AUDIT-2 re-audit 8: leader 1 crossed the video card's corner on a slant)
      const kx = end ? Math.max(0, len - EXEMPT_MAX) / len : 1;
      const cross = kx > 0 ? helpV.__help.crossWhy(edgeBoxesV, x1, y1, x1 + (x2 - x1) * kx, y1 + (y2 - y1) * kx, 3 + CLEAR - 0.5) : '';
      if (cross) { out.push(`number ${what}'s leader line runs ${cross}`); continue; }
      for (let t = 0; t <= len - (end ? 2 + CLEAR + 3 : 0); t += 1.5) {
        const g = grow({ x: x1 + ((x2 - x1) * t) / len - 3, y: y1 + ((y2 - y1) * t) / len - 3, w: 6, h: 6 }, CLEAR - 0.5);
        const tx = texts.find((x) => hit(g, x));
        const pc = pictures.find((x) => hit(g, x));
        const q = nums.find((x) => x.what !== what && hit(g, x));
        const other = rings.find((o) => o.what !== what && band(o).some((b) => hit(g, b)));
        // A card's edge, crossed straight across or 4 px away, never run beside (AUDIT-2 re-audit 7);
        // in the end stretch no nearer than its outline's own side, its halo 1 px off the card
        const px = x1 + ((x2 - x1) * t) / len;
        const py = y1 + ((y2 - y1) * t) / len;
        const fromEnd = end ? len - t : 1e9;
        const near = 3 + CLEAR - 0.5;
        let along = '';
        for (const cb of edgeBoxesV) {
          const sides: Array<{ e: number; p: number; mine: number[] }> = [];
          const rr = fromEnd > EXEMPT_MAX ? Math.min(cb.r, cb.w / 2, cb.h / 2) : 0;
          const inCorner = (v: number, lo: number, size: number) => rr >= 1 && (v < lo + rr || v > lo + size - rr);
          if (px > cb.x - near && px < cb.x + cb.w + near && !inCorner(px, cb.x, cb.w) && Math.abs(y2 - y1) / len < 0.7) sides.push({ e: cb.y, p: py, mine: ring ? [ring.y, ring.y + ring.h] : [] }, { e: cb.y + cb.h, p: py, mine: ring ? [ring.y, ring.y + ring.h] : [] });
          if (py > cb.y - near && py < cb.y + cb.h + near && !inCorner(py, cb.y, cb.h) && Math.abs(x2 - x1) / len < 0.7) sides.push({ e: cb.x, p: px, mine: ring ? [ring.x, ring.x + ring.w] : [] }, { e: cb.x + cb.w, p: px, mine: ring ? [ring.x, ring.x + ring.w] : [] });
          for (const sd of sides) {
            const d = Math.abs(sd.p - sd.e);
            if (d >= near) continue;
            const holds = !!ring && cb.x <= ring.x && cb.y <= ring.y && cb.x + cb.w >= ring.x + ring.w && cb.y + cb.h >= ring.y + ring.h;
            const own = sd.mine.length ? Math.min(...sd.mine.map((m) => Math.abs(m - sd.e))) : 0;
            if (fromEnd > EXEMPT_MAX || holds || own >= near) along = `the edge of a card at ${Math.round(sd.e)} (it runs beside it, ${(d - 3).toFixed(1)} px)`;
            else if (d < own - 0.5) along = `the edge of a card at ${Math.round(sd.e)} (end stretch further in than its outline)`;
            else if (hit(grow({ x: px - 3, y: py - 3, w: 6, h: 6 }, 0.5), cb)) along = `the edge of a card at ${Math.round(sd.e)} (end stretch halo touches it)`;
            if (along) break;
          }
          if (along) break;
        }
        if (!along && fromEnd > EXEMPT_MAX) {
          const aw = (helpV.__help as unknown as { arcWhy: (b: Box[], x: number, y: number, n: number) => string }).arcWhy(edgeBoxesV, px, py, near);
          if (aw) along = `the ${aw.replace(/^by the /, '')}`;
        }
        const why = tx ? tx.what : pc ? pc.what : q ? `number ${q.what}` : other ? `outline ${other.what}` : along;
        if (why) { out.push(`number ${what}'s leader line is within ${CLEAR} px of ${why}`); break; }
      }
    }
    for (const o of rings) {
      const outer = grow(o, 2);
      if (!contains(frame, outer)) out.push(`outline ${o.what} is cut by the picture's edge`);
      const oTarget = document.querySelector(`[data-help-target="${o.what}"]`);
      if (straddlesBar(outer, oTarget ? barsHere(oTarget) : bars)) out.push(`outline ${o.what} runs under the header or tab bar`);
      const oMenu = oTarget?.closest('[data-testid="nav-menu"]');
      if (oMenu && !contains(grow(fromRect(oMenu.getBoundingClientRect()), -1), outer)) out.push(`outline ${o.what} crosses its menu's edge`);
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
    const barTop = Math.max(0, ...bars.filter((br) => br.y + br.h < innerHeight / 2).map((br) => br.y + br.h));
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
      if (!vb || bars.some((br) => contains(grow(br, 0.5), { x: vb.l, y: vb.t, w: vb.r - vb.l, h: vb.b - vb.t }))) return;
      const b = cutBy(vb);
      // Its part beyond the picture's edge lies in the header strip (a menu's top row tucked 3 px under
      // the header): the bar hides it, not the crop
      const outside = b && (b.y < frame.y ? { t: b.y, b: frame.y } : b.y + b.h > frame.y + frame.h ? { t: frame.y + frame.h, b: b.y + b.h } : null);
      if (b && outside && b.x >= frame.x - 0.5 && b.x + b.w <= frame.x + frame.w + 0.5 && bars.some((br) => outside.t >= br.y - 0.5 && outside.b <= br.y + br.h + 0.5)) return;
      if (b) out.push(`${whatOf(el)} at ${Math.round(b.x)},${Math.round(b.y)} is cut by the picture's edge`);
    });
    const keyEls = [...document.querySelectorAll('[data-help-target]')];
    for (const el of [...help.cards(), ...help.overlays()]) {
      { const r0 = el.getBoundingClientRect(); if (bars.some((br) => contains(grow(br, 0.5), fromRect(r0)) || (el as Element).contains(br.el ?? null))) continue; }
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
      // A pinned layout column that runs from the header to the bottom of the screen (Studio's rail,
      // sticky under the header) is page chrome like the bars: the picture's edge may cross it
      const pos = getComputedStyle(el).position;
      if ((pos === 'sticky' || pos === 'fixed') && full.top <= barTop + 1 && full.bottom >= barBottom - 1) continue;
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
  // A line of text as its letters' ink, measured with its own font (canvas), not its line box: an
  // Arabic line box runs far above and below the letters («تتصرّف باسم» 26 px tall at 14 px), so
  // outlines that fit in English found no room in Arabic (AUDIT-2 2026-11-21: Amina's row outlined
  // in English, number-only in Arabic). 1 px of slack each way; never larger than the line box.
  const inkCtx = document.createElement('canvas').getContext('2d');
  const ink = (el, text, b) => {
    const cs = getComputedStyle(el);
    if (!inkCtx || !text) return b;
    inkCtx.font = cs.fontStyle + ' ' + cs.fontWeight + ' ' + cs.fontSize + ' ' + cs.fontFamily;
    inkCtx.direction = cs.direction === 'rtl' ? 'rtl' : 'ltr';
    const m = inkCtx.measureText(text);
    const fa = m.fontBoundingBoxAscent;
    const fd = m.fontBoundingBoxDescent;
    if (!(fa + fd > 0) || !(b.height > 0)) return b;
    const baseline = b.top + fa * (b.height / (fa + fd));
    const top = Math.max(b.top, baseline - m.actualBoundingBoxAscent - 1);
    const bottom = Math.min(b.bottom, baseline + m.actualBoundingBoxDescent + 1);
    return bottom - top > 1 ? new DOMRect(b.left, top, b.width, bottom - top) : b;
  };
  // The bars as seen from an element in the open menu: a bar the menu is drawn over ends at the
  // menu's top (the Arabic desktop account row starts 3 px inside the header's strip, under nothing:
  // the menu covers the header's line). Bars are { x, y, w, h } boxes
  const barsFor = (el, bars) => {
    const menu = el && el.closest('[data-testid="nav-menu"]');
    if (!menu) return bars;
    const mt = menu.getBoundingClientRect().top;
    const r = el.getBoundingClientRect();
    return bars.map((bar) => {
      if (!(bar.y < mt && bar.y + bar.h > mt)) return bar;
      const at = document.elementFromPoint(r.left + r.width / 2, Math.min(bar.y + bar.h, r.bottom) - 1);
      return at && menu.contains(at) ? Object.assign({}, bar, { h: mt - bar.y }) : bar;
    });
  };
  // A card's corner radius (the largest of its four): a line crosses its edge only where the edge is
  // straight, never on the rounded corner (AUDIT-2 re-audit 8: leader 1 crossed the video card's corner)
  const radiusOf = (el) => { const cs = getComputedStyle(el); return Math.max(0, ...['TopLeft', 'TopRight', 'BottomLeft', 'BottomRight'].map((k) => parseFloat(cs['border' + k + 'Radius']) || 0)); };
  // Why a straight segment may not cross the cards' edges ('' = fine). Boxes are { x, y, w, h, r }.
  // It crosses an edge square on (a slant across one reads as running along it), and where the edge is
  // straight: past the rounded corner by \`near\` px (the line's halo and clear space)
  const crossWhy = (boxes, x1, y1, x2, y2, near) => {
    const len = Math.hypot(x2 - x1, y2 - y1);
    if (len < 1) return '';
    for (const cb of boxes) {
      const rr = Math.min(cb.r || 0, cb.w / 2, cb.h / 2);
      // Within a corner's own span the edge is its curve (or the empty corner outside it): there the
      // distance to the curve decides (arcWhy); just past it, a crossing keeps \`near\` px from the curve
      for (const e of [cb.y, cb.y + cb.h]) {
        if ((y1 - e) * (y2 - e) >= 0) continue;
        const x = x1 + ((x2 - x1) * (e - y1)) / (y2 - y1);
        if (x <= cb.x + rr || x >= cb.x + cb.w - rr) continue;
        if (Math.abs(x2 - x1) / len > 0.02) return 'across a card edge at ' + Math.round(x) + ',' + Math.round(e) + ' on a slant';
        if (rr >= 1 && (x < cb.x + rr + near || x > cb.x + cb.w - rr - near)) return 'across the rounded corner of a card at ' + Math.round(x) + ',' + Math.round(e);
      }
      for (const e of [cb.x, cb.x + cb.w]) {
        if ((x1 - e) * (x2 - e) >= 0) continue;
        const y = y1 + ((y2 - y1) * (e - x1)) / (x2 - x1);
        if (y <= cb.y + rr || y >= cb.y + cb.h - rr) continue;
        if (Math.abs(y2 - y1) / len > 0.02) return 'across a card edge at ' + Math.round(e) + ',' + Math.round(y) + ' on a slant';
        if (rr >= 1 && (y < cb.y + rr + near || y > cb.y + cb.h - rr - near)) return 'across the rounded corner of a card at ' + Math.round(e) + ',' + Math.round(y);
      }
    }
    return '';
  };
  // Why a point of a line (its centre) is too near a card's rounded corner ('' = fine): inside the
  // corner's square, it keeps \`near\` px from the curve itself, as it does from a straight edge
  const arcWhy = (boxes, px, py, near) => {
    for (const cb of boxes) {
      const rr = Math.min(cb.r || 0, cb.w / 2, cb.h / 2);
      if (rr < 1) continue;
      for (const [ax, ay, sx, sy] of [[cb.x + rr, cb.y + rr, -1, -1], [cb.x + cb.w - rr, cb.y + rr, 1, -1], [cb.x + rr, cb.y + cb.h - rr, -1, 1], [cb.x + cb.w - rr, cb.y + cb.h - rr, 1, 1]]) {
        if ((px - ax) * sx < 0 || (py - ay) * sy < 0) continue;
        if (Math.abs(px - ax) > rr + near || Math.abs(py - ay) > rr + near) continue;
        const d = Math.abs(Math.hypot(px - ax, py - ay) - rr);
        // (a quarter pixel of slack: a step exactly 7 px from the curve read as 6.99 in Arabic)
        if (d < near - 0.25) return 'by the rounded corner of a card at ' + Math.round(ax + sx * rr) + ',' + Math.round(ay + sy * rr) + ' (' + (d - 3).toFixed(1) + ' px)';
      }
    }
    return '';
  };
  window.__help = { overlays, visible, cards, isCard, pictureSel, ink, barsFor, radiusOf, crossWhy, arcWhy };
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
 * a real-looking fixture address, amina@mail.alummahnow.net, AUDIT-2 2026-11-21; on the site's own mail domain, orchestrator 2026-11-21: a made-up personal domain could be someone's), kept up while the clip records: a MutationObserver rewrites any run
 * address or handle the moment it renders, before the next frame is painted
 */
const CLIP_SCRUB = `(() => {
  // Menu images load at once: the app icons are loading="lazy", so a menu that just mounted (it
  // remounts when you switch who you act as) drew them a frame late, empty slots in the clip (AUDIT-2
  // 2026-11-21: Website and Your profile)
  const eager = (root) => { if (root.querySelectorAll) root.querySelectorAll('img[loading="lazy"]').forEach((img) => { img.loading = 'eager'; img.decoding = 'sync'; }); };
  new MutationObserver((ms) => ms.forEach((m) => m.addedNodes.forEach((n) => { if (n.nodeType === 1) { if (n.tagName === 'IMG' && n.loading === 'lazy') { n.loading = 'eager'; n.decoding = 'sync'; } eager(n); } }))).observe(document, { childList: true, subtree: true });
  const fix = (root) => {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const t = node.textContent || '';
      if (/e2e\\.alummahnow\\.net|e2e\\+/.test(t)) node.textContent = t.replace(/e2e\\+[^@\\s]*/g, 'amina').replace(/@?e2e\\.alummahnow\\.net/g, '@mail.alummahnow.net');
      const u = node.textContent || '';
      if (/@\\s*E2E[\\w-]+/i.test(u)) node.textContent = u.replace(/@\\s*E2E[\\w-]+/gi, '@communitycorner');
    }
    if (root.querySelectorAll) root.querySelectorAll('input, textarea').forEach((el) => { if (/e2e\\+|e2e\\.alummahnow\\.net/.test(el.value)) el.value = 'amina@mail.alummahnow.net'; });
    // An avatar initial taken from the run address ('E' of e2e+…) belongs to the example address too:
    // 'A' (the account-switch clip showed 'E' beside the example address while the name loaded)
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
/**
 * Pictures whose rail was left out, by name without the language: the twin leaves it out too, so the
 * English and Arabic pictures show the same columns
 */
const railLeftOut = new Set<string>();

async function shoot(page: Page, file: string, region: Locator[] = [], opts: { keepHeader?: boolean; height?: number; railOut?: boolean } = {}): Promise<number> {
  const twinKey = file.replace(/\.(en|ar)\./, '.');
  // The run account's address (e2e+<run>…@e2e.alummahnow.net) reads as noise: show an example one
  await page.evaluate(() => {
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (node.textContent && /e2e\.alummahnow\.net|^e2e\+/.test(node.textContent)) {
        node.textContent = node.textContent.replace(/e2e\+[^@\s]*/g, 'amina').replace(/@?e2e\.alummahnow\.net/g, '@mail.alummahnow.net');
      }
      // Run-tagged handles (@E2Ehelp<run>…) read as noise too
      if (node.textContent && /@E2E[\w-]+/i.test(node.textContent)) node.textContent = node.textContent.replace(/@E2E[\w-]+/gi, '@communitycorner');
    }
    document.querySelectorAll<HTMLElement>('[title*="e2e.alummahnow.net"]').forEach((el) => { el.title = 'amina@mail.alummahnow.net'; });
    // A handle rendered as two text nodes ("@" + "E2Ehelp<run>…", e.g. <bdi>@{handle}</bdi>) slips past
    // the per-node pass: rewrite the smallest element whose whole text is a run handle
    document.querySelectorAll<HTMLElement>('body *').forEach((el) => {
      if (el.children.length === 0 && /^\s*E2E[\w-]+\s*$/i.test(el.textContent ?? '')) el.textContent = 'communitycorner';
      else if (el.childElementCount === 0 && /@\s*E2E[\w-]+/i.test(el.textContent ?? '')) el.textContent = (el.textContent ?? '').replace(/@\s*E2E[\w-]+/gi, '@communitycorner');
    });
    // Field values are not text nodes: the profile's (read-only) email field showed the run address
    document.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>('input, textarea').forEach((el) => {
      if (/e2e\+|e2e\.alummahnow\.net/.test(el.value)) el.value = 'amina@mail.alummahnow.net';
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
    clip = await page.evaluate(({ c, core, keepHeader, match, railOut }) => {
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
      /** Each word box's text and element, for the notes */
      const wordWhat = new Map<R, string>();
      /** Each picture or marker box's element, for the notes */
      const itemWhat = new Map<R, string>();
      /**
       * Text kept 3 px clear instead of 4, only where the font's own box is roomy (at least 1.2 times
       * the font size, so the letters' ink sits inside it). Used by one late tier, before an edge may
       * cut through anything: the Arabic rail's two-line labels sit 7 px apart, and 4 px each side left
       * no line below the home hero (appearance-rail ar, main 2026-11-22)
       */
      const looseWords: R[] = [];
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
        return b.width >= W * 0.6 && b.height > 20 && b.height < H * 0.3 && (b.top <= 1 || b.bottom >= H - 1 || !!el.closest("[data-pinned]"));
      });
      const barRects = barEls.map((be) => be.getBoundingClientRect());
      // Text no one sees never holds an edge back: in a closed <details>, screen-reader-only (1 px,
      // clipped) or invisible (AUDIT-2 2026-11-21: the phone comment crop started 5 px inside the card)
      const unseen = (el: Element) => {
        // Inside a closed <details> (not its summary): laid out, never shown (the watch page's collapsed
        // description, «A short walk through the…», was the line that held the Arabic phone crop back)
        if (el.closest('details:not([open])') && !el.closest('summary')) return true;
        if (typeof (el as Element & { checkVisibility?: (o?: object) => boolean }).checkVisibility === 'function'
          && !(el as Element & { checkVisibility: (o?: object) => boolean }).checkVisibility({ contentVisibilityAuto: true, opacityProperty: true, visibilityProperty: true })) return true;
        for (let e: Element | null = el; e && e !== document.body; e = e.parentElement) {
          const b = e.getBoundingClientRect();
          const cs = getComputedStyle(e);
          const tiny = (b.width <= 2 || b.height <= 2) && cs.display !== 'contents' && (cs.overflow !== 'visible' || cs.overflowX !== 'visible' || cs.overflowY !== 'visible');
          if (tiny || (cs.clip && cs.clip !== 'auto') || (cs.clipPath && /inset\(50%/.test(cs.clipPath)) || cs.visibility === 'hidden' || cs.opacity === '0') return true;
        }
        return false;
      };
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        const el = node.parentElement;
        if (!node.textContent?.trim() || !el || el.closest('[data-help-marker]') || unseen(el)) continue;
        const range = document.createRange();
        range.selectNodeContents(node);
        for (const b of range.getClientRects()) {
          if (b.width <= 0 || b.height <= 0) continue;
          const v = help.visible(el, { l: b.left, t: b.top, r: b.right, b: b.bottom });
          if (!v || !onScreen(v)) continue;
          // Half under an open menu (its other part shows): an edge never goes past it, so the picture
          // ends at the menu (AUDIT r4/r5: a row half under the menu's edge)
          if (help.overlays().some((ov) => { if (ov.contains(el)) return false; const o = ov.getBoundingClientRect(); return o.left < b.right && o.right > b.left && o.top < b.bottom && o.bottom > b.top; })) { avoid.push(v); continue; }
          // Under a bar or a fade (fixed/sticky): an edge never crosses it, nor goes past it
          let covered = 0;
          let seen = 0;
          let by = '';
          for (const y of [v.t + 2, (v.t + v.b) / 2, v.b - 2]) for (const x of [v.l + 2, (v.l + v.r) / 2, v.r - 2]) {
            if (x < 0 || y < 0 || x >= W || y >= H) continue;
            // Covered = the point is inside the header's or tab bar's own box and the line isn't part of
            // that bar (r5: the open menu's backdrop sits inside the header element, so walking up from
            // it made every line on the page 'under the header')
            const bar = barRects.find((br) => x >= br.left && x <= br.right && y >= br.top && y <= br.bottom);
            const cov = !!bar && !(v.t >= bar.top - 0.5 && v.b <= bar.bottom + 0.5);
            if (cov) by = by || 'a bar';
            if (cov) covered++; else seen++;
          }
          if (covered) { avoid.push(v); if (avoidWhat.length < 3) avoidWhat.push(`"${(node.textContent ?? '').trim().slice(0, 16)}" ${Math.round(v.t)}..${Math.round(v.b)} under ${by}`); }
          // Text keeps 4 px from an edge: the letters' ink runs past the line box (Arabic descenders)
          if (seen && !covered) {
            const g = { l: v.l - 4, t: v.t - 4, r: v.r + 4, b: v.b + 4 }; items.push(g); words.push(g); wordWhat.set(g, `"${(node.textContent ?? '').trim().slice(0, 24)}" <${el.tagName.toLowerCase()}.${(el.getAttribute('class') ?? '').split(' ').slice(0, 2).join('.')}>`);
            const p = b.height >= parseFloat(getComputedStyle(el).fontSize) * 1.2 ? 3 : 4;
            looseWords.push({ l: v.l - p, t: v.t - p, r: v.r + p, b: v.b + p });
          }
        }
      }
      document.querySelectorAll(`${help.pictureSel}, [data-help-marker]`).forEach((el) => {
        if (el.closest('svg') && el.tagName.toLowerCase() !== 'svg') return;
        const v = help.visible(el);
        if (!v || !onScreen(v)) return;
        // A number or outline with its 2 px white halo, and a pixel to spare: an edge on a card's line
        // went through number 2's halo (creating-upload ar)
        const it = el.hasAttribute('data-help-marker') ? { l: v.l - 3, t: v.t - 3, r: v.r + 3, b: v.b + 3 } : v;
        items.push(it);
        itemWhat.set(it, `<${el.tagName.toLowerCase()}.${(el.getAttribute('class') ?? '').split(' ').slice(0, 2).join('.')}>`);
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
        // A menu that hangs from the header keeps it: the picture shows where the menu opens from, and
        // the menu's top edge isn't cut at the picture's edge (AUDIT-2 2026-11-21)
        if (keepHeader && bar.t <= 1) continue;
        if (bar.t >= H - 1 - (bar.b - bar.t) && core.b > bar.t) core.b = Math.max(core.t + 1, bar.t);
        if (bar.b < H / 2 && core.t < bar.b) core.t = Math.min(core.b - 1, bar.b);
      }
      let l = c.x; let t = c.y; let r = c.x + c.width; let b = c.y + c.height;
      // A bar the core is in is taken whole, full width; a bar the core is not in is left out
      for (const bar of bars) {
        if (core.b > bar.t && core.t < bar.b) { t = Math.min(t, bar.t); b = Math.max(b, bar.b); l = 0; r = W; }
        else if (bar.t >= core.b) b = Math.min(b, bar.t);
        else if (bar.b <= core.t) t = Math.max(t, bar.b);
      }
      // A bar left out keeps 4 px clear of the picture's edge: its own line (the header's gold rule, drawn
      // just past its box) was row 0 of the picture (AUDIT-2 re-audit 8: creating-studio)
      const topLimit = Math.max(0, ...bars.filter((bar) => bar.b <= core.t && !(core.b > bar.t && core.t < bar.b)).map((bar) => Math.min(core.t, bar.b + 4)));
      const bottomLimit = Math.min(H, ...bars.filter((bar) => bar.t >= core.b && !(core.b > bar.t && core.t < bar.b)).map((bar) => Math.max(core.b, bar.t - 4)));
      t = Math.max(t, topLimit);
      b = Math.min(b, bottomLimit);
      // The side rail (a fixed column as tall as the window) is taken whole or left out with 4 px to
      // spare, never shown as a sliver at a side edge (AUDIT-2 re-audit 8: watching-actions)
      const rails = [...document.querySelectorAll<HTMLElement>('nav, aside')].map((el) => el.getBoundingClientRect())
        .filter((g) => g.height >= H * 0.8 && g.width >= 40 && g.width <= W * 0.2 && (g.left <= 1 || g.right >= W - 1));
      const offRail = (v: number) => rails.every((g) => (g.left <= 1 ? v <= 0 || v >= g.right + 4 : v >= W || v <= g.left - 4));
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
      // Sides: only a card narrower than the page counts (a page-wide container would push the edge out
      // to the rail)
      // A card's edge keeps 4 px from the picture's edge too, never a 1 px sliver of frame (AUDIT-2
      // 2026-11-21: the comment card's bottom 1 px from the frame's)
      const padded = cards.map((cd) => ({ l: cd.l - 6, t: cd.t - 6, r: cd.r + 6, b: cd.b + 6 }));
      const cardsCross = (axis: 'y' | 'x', at: number) => crosses(axis === 'y' ? padded : padded.filter((cd) => cd.r - cd.l < W * 0.6 + 12), axis, at);
      // No room for the 4 px: the card's own edge still beats cutting through it (creating-upload ar)
      const cardsCrossTight = (axis: 'y' | 'x', at: number) => crosses(axis === 'y' ? cards : cards.filter((cd) => cd.r - cd.l < W * 0.6), axis, at);
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
              // What sits just past the edge it took (why no cleaner line was found further out)
              const at = Math.round(found + 4 * outward);
              const blockers = [...cards, ...items].filter((it) => (axis === 'y' ? it.r > l && it.l < r && it.t < at && it.b > at : it.b > t && it.t < b && it.l < at && it.r > at)).slice(0, 3)
                .map((it) => `${Math.round(it.l)},${Math.round(it.t)} ${Math.round(it.r - it.l)}x${Math.round(it.b - it.t)}${wordWhat.has(it) ? ` ${wordWhat.get(it)}` : ''}`);
              // And the text crossing the line it wanted (what kept every cleaner line out)
              const wv = Math.round(want);
              const wantWords = words.filter((it) => (axis === 'y' ? it.r > l && it.l < r && it.t < wv && it.b > wv : it.b > t && it.t < b && it.l < wv && it.r > wv)).slice(0, 3)
                .map((it) => `${Math.round(it.l)},${Math.round(it.t)} ${Math.round(it.r - it.l)}x${Math.round(it.b - it.t)} ${wordWhat.get(it) ?? ''}`);
              notes.push(`${edge} edge fell back to tier ${k + 1} at ${found} (range ${Math.round(min)}..${Math.round(max)}; at ${at}: ${blockers.join(' | ')}; text at ${wv}: ${wantWords.join(' | ') || 'none'})`);
            }
            return found;
          }
        }
        notes.push(`${edge} edge found no line in ${Math.round(min)}..${Math.round(max)}`);
        return want;
      };
      // A link's or button's content is whole: the late tier never splits an icon from its label. Its
      // content, not its box: a rail link's empty padding under its label may be crossed (appearance-rail
      // ar: the Liked link's box ran 9 px past its label, onto the only clean line below the hero)
      const controls: R[] = [];
      for (const el of document.querySelectorAll('a[href], button')) {
        const box = help.visible(el);
        if (!box || !onScreen(box) || box.b - box.t >= 120 || bars.some((bar) => box.t >= bar.t - 0.5 && box.b <= bar.b + 0.5)) continue;
        const parts: R[] = [...el.querySelectorAll('svg, img')].map((p) => help.visible(p)).filter((v): v is R => !!v);
        const tw = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
        for (let n = tw.nextNode(); n; n = tw.nextNode()) {
          if (!n.textContent?.trim() || !n.parentElement || unseen(n.parentElement)) continue;
          const rg = document.createRange(); rg.selectNodeContents(n);
          for (const r of rg.getClientRects()) if (r.width > 0 && r.height > 0) parts.push({ l: r.left, t: r.top, r: r.right, b: r.bottom });
        }
        if (parts.length < 2) continue;
        controls.push(parts.reduce((a, q) => ({ l: Math.max(box.l, Math.min(a.l, q.l)), t: Math.max(box.t, Math.min(a.t, q.t)), r: Math.min(box.r, Math.max(a.r, q.r)), b: Math.min(box.b, Math.max(a.b, q.b)) })));
      }
      const wordSet = new Set(words);
      const nonWords = items.filter((it) => !wordSet.has(it));
      const tiersFor = (axis: 'y' | 'x', between0: (v: number) => boolean) => {
        const between = axis === 'x' ? (v: number) => offRail(v) && between0(v) : between0;
        return [
          (v: number) => !crosses(items, axis, v) && !cardsCross(axis, v) && between(v),
          (v: number) => !crosses(items, axis, v) && !cardsCrossTight(axis, v) && between(v),
          (v: number) => !crosses(items, axis, v) && between(v),
          (v: number) => !crosses(nonWords, axis, v) && !crosses(looseWords, axis, v) && !crosses(controls, axis, v) && !cardsCrossTight(axis, v) && between(v),
          (v: number) => !crosses(words, axis, v) && between(v),
        ];
      };
      const has = Number.isFinite(must.t);
      const mustT = has ? must.t : core.t;
      const mustB = has ? must.b : core.b;
      const mustL = has ? must.l : core.l;
      const mustR = has ? must.r : core.r;
      const start = { l, t, r, b };
      const passes = () => {
        for (let pass = 0; pass < 2; pass++) {
          const last = pass === 1;
          t = pick(Math.max(topLimit, Math.min(t, core.t)), topLimit, mustT, -1, tiersFor('y', (y) => !avoidIn(y, mustT, 'y')), last ? 'top' : '');
          b = pick(Math.min(bottomLimit, Math.max(b, core.b)), mustB, bottomLimit, 1, tiersFor('y', (y) => !avoidIn(mustB, y, 'y')), last ? 'bottom' : '');
          if (l > 0 || r < W) {
            l = pick(Math.max(0, Math.min(l, core.l)), 0, mustL, -1, tiersFor('x', (x) => !avoidIn(x, mustL, 'x')), last ? 'left' : '', true);
            r = pick(Math.min(W, Math.max(r, core.r)), mustR, W, 1, tiersFor('x', (x) => !avoidIn(mustR, x, 'x')), last ? 'right' : '', true);
          }
        }
      };
      passes();
      // The top or bottom edge found no line short of the last tiers (it would cut a rail item's icon
      // from its label: creating-upload en, the Community guidelines book cut in half), and no bar holds
      // the picture full width: the side rail, a layout column with no number in it, is left out and the
      // edges searched again, the picture then being of the page's own column
      const lastTier = (n: string) => /^(top|bottom) edge (fell back to tier [4-9]|found no line)/.test(n);
      const barTaken = bars.some((bar) => core.b > bar.t && core.t < bar.b);
      let leftOut = false;
      if ((railOut || notes.some(lastTier)) && !barTaken && start.l <= 1 && start.r >= W - 1) {
        const marked = [...document.querySelectorAll('[data-help-marker], [data-help-target]')].map((m) => m.getBoundingClientRect());
        const rail = [...document.querySelectorAll<HTMLElement>('nav, aside')].map((el) => el.getBoundingClientRect())
          .filter((g) => g.height >= H * 0.8 && g.width >= 40 && g.width <= W * 0.2 && (g.left <= 1 || g.right >= W - 1))
          .filter((g) => !marked.some((m) => m.right > g.left && m.left < g.right))
          .sort((p, q) => q.width - p.width)[0];
        if (rail) {
          const was = notes.filter(lastTier).join('; ');
          notes.length = 0;
          ({ l, t, r, b } = start);
          if (rail.left <= 1) { l = Math.ceil(rail.right); core.l = Math.max(core.l, l); } else { r = Math.floor(rail.left); core.r = Math.min(core.r, r); }
          passes();
          leftOut = true;
          notes.push(`the rail (${Math.round(rail.left)}..${Math.round(rail.right)}) left out, ${railOut && !was ? 'as in its twin' : `as with it ${was}`}`);
        }
      }
      // An edge a few px inside a card's border shows a sliver of its frame and rounded corners: it
      // moves just outside the card (AUDIT-2 2026-11-21: the Arabic phone comments card cut 5 px in)
      const nearCard = (v: number, edge: 'top' | 'bottom') => cards.find((cd) => cd.r > l && cd.l < r && (edge === 'top'
        ? cd.t < v && v - cd.t <= 16 && cd.t - 6 >= topLimit && cd.t - 6 <= mustT
        : cd.b > v && cd.b - v <= 16 && cd.b + 6 <= bottomLimit && cd.b + 6 >= mustB));
      const cleanAt = (v: number) => !crosses(items, 'y', v) && !crosses(words, 'y', v);
      { const cd = nearCard(t, 'top'); if (cd && cleanAt(cd.t - 6)) t = cd.t - 6; }
      { const cd = nearCard(b, 'bottom'); if (cd && cleanAt(cd.b + 6)) b = cd.b + 6; }
      // Whole pixels, so the English and Arabic twins compare exactly; the sides too (a fractional width
      // left a 1 px pure-black column at the picture's end: AUDIT-2 re-audit 8, watching-actions)
      t = Math.round(t); b = Math.round(b);
      l = Math.max(0, Math.ceil(l - 0.01)); r = Math.min(W, Math.floor(r + 0.01));
      // The other language's height: its twin is framed the same (AUDIT-2 2026-11-21: 378 vs 370 tall).
      // The pair of clean lines exactly that far apart nearest this crop's top
      if (match && b - t !== match) {
        let best: number | null = null;
        for (let nt = Math.ceil(topLimit); nt <= mustT; nt++) {
          const nb = nt + match;
          if (nb < mustB || nb > bottomLimit) continue;
          if (crosses(items, 'y', nt) || crosses(items, 'y', nb) || cardsCross('y', nt) || cardsCross('y', nb) || avoidIn(nt, mustT, 'y') || avoidIn(mustB, nb, 'y')) continue;
          if (best === null || Math.abs(nt - t) < Math.abs(best - t)) best = nt;
        }
        // No pair clean by the strict rules: the late tier's (roomy text 3 px clear, link content whole)
        if (best === null) {
          const loose = (v: number) => !crosses(nonWords, 'y', v) && !crosses(looseWords, 'y', v) && !crosses(controls, 'y', v) && !cardsCrossTight('y', v);
          for (let nt = Math.ceil(topLimit); nt <= mustT; nt++) {
            const nb = nt + match;
            if (nb < mustB || nb > bottomLimit) continue;
            if (!loose(nt) || !loose(nb) || avoidIn(nt, mustT, 'y') || avoidIn(mustB, nb, 'y')) continue;
            if (best === null || Math.abs(nt - t) < Math.abs(best - t)) best = nt;
          }
          if (best !== null) notes.push(`height ${match} matched by the late tier at ${best}..${best + match}`);
        }
        if (best !== null) { t = best; b = best + match; } else {
          // What crosses the line the twin ends on (why no pair that far apart was clean)
          const at = Math.round(t + match);
          const what = [...items, ...padded].filter((it) => it.r > l && it.l < r && it.t < at && it.b > at).slice(0, 6)
            .map((it) => `${Math.round(it.l)},${Math.round(it.t)} ${Math.round(it.r - it.l)}x${Math.round(it.b - it.t)}${wordWhat.has(it) ? ` ${wordWhat.get(it)}` : itemWhat.get(it) ? ` ${itemWhat.get(it)}` : padded.includes(it) ? ' card' : ''}`);
          notes.push(`height ${b - t} could not match ${match} (at ${at}: ${what.join(' | ') || 'nothing'})`);
          // The side columns (the rail) near that line: their boxes, top to bottom, so a crowded column
          // shows where its gaps are
          const side = [...items, ...controls].filter((it) => (it.r < W * 0.2 || it.l > W * 0.8) && it.b > at - 60 && it.t < at + 90).sort((p, q) => p.t - q.t)
            .slice(0, 14).map((it) => `${Math.round(it.t)}..${Math.round(it.b)}${wordWhat.has(it) ? ' text' : controls.includes(it) ? ' control' : ` ${itemWhat.get(it) ?? ''}`}`);
          if (side.length) notes.push(`side column near ${at}: ${side.join(', ')}`);
        }
      }
      if (notes.length) notes.push(`covered: ${avoidWhat.join(', ')}`);
      return { x: l, y: t, width: r - l, height: b - t, notes, avoid: avoid.length, leftOut };
    }, { c: clip, core, keepHeader: !!opts.keepHeader, match: opts.height ?? 0, railOut: !!opts.railOut || railLeftOut.has(twinKey) });
    if (clip && 'notes' in clip) {
      const { notes: cropNotes, avoid: avoidN, leftOut, ...box } = clip as typeof clip & { notes: string[]; avoid: number; leftOut: boolean };
      if (leftOut) railLeftOut.add(twinKey);
      if (cropNotes.length) console.log(`help crop ${file}: ${cropNotes.join('; ')} (avoid ${avoidN})`);
      clip = box;
    }
  }
  await verifyFrame(page, clip, file);
  const png = join(OUT, `${file}.png`);
  await page.screenshot({ path: png, clip, animations: 'disabled' });
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', png, '-c:v', 'libwebp', '-quality', '82', '-compression_level', '6', join(OUT, `${file}.webp`)]);
  rmSync(png);
  return Math.round(clip?.height ?? viewport.height);
}

interface Scene {
  id: string;
  signedIn?: boolean;
  /** Where the numbers go (see mark) */
  markers?: 'side' | 'above';
  /** The header stays in the picture (a menu that opens from it) */
  keepHeader?: boolean;
  /**
   * The side rail left out: a picture as tall as the window would end on the rail's scroll chevron,
   * 3 px from the edge, its list running on past it (AUDIT-2 re-audit 8: creating-studio)
   */
  railOut?: boolean;
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
      await pinWatchMeta(page, lang);
      // Where the player's picture comes from (AUDIT-2 re-audit 8, item 12: gold corners on it)
      console.log(`help scene watching-actions.${lang}: player ${await page.evaluate(() => {
        const box = document.querySelector('#video-player') ?? document.querySelector('.video-js');
        if (!box) return 'none';
        const imgs = [...box.querySelectorAll('img, video, .vjs-poster, picture source')].map((el) => {
          const cs = getComputedStyle(el);
          const r = el.getBoundingClientRect();
          return `<${el.tagName.toLowerCase()}.${(el.getAttribute('class') ?? '').split(' ')[0]}> ${Math.round(r.width)}x${Math.round(r.height)} src=${(el as HTMLImageElement).currentSrc || (el as HTMLImageElement).src || el.getAttribute('poster') || ''} bg=${cs.backgroundImage.slice(0, 120)} fit=${cs.objectFit}`;
        });
        return imgs.join(' | ');
      })}`);
      console.log(`help scene watching-actions.${lang}: poster pixels ${await page.evaluate(async () => {
        const img = [...document.querySelectorAll<HTMLImageElement>('#video-player img, .video-js img')].find((i) => /thumbnail/.test(i.currentSrc || i.src));
        if (!img) return 'no poster img';
        try {
          const bmp = await createImageBitmap(await (await fetch(img.currentSrc || img.src)).blob());
          const cv = document.createElement('canvas');
          cv.width = bmp.width; cv.height = bmp.height;
          const cx = cv.getContext('2d')!;
          cx.drawImage(bmp, 0, 0);
          const mean = (x: number, y: number) => { const d = cx.getImageData(x, y, 24, 24).data; let r = 0, g = 0, b = 0; for (let k = 0; k < d.length; k += 4) { r += d[k]; g += d[k + 1]; b += d[k + 2]; } const n = d.length / 4; return `${Math.round(r / n)},${Math.round(g / n)},${Math.round(b / n)}`; };
          const v = document.querySelector<HTMLVideoElement>('#video-player video, .video-js video');
          let vInfo = 'no video';
          if (v) {
            vInfo = `video ${v.videoWidth}x${v.videoHeight} t ${v.currentTime.toFixed(2)} ready ${v.readyState}`;
            try {
              const c2 = document.createElement('canvas'); c2.width = v.videoWidth || 1; c2.height = v.videoHeight || 1;
              const x2 = c2.getContext('2d')!; x2.drawImage(v, 0, 0);
              const d = x2.getImageData(0, 0, 16, 16).data; let r = 0, g = 0, b = 0; for (let k = 0; k < d.length; k += 4) { r += d[k]; g += d[k + 1]; b += d[k + 2]; }
              vInfo += ` frame tl ${Math.round(r / 256)},${Math.round(g / 256)},${Math.round(b / 256)}`;
            } catch (e) { vInfo += ` frame ${(e as Error).message}`; }
          }
          const pr = (document.querySelector('#video-player') ?? img).getBoundingClientRect();
          const stack = document.elementsFromPoint(pr.left + 8, pr.top + 8).slice(0, 6).map((el) => {
            const cs = getComputedStyle(el); const b4 = getComputedStyle(el, '::before'); const af = getComputedStyle(el, '::after');
            return `<${el.tagName.toLowerCase()}.${(el.getAttribute('class') ?? '').split(' ').slice(0, 2).join('.')}#${el.id}> z${cs.zIndex} op${cs.opacity} r${cs.borderTopLeftRadius} bg ${cs.backgroundColor} ${cs.backgroundImage.slice(0, 80)} before ${b4.content !== 'none' ? b4.backgroundImage.slice(0, 60) + ' ' + b4.backgroundColor : '-'} after ${af.content !== 'none' ? af.backgroundImage.slice(0, 60) + ' ' + af.backgroundColor : '-'}`;
          }).join(' / ');
          return `${bmp.width}x${bmp.height} natural ${img.naturalWidth}x${img.naturalHeight} tl ${mean(0, 0)} tr ${mean(bmp.width - 24, 0)} opacity ${getComputedStyle(img).opacity} display ${getComputedStyle(img.parentElement!).display}; ${vInfo}; at top-left: ${stack}`;
        } catch (e) { return `error ${(e as Error).message}`; }
      })}`);
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
    // The header stays in: the menu hangs from it, and without it the crop started at the menu's top
    // border (AUDIT-2 2026-11-21)
    keepHeader: true,
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
    keepHeader: true,
    run: async (page, lang) => {
      // Over the library page, like identity-menu: plain rows behind the menu (audit r4/r5: the
      // channel header, share button and tab strip were cut under it), with blank page under its foot
      await settle(page, '/library', lang);
      const menu = await openMenuOverBlank(page, 'channels');
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
      // The heading row 48 px under the header in every language: the whole form shows above a
      // phone's tab bar, and the English and Arabic twins frame alike (AUDIT-2 2026-11-21: the form ran
      // off the bottom; the card's top at 45 in English, 85 in Arabic)
      const headTop = await page.getByTestId('comments-count').first().evaluate((el) => el.getBoundingClientRect().top + window.scrollY);
      const headerH = (await header(page).boundingBox())?.height ?? 0;
      await page.evaluate((y) => window.scrollTo({ top: y, behavior: 'instant' }), Math.max(0, headTop - headerH - 48));
      // A phone pins the player under the header once it scrolls (lib/video/mini-player.ts): the heading
      // goes 48 px under the player instead (AUDIT-2 2026-11-21: the English phone crop cut the player).
      // Room below the page first: the Arabic phone page ended too soon to scroll that far, so the watch
      // line stayed in view right above the card and the crop began inside the card
      await page.waitForTimeout(300);
      const pinnedBottom = await page.evaluate(() => {
        const p = document.querySelector('[data-pinned] .video-js') ?? document.querySelector('[data-pinned]');
        return p ? p.getBoundingClientRect().bottom : 0;
      });
      if (pinnedBottom > headerH) {
        await page.evaluate(() => { document.body.style.paddingBottom = `${window.innerHeight}px`; });
        await page.evaluate((y) => window.scrollTo({ top: y, behavior: 'instant' }), Math.max(0, headTop - pinnedBottom - 48));
        await page.waitForTimeout(300);
        const off = await page.getByTestId('comments-count').first().evaluate((el, want) => Math.round(el.getBoundingClientRect().top - want), pinnedBottom + 48);
        if (Math.abs(off) > 2) console.log(`help scene identity-comment.${lang}: heading ${off} px from its place under the pinned player`);
      }
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
    railOut: true,
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
      // The two cards, never their headings alone; the picture is those cards (the whole window put the
      // Arabic rail's icon right in the gap under them, r5)
      return [[exportCard, deleteCard], [exportCard, deleteCard]];
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

// Runs before the pictures: the appearance picture marks the notifications read, and the clip's bell
// then lost the badge its stills show (AUDIT-2 2026-11-21)
test('clip identity-switch', async ({ browser }) => {
  test.setTimeout(8 * 60_000);
  for (const lang of LANGS) for (const mode of MODES) {
    // One switch, as Help's caption says: from the channel to yourself, the picture by the comment
    // box changing with it. Same steps in every clip, a settled end, the way back off camera
    // (AUDIT-2 2026-11-21: a setup switch recorded first, the four clips different)
    await clip(browser, 'identity-switch', lang, mode, async (page) => {
      await settle(page, `/video/${videoId}`, lang);
      await expect(page.getByTestId('comment-identity').first()).toHaveAttribute('data-as', 'channel', { timeout: 30_000 });
      // Off camera, the menu once, both views, until every picture in it has loaded (AUDIT-2: empty
      // icon slots, a bare avatar disc)
      let menuBottom = 0;
      for (const view of ['main', 'channels'] as const) {
        const warm = await openMenu(page, view);
        await expect.poll(() => warm.evaluate((m) => [...m.querySelectorAll('img')].every((i) => i.complete && i.naturalWidth > 0)), { timeout: 20_000 }).toBe(true);
        // Fixed under the header: where it ends sets how much of the window the clip needs
        menuBottom = Math.max(menuBottom, await warm.evaluate((m) => m.getBoundingClientRect().bottom));
        // Every picture decoded and held: the menu redraws its rows on the switch, and a picture let go
        // showed its plain disc for a frame (AUDIT-2 re-audit 4: Weekend Sessions at 1.04 s)
        await warm.evaluate(async (m) => {
          const w = window as unknown as { __helpKeep?: HTMLImageElement[] };
          w.__helpKeep = w.__helpKeep ?? [];
          await Promise.all([...m.querySelectorAll('img')].map(async (i) => {
            const im = new Image();
            im.src = i.currentSrc || i.src;
            w.__helpKeep!.push(im);
            await im.decode().catch(() => undefined);
          }));
        });
      }
      await closeMenu(page);
      // The comment box in view under the header, where the menu opens
      await page.getByTestId('comment-identity').first().evaluate((el) => el.scrollIntoView({ block: 'center', behavior: 'instant' }));
      // No sliver of a card left under the header (the Related card's last row showed there once the
      // menu closed, AUDIT-2 2026-11-21): any card the header cuts goes fully under it, with a row to
      // spare (the list re-renders after the switch and grew back out from under the header)
      await page.evaluate(() => {
        const head = document.querySelector('header.ah');
        const hb = head ? head.getBoundingClientRect().bottom : 0;
        let push = 0;
        for (const el of document.querySelectorAll('.related-videos, [data-testid="related-videos"]')) {
          const r = el.getBoundingClientRect();
          if (r.height && r.top < hb && r.bottom > hb) push = Math.max(push, r.bottom - hb + 4 + 160);
        }
        // Nor a cut row of the video card above (its channel line showed half under the header once the
        // Related card was cleared): the Comments card starts just under the header, everything above it
        // goes fully under
        if (push) {
          const comments = document.querySelector('[data-testid="comments-section"]');
          if (comments) push = Math.max(push, comments.getBoundingClientRect().top - hb - 32);
        }
        // The page ends right there in the clip's tall window: room below first, or the scroll does nothing.
        // A spacer, not body padding: the menu's scroll lock rewrites body's style when it opens, the page
        // shrank back and the browser pulled the scroll with it
        if (push) {
          const spacer = document.createElement('div');
          spacer.setAttribute('aria-hidden', 'true');
          spacer.style.height = `${window.innerHeight}px`;
          document.body.append(spacer);
          window.scrollBy({ top: push, behavior: 'instant' });
        }
        return push;
      }).then((push) => console.log(`help clip identity-switch.${lang}: ${push ? `scrolled ${Math.round(push)} px past a card under the header` : 'no card under the header'}`));
      // The comments card's bottom near the menu's: the page comes back down as far as that allows with
      // the header's line in a gap (no row cut under it), so the clip has no bare band under the card
      // (AUDIT-2 re-audit 4: about 27% of the frame)
      await page.evaluate((menuB) => {
        const head = document.querySelector('header.ah');
        const hb = head ? head.getBoundingClientRect().bottom : 0;
        const section = document.querySelector('[data-testid="comments-section"]');
        let card: Element | null = section;
        for (let e = section?.parentElement; e && e !== document.body; e = e.parentElement) {
          const cs = getComputedStyle(e);
          if (parseFloat(cs.borderTopWidth) >= 1 || cs.boxShadow !== 'none' || cs.backgroundColor !== 'rgba(0, 0, 0, 0)') { card = e; break; }
        }
        if (!card) return 0;
        const want = Math.floor(menuB - card.getBoundingClientRect().bottom);
        if (want <= 0) return 0;
        const fixed = (el: Element) => { for (let e: Element | null = el; e; e = e.parentElement) { const p = getComputedStyle(e).position; if (p === 'fixed' || p === 'sticky') return true; } return false; };
        const boxes: Array<[number, number]> = [];
        const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
        for (let n = walker.nextNode(); n; n = walker.nextNode()) {
          if (!n.textContent?.trim() || !n.parentElement || fixed(n.parentElement) || !n.parentElement.checkVisibility?.({ opacityProperty: true, visibilityProperty: true })) continue;
          if (n.parentElement.closest('details:not([open])') && !n.parentElement.closest('summary')) continue;
          const r = document.createRange();
          r.selectNodeContents(n);
          for (const b of r.getClientRects()) if (b.width > 0 && b.height > 0) boxes.push([b.top - 4, b.bottom + 4]);
        }
        document.querySelectorAll('img, svg, button, a, input, textarea, video').forEach((el) => {
          if ((el.closest('svg') && el.tagName.toLowerCase() !== 'svg') || fixed(el)) return;
          const b = el.getBoundingClientRect();
          if (b.width > 0 && b.height > 0) boxes.push([b.top - 4, b.bottom + 4]);
        });
        // Cards too: none ends in a sliver just under the header
        document.querySelectorAll('section, article, [class*="rounded"]').forEach((el) => {
          if (fixed(el)) return;
          const b = el.getBoundingClientRect();
          if (b.height > 40 && b.width > 200) boxes.push([b.bottom - 24, b.bottom + 4]);
        });
        for (let d = want; d >= 0; d--) {
          if (!boxes.some(([t, b]) => t + d < hb && b + d > hb)) { window.scrollBy({ top: -d, behavior: 'instant' }); return d; }
        }
        return 0;
      }, menuBottom).then((d) => console.log(`help clip identity-switch.${lang}: back down ${d} px toward the menu's bottom`));
      await parkPointer(page);
      // The clip ends below the menu and the comments, on a line that cuts nothing (AUDIT-2 2026-11-21:
      // half the frame was bare page, and the rail's scroll chevron sat on a cut item at the bottom)
      const cleanLines = await page.evaluate((menuB) => {
        const H = innerHeight;
        const card = document.querySelector('[data-testid="comments-section"]');
        let cardB = card ? card.getBoundingClientRect().bottom : 0;
        // The comments' card is the section's nearest ancestor that draws a frame
        for (let e = card?.parentElement; e && e !== document.body; e = e.parentElement) {
          const cs = getComputedStyle(e);
          if (parseFloat(cs.borderTopWidth) >= 1 || cs.boxShadow !== 'none' || cs.backgroundColor !== 'rgba(0, 0, 0, 0)') { cardB = e.getBoundingClientRect().bottom; break; }
        }
        const from = Math.ceil(Math.max(menuB, cardB) + 16);
        // Everything a line must not cut, 4 px clear: text lines, pictures, controls
        const boxes: Array<[number, number]> = [];
        const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
        for (let n = walker.nextNode(); n; n = walker.nextNode()) {
          if (!n.textContent?.trim() || !n.parentElement || !n.parentElement.checkVisibility?.({ opacityProperty: true, visibilityProperty: true })) continue;
          const r = document.createRange();
          r.selectNodeContents(n);
          for (const b of r.getClientRects()) if (b.width > 0 && b.height > 0 && b.bottom > 0 && b.top < H) boxes.push([b.top - 4, b.bottom + 4]);
        }
        // Icons and fields, not whole links or buttons: the rail's tiles touch, their icons and labels
        // leave gaps. Decoration (aria-hidden, the lantern street) never holds the line
        document.querySelectorAll('img, svg, input, textarea, [role="img"]').forEach((el) => {
          if (el.closest('svg') && el.tagName.toLowerCase() !== 'svg') return;
          if (el.closest('[aria-hidden="true"]') && !el.closest('a, button')) return;
          if (!(el as HTMLElement).checkVisibility?.({ opacityProperty: true, visibilityProperty: true })) return;
          const b = el.getBoundingClientRect();
          if (b.width > 0 && b.height > 0 && b.height < H / 2 && b.bottom > 0 && b.top < H) boxes.push([b.top - 4, b.bottom + 4]);
        });
        // The rail's scroll chevron sits at its bottom: the line is above it
        const clean: number[] = [];
        for (let y = from; y <= H; y++) if (!boxes.some(([t, b]) => t < y && b > y)) clean.push(y);
        return clean;
      }, menuBottom);
      console.log(`help clip identity-switch.${lang}: first clean line ${cleanLines[0] ?? 'none'} (menu ends at ${Math.round(menuBottom)})`);
      return { cleanLines };
    }, async (page, poster) => {
      // The same opening in every clip: the page with the menu closed for a moment, then the menu
      // opening (AUDIT-2 re-audit 8: English opened closed for 2 frames, Arabic already open)
      await parkPointer(page);
      await page.waitForTimeout(600);
      const menu = await openMenu(page, 'main', true);
      // The pointer off the menu before anything in it changes, and the menu's own steps clicked where
      // they are, without moving it: a row the view swaps in under the pointer showed as hovered for a
      // few frames with no pointer in sight (AUDIT-2 re-audit 8: Weekend Sessions beside the tick)
      await parkPointer(page);
      await page.waitForTimeout(900);
      await menu.getByTestId('nav-switch-channel').dispatchEvent('click');
      await expect(menu.getByTestId('nav-channel-option-none')).toBeVisible();
      await page.waitForTimeout(900);
      // The clip's still: the picker, about to switch (AUDIT-2)
      await poster();
      await menu.getByTestId('nav-channel-option-none').dispatchEvent('click');
      await expect(page.getByTestId('comment-identity').first()).toHaveAttribute('data-as', 'member', { timeout: 30_000 });
      await expect(page.getByTestId('nav-menu-trigger')).not.toHaveAttribute('aria-busy', 'true');
      await page.waitForTimeout(2000);
    }, 12, CLIP_HEIGHT);
    // Back to the channel off camera, so every other picture shows it active
    const { context, page } = await open(browser, lang, 'desktop', mode);
    try {
      await settle(page, `/video/${videoId}`, lang);
      const menu = await openMenu(page, 'channels');
      await menu.locator(`[data-testid="nav-channel-option"][data-channel-id="${channelId}"]`).click();
      await expect(page.getByTestId('comment-identity').first()).toHaveAttribute('data-as', 'channel', { timeout: 30_000 });
    } catch (error) {
      problems.push(`clip identity-switch.${lang}.${mode}: switching back to the channel: ${(error as Error).message.split('\n')[0]}`);
    } finally {
      await context.close();
    }
  }
  finishDeferred('identity-switch');
});

for (const scene of SCENES) {
  test(`picture ${scene.id}`, async ({ browser }) => {
    test.setTimeout(12 * 60_000);
    const take = async (lang: Lang, device: Device, mode: Mode, height?: number, retake = false): Promise<number | undefined> => {
      const name = `${scene.id}.${lang}.${device}.${mode}`;
      const { context, page } = await open(browser, lang, device, mode, { signedIn: scene.signedIn });
      try {
        const [markers, region] = await scene.run(page, lang, device);
        // Each picture's numbers match the numbered list Help shows under it
        const listed = listedMarkers(lang === 'ar' ? HELP_AR : HELP_EN, scene.id);
        if (listed.some((n) => n !== markers.length)) throw new Error(`${markers.length} markers, but Help lists ${listed.join('/')} under this picture`);
        await mark(page, lang, markers, (msg) => { if (!retake) notes.push(`${name}: ${msg}`); }, scene.markers);
        return await shoot(page, name, region, { keepHeader: scene.keepHeader, height, railOut: scene.railOut });
      } catch (error) {
        problems.push(`${name}: ${(error as Error).message.split('\n').slice(0, 4).join(' ')}`);
        await page.screenshot({ path: test.info().outputPath(`${name}.failed.png`), fullPage: false }).catch(() => undefined);
        return undefined;
      } finally {
        await context.close();
      }
    };
    // English and Arabic framed alike: Arabic takes English's height; when it can't, English is
    // retaken at Arabic's (AUDIT-2 2026-11-21: twins 378 and 370 tall, 562 and 602)
    for (const device of DEVICES) for (const mode of MODES) {
      const first = await take(LANGS[0], device, mode);
      const second = await take(LANGS[1], device, mode, first);
      if (first !== undefined && second !== undefined && second !== first) {
        const again = await take(LANGS[0], device, mode, second, true);
        if (again !== second) notes.push(`${scene.id}.${device}.${mode}: en ${again} and ar ${second} tall`);
      }
    }
  });
}

/** What a clip does on camera; `poster` retakes the clip's still at that moment (else it is the first frame) */
type ClipAct = (page: Page, poster: () => Promise<void>) => Promise<void>;

/** Records `act` in a fresh desktop context; keeps from `act` on, trimmed to `seconds`, plus a still */
/**
 * What a clip's setup may hand back: `cleanLines`, the window lines (px from the top) that cut nothing.
 * Such a clip is encoded only once every language and mode of it is recorded (`finishDeferred`), all
 * cropped at the first line clean in each, so English and Arabic are framed alike (AUDIT-2 2026-11-21)
 */
type ClipPrepare = (page: Page) => Promise<void | { cleanLines?: number[] }>;
/**
 * Records the page from Chrome's own screencast: every painted frame as a full-quality JPEG with its
 * time, laid out losslessly at 25 fps. Playwright's recorder encodes live at a fixed bit rate, and the
 * frame where the whole page changes came out smeared (AUDIT-2 re-audit 5: en frame 38, ar frame 30)
 */
async function startRecorder(page: Page, dir: string): Promise<() => Promise<string>> {
  const cdp = await page.context().newCDPSession(page);
  const frames: Array<{ file: string; at: number; w: number; h: number }> = [];
  const writes: Promise<void>[] = [];
  cdp.on('Page.screencastFrame', ({ data, metadata, sessionId }) => {
    const file = join(dir, `f${String(frames.length).padStart(6, '0')}.jpg`);
    frames.push({ file, at: metadata.timestamp ?? Date.now() / 1000, w: Math.round(metadata.deviceWidth), h: Math.round(metadata.deviceHeight) });
    writeFileSync(file, Buffer.from(data, 'base64'));
    writes.push(cdp.send('Page.screencastFrameAck', { sessionId }).then(() => undefined, () => undefined));
  });
  // No size cap: a cap taken from the window before the clip's resize scaled every later frame down
  await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 100, maxWidth: 4096, maxHeight: 4096, everyNthFrame: 1 });
  return async () => {
    const stoppedAt = Date.now() / 1000;
    await cdp.send('Page.stopScreencast').catch(() => undefined);
    await Promise.all(writes);
    await cdp.detach().catch(() => undefined);
    // Only frames of the window as it ends: one painted before the clip's window was resized is another
    // size, and ffmpeg then rebuilt its filters mid-stream and the crop failed (run 45063102782)
    const end = page.viewportSize()!;
    for (const f of frames.filter((fr) => Math.abs(fr.w - end.width) > 1 || Math.abs(fr.h - end.height) > 1)) rmSync(f.file, { force: true });
    frames.splice(0, frames.length, ...frames.filter((fr) => Math.abs(fr.w - end.width) <= 1 && Math.abs(fr.h - end.height) <= 1));
    if (!frames.length) throw new Error('the screencast sent no frames');
    // 25 fps from the first frame: each step shows the frame painted last by then (frames painted closer
    // together than 40 ms each still took a whole step when listed one by one, and the clip ran long)
    const t0 = frames[0].at;
    const steps = Math.max(1, Math.ceil((Math.max(stoppedAt, frames[frames.length - 1].at) - t0) * 25));
    const list: string[] = [];
    let k = 0;
    for (let n = 0; n < steps; n++) {
      while (k + 1 < frames.length && frames[k + 1].at <= t0 + n / 25) k++;
      list.push(`file '${frames[k].file}'\nduration 0.04`);
    }
    writeFileSync(join(dir, 'frames.txt'), `ffconcat version 1.0\n${list.join('\n')}\n`);
    const raw = join(dir, 'raw.mkv');
    execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', join(dir, 'frames.txt'), '-vf', `scale=${end.width}:${end.height}:flags=lanczos,fps=25,format=yuv420p`, '-c:v', 'ffv1', raw]);
    for (const f of frames) rmSync(f.file, { force: true });
    return raw;
  };
}

const deferredClips: Array<{ id: string; name: string; raw: string; hold: string; offset: number; seconds: number; lines: number[] }> = [];

/** Trim at the cut, crop to the top `crop` px (if any), encode, and turn the still into its webp */
function encodeClip(raw: string, name: string, offset: number, seconds: number, crop?: number): void {
  const vf = crop ? ['-vf', `crop=iw:${crop}:0:0`] : [];
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-ss', offset.toFixed(2), '-t', String(seconds), '-i', raw, ...vf, '-an', '-c:v', 'libvpx-vp9', '-b:v', '0', '-crf', '18', '-row-mt', '1', join(CLIPS, `${name}.webm`)]);
  const png = join(CLIPS, `${name}.png`);
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', png, ...vf, '-c:v', 'libwebp', '-quality', '80', join(CLIPS, `${name}.webp`)]);
  rmSync(png);
}

/**
 * Encode a deferred clip's recordings, each cropped at a line that cuts nothing: one shared by all when
 * there is one, else each language's line nearest the lowest first line (the Arabic rail's labels wrap
 * to two lines, so its items sit at other heights and English and Arabic may share no clean line)
 */
function finishDeferred(id: string): void {
  const jobs = deferredClips.filter((j) => j.id === id);
  if (!jobs.length) return;
  const sets = jobs.map((j) => new Set(j.lines));
  const shared = jobs[0].lines.filter((y) => sets.every((st) => st.has(y)) && y % 2 === 0).sort((a, b) => a - b);
  const target = Math.max(...jobs.map((j) => j.lines[0] ?? 0));
  const cropFor = (lines: number[]) => {
    if (shared.length) return shared[0];
    const even = lines.filter((y) => y % 2 === 0);
    if (!even.length) return undefined;
    return even.reduce((best, y) => (Math.abs(y - target) < Math.abs(best - target) ? y : best), even[0]);
  };
  // One length for every recording of the clip (AUDIT-2 re-audit 8: 5.84 s and 5.68 s): the shortest
  // that each still has after its cut, in whole frames
  const left = jobs.map((j) => {
    const dur = Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', j.raw]).toString().trim());
    return Number.isFinite(dur) ? dur - j.offset : j.seconds;
  });
  const seconds = Math.floor(Math.min(...jobs.map((j) => j.seconds), ...left) * 25) / 25;
  for (const j of jobs) {
    j.seconds = seconds;
    const crop = cropFor(j.lines);
    if (crop === undefined) problems.push(`clip ${j.name}: no line cuts nothing below the menu and the comments`);
    console.log(`help clip ${j.name}: cropped to the top ${crop ?? 'full'} px${shared.length ? ' (shared by every recording)' : ` (nearest clean line to ${target})`}`);
    try {
      encodeClip(j.raw, j.name, j.offset, j.seconds, crop);
    } finally {
      rmSync(j.hold, { recursive: true, force: true });
    }
  }
  deferredClips.splice(0, deferredClips.length, ...deferredClips.filter((j) => j.id !== id));
}

async function clip(browser: Browser, id: string, lang: Lang, mode: Mode, prepare: ClipPrepare, act: ClipAct, seconds = 10, height?: number): Promise<void> {
  try {
    await recordClip(browser, id, lang, mode, prepare, act, seconds, height);
  } catch (error) {
    problems.push(`clip ${id}.${lang}.${mode}: ${(error as Error).message.split('\n').slice(0, 4).join(' ')}`);
  }
}

async function recordClip(browser: Browser, id: string, lang: Lang, mode: Mode, prepare: ClipPrepare, act: ClipAct, seconds: number, height?: number): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), 'help-clip-'));
  try {
    const started = Date.now();
    // `height`: a taller window for a clip whose still shows the side rail whole, no scroll chevron over
    // a cut item (AUDIT-2 2026-11-21); the rest keep the desktop height (the mini player needs the
    // page to scroll its player away)
    const { context, page } = await open(browser, lang, 'desktop', mode, { height });
    const stopRecording = await startRecorder(page, dir);
    // Recorded clips move: only they keep motion on
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    let offset = 0;
    let lines: number[] | undefined;
    let rawPath = '';
    try {
      const prepared = await prepare(page);
      if (prepared && prepared.cleanLines) lines = prepared.cleanLines;
            // Clips get no text pass: the data itself must be clean (audit r4: @E2Ehelp<run> in a clip)
      await expectNoLeaks(page);
      await page.context().addInitScript(CLIP_LEAK_WATCH);
      await page.evaluate(CLIP_LEAK_WATCH);
      await page.screenshot({ path: join(CLIPS, `${id}.${lang}.${mode}.png`) });
      // A black frame marks the cut in the video itself: the recorder only writes frames when the page
      // paints, so wall-clock time drifts from video time and the menu warm-up showed in the clip's
      // first second (AUDIT-2 2026-11-21). The time is only the fallback
      await page.evaluate(() => new Promise<void>((done) => {
        const cut = document.createElement('div');
        cut.id = 'help-clip-cut';
        cut.style.cssText = 'position:fixed;inset:0;background:#000;z-index:2147483647';
        document.documentElement.append(cut);
        requestAnimationFrame(() => requestAnimationFrame(() => done()));
      }));
      await page.waitForTimeout(400);
      await page.evaluate(() => new Promise<void>((done) => {
        document.getElementById('help-clip-cut')?.remove();
        requestAnimationFrame(() => requestAnimationFrame(() => done()));
      }));
      offset = (Date.now() - started) / 1000;
      await act(page, async () => { await page.screenshot({ path: join(CLIPS, `${id}.${lang}.${mode}.png`) }); });
      await page.waitForTimeout(1200);
      await expectNoLeaks(page);
      const during = await readClipLeaks(page);
      if (during.length) throw new Error(`test data showed during the clip: ${during.join(' | ')}`);
      rawPath = await stopRecording();
    } finally {
      await context.close();
    }
    const raw = rawPath.slice(dir.length + 1);
    // The cut: just after the last black stretch (the page's own dark theme is never pure black)
    const probe = spawnSync('ffmpeg', ['-hide_banner', '-i', join(dir, raw), '-vf', 'blackdetect=d=0.1:pic_th=0.98:pix_th=0.02', '-an', '-f', 'null', '-'], { encoding: 'utf8' });
    const ends = [...(probe.stderr ?? '').matchAll(/black_end:\s*([\d.]+)/g)].map((m) => Number(m[1]));
    if (ends.length) offset = ends[ends.length - 1] + 0.05;
    else console.log(`help clip ${id}.${lang}.${mode}: no cut frame found, trimmed by time (${offset.toFixed(2)} s)`);
    if (lines) {
      // Kept until every language and mode is recorded (finishDeferred)
      const hold = mkdtempSync(join(tmpdir(), 'help-clip-hold-'));
      const kept = join(hold, raw);
      renameSync(join(dir, raw), kept);
      deferredClips.push({ id, name: `${id}.${lang}.${mode}`, raw: kept, hold, offset, seconds, lines });
    } else encodeClip(join(dir, raw), `${id}.${lang}.${mode}`, offset, seconds);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

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
