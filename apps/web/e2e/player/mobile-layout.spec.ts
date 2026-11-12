/**
 * Owner bug: "on mobile with wide, foldable screen, it's always theater mode, even when not
 * selected." The layout follows the viewport width only: the related column sits beside the player
 * from 1024px; below that the page stacks. Below 1024px the theatre layout used to be that same
 * stacked page, so an unfolded foldable (or a tablet) always looked like theatre and the toggle did
 * nothing. Theatre below 1024px is now the edge-to-edge player (no gutter, square corners); off is
 * the normal page with its gutter and rounded corners (theme/system.css).
 *
 * For a Galaxy Z Fold 5 (folded, unfolded, unfolded landscape), a Surface Duo (one screen and both)
 * and a tablet in landscape: theatre off is the normal layout for the width, the button says off,
 * the toggle switches the layouts and is remembered, and folding or unfolding (a resize) re-applies
 * the layout live. Runs in the mobile projects.
 */
import { test, expect, devices, type Locator, type Page } from '@playwright/test';
import { openHarness } from './harness';

const SIDE_COLUMN_FROM = 1024;
const PRESETS = {
  'galaxy-z-fold-5 folded': { width: 344, height: 882 },
  'galaxy-z-fold-5 unfolded': { width: 884, height: 1104 },
  'galaxy-z-fold-5 unfolded landscape': { width: 1104, height: 884 },
  'surface-duo one screen': { width: 540, height: 720 },
  'surface-duo spanned': { width: 1114, height: 720 },
  'tablet landscape (Galaxy Tab S9)': devices['Galaxy Tab S9 landscape'].viewport,
} as const;

interface Layout { theatreAttr: boolean; pressed: string | null; buttonShown: boolean; viewport: number; contentWidth: number; playerLeft: number; playerWidth: number; radius: number; asideBeside: boolean }

function layout(page: Page): Promise<Layout> {
  return page.evaluate(() => {
    const p = document.querySelector('.video-js.vjs-fanous')!;
    const r = p.getBoundingClientRect();
    const aside = document.querySelector('[data-testid="harness-aside"]')!.getBoundingClientRect();
    const btn = document.querySelector('.vjs-fanous-theatre');
    return {
      theatreAttr: document.querySelector('[data-testid="watch-layout"]')!.hasAttribute('data-theatre'),
      pressed: btn?.getAttribute('aria-pressed') ?? null,
      buttonShown: !!btn && getComputedStyle(btn).display !== 'none' && btn.getBoundingClientRect().width > 0,
      viewport: document.documentElement.clientWidth,
      // From 1024px the site's side rail takes the start of the page: the content is the harness's main
      contentWidth: document.querySelector('[data-testid="player-harness"]')!.clientWidth,
      playerLeft: Math.round(r.left),
      playerWidth: Math.round(r.width),
      radius: parseFloat(getComputedStyle(p).borderTopLeftRadius) || 0,
      asideBeside: aside.top < r.bottom - 1,
    };
  });
}

/** Theatre off: the normal layout for this width */
function expectNormal(g: Layout): void {
  expect(g.theatreAttr).toBe(false);
  if (g.pressed !== null) expect(g.pressed).toBe('false');
  if (g.viewport >= SIDE_COLUMN_FROM) {
    expect(g.asideBeside, 'related column beside the player').toBe(true);
  } else {
    expect(g.asideBeside).toBe(false);
    expect(g.playerLeft, 'the page gutter, not edge to edge').toBeGreaterThanOrEqual(12);
    expect(g.playerWidth).toBeLessThan(g.viewport - 20);
    expect(g.radius, 'rounded corners').toBeGreaterThan(0);
  }
}

/** Theatre on: the player spans the content (edge to edge below 1024px), related below */
function expectTheatre(g: Layout): void {
  expect(g.theatreAttr).toBe(true);
  expect(g.pressed).toBe('true');
  expect(g.asideBeside).toBe(false);
  expect(g.radius).toBe(0);
  if (g.viewport < SIDE_COLUMN_FROM) {
    expect(g.playerLeft).toBe(0);
    expect(g.playerWidth).toBe(g.viewport);
  } else {
    expect(g.playerWidth).toBeGreaterThanOrEqual(0.95 * (g.contentWidth - 32));
  }
}

async function readyPaused(page: Page, player: Locator): Promise<void> {
  const big = await player.locator('.vjs-big-play-button').boundingBox();
  await page.touchscreen.tap(big!.x + big!.width / 2, big!.y + big!.height / 2);
  await expect(player).toHaveClass(/vjs-has-started/);
  await page.evaluate(() => document.querySelector<HTMLVideoElement>('.video-js video')!.pause());
  await expect.poll(() => page.evaluate(() => document.querySelector<HTMLVideoElement>('.video-js video')!.paused)).toBe(true);
}

async function tapTheatre(page: Page, player: Locator): Promise<void> {
  const btn = player.locator('.vjs-control-bar .vjs-fanous-theatre');
  await expect(btn).toBeVisible();
  const b = (await btn.boundingBox())!;
  await page.touchscreen.tap(b.x + b.width / 2, b.y + b.height / 2);
}

for (const [name, size] of Object.entries(PRESETS)) {
  test(`theatre off is the normal layout and the toggle switches it (${name}, ${size.width}x${size.height})`, async ({ page }) => {
    await page.setViewportSize(size);
    const player = await openHarness(page, { lang: 'en' });
    await readyPaused(page, player);
    const normal = await layout(page);
    expectNormal(normal);
    if (!normal.buttonShown) return; // a player under 440px has no theatre button: nothing to toggle

    await tapTheatre(page, player);
    await expect.poll(async () => { try { expectTheatre(await layout(page)); return true; } catch { return false; } }).toBe(true);
    expect(await page.evaluate(() => localStorage.getItem('aun.player.theatre'))).toBe('1');

    await tapTheatre(page, player);
    await expect.poll(async () => { try { expectNormal(await layout(page)); return true; } catch { return false; } }).toBe(true);
    expect(await page.evaluate(() => localStorage.getItem('aun.player.theatre'))).toBe('0');
  });
}

test('folding and unfolding re-applies the layout live; theatre stays as chosen', async ({ page }) => {
  await page.setViewportSize(PRESETS['galaxy-z-fold-5 unfolded landscape']);
  const player = await openHarness(page, { lang: 'ar' });
  await readyPaused(page, player);
  for (const size of [PRESETS['galaxy-z-fold-5 unfolded'], PRESETS['galaxy-z-fold-5 folded'], PRESETS['galaxy-z-fold-5 unfolded landscape']]) {
    await page.setViewportSize(size);
    await expect.poll(async () => { try { expectNormal(await layout(page)); return true; } catch { return false; } }, { message: `normal at ${size.width}px` }).toBe(true);
  }
  await tapTheatre(page, player);
  for (const size of [PRESETS['galaxy-z-fold-5 unfolded'], PRESETS['galaxy-z-fold-5 unfolded landscape']]) {
    await page.setViewportSize(size);
    await expect.poll(async () => { try { expectTheatre(await layout(page)); return true; } catch { return false; } }, { message: `theatre at ${size.width}px` }).toBe(true);
  }
});
