import { expect, type Page } from '@playwright/test';

/**
 * Clicks a first-level item of the videos header's account menu (Add account,
 * Sign out...). Opens the menu, or steps back out of a submenu (accounts,
 * channels), until the item shows.
 */
export async function clickAccountMenuItem(page: Page, testId: string): Promise<void> {
  const item = page.locator(`[data-testid="${testId}"]:visible`).first();
  await expect(async () => {
    if (!(await item.isVisible())) {
      const back = page.locator('[data-testid="nav-menu-back"]:visible').first();
      if (await back.isVisible()) await back.click();
      else await page.locator('[data-testid="nav-menu-trigger"]:visible').first().click();
    }
    await expect(item).toBeVisible({ timeout: 3000 });
  }).toPass({ timeout: 30000 });
  await item.click();
}
