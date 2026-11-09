/**
 * Shared setup for the player specs: local fixtures, the chapters and subtitles API, and helpers
 * that read the player's real state from the media element and the rendered pixels.
 */
import fs from 'fs';
import path from 'path';
import { expect, type Locator, type Page } from '@playwright/test';

const FIXTURES = path.join(__dirname, 'fixtures');
const TYPES: Record<string, string> = { '.m3u8': 'application/vnd.apple.mpegurl', '.ts': 'video/mp2t', '.vtt': 'text/vtt' };
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

export async function routeFixtures(page: Page): Promise<void> {
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
            { id: 'c1', startTime: 0, endTime: 30, title: 'Opening' },
            { id: 'c2', startTime: 30, endTime: 60, title: 'The middle' },
            { id: 'c3', startTime: 60, endTime: 90, title: 'Closing' },
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
            { language: 'en', label: 'English', url: '/__player-fixtures/en.vtt', status: 'ready' },
            { language: 'ar', label: 'العربية', url: '/__player-fixtures/ar.vtt', status: 'ready' },
          ],
        },
      }),
    }),
  );
}

export interface HarnessOptions {
  lang?: 'en' | 'ar';
  src?: 'bright' | 'dark' | 'short' | 'live';
  watch?: boolean;
  width?: number;
  /** Seed a saved position (seconds) so the player resumes and offers Start over */
  resumeAt?: number;
  /** Player theme; defaults to PLAYER_THEME, else the theme the server was built with */
  theme?: string;
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

/**
 * next dev reloads open pages when another worker's request compiles a new entry, or when its hot
 * reload socket reconnects to a changed build. The page needs the socket's first sync to finish
 * loading; after that the specs want no hot reload, so later build messages never reach the page.
 */
const DEV_RELOAD_ACTIONS = new Set(['building', 'built', 'reloadPage', 'serverComponentChanges']);

async function keepDevBuildStill(page: Page): Promise<void> {
  let synced = false;
  await page.routeWebSocket(/\/_next\/webpack-hmr/, (ws) => {
    const server = ws.connectToServer();
    server.onMessage((message) => {
      let action: unknown;
      try {
        action = typeof message === 'string' ? (JSON.parse(message) as { action?: unknown }).action : undefined;
      } catch {
        action = undefined;
      }
      if (action === 'sync') {
        if (synced) return;
        synced = true;
      } else if (typeof action === 'string' && DEV_RELOAD_ACTIONS.has(action)) {
        return;
      }
      ws.send(message);
    });
  });
}

export async function openHarness(page: Page, opts: HarnessOptions = {}): Promise<Locator> {
  await routeFixtures(page);
  await keepDevBuildStill(page);
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
  await page.goto(`/${opts.lang ?? 'en'}/dev/player?${q}`);
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

export async function layoutBox(l: Locator): Promise<Box> {
  const r = await rect(l);
  return box(r.x, r.y, r.width, r.height);
}
