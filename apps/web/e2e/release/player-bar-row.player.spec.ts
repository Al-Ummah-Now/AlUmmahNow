/**
 * Release regression: the player's control bar is one row at every width (v2026.11.09.5, a
 * tablet in Arabic: the fullscreen button wrapped onto a second row, and the bar with its
 * gradient covered the bottom half of the video with the progress bar mid-frame).
 *
 * The player is measured at its real size inside the watch page, not the viewport: the page is
 * resized from 320 to 1920 px wide and at each width every visible control-bar button must share
 * one row (same top within 2px), every control must stay inside the player, and the bar must
 * cover at most half of the player. Run with a mouse and on touch (44px targets, #531), in both
 * page languages. Runs in the "player" project (branded Chrome); RELEASE_PLAYER_BROWSERS adds
 * Firefox and WebKit locally (playwright.release.config.ts).
 */
import { test, expect, type Page } from '@playwright/test';
import { findPlayableVideo, NO_PLAYABLE_VIDEO, watchUrl } from './videos';

const PLAYER = '.video-js.vjs-fanous';
const BAR = `${PLAYER} .vjs-control-bar`;
const WIDTHS = [320, 360, 375, 390, 414, 480, 540, 600, 640, 720, 768, 820, 900, 1000, 1024, 1112, 1180, 1280, 1366, 1440, 1600, 1920];
const HEIGHT = 900;

interface Box { left: number; right: number; top: number; bottom: number; width: number; height: number }
interface Layout {
  player: Box;
  bar: Box;
  /** `pill`: the live badge, a shorter pill centred on the row rather than a full-height button. */
  buttons: Array<{ name: string; box: Box; pill: boolean }>;
  controls: Array<{ name: string; box: Box }>;
}

/** The player, the bar, every visible button and every other visible control in the bar's row. */
function measure(page: Page): Promise<Layout> {
  return page.evaluate((selectors) => {
    const box = (el: Element) => {
      const r = el.getBoundingClientRect();
      return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width, height: r.height };
    };
    const shown = (el: Element) => {
      const style = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      return style.display !== 'none' && style.visibility !== 'hidden' && r.width > 0 && r.height > 0;
    };
    const name = (el: Element) => el.getAttribute('aria-label') || el.getAttribute('title') || el.className.split(' ')[0];
    const bar = document.querySelector(selectors.bar)!;
    const rowItems = [...bar.children].filter(
      (el) => !el.classList.contains('vjs-progress-control') && !el.classList.contains('vjs-custom-control-spacer') && shown(el),
    );
    return {
      player: box(document.querySelector(selectors.player)!),
      bar: box(bar),
      buttons: [...bar.querySelectorAll('button')].filter(shown).map((el) => ({ name: name(el), box: box(el), pill: el.classList.contains('vjs-fanous-live') })),
      controls: rowItems.map((el) => ({ name: name(el), box: box(el) })),
    };
  }, { player: PLAYER, bar: BAR });
}

/** Two animation frames: container queries and the watch layout have settled after a resize. */
function settle(page: Page): Promise<void> {
  return page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
}

/** Starts the video, then pauses it: a paused player keeps its bar up (it hides only while playing). */
async function showBar(page: Page): Promise<void> {
  const bigPlay = page.locator(`${PLAYER} .vjs-big-play-button`);
  await expect(bigPlay).toBeVisible({ timeout: 45000 });
  await expect(page.locator('.vjs-volume-bar')).toHaveAttribute('aria-orientation', 'horizontal', { timeout: 15000 });
  await page.waitForFunction(() => (document.querySelector<HTMLVideoElement>('.video-js video')?.readyState ?? 0) >= 1, null, { timeout: 45000 });
  await page.evaluate(() => { document.querySelector<HTMLVideoElement>('.video-js video')!.muted = true; });
  await bigPlay.click();
  await expect(page.locator(PLAYER)).toHaveClass(/vjs-has-started/, { timeout: 30000 });
  await page.evaluate(() => document.querySelector<HTMLVideoElement>('.video-js video')!.pause());
  await expect(page.locator(PLAYER)).toHaveClass(/vjs-paused/);
  // The bar fades in; measure it once it is fully shown
  await expect(page.locator(BAR)).toBeVisible();
  await expect.poll(() => page.locator(BAR).evaluate((el) => getComputedStyle(el).opacity)).toBe('1');
}

for (const input of ['mouse', 'touch'] as const) {
  test.describe(`Release: player control bar is one row (${input})`, () => {
    if (input === 'touch') test.use({ hasTouch: true });

    for (const locale of ['en', 'ar'] as const) {
      test(`one row inside the player from 320 to 1920 px (${locale}, ${input})`, async ({ page }) => {
        test.setTimeout(240000);
        const video = await findPlayableVideo(20);
        test.skip(!video, NO_PLAYABLE_VIDEO);

        await page.setViewportSize({ width: 1280, height: HEIGHT });
        await page.goto(watchUrl(video!.id, locale));
        await showBar(page);
        if (input === 'touch') {
          // The touch rules (44px targets) are what made the bar too wide; make sure they apply
          expect(await page.evaluate(() => matchMedia('(pointer: coarse)').matches), 'touch emulation gives (pointer: coarse)').toBe(true);
        }

        const failures: string[] = [];
        for (const width of WIDTHS) {
          await page.setViewportSize({ width, height: HEIGHT });
          await settle(page);
          // Measured until two reads agree: the watch layout and the player settle over a frame or two
          let layout = await measure(page);
          await expect
            .poll(async () => {
              const next = await measure(page);
              const same = JSON.stringify(next) === JSON.stringify(layout);
              layout = next;
              return same;
            }, { message: `layout did not settle at ${width}px` })
            .toBe(true);

          const { player, bar, buttons, controls } = layout;
          const where = `${width}px (player ${Math.round(player.width)}x${Math.round(player.height)})`;
          if (buttons.length < 3) failures.push(`${where}: only ${buttons.length} buttons visible`);
          const full = buttons.filter((b) => !b.pill);
          const top = Math.min(...full.map((b) => b.box.top));
          const middle = (b: Box) => (b.top + b.bottom) / 2;
          const rowMiddle = middle(full.find((b) => b.box.top === top)!.box);
          for (const b of buttons) {
            const off = b.pill ? Math.abs(middle(b.box) - rowMiddle) : Math.abs(b.box.top - top);
            if (off > 2) failures.push(`${where}: "${b.name}" is on another row (${Math.round(off)}px off the first)`);
          }
          for (const c of controls) {
            if (c.box.left < player.left - 0.5 || c.box.right > player.right + 0.5) {
              failures.push(`${where}: "${c.name}" sticks out of the player (${Math.round(c.box.left - player.left)}..${Math.round(c.box.right - player.left)})`);
            }
            if (c.box.bottom > player.bottom + 0.5) failures.push(`${where}: "${c.name}" is below the player`);
          }
          if (bar.height > player.height / 2) {
            failures.push(`${where}: the bar covers ${Math.round((bar.height / player.height) * 100)}% of the player's height`);
          }
        }
        expect(failures, failures.join('\n')).toEqual([]);
      });
    }
  });
}
