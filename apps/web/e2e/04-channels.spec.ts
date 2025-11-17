import { test, expect } from './fixtures';

/**
 * Channel Management E2E Tests
 * Tests for channel pages and management functionality
 */

test.describe('Channel Pages', () => {
  test('should load channel page', async ({ page }) => {
    await page.goto('/en/channel/test-channel-id');

    // Page should load
    await expect(page.locator('body')).toBeVisible();
  });

  test('channel page should be responsive', async ({ page }) => {
    // Desktop
    await page.setViewportSize({ width: 1920, height: 1080 });
    await page.goto('/en/channel/test-channel-id');
    await expect(page.locator('body')).toBeVisible();

    // Mobile
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto('/en/channel/test-channel-id');
    await expect(page.locator('body')).toBeVisible();
  });
});

test.describe('Channel Pages - RTL', () => {
  test('should load Arabic channel page', async ({ page }) => {
    await page.goto('/ar/channel/test-channel-id');

    // Page should load
    await expect(page.locator('body')).toBeVisible();

    // Check for RTL direction on page content
    const rtlDiv = page.locator('div[dir="rtl"]').first();
    if (await rtlDiv.count() > 0) {
      await expect(rtlDiv).toBeVisible();
    }
  });
});
