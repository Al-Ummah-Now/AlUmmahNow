import { test, expect } from './fixtures';
import type { Locator, Page } from '@playwright/test';
import { ANONYMOUS_STATE, AUTH_STATE } from './test-utils/auth-state';
import { openAccountMenu } from './test-utils/navigation';

/**
 * No menu or popup renders outside the screen (owner decision 2026-11-13; docs/design/NAV.md):
 * the header account menu (signed out and signed in), the notifications panel and the search
 * suggestions, at phone widths (320 / 375 / 414) and a landscape phone, English (LTR) and Arabic (RTL).
 * Radix menus/selects place themselves (collision handling); the hand-placed popups use
 * useFitToViewport (src/hooks/useFitToViewport.ts).
 */
const VIEWPORTS = [
  { width: 320, height: 640 },
  { width: 375, height: 667 },
  { width: 414, height: 896 },
  { width: 844, height: 390 },
] as const;
const LOCALES = ['en', 'ar'] as const;

async function expectInViewport(page: Page, popup: Locator, what: string) {
  await expect(popup, what).toBeVisible();
  await page.waitForTimeout(150);
  const box = (await popup.boundingBox())!;
  const vp = page.viewportSize()!;
  expect.soft(box.x, `${what}: left edge`).toBeGreaterThanOrEqual(-1);
  expect.soft(box.y, `${what}: top edge`).toBeGreaterThanOrEqual(-1);
  expect.soft(box.x + box.width, `${what}: right edge`).toBeLessThanOrEqual(vp.width + 1);
  expect.soft(box.y + box.height, `${what}: bottom edge`).toBeLessThanOrEqual(vp.height + 1);
  expect.soft(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), `${what}: page scrolls sideways`).toBeLessThanOrEqual(0);
}

test.describe('Menus stay inside the viewport - signed out', () => {
  test.use({ storageState: ANONYMOUS_STATE });
  test.skip(({ isMobile }) => isMobile, 'viewports are set per test');

  for (const vp of VIEWPORTS) {
    for (const locale of LOCALES) {
      test(`MENU-VP-001 ${vp.width}×${vp.height} ${locale}: account menu and search suggestions`, async ({ page }) => {
        await page.setViewportSize(vp);
        await page.goto(`/${locale}`);
        const menu = await openAccountMenu(page);
        await expectInViewport(page, menu, 'account menu (signed out)');
        await page.keyboard.press('Escape');
        await expect(menu).toBeHidden();

        // The search page's own box shows below 640px (sm:hidden); wider, the header's box is the one
        await page.goto(`/${locale}/search`);
        const box = page.locator('[data-testid="search-input"]:visible, [data-testid="header-search-input"]:visible').first();
        await expect(box).toBeVisible();
        await box.click();
        await box.fill(locale === 'ar' ? 'ص' : 'a');
        const popup = page.locator('[data-testid="search-dropdown"]:visible').first();
        if (await popup.isVisible({ timeout: 5000 }).catch(() => false)) await expectInViewport(page, popup, 'search suggestions');
      });
    }
  }
});

test.describe('Menus stay inside the viewport - signed in', () => {
  test.use({ storageState: AUTH_STATE.single });
  test.skip(({ isMobile }) => isMobile, 'viewports are set per test');

  for (const vp of VIEWPORTS) {
    for (const locale of LOCALES) {
      test(`MENU-VP-002 ${vp.width}×${vp.height} ${locale}: account menu and notifications`, async ({ page }) => {
        await page.setViewportSize(vp);
        await page.goto(`/${locale}`);
        const menu = await openAccountMenu(page);
        await expectInViewport(page, menu, 'account menu');
        await page.keyboard.press('Escape');
        await expect(menu).toBeHidden();

        const bell = page.getByTestId('notification-bell');
        if (await bell.isVisible()) {
          await bell.click();
          await expectInViewport(page, page.getByTestId('notification-dropdown'), 'notifications');
          await page.keyboard.press('Escape');
        }
      });
    }
  }
});
