/**
 * Shared setup for the player specs: local fixtures, the chapters and subtitles API, and helpers
 * that read the player's real state from the media element and the rendered pixels.
 */
import fs from 'fs';
import path from 'path';
import { expect, test as base, type Locator, type Page } from '@playwright/test';

const FIXTURES = path.join(__dirname, 'fixtures');
const TYPES: Record<string, string> = { '.m3u8': 'application/vnd.apple.mpegurl', '.ts': 'video/mp2t', '.vtt': 'text/vtt', '.mp4': 'video/mp4', '.m4s': 'video/iso.segment' };
const CORS = { 'access-control-allow-origin': '*' };

/** A live media playlist that slides over the bright fixture's 360p segments, 2s each */
function livePlaylist(): string {
  const segments = 45;
  const window = 6;
  const now = Math.floor(Date.now() / 2000);
  const first = now - window;
  const lines = ['#EXTM3U', '#EXT-X-VERSION:3', '#EXT-X-TARGETDURATION:2', `#EXT-X-MEDIA-SEQUENCE:${first}`, `#EXT-X-DISCONTINUITY-SEQUENCE:${Math.floor(first / segments)}`];
  for (let n = first; n < now; n++) {
    if (n % segments === 0 && n !== first) lines.push('#EXT-X-DISCONTINUITY');
    lines.push('#EXTINF:2.0,', `/__player-fixtures/bright/0_${String(n % segments).padStart(3, '0')}.ts`);
  }
  return `${lines.join('\n')}\n`;
}

const CHAPTER_TITLES: [string, string, string] = ['Opening', 'The middle', 'Closing'];

export async function routeFixtures(page: Page, chapterTitles: [string, string, string] = CHAPTER_TITLES, captions: CaptionBodies = {}): Promise<void> {
  await page.route('**/__player-fixtures/**', async (route) => {
    const rel = decodeURIComponent(new URL(route.request().url()).pathname.replace(/^.*\/__player-fixtures\//, ''));
    if (rel === 'live/master.m3u8') {
      const body = livePlaylist();
      return route.fulfill({ status: 200, headers: { ...CORS, 'content-type': TYPES['.m3u8'], 'cache-control': 'no-store' }, body });
    }
    const file = path.join(FIXTURES, rel);
    if (!file.startsWith(FIXTURES) || !fs.existsSync(file)) return route.fulfill({ status: 404, headers: CORS, body: '' });
    return route.fulfill({ status: 200, headers: { ...CORS, 'content-type': TYPES[path.extname(file)] ?? 'application/octet-stream' }, body: fs.readFileSync(file) });
  });

  await page.route(/\/api\/videos\/harness-[a-z]+\/chapters/, (route) =>
    route.fulfill({
      status: 200,
      headers: { ...CORS, 'content-type': 'application/json' },
      body: JSON.stringify({
        success: true,
        chapters: {
          source: 'manual',
          parsedAt: '2026-01-01T00:00:00.000Z',
          version: 1,
          chapters: [
            { id: 'c1', startTime: 0, endTime: 30, title: chapterTitles[0] },
            { id: 'c2', startTime: 30, endTime: 60, title: chapterTitles[1] },
            { id: 'c3', startTime: 60, endTime: 90, title: chapterTitles[2] },
          ],
        },
      }),
    }),
  );

  await page.route(/\/api\/videos\/harness-[a-z]+\/subtitles$/, (route) =>
    route.fulfill({
      status: 200,
      headers: { ...CORS, 'content-type': 'application/json' },
      body: JSON.stringify({
        success: true,
        data: {
          tracks: [
            // The API's own track paths (the player derives the download link from them)
            { language: 'en', label: 'English', url: `/api/videos/${videoIdOf(route.request().url())}/subtitles/en`, status: 'ready' },
            { language: 'ar', label: 'العربية', url: `/api/videos/${videoIdOf(route.request().url())}/subtitles/ar`, status: 'ready' },
          ],
        },
      }),
    }),
  );

  await page.route(/\/api\/videos\/harness-[a-z]+\/subtitles\/(en|ar)$/, (route) => {
    const lang = new URL(route.request().url()).pathname.split('/').pop() as 'en' | 'ar';
    return route.fulfill({ status: 200, headers: { ...CORS, 'content-type': TYPES['.vtt'] }, body: captions[lang] ?? fs.readFileSync(path.join(FIXTURES, `${lang}.vtt`)) });
  });
}

/** WebVTT bodies served for a track instead of the fixture file (as GET /subtitles/:lang serves them) */
export type CaptionBodies = Partial<Record<'en' | 'ar', string>>;

const videoIdOf = (url: string) => /\/videos\/([^/]+)\/subtitles/.exec(new URL(url).pathname)?.[1] ?? 'harness-bright';

/** GET /api/me/features: every feature off unless the spec turns it on, never the real API's answer */
async function routeFeatures(page: Page, features: Record<string, boolean>): Promise<void> {
  await page.route(/\/api\/me\/features(\?|$)/, (route) =>
    route.fulfill({ status: 200, headers: { ...CORS, 'content-type': 'application/json' }, body: JSON.stringify({ success: true, features }) }),
  );
}

export interface HarnessOptions {
  lang?: 'en' | 'ar';
  src?: 'bright' | 'dark' | 'short' | 'live' | 'audio';
  watch?: boolean;
  width?: number;
  /** Seed a saved position (seconds) so the player resumes and offers Start over */
  resumeAt?: number;
  /** Player theme; defaults to PLAYER_THEME, else the theme the server was built with */
  theme?: string;
  /** Also switch the site theme (html[data-theme]) so the page uses that theme's fonts */
  siteTheme?: boolean;
  /** Titles of the three fixture chapters */
  chapterTitles?: [string, string, string];
  /** Playlist playback: the list in the URL (its queue is served by the spec) and the item's index */
  list?: string;
  index?: number;
  /** "Autoplay next" synced with an account (the spec serves the token and playback settings) */
  account?: boolean;
  /** The features answer (GET /api/me/features); every feature is off unless named here */
  features?: Record<string, boolean>;
  /** Caption track bodies instead of the fixture files */
  captions?: CaptionBodies;
}

const THEMES_CSS = path.resolve(__dirname, '../../../../packages/fanous-tokens/generated-player');

/** The player themes the tokens package generates */
export const PLAYER_THEMES = fs.readdirSync(THEMES_CSS).filter((f) => f.endsWith('.css')).map((f) => f.slice(0, -4)).sort();

/**
 * A build ships one theme (docs/specs/VIDEO-PLAYER.md section 6). To test the others against one
 * server, the page gets that theme's generated player CSS over the built one, from the same file a
 * build of that theme bundles. The doubled `:root` outranks the built theme wherever it loads.
 */
function themeCss(theme: string): string {
  if (!PLAYER_THEMES.includes(theme)) throw new Error(`Unknown player theme "${theme}" (have ${PLAYER_THEMES.join(', ')})`);
  return fs.readFileSync(path.join(THEMES_CSS, `${theme}.css`), 'utf8').replace(/:root\s*\{/g, ':root:root {');
}

/** `next dev`'s hot-reload socket: /_next/hmr since Next 16.4, /_next/webpack-hmr before */
const HMR_SOCKET = /\/_next\/(webpack-)?hmr(\?|$)/;
/**
 * next dev reloads open pages when another worker's request compiles a new entry, or when a "sync"
 * names a changed build. No source changes during a run, so nothing the socket sends as text (sync,
 * building, built, reloadPage, …) is for a spec; binary messages pass, React waits for its debug
 * chunks before it hydrates (as in e2e/themes/harness.ts, #2014).
 *
 * In the page, not routeWebSocket: that evaluates in the page for every message, which WebKit counts
 * as a user gesture, so a page could play with sound that no viewer let it.
 *
 * Returns the check for the end of the test: a dev page whose socket was not held, or a hot update
 * that got through, fails it. From 2026-11-21 (Next 16.4 moved the socket) to 2026-11-25 the hold
 * silently held nothing: the first two specs of every WebKit run lost their page to a reload in the
 * middle of a measurement and passed on the retry. The state stays in the page until then: with a
 * console listener Playwright forwards every console event, and React's dev build writes thousands per
 * page (Firefox's run took 42 to 60 min instead of 35).
 */
async function keepDevBuildStill(page: Page): Promise<() => Promise<void>> {
  await page.addInitScript((socket) => {
    const hmr = new RegExp(socket);
    let held = false;
    /** Flags that outlive the document: the reload an update ends in, and a spec that moves on */
    const flag = (name: 'updated' | 'missed', set = false): boolean => {
      try {
        const key = `player-harness-${name}`;
        if (set) window.sessionStorage.setItem(key, '1');
        return window.sessionStorage.getItem(key) === '1';
      } catch {
        return set; // storage blocked
      }
    };
    const missed = () => {
      // Next's dev entry chunk (a production build's carries a hash), and an app that runs: its socket is up
      const dev = [...document.scripts].some((script) => /\/_next\/static\/chunks\/main-app\.js/.test(script.src));
      const running = [...document.querySelectorAll('button')].some((button) => Object.keys(button).some((key) => key.startsWith('__reactProps$')));
      return dev && running && !held;
    };
    window.addEventListener('pagehide', () => { if (missed()) flag('missed', true); });
    (window as unknown as { __hold: () => Hold }).__hold = () => ({ missed: missed() || flag('missed'), updated: flag('updated') });
    const log = console.log;
    console.log = (...args: unknown[]) => {
      if (typeof args[0] === 'string' && args[0].startsWith('[Fast Refresh] rebuilding')) flag('updated', true);
      log.apply(console, args);
    };
    const Native = window.WebSocket;
    window.WebSocket = class extends Native {
      constructor(url: string | URL, protocols?: string | string[]) {
        super(url, protocols);
        if (!hmr.test(String(url))) return;
        held = true;
        // The first listener: stopping here keeps the message from the page's own
        this.addEventListener('message', (event) => {
          if (typeof event.data === 'string') event.stopImmediatePropagation();
        });
      }
    };
  }, HMR_SOCKET.source);
  return async () => {
    if (page.isClosed()) return;
    for (const frame of page.frames()) {
      // A frame that goes meanwhile has nothing more to tell
      const hold = await frame.evaluate(() => (window as unknown as { __hold?: () => Hold }).__hold?.()).catch(() => undefined);
      expect(hold?.missed ?? false, 'the hot-reload hold holds nothing: next dev moved its socket (HMR_SOCKET)').toBe(false);
      expect(hold?.updated ?? false, 'a hot update reached the page past the hold (keepDevBuildStill)').toBe(false);
    }
  };
}

interface Hold { missed: boolean; updated: boolean }

/** Every player spec's `test`: the dev server's hot reload held, and the hold checked when the test ends. */
export const test = base.extend<{ buildStill: void }>({
  buildStill: [async ({ page }, use) => {
    const check = await keepDevBuildStill(page);
    await use();
    await check();
  }, { auto: true }],
});

export async function openHarness(page: Page, opts: HarnessOptions = {}): Promise<Locator> {
  await routeFixtures(page, opts.chapterTitles, opts.captions);
  await routeFeatures(page, opts.features ?? {});
  // A recorded consent choice keeps the consent banner out of the frame (lib/consent/consent-cookie.ts)
  const origin = new URL(process.env.PLAYER_BASE_URL || `http://localhost:${process.env.PLAYER_PORT || 3101}`).origin;
  await page.context().addCookies([{ name: 'aun_consent', value: `v1.a0.e0.p0.${Date.now()}`, url: origin }]);
  await page.addInitScript(({ resumeAt, src }) => {
    try {
      if (resumeAt !== undefined) {
        const id = `harness-${src}`;
        window.localStorage.setItem('watchProgress', JSON.stringify({ [id]: { videoId: id, currentTime: resumeAt, duration: 90, completed: false, timestamp: new Date().toISOString() } }));
      }
    } catch {
      // Storage blocked: the specs that need it will fail on their own assertions
    }
  }, { resumeAt: opts.resumeAt, src: opts.src ?? 'bright' });
  const theme = opts.theme ?? process.env.PLAYER_THEME;
  if (theme) {
    await page.addInitScript((css) => {
      const add = () => {
        const style = document.createElement('style');
        style.id = 'player-theme-under-test';
        style.textContent = css;
        document.head.appendChild(style);
      };
      if (document.head) add();
      else document.addEventListener('DOMContentLoaded', add, { once: true });
    }, themeCss(theme));
  }
  const q = new URLSearchParams();
  q.set('src', opts.src ?? 'bright');
  if (opts.watch === false) q.set('watch', '0');
  if (opts.width) q.set('width', String(opts.width));
  if (opts.list) q.set('list', opts.list);
  if (opts.index !== undefined) q.set('index', String(opts.index));
  if (opts.account) q.set('account', '1');
  await page.goto(`/${opts.lang ?? 'en'}/dev/player?${q}`);
  // The site theme picks the page fonts (theme/fonts.css), which the player's layers inherit. The
  // server renders its own theme and the page sets it again once loaded, so this one is kept pinned.
  if (theme && opts.siteTheme) {
    await page.evaluate((name) => {
      const html = document.documentElement;
      const set = () => { if (html.getAttribute('data-theme') !== name) html.setAttribute('data-theme', name); };
      set();
      new MutationObserver(set).observe(html, { attributes: true, attributeFilter: ['data-theme'] });
    }, theme);
  }
  const player = page.locator('.video-js.vjs-fanous').first();
  await expect(player).toBeVisible({ timeout: 60_000 });
  // A live stream loads no segments before Play, so there is no metadata to wait for
  if (opts.src === 'live') {
    await expect(player).toHaveClass(/vjs-live/, { timeout: 60_000 });
    return player;
  }
  await page.waitForFunction(() => {
    const v = document.querySelector<HTMLVideoElement>('.video-js video');
    return !!v && v.readyState >= 1 && (v.duration > 0 || v.duration === Infinity);
  }, undefined, { timeout: 60_000 });
  return player;
}

export const video = (page: Page) => page.locator('.video-js video').first();

export async function mediaState(page: Page) {
  return page.evaluate(() => {
    const v = document.querySelector<HTMLVideoElement>('.video-js video')!;
    return { paused: v.paused, currentTime: v.currentTime, duration: v.duration, volume: v.volume, muted: v.muted, rate: v.playbackRate, ended: v.ended };
  });
}

/** Start playback with the big play button and wait for the controls */
export async function startPlayback(page: Page, player: Locator): Promise<void> {
  await player.locator('.vjs-big-play-button').click();
  await expect(player).toHaveClass(/vjs-has-started/);
  await page.waitForFunction(() => {
    const v = document.querySelector<HTMLVideoElement>('.video-js video');
    return !!v && !v.paused && v.currentTime > 0.2;
  }, undefined, { timeout: 30_000 });
}

/** Pause and keep the controls up (paused players never hide them) */
export async function pauseAt(page: Page, player: Locator, seconds: number): Promise<void> {
  await page.evaluate((t) => {
    const v = document.querySelector<HTMLVideoElement>('.video-js video')!;
    v.pause();
    v.currentTime = t;
  }, seconds);
  await page.waitForFunction((t) => {
    const v = document.querySelector<HTMLVideoElement>('.video-js video');
    return !!v && v.paused && Math.abs(v.currentTime - t) < 0.6 && v.readyState >= 2;
  }, seconds);
  await player.hover({ position: { x: 20, y: 20 } });
}

export const bar = (player: Locator) => player.locator('.vjs-control-bar');

/** A PNG screenshot decoded to RGBA, with device-pixel helpers */
export async function pixels(page: Page, clip: { x: number; y: number; width: number; height: number }) {
  // WebKit now and then fails to decode a good PNG in the page ("EncodingError: Loading error"):
  // take the screenshot again rather than fail the measurement
  for (let attempt = 1; ; attempt++) {
    try {
      return await capturePixels(page, clip);
    } catch (err) {
      if (attempt >= 3 || !/EncodingError/.test(String(err))) throw err;
    }
  }
}

async function capturePixels(page: Page, clip: { x: number; y: number; width: number; height: number }) {
  const buffer = await page.screenshot({ clip, animations: 'disabled', caret: 'hide', scale: 'device' });
  const decoded = await page.evaluate(async (b64) => {
    const img = new Image();
    img.src = `data:image/png;base64,${b64}`;
    await img.decode();
    const c = document.createElement('canvas');
    c.width = img.width;
    c.height = img.height;
    const ctx = c.getContext('2d')!;
    ctx.drawImage(img, 0, 0);
    // As base64: a JSON array of every channel outgrows the protocol's string limit on large clips
    const bytes = ctx.getImageData(0, 0, img.width, img.height).data;
    let binary = '';
    for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return { w: img.width, h: img.height, rgba: btoa(binary) };
  }, buffer.toString('base64'));
  const data = { w: decoded.w, h: decoded.h, rgba: new Uint8Array(Buffer.from(decoded.rgba, 'base64')) };
  const at = (x: number, y: number) => {
    const i = (Math.round(y) * data.w + Math.round(x)) * 4;
    return [data.rgba[i], data.rgba[i + 1], data.rgba[i + 2]] as [number, number, number];
  };
  return { ...data, at };
}

export function luminance([r, g, b]: [number, number, number]): number {
  const ch = (v: number) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * ch(r) + 0.7152 * ch(g) + 0.0722 * ch(b);
}

export function contrast(a: [number, number, number], b: [number, number, number]): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

export const rect = (l: Locator) => l.evaluate((el) => {
  const r = el.getBoundingClientRect();
  return { x: r.x, y: r.y, width: r.width, height: r.height, right: r.right, bottom: r.bottom };
});

export interface Box { x: number; y: number; width: number; height: number; cx: number; cy: number; right: number; bottom: number }

const box = (x: number, y: number, width: number, height: number): Box => ({ x, y, width, height, cx: x + width / 2, cy: y + height / 2, right: x + width, bottom: y + height });

/**
 * Where a target's ink actually is, in CSS pixels: the page is captured with the target drawn
 * and with it hidden, and the pixels that change are the target. Measures what the viewer sees
 * (SVG paths inside their viewBox, glyphs inside their line box, pseudo-element handles), not
 * layout boxes. `part` hides the element itself, or only its ::before or ::after.
 */
export async function inkBox(page: Page, target: Locator, part: 'self' | 'before' | 'after' = 'self', pad = 6): Promise<Box> {
  // A capture can land before the hide style is painted, leaving no difference: measure once more
  try {
    return await measureInk(page, target, part, pad);
  } catch (err) {
    if (!/drew nothing/.test(String(err))) throw err;
    return measureInk(page, target, part, pad);
  }
}

async function measureInk(page: Page, target: Locator, part: 'self' | 'before' | 'after', pad: number): Promise<Box> {
  const r = await rect(target);
  const clip = { x: Math.max(0, r.x - pad), y: Math.max(0, r.y - pad), width: r.width + pad * 2, height: r.height + pad * 2 };
  const shown = await pixels(page, clip);
  // Pinned once: a locator such as `svg:visible` stops matching while the target is hidden
  const el = await target.elementHandle();
  if (!el) throw new Error('inkBox: target not found');
  await el.evaluate((el, p) => {
    el.setAttribute('data-ink-probe', p);
    const style = document.createElement('style');
    style.id = 'ink-probe-style';
    style.textContent = [
      '[data-ink-probe="self"], [data-ink-probe="self"] * { visibility: hidden !important; }',
      '[data-ink-probe="before"]::before { visibility: hidden !important; }',
      '[data-ink-probe="after"]::after { visibility: hidden !important; }',
    ].join('\n');
    document.head.appendChild(style);
  }, part);
  await page.evaluate(() => new Promise((res) => requestAnimationFrame(() => requestAnimationFrame(res))));
  const hidden = await pixels(page, clip);
  await el.evaluate((el) => {
    el.removeAttribute('data-ink-probe');
    document.getElementById('ink-probe-style')?.remove();
  });
  await el.dispose();
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (let y = 0; y < shown.h; y++) {
    for (let x = 0; x < shown.w; x++) {
      const i = (y * shown.w + x) * 4;
      const d = Math.max(Math.abs(shown.rgba[i] - hidden.rgba[i]), Math.abs(shown.rgba[i + 1] - hidden.rgba[i + 1]), Math.abs(shown.rgba[i + 2] - hidden.rgba[i + 2]));
      if (d > 48) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (!Number.isFinite(minX)) throw new Error('inkBox: the target drew nothing');
  const sx = shown.w / clip.width;
  return box(clip.x + minX / sx, clip.y + minY / sx, (maxX - minX + 1) / sx, (maxY - minY + 1) / sx);

}

/**
 * Resolves once every animation and transition in the target (and under it) has finished, plus
 * one painted frame: slide-ins and height changes are measured at rest, however slow the runner.
 */
export async function animationsDone(target: Locator): Promise<void> {
  await target.evaluate(async (el) => {
    for (let round = 0; round < 5; round++) {
      const running = el.getAnimations({ subtree: true }).filter((a) => a.playState !== 'finished');
      if (running.length === 0) break;
      // A cancelled animation rejects `finished`; it is not running any more either way
      await Promise.all(running.map((a) => a.finished.catch(() => undefined)));
    }
    await new Promise((res) => requestAnimationFrame(() => requestAnimationFrame(res)));
  });
}

export async function layoutBox(l: Locator): Promise<Box> {
  const r = await rect(l);
  return box(r.x, r.y, r.width, r.height);
}
