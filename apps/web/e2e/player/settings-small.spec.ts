/**
 * The settings panel in a phone-sized player (docs/specs/VIDEO-PLAYER.md, Settings menu). On a
 * 390px phone the frame is 358 x 201 and the bar sits on one row, so there is room for barely
 * three rows above it: the panel used to sit there at 280 x 144, a scrolling sliver that covered
 * the progress bar. A small player's panel fills the frame instead, 8px in from every edge, so it
 * is one clean surface over the controls with every row in reach, never a strip half over them.
 */
import fs from 'fs';
import path from 'path';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { layoutBox, openHarness, pauseAt, PLAYER_THEMES, startPlayback, type Box } from './harness';

const TOLERANCE = 1;
const SHOTS = process.env.PLAYER_SHOTS_DIR;

async function openPaused(page: Page, opts: Parameters<typeof openHarness>[1]): Promise<Locator> {
  const player = await openHarness(page, opts);
  await startPlayback(page, player);
  await pauseAt(page, player, 20);
  return player;
}

async function openMenu(page: Page, player: Locator): Promise<Locator> {
  await player.locator('.vjs-fanous-settings').click();
  const menu = page.getByTestId('player-settings-menu');
  await expect(menu).toBeVisible();
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.mouse.move(1, 1);
  await page.waitForTimeout(350);
  return menu;
}

function expectFillsFrame(panel: Box, frame: Box) {
  expect(Math.abs(panel.x - (frame.x + 8)), `panel x ${panel.x} vs frame ${frame.x}`).toBeLessThanOrEqual(TOLERANCE);
  expect(Math.abs(panel.right - (frame.right - 8)), `panel right ${panel.right} vs frame ${frame.right}`).toBeLessThanOrEqual(TOLERANCE);
  expect(Math.abs(panel.y - (frame.y + 8)), `panel top ${panel.y} vs frame ${frame.y}`).toBeLessThanOrEqual(TOLERANCE);
  expect(Math.abs(panel.bottom - (frame.bottom - 8)), `panel bottom ${panel.bottom} vs frame ${frame.bottom}`).toBeLessThanOrEqual(TOLERANCE);
}

for (const lang of ['en', 'ar'] as const) {
  for (const theme of [undefined, ...(process.env.PLAYER_ALL_THEMES ? PLAYER_THEMES : [])]) {
    test(`phone (390px) ${lang}${theme ? ` ${theme}` : ''}: the settings panel fills the frame, every row in reach`, async ({ page }, info) => {
      await page.setViewportSize({ width: 390, height: 844 });
      // The watch page's player on a 390px phone: 16px page gutters either side
      const player = await openPaused(page, { lang, width: 358, theme });
      const menu = await openMenu(page, player);
      const frame = await layoutBox(player);
      const panel = await layoutBox(menu);
      if (SHOTS) {
        fs.mkdirSync(SHOTS, { recursive: true });
        await page.screenshot({ path: path.join(SHOTS, `${info.project.name}-${lang}-${theme ?? 'default'}.png`), clip: { x: 0, y: 0, width: 390, height: Math.ceil(frame.bottom + 16) } });
      }
      await expect(menu).toHaveAttribute('data-over-bar', '');
      expectFillsFrame(panel, frame);

      // Every root row can be scrolled into full view, at its full 44px height
      const rows = menu.locator('.vjs-fanous-mi');
      const count = await rows.count();
      // Speed, captions and shortcuts always; Quality only where the stream exposes renditions (not Safari)
      expect(count).toBeGreaterThanOrEqual(3);
      for (let i = 0; i < count; i++) {
        await rows.nth(i).scrollIntoViewIfNeeded();
        const r = await layoutBox(rows.nth(i));
        const p = await layoutBox(menu);
        expect(r.y).toBeGreaterThanOrEqual(p.y - TOLERANCE);
        expect(r.bottom).toBeLessThanOrEqual(p.bottom + TOLERANCE);
        expect(Math.abs(r.height - 44)).toBeLessThanOrEqual(TOLERANCE);
      }

      // A submenu is usable too: open Speed, pick 1.5, back on the root with the value shown
      await menu.locator('[data-row="speed"]').click();
      await expect(menu).toHaveAttribute('data-panel', 'speed');
      expectFillsFrame(await layoutBox(menu), frame);
      const option = menu.locator('[data-row="1.5"]');
      await option.scrollIntoViewIfNeeded();
      await option.click();
      await expect(menu).toHaveAttribute('data-panel', 'root');
      expect(await page.evaluate(() => (document.querySelector('video') as HTMLVideoElement).playbackRate)).toBe(1.5);

      // Escape closes it and the controls are back in reach
      await page.keyboard.press('Escape');
      await expect(menu).toBeHidden();
      await expect(player.locator('.vjs-fanous-settings')).toBeFocused();
    });
  }
}

test('desktop (1440px): the panel still sits above the bar, end-aligned, 280px wide', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const player = await openPaused(page, { lang: 'en' });
  const menu = await openMenu(page, player);
  await expect(menu).not.toHaveAttribute('data-over-bar', '');
  const panel = await layoutBox(menu);
  const progress = await layoutBox(player.locator('.vjs-progress-control'));
  expect(Math.abs(panel.width - 280)).toBeLessThanOrEqual(TOLERANCE);
  expect(panel.bottom).toBeLessThanOrEqual(progress.y + TOLERANCE);
});
