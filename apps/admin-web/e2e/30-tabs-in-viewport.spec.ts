/**
 * Admin tab rows are one row (owner, #1669; components/PriorityTabs): as many tabs as fit, the rest
 * under "More ▾" / «المزيد ▾» at the row's end, the current tab always in the row, nothing cut at
 * an edge and nothing wrapped. At 360 and 390 px, English and Arabic: Payments, Operations, Tier
 * requests and App config. Choosing a tab under More opens it, and it is in the row. Read-only: it opens the pages as a super admin and changes nothing.
 */
import type { Page } from '@playwright/test';
import { test, expect } from './support/fixtures';
import { storageStatePath } from './support/env';
import { setPreferences } from './support/ui';

test.use({ storageState: storageStatePath('superadmin') });

const VIEWPORTS = [
  { width: 360, height: 780 },
  { width: 390, height: 844 },
] as const;

const STRIPS = [
  { path: '/payments', nav: 'payments-tabs', prefix: 'payments-tab-', ids: ['providers', 'prices', 'tax', 'subscriptions'] },
  { path: '/operations', nav: 'ops-tabs', prefix: 'ops-tab-', ids: ['worker', 'd1', 'r2', 'queue', 'kv', 'do'] },
  { path: '/tier-requests', nav: 'tier-requests-tabs', prefix: 'tier-requests-tab-', ids: ['pending', 'approved', 'declined', 'all'] },
  // Buttons, not links: the current document's tab is pressed
  { path: '/app-config', nav: 'app-config-tabs', prefix: 'app-config-tab-', ids: ['flags', 'config', 'versions'] },
] as const;

/** The row's tabs (id + box), the More button's box and the menu's ids; the menu is closed again */
async function readStrip(page: Page, nav: string, prefix: string) {
  const strip = page.getByTestId(nav);
  await expect(strip).toBeVisible();
  await expect(strip).not.toHaveAttribute('data-measuring', /.*/);
  const row = await strip.locator(`[data-testid^="${prefix}"]`).evaluateAll((els, p) => els.map((e) => {
    const r = e.getBoundingClientRect();
    return { id: (e.getAttribute('data-testid') ?? '').slice(p.length), top: Math.round(r.top), left: r.left, right: r.right, current: e.getAttribute('aria-current') === 'page' || e.getAttribute('aria-pressed') === 'true' };
  }), prefix);
  const more = page.getByTestId(`${nav}-more`);
  let menu: string[] = [];
  let moreBox: { x: number; width: number } | null = null;
  if (await more.isVisible()) {
    moreBox = await more.boundingBox();
    await more.click();
    const entries = page.locator(`[data-testid^="${nav}-menu-"]`);
    await expect(entries.first()).toBeVisible();
    menu = await entries.evaluateAll((els, p) => els.map((e) => (e.getAttribute('data-testid') ?? '').slice(p.length)), `${nav}-menu-`);
    await page.keyboard.press('Escape');
    await expect(entries.first()).toBeHidden();
    await expect(more).toBeFocused();
  }
  return { row, menu, moreBox };
}

function expectStrip(what: string, width: number, strip: Awaited<ReturnType<typeof readStrip>>, ids: readonly string[]) {
  expect(strip.row.length, `${what}: tabs in the row`).toBeGreaterThan(0);
  expect(new Set(strip.row.map((t) => t.top)).size, `${what}: one row`).toBe(1);
  for (const t of strip.row) expect(t.left >= -1 && t.right <= width + 1, `${what}: ${t.id} ${Math.round(t.left)}..${Math.round(t.right)} inside 0..${width}`).toBe(true);
  if (strip.moreBox) expect(strip.moreBox.x >= -1 && strip.moreBox.x + strip.moreBox.width <= width + 1, `${what}: More inside the window`).toBe(true);
  expect([...strip.row.map((t) => t.id), ...strip.menu].sort(), `${what}: row + More = every tab`).toEqual([...ids].sort());
  expect(strip.row.some((t) => t.current), `${what}: the current tab is in the row`).toBe(true);
}

test.describe('tab rows on phones', () => {
  test.skip(({ isMobile }) => isMobile, 'viewports are set per test');

  for (const vp of VIEWPORTS) {
    for (const locale of ['en', 'ar'] as const) {
      test(`TABS-VP ${vp.width}px ${locale}: Payments, Operations, Tier requests, App config`, async ({ page }) => {
        await page.setViewportSize(vp);
        await setPreferences(page, { locale });
        for (const { path, nav, prefix, ids } of STRIPS) {
          await page.goto(path);
          await page.evaluate(() => document.fonts.ready);
          const what = `${path} ${vp.width}px ${locale}`;
          const first = await readStrip(page, nav, prefix);
          expectStrip(what, vp.width, first, ids);
          expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), `${what}: the page scrolls sideways`).toBeLessThanOrEqual(0);
          // A tab under More opens and then sits in the row as the current one
          if (first.menu.length) {
            const id = first.menu[first.menu.length - 1];
            await page.getByTestId(`${nav}-more`).click();
            await page.getByTestId(`${nav}-menu-${id}`).click();
            await expect(page.getByTestId(`${prefix}${id}`)).toHaveAttribute(nav === 'app-config-tabs' ? 'aria-pressed' : 'aria-current', nav === 'app-config-tabs' ? 'true' : 'page');
            await expect(page.getByTestId(`${prefix}${id}`), `${what}: ${id} has the focus after choosing it`).toBeFocused();
            // Picked with the pointer: the current style shows it, no keyboard focus ring
            expect(await page.getByTestId(`${prefix}${id}`).evaluate((el) => el.hasAttribute('data-pointer-focus') || !el.matches(':focus-visible')), `${what}: no focus ring after a pointer pick`).toBe(true);
            expectStrip(`${what}, ${id} chosen`, vp.width, await readStrip(page, nav, prefix), ids);
          }
        }
      });
    }
  }
});
