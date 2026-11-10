/**
 * Release regression: the progress bar is one continuous track (v2026.11.09.5: a dent beside the
 * handle where the buffered fill ended). The played and buffered fills had rounded (pill) ends, so
 * where a fill stopped mid-track the darker track showed above and below its cap: a notch.
 *
 * The track's pixels are read back and sampled along its whole length in three rows: near the top
 * edge, the middle and near the bottom edge. Every step in colour (the end of the played fill, the
 * end of the buffered fill, a chapter separator) must fall at the same x in all three rows, within
 * a pixel; a rounded end steps earlier at the edges than in the middle. The handle and the video
 * behind the bar are hidden while sampling, so only the track's own layers are measured. The played
 * fill ends mid-track at a seek point, and the buffered fill is held mid-track too, so both edges are
 * checked whatever the network buffered. Idle and hovered (the track grows), en and ar, mouse and
 * touch, a desktop and a phone width. Runs in the "player" project; RELEASE_PLAYER_BROWSERS adds
 * Firefox and WebKit locally (playwright.release.config.ts).
 */
import { test, expect, type Page } from '@playwright/test';
import { findPlayableVideo, NO_PLAYABLE_VIDEO, watchUrl } from './videos';

const PLAYER = '.video-js.vjs-fanous';
const HOLDER = `${PLAYER} .vjs-progress-holder`;
/**
 * Hides everything over or behind the track that is not the track: the handle, the hover readout,
 * the one-time touch gesture hint (it can sit over the track's start while it fades), the video.
 */
const ISOLATE = `
  ${PLAYER} .vjs-play-progress::before { visibility: hidden !important; }
  ${PLAYER} .vjs-mouse-display, .vjs-fanous-tip, ${PLAYER} .vjs-gesture-hint { display: none !important; }
  ${PLAYER} .vjs-tech, ${PLAYER} .vjs-poster { visibility: hidden !important; }
`;

/** Where the colour steps along one row of RGBA pixels (device pixels), ignoring smooth gradients. */
interface Rows { top: number[]; middle: number[]; bottom: number[]; width: number; scale: number }

/**
 * Screenshot of the track, decoded in the page (a canvas works the same in every browser), and the
 * x positions of the colour steps in each sampled row.
 */
async function sampleTrack(page: Page): Promise<Rows> {
  const box = (await page.locator(HOLDER).boundingBox())!;
  const png = await page.screenshot({ clip: { x: box.x, y: box.y, width: box.width, height: box.height } });
  return page.evaluate(async ({ data, cssWidth, cssHeight }) => {
    const img = new Image();
    img.src = `data:image/png;base64,${data}`;
    await img.decode();
    const canvas = document.createElement('canvas');
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    const ctx = canvas.getContext('2d')!;
    ctx.drawImage(img, 0, 0);
    const scale = img.naturalWidth / cssWidth;
    const radius = (cssHeight / 2) * scale;
    const steps = (fraction: number) => {
      const y = Math.min(img.naturalHeight - 1, Math.round(img.naturalHeight * fraction));
      const row = ctx.getImageData(0, y, img.naturalWidth, 1).data;
      const lum = (x: number) => 0.2126 * row[x * 4] + 0.7152 * row[x * 4 + 1] + 0.0722 * row[x * 4 + 2];
      const out: number[] = [];
      // Skip the track's own rounded ends, where the rows legitimately differ
      for (let x = Math.ceil(radius) + 2; x < img.naturalWidth - Math.ceil(radius) - 3; x++) {
        // A step is a change of 10+ levels over two device pixels (antialiasing spreads an edge over two)
        if (Math.abs(lum(x + 2) - lum(x)) >= 10 && (out.length === 0 || x - out[out.length - 1] > 3)) out.push(x + 1);
      }
      return out;
    };
    // Rows at 10% and 90% of the height: a rounded cap of radius h/2 ends 0.4 radius (2.4px idle,
    // 3.2px hovered) short of a square edge there, well past the tolerance
    return { top: steps(0.1), middle: steps(0.5), bottom: steps(0.9), width: img.naturalWidth, scale };
  }, { data: png.toString('base64'), cssWidth: box.width, cssHeight: box.height });
}

/** Steps in `a` with no step in `b` within `tolerance` device pixels. */
const unmatched = (a: number[], b: number[], tolerance: number) => a.filter((x) => !b.some((y) => Math.abs(x - y) <= tolerance));

async function startPaused(page: Page): Promise<void> {
  const bigPlay = page.locator(`${PLAYER} .vjs-big-play-button`);
  await expect(bigPlay).toBeVisible({ timeout: 45000 });
  await expect(page.locator('.vjs-volume-bar')).toHaveAttribute('aria-orientation', 'horizontal', { timeout: 15000 });
  await page.waitForFunction(() => (document.querySelector<HTMLVideoElement>('.video-js video')?.readyState ?? 0) >= 1, null, { timeout: 45000 });
  await page.evaluate(() => { document.querySelector<HTMLVideoElement>('.video-js video')!.muted = true; });
  await bigPlay.click();
  await expect(page.locator(PLAYER)).toHaveClass(/vjs-has-started/, { timeout: 30000 });
  await page.evaluate(() => document.querySelector<HTMLVideoElement>('.video-js video')!.pause());
  await expect(page.locator(PLAYER)).toHaveClass(/vjs-paused/);
  await expect.poll(() => page.locator(`${PLAYER} .vjs-control-bar`).evaluate((el) => getComputedStyle(el).opacity)).toBe('1');
}

/** Played fill to `played` of the track (a real seek), buffered fill held at `buffered`. */
async function setFills(page: Page, played: number, buffered: number): Promise<void> {
  await page.evaluate((p) => {
    const v = document.querySelector<HTMLVideoElement>('.video-js video')!;
    v.currentTime = v.duration * p;
  }, played);
  await page.waitForFunction(() => !document.querySelector<HTMLVideoElement>('.video-js video')!.seeking, null, { timeout: 30000 });
  await expect
    .poll(() => page.locator(`${PLAYER} .vjs-play-progress`).evaluate((el, p) => {
      const holder = el.parentElement!.getBoundingClientRect().width;
      return Math.abs(el.getBoundingClientRect().width / holder - p) < 0.02;
    }, played))
    .toBe(true);
  // Video.js redraws the buffered fill on `progress`; holding it mid-track (re-applied whenever
  // Video.js rewrites it) makes its edge testable even when the whole video is already buffered.
  // One strip, as Video.js draws a single buffered range
  await page.evaluate((b) => {
    const load = document.querySelector<HTMLElement>('.video-js .vjs-load-progress')!;
    const hold = () => {
      if (load.style.width !== `${b * 100}%`) load.style.width = `${b * 100}%`;
      load.querySelectorAll<HTMLElement>('div').forEach((s, i) => {
        const want = { display: i === 0 ? '' : 'none', left: '0%', width: '100%' };
        if (s.style.display !== want.display) s.style.display = want.display;
        if (s.style.left !== want.left) s.style.left = want.left;
        if (s.style.width !== want.width) s.style.width = want.width;
      });
    };
    const w = window as unknown as { __holdBuffered?: MutationObserver };
    w.__holdBuffered?.disconnect();
    w.__holdBuffered = new MutationObserver(hold);
    w.__holdBuffered.observe(load, { attributes: true, childList: true, subtree: true, attributeFilter: ['style'] });
    hold();
  }, buffered);
  await expect
    .poll(() => page.locator(`${PLAYER} .vjs-load-progress`).evaluate((el, b) => {
      const holder = el.parentElement!.getBoundingClientRect().width;
      return Math.abs(el.getBoundingClientRect().width / holder - b) < 0.01;
    }, buffered))
    .toBe(true);
}

for (const input of ['mouse', 'touch'] as const) {
  test.describe(`Release: progress bar is one continuous track (${input})`, () => {
    // Device scale 2, so a pixel-level step is several samples wide in every browser
    test.use({ deviceScaleFactor: 2, ...(input === 'touch' ? { hasTouch: true } : {}) });

    for (const locale of ['en', 'ar'] as const) {
      test(`no dent between the played, buffered and remaining track (${locale}, ${input})`, async ({ page }) => {
        test.setTimeout(240000);
        const video = await findPlayableVideo(20);
        test.skip(!video, NO_PLAYABLE_VIDEO);

        await page.setViewportSize({ width: 1280, height: 900 });
        await page.goto(watchUrl(video!.id, locale));
        await startPaused(page);
        await page.addStyleTag({ content: ISOLATE });

        const failures: string[] = [];
        for (const width of [1280, 375]) {
          await page.setViewportSize({ width, height: 900 });
          const states = input === 'mouse' ? (['idle', 'hover'] as const) : (['idle'] as const);
          for (const state of states) {
            await setFills(page, 0.3, 0.6);
            if (state === 'hover') {
              // Hover grows the track; the pointer sits past the buffered end, off both fill edges
              const box = (await page.locator(HOLDER).boundingBox())!;
              await page.mouse.move(box.x + box.width * 0.85, box.y + box.height / 2);
              await expect.poll(async () => (await page.locator(HOLDER).boundingBox())!.height).toBe(16);
            } else {
              await page.mouse.move(1, 1);
              await expect.poll(async () => (await page.locator(HOLDER).boundingBox())!.height).toBe(12);
            }
            const rows = await sampleTrack(page);
            const where = `${width}px ${state}`;
            const tolerance = Math.round(rows.scale);
            // The played and buffered ends must both show as steps in the middle row
            if (rows.middle.length < 2) failures.push(`${where}: expected the played and buffered ends in the track, saw ${rows.middle.length} steps`);
            for (const [name, edge] of [['top', rows.top], ['bottom', rows.bottom]] as const) {
              const off = [...unmatched(rows.middle, edge, tolerance), ...unmatched(edge, rows.middle, tolerance)];
              if (off.length) {
                failures.push(`${where}: steps at x=${off.map((x) => (x / rows.scale).toFixed(1)).join(', ')}px are not straight down the track (middle ${rows.middle.map((x) => (x / rows.scale).toFixed(1))}, ${name} ${edge.map((x) => (x / rows.scale).toFixed(1))})`);
              }
            }
          }
        }
        expect(failures, failures.join('\n')).toEqual([]);
      });
    }
  });
}
