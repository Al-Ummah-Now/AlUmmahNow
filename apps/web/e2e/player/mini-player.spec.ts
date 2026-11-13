/**
 * The mini player is really on screen while the page scrolls (owner, 2026-11-13: "when I scroll,
 * the player disappears", with Shorts). For a 16:9 video and a vertical one, at desktop and tablet
 * widths (below 1024px the site's tab bar is fixed at the bottom of the page): scroll while
 * playing, then the floating player must be inside the viewport, not covered by anything (its
 * centre and its control bar are the topmost element there) and painting a moving picture.
 */
import { expect, test, type Page } from '@playwright/test';
import { openHarness, pixels, startPlayback } from './harness';

/** What the browser hit-tests at a point belongs to the player */
const playerOnTop = (page: Page, x: number, y: number) =>
  page.evaluate(([px, py]) => !!document.elementFromPoint(px, py)?.closest('.video-js'), [x, y] as const);

for (const src of ['bright', 'short'] as const) {
  for (const [form, width, height] of [['desktop', 1280, 800], ['tablet', 820, 760]] as const) {
    test(`${src === 'short' ? 'vertical' : '16:9'} video, ${form}: scrolling while playing keeps the player on screen`, async ({ page }) => {
      await page.setViewportSize({ width, height });
      const player = await openHarness(page, { src });
      // Room to scroll the frame well away
      await page.evaluate(() => {
        const spacer = document.createElement('div');
        spacer.style.height = '3000px';
        spacer.setAttribute('data-testid', 'scroll-spacer');
        document.body.appendChild(spacer);
      });
      await startPlayback(page, player);
      // Scrolled in steps (the side column is below the fold at tablet widths, and Firefox drops
      // wheel events sent to a point outside the viewport)
      for (let i = 0; i < 12; i++) {
        await page.evaluate(() => window.scrollBy(0, 150));
        await page.waitForTimeout(40);
      }
      const wrapper = page.locator('.custom-video-player').first();
      await expect(wrapper).toHaveAttribute('data-mini');
      if (src === 'short') await expect(wrapper).toHaveAttribute('data-portrait');

      const box = (await player.boundingBox())!;
      expect(box.width).toBeGreaterThan(100);
      expect(box.height).toBeGreaterThan(100);
      // A vertical video floats in a portrait box, not as a strip in a 16:9 one
      if (src === 'short') expect(box.height).toBeGreaterThan(box.width);
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.y).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(width);
      expect(box.y + box.height).toBeLessThanOrEqual(height);

      // Nothing covers it: its centre and its control bar (above the tab bar on tablets)
      await player.hover();
      expect(await playerOnTop(page, box.x + box.width / 2, box.y + box.height / 2)).toBe(true);
      const controls = (await player.locator('.vjs-control-bar').boundingBox())!;
      expect(controls.y + controls.height).toBeLessThanOrEqual(height);
      expect(await playerOnTop(page, controls.x + controls.width / 2, controls.y + controls.height / 2)).toBe(true);
      // One row of buttons, however narrow the floating box
      const rows = await player.locator('.vjs-control-bar .vjs-control.vjs-button:visible').evaluateAll((els) => new Set(els.map((e) => Math.round(e.getBoundingClientRect().top / 8))).size);
      expect(rows).toBe(1);

      // Painting: the media plays on and the frame inside the box is not one flat colour
      const t0 = await page.evaluate(() => document.querySelector<HTMLVideoElement>('.video-js video')!.currentTime);
      await expect.poll(() => page.evaluate(() => document.querySelector<HTMLVideoElement>('.video-js video')!.currentTime)).toBeGreaterThan(t0 + 0.3);
      await page.mouse.move(1, 1);
      const shot = await pixels(page, { x: box.x + 8, y: box.y + 8, width: box.width - 16, height: Math.min(box.height / 2, box.height - 16) });
      const seen = new Set<string>();
      for (let y = 0; y < shot.h; y += 6) for (let x = 0; x < shot.w; x += 6) seen.add(shot.at(x, y).map((c) => c >> 4).join(','));
      expect(seen.size).toBeGreaterThan(3);
    });
  }
}
