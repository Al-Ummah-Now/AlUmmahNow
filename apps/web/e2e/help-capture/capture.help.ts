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
  { key: 'tour', art: 'videos.webp', title: NAMES.video },
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
  for (const [id, name] of [[creator.channelIds[0], NAMES.channel], [creator.channelIds[1], NAMES.second]] as const) {
    expect((await apiFetch(user, `/api/channels/${id}`, json({ name: name.en, nameLocalized: name, description: about.en, descriptionLocalized: about }, id))).status).toBeLessThan(300);
  }
  // The demo videos, oldest first so "Site tour" is the newest (the home page's featured video)
  for (const demo of [...DEMOS].reverse()) {
    const video = await data.createVideo(user, channelId, { clip: 'landscape40', isPublic: true, title: demo.title.en, waitReady: true });
    expect((await apiFetch(user, `/api/videos/${video.id}`, json({ titleLocalized: demo.title }, channelId))).status).toBeLessThan(300);
    const guid = await cdnGuid(video.id);
    if (guid) demoByGuid.set(guid, demo.key);
    else problems.push(`no CDN guid for demo video ${demo.key}: it shows the test pattern`);
    demoIds.push(video.id);
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
  const unplaced = await page.evaluate(({ rtl, above }) => {
    document.querySelectorAll('[data-help-marker]').forEach((n) => n.remove());
    type Box = { x: number; y: number; w: number; h: number };
    // An annotation, never UI (owner review 2026-11-16): a dashed outline in the theme's live red with
    // a white halo, offset from the control, and its number attached to the outline. Red markup is
    // what a screenshot annotation looks like; no control on the site is drawn this way.
    const S = 24;
    const GAP = 6;
    const INK = 'var(--fanous-color-live)';
    const ON_INK = 'var(--fanous-color-on-live)';
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
    const placed: Box[] = [];
    let missed = 0;
    for (const target of targets) {
      const r = target.getBoundingClientRect();
      // The outline: the control's own shape (round around an avatar), GAP px outside it
      const radius = parseFloat(getComputedStyle(target).borderTopLeftRadius) || 0;
      const round = radius >= Math.min(r.width, r.height) / 2 - 0.5;
      const o = { x: r.x - GAP, y: r.y - GAP, w: r.width + GAP * 2, h: r.height + GAP * 2 };
      const ring = document.createElement('span');
      ring.dataset.helpMarker = '';
      Object.assign(ring.style, {
        position: 'fixed', left: `${o.x}px`, top: `${o.y}px`, width: `${o.w}px`, height: `${o.h}px`, boxSizing: 'border-box',
        border: `2px dashed ${INK}`, borderRadius: round ? '9999px' : `${radius + GAP}px`,
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
      const candidates: Array<[number, number]> = above
        ? [[cornerStartX, topY + k], [cornerEndX, topY + k], [cornerStartX, bottomY - k], [cornerEndX, bottomY - k]]
        : [[startX, midY], [endX, midY], [cornerStartX, topY + k], [cornerStartX, bottomY - k]];
      const others = controls
        .filter((c) => c.el !== target && !c.el.contains(target) && !target.contains(c.el))
        .map((c) => ({ x: c.r.x + 2, y: c.r.y + 2, w: Math.max(0, c.r.width - 4), h: Math.max(0, c.r.height - 4) }));
      const fits = ([x, y]: [number, number]) => {
        const box = { x, y, w: S, h: S };
        return x >= 2 && y >= 2 && x + S <= window.innerWidth - 2 && y + S <= window.innerHeight - 2
          && !others.some((c) => hit(box, c)) && !placed.some((q) => hit(box, q));
      };
      const spot = candidates.find(fits);
      if (!spot) missed++;
      const [x, y] = spot ?? candidates.find(([cx, cy]) => cx >= 2 && cy >= 2 && cx + S <= window.innerWidth - 2) ?? candidates[0];
      placed.push({ x, y, w: S, h: S });
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
    return missed;
  }, { rtl: lang === 'ar', above: place === 'above' });
  // Not silent: the run lists every picture whose number had to sit on another control
  if (unplaced) note(`${unplaced} marker(s) found no spot clear of other controls`);
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
  });
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
      // The avatar of whoever you act as (no 'Commenting as' text, no Switch: owner 2026-11-15), then the box
      return [[line, box], [line, box]];
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
      await settle(page, `/channels/${channelId}`, lang);
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
