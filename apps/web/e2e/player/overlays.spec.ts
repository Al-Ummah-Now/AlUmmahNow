/**
 * No page content ever draws over a player overlay (docs/specs/VIDEO-PLAYER.md section 5, Layers),
 * in every browser, left to right and right to left. The owner's report: the shortcuts dialog was
 * drawn under the related thumbnails, the Share button and the site header.
 *
 * Each overlay is probed with `elementFromPoint` on a grid over its box, twice: as the page is, and
 * with decoys laid over that box at the strongest stacking the page itself uses (a fixed element at
 * the consent banner's z-index 60, and a transformed element at the header's z-index 50). Every
 * point must land on the overlay. Dialogs must also cover the real header and related column with
 * their scrim. The shortcuts dialog's layout (centred, two columns, compact rows, unclipped key
 * chips, the X and Escape only) and the caption style dialog are checked here too.
 */
import { expect, test, type Locator, type Page } from '@playwright/test';
import { layoutBox, openHarness, pauseAt, startPlayback } from './harness';

const TOLERANCE = 1;

interface Miss { x: number; y: number; hit: string }

/** Points on a grid over the target that land on something other than the target */
async function occlusion(target: Locator, { decoys, grid = 5 }: { decoys: boolean; grid?: number }): Promise<Miss[]> {
  return target.evaluate((el, { decoys, grid }) => {
    const r = el.getBoundingClientRect();
    const made: HTMLElement[] = [];
    if (decoys) {
      for (const kind of ['fixed', 'transformed'] as const) {
        const d = document.createElement('div');
        d.setAttribute('data-occlusion-decoy', kind);
        Object.assign(d.style, {
          position: kind === 'fixed' ? 'fixed' : 'absolute',
          left: `${r.left + (kind === 'fixed' ? 0 : window.scrollX)}px`,
          top: `${r.top + (kind === 'fixed' ? 0 : window.scrollY)}px`,
          width: `${r.width}px`,
          height: `${r.height}px`,
          zIndex: kind === 'fixed' ? '60' : '50',
          transform: kind === 'transformed' ? 'translateZ(0)' : '',
          background: 'rgb(255 0 0 / 0.02)',
        });
        document.body.appendChild(d);
        made.push(d);
      }
    }
    // A tooltip ignores the pointer; probe what is painted, not what takes clicks
    const own = el as HTMLElement;
    const pe = own.style.pointerEvents;
    own.style.pointerEvents = 'auto';
    // Hit testing follows border-radius: keep the corner points inside the curve (0.29 of the radius in)
    const radius = Math.min(parseFloat(getComputedStyle(el).borderTopLeftRadius) || 0, r.width / 2, r.height / 2);
    const inset = 3 + radius * 0.3;
    const misses: { x: number; y: number; hit: string }[] = [];
    for (let i = 0; i < grid; i++) {
      for (let j = 0; j < grid; j++) {
        const x = r.left + inset + ((r.width - inset * 2) * i) / (grid - 1);
        const y = r.top + inset + ((r.height - inset * 2) * j) / (grid - 1);
        if (x < 0 || y < 0 || x >= innerWidth || y >= innerHeight) continue;
        const hit = document.elementFromPoint(x, y);
        if (!hit || !(hit === el || el.contains(hit))) {
          misses.push({ x: Math.round(x), y: Math.round(y), hit: hit ? `${hit.tagName.toLowerCase()}.${String(hit.className).split(' ').slice(0, 2).join('.')}${hit.getAttribute('data-occlusion-decoy') ? '[decoy]' : ''}` : 'nothing' });
        }
      }
    }
    own.style.pointerEvents = pe;
    made.forEach((d) => d.remove());
    return misses;
  }, { decoys, grid });
}

async function expectOnTop(target: Locator, what: string, grid = 5) {
  await expect(target).toBeVisible();
  expect(await occlusion(target, { decoys: false, grid }), `${what}: covered by the page`).toEqual([]);
  expect(await occlusion(target, { decoys: true, grid }), `${what}: covered by page content at z-index 50-60`).toEqual([]);
}

/** The point at an element's centre lands inside a player layer */
async function coveredByLayer(page: Page, target: Locator) {
  const b = await layoutBox(target);
  return page.evaluate(({ x, y }) => !!document.elementFromPoint(x, y)?.closest('[data-player-layer]'), { x: b.cx, y: Math.max(1, b.cy) });
}

async function openPausedPlayer(page: Page, lang: 'en' | 'ar', opts: { width?: number } = {}) {
  const player = await openHarness(page, { lang, width: opts.width });
  await startPlayback(page, player);
  await pauseAt(page, player, 20);
  await page.mouse.move(2, 2);
  return player;
}

async function openSettings(page: Page, player: Locator) {
  await player.locator('.vjs-fanous-settings').click();
  const menu = page.getByTestId('player-settings-menu');
  await expect(menu).toBeVisible();
  await page.waitForTimeout(300);
  return menu;
}

for (const lang of ['en', 'ar'] as const) {
  const dir = lang === 'ar' ? 'rtl' : 'ltr';

  test.describe(`player overlays (${dir})`, () => {
    test('settings menu and submenus sit above the page, over the frame', async ({ page }) => {
      const player = await openPausedPlayer(page, lang);
      const menu = await openSettings(page, player);
      // Portalled out of the clipped frame, but placed over it above the bar
      expect(await menu.evaluate((el) => el.closest('.video-js') === null && el.parentElement === document.body)).toBe(true);
      const frame = await layoutBox(player);
      const box = await layoutBox(menu);
      const progress = await layoutBox(player.locator('.vjs-progress-control'));
      expect(box.right).toBeLessThanOrEqual(frame.right + TOLERANCE);
      expect(box.x).toBeGreaterThanOrEqual(frame.x - TOLERANCE);
      expect(box.y).toBeGreaterThanOrEqual(frame.y - TOLERANCE);
      expect(box.bottom).toBeLessThanOrEqual(progress.y + TOLERANCE);
      await expectOnTop(menu, 'settings menu');
      // Every root row shows in full, with no scrolling, inside the panel's padding
      expect(await menu.evaluate((el) => el.scrollHeight - el.clientHeight), 'root menu scrolls').toBeLessThanOrEqual(0);
      const last = await layoutBox(menu.locator('[data-row]').last());
      expect(last.bottom, 'last row clipped').toBeLessThanOrEqual(box.bottom - 6 + TOLERANCE);
      await menu.locator('[data-row="speed"]').click();
      await page.waitForTimeout(300);
      await expectOnTop(menu, 'speed submenu');
      // It keeps its place over the frame when the page scrolls under it
      const offset = { x: box.right - frame.right, y: box.bottom - frame.bottom };
      await page.evaluate(() => window.scrollBy(0, 120));
      await page.waitForTimeout(200);
      const scrolled = await layoutBox(player);
      expect(scrolled.y, 'the page scrolled').toBeLessThan(frame.y - 50);
      const moved = await layoutBox(menu);
      near(moved.right - scrolled.right, offset.x, 'menu keeps its inline place over the frame after scroll');
      near(moved.bottom - scrolled.bottom, offset.y, 'menu keeps its place above the bar after scroll');
    });

    test('the progress tooltip (time and chapter) sits above the page', async ({ page }) => {
      const player = await openPausedPlayer(page, lang);
      const holder = await layoutBox(player.locator('.vjs-progress-holder'));
      await page.mouse.move(holder.x + holder.width * 0.5, holder.cy);
      const tip = page.getByTestId('player-progress-tooltip');
      await expect(tip).toBeVisible();
      // 0:45 of 1:30 is in the second chapter
      await expect(tip).toContainText('The middle');
      await expect(tip).toContainText(/0:4[45]/);
      expect(await tip.evaluate((el) => el.closest('.video-js') === null)).toBe(true);
      const box = await layoutBox(tip);
      expect(box.bottom).toBeLessThanOrEqual(holder.y + TOLERANCE);
      near(box.cx, holder.x + holder.width * 0.5, 'tooltip centred on the pointer');
      await expectOnTop(tip, 'progress tooltip', 3);
      // Near the edge it stays inside the frame
      await page.mouse.move(holder.x + 2, holder.cy);
      const frame = await layoutBox(player);
      expect((await layoutBox(tip)).x).toBeGreaterThanOrEqual(frame.x);
      await page.mouse.move(2, 2);
      await expect(tip).toBeHidden();
    });

    test('keyboard shortcuts: a centred two-column dialog over a scrim, above the header and related column', async ({ page }) => {
      const player = await openPausedPlayer(page, lang);
      const menu = await openSettings(page, player);
      await menu.locator('[data-row="shortcuts"]').click();
      const dialog = page.getByTestId('player-shortcuts-dialog');
      await expect(dialog).toBeVisible();
      await page.waitForTimeout(200);
      await expectOnTop(dialog, 'shortcuts dialog');
      // The scrim covers the page: header and related column included
      await expect.poll(() => coveredByLayer(page, page.locator('header').first())).toBe(true);
      await expect.poll(() => coveredByLayer(page, page.locator('[data-testid="watch-layout"] aside').first())).toBe(true);
      // Centred in the viewport
      const viewport = page.viewportSize()!;
      const box = await layoutBox(dialog);
      near(box.cx, viewport.width / 2, 'dialog centred horizontally');
      near(box.cy, viewport.height / 2, 'dialog centred vertically');
      // Two columns of groups at desktop width
      const starts = new Set<number>();
      for (const s of await dialog.locator('.vjs-fanous-shortcuts-group').all()) starts.add(Math.round((await layoutBox(s)).x));
      expect(starts.size).toBe(2);
      // Compact rows, each with its key chips on the label's line, nothing clipped
      const body = await layoutBox(dialog.locator('.vjs-fanous-shortcuts-body'));
      const rows = dialog.getByTestId('player-shortcut-row');
      const count = await rows.count();
      expect(count).toBeGreaterThanOrEqual(20);
      for (let i = 0; i < count; i++) {
        const row = rows.nth(i);
        await row.scrollIntoViewIfNeeded();
        const r = await layoutBox(row);
        expect(r.height, `row ${i} is compact`).toBeLessThanOrEqual(40);
        const chips = row.locator('kbd');
        expect(await chips.count(), `row ${i} has a key chip`).toBeGreaterThan(0);
        for (const chip of await chips.all()) {
          const c = await layoutBox(chip);
          near(c.cy, r.cy, `row ${i} chip on the label's line`);
          expect(c.x, `row ${i} chip inside the dialog`).toBeGreaterThanOrEqual(body.x - TOLERANCE);
          expect(c.right, `row ${i} chip inside the dialog`).toBeLessThanOrEqual(body.right + TOLERANCE);
          expect(await chip.evaluate((el) => el.scrollWidth - el.clientWidth), `row ${i} chip text clipped`).toBeLessThanOrEqual(0);
          const hit = await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.closest('kbd') !== null, { x: c.cx, y: c.cy });
          expect(hit, `row ${i} chip visible`).toBe(true);
        }
      }
      // The X is the only button; the scrim does not close it; Escape does
      await expect(dialog.getByRole('button')).toHaveCount(1);
      await expect(dialog.getByTestId('player-shortcuts-close')).toBeFocused();
      await page.mouse.click(4, viewport.height - 4);
      await expect(dialog).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(dialog).toBeHidden();
      // Reopen with ? and close with the X
      await player.evaluate((el) => (el as HTMLElement).focus());
      await page.keyboard.press('Shift+Slash');
      await expect(dialog).toBeVisible();
      await dialog.getByTestId('player-shortcuts-close').click();
      await expect(dialog).toBeHidden();
    });

    test('keyboard shortcuts at phone width: one column that fits', async ({ page }) => {
      await page.setViewportSize({ width: 390, height: 844 });
      const player = await openPausedPlayer(page, lang, { width: 360 });
      await player.evaluate((el) => (el as HTMLElement).focus());
      await page.keyboard.press('Shift+Slash');
      const dialog = page.getByTestId('player-shortcuts-dialog');
      await expect(dialog).toBeVisible();
      await expectOnTop(dialog, 'shortcuts dialog (phone)');
      const box = await layoutBox(dialog);
      expect(box.x).toBeGreaterThanOrEqual(16 - TOLERANCE);
      expect(box.right).toBeLessThanOrEqual(390 - 16 + TOLERANCE);
      const starts = new Set<number>();
      for (const s of await dialog.locator('.vjs-fanous-shortcuts-group').all()) starts.add(Math.round((await layoutBox(s)).x));
      expect(starts.size).toBe(1);
    });

    test('caption style opens as a dialog above the page and returns to the player', async ({ page }) => {
      const player = await openPausedPlayer(page, lang);
      const menu = await openSettings(page, player);
      await menu.locator('[data-row="captions"]').click();
      await menu.locator('[data-row="extra"]').click();
      const layer = page.getByTestId('player-caption-style-layer');
      const dialog = layer.locator('.vjs-text-track-settings');
      await expect(dialog).toBeVisible();
      expect(await layer.evaluate((el) => el.closest('.video-js') === null)).toBe(true);
      await expectOnTop(dialog, 'caption style dialog');
      await expect.poll(() => coveredByLayer(page, page.locator('header').first())).toBe(true);
      const viewport = page.viewportSize()!;
      near((await layoutBox(dialog)).cx, viewport.width / 2, 'caption style centred');
      await page.keyboard.press('Escape');
      await expect(layer).toHaveCount(0);
      expect(await player.evaluate((el) => !!el.querySelector('.vjs-text-track-settings'))).toBe(true);
    });

    test('in fullscreen the menu and dialogs open inside the fullscreen element', async ({ page }) => {
      const player = await openPausedPlayer(page, lang);
      await player.hover();
      await player.locator('.vjs-fullscreen-control').click();
      await expect(player).toHaveClass(/vjs-fullscreen|vjs-full-window/);
      await page.waitForTimeout(300);
      const menu = await openSettings(page, player);
      const inside = () => page.evaluate(() => {
        const fs = document.fullscreenElement ?? (document as Document & { webkitFullscreenElement?: Element }).webkitFullscreenElement;
        const layer = document.querySelector('[data-player-layer]');
        // Real fullscreen: the layer is inside the fullscreen element; full-window mode: on the body above the fixed player
        return fs ? !!layer && fs.contains(layer) : layer?.parentElement === document.body;
      });
      expect(await inside()).toBe(true);
      await expectOnTop(menu, 'settings menu (fullscreen)');
      await menu.locator('[data-row="shortcuts"]').click();
      const dialog = page.getByTestId('player-shortcuts-dialog');
      await expect(dialog).toBeVisible();
      expect(await inside()).toBe(true);
      await expectOnTop(dialog, 'shortcuts dialog (fullscreen)');
    });

    // These are part of the frame, so content laid over the player covers them with it; what
    // matters is that nothing in the frame or the page draws over them
    test('in-frame overlays (end screen, start over) are not covered by the page', async ({ page }) => {
      const player = await openHarness(page, { lang, resumeAt: 40 });
      const pill = page.getByTestId('player-start-over');
      await expect(pill).toBeVisible();
      expect(await occlusion(pill, { decoys: false, grid: 3 })).toEqual([]);
      await startPlayback(page, player);
      await page.mouse.move(2, 2);
      await page.evaluate(() => { const v = document.querySelector<HTMLVideoElement>('.video-js video')!; v.currentTime = v.duration - 0.4; });
      const end = page.getByTestId('player-end-screen');
      await expect(end).toBeVisible({ timeout: 20_000 });
      await page.getByTestId('player-next-thumb').hover();
      expect(await occlusion(end.locator('.vjs-fanous-next-card'), { decoys: false })).toEqual([]);
    });
  });
}

function near(actual: number, expected: number, what: string) {
  expect(Math.abs(actual - expected), `${what}: ${actual.toFixed(2)} vs ${expected.toFixed(2)}`).toBeLessThanOrEqual(TOLERANCE);
}
