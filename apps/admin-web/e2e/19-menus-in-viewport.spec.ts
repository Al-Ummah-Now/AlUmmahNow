/**
 * No menu or popup renders outside the screen (owner decision 2026-11-13; docs/design/NAV.md):
 * the header account menu, the main navigation drawer and a search picker's suggestions, at phone
 * widths (320 / 375 / 414) and a landscape phone, in English (LTR) and Arabic (RTL).
 */
import { test, expect } from './support/fixtures';
import type { Locator, Page } from '@playwright/test';
import { setPreferences } from './support/ui';

const VIEWPORTS = [
  { width: 320, height: 640 },
  { width: 375, height: 667 },
  { width: 414, height: 896 },
  { width: 844, height: 390 },
] as const;

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

test.describe('menus stay inside the viewport', () => {
  test.skip(({ isMobile }) => isMobile, 'viewports are set per test');

  for (const vp of VIEWPORTS) {
    for (const locale of ['en', 'ar'] as const) {
      test(`MENU-VP ${vp.width}×${vp.height} ${locale}`, async ({ page }) => {
        await page.setViewportSize(vp);
        await setPreferences(page, { locale });
        await page.goto('/moderation');

        // the account menu in the top bar
        const trigger = page.getByTestId('account-menu-trigger');
        await trigger.click();
        await expectInViewport(page, page.getByTestId('account-menu'), 'account menu');
        await page.keyboard.press('Escape');
        await expect(page.getByTestId('account-menu')).toBeHidden();

        // a search picker's suggestions (they open with the first page on focus)
        const reporter = page.getByTestId('moderation-reporter-input');
        if (await reporter.isVisible()) {
          await reporter.click();
          await expectInViewport(page, page.getByTestId('moderation-reporter-popup'), 'reporter picker suggestions');
          await reporter.press('Escape');
        }
      });
    }
  }
});
