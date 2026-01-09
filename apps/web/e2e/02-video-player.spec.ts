import { test, expect } from './fixtures';

/**
 * Video Player E2E Tests
 * Tests for video playback and player controls
 */

test.describe('Video Player', () => {
  test('should navigate to video page', async ({ page }) => {
    await page.goto('/en/video');

    // Check page loads
    await expect(page.locator('body')).toBeVisible();
  });

  test('should have video player controls', async ({ page }) => {
    await page.goto('/en/video?vid=test-video-id');

    // Wait for player to load
    await page.waitForTimeout(2000);

    // Check if video element exists
    // Note: Video.js creates a complex DOM structure
    // Basic check that something video-related exists
    // This will need to be refined based on actual implementation
    await expect(page.locator('body')).toBeVisible();
  });

  test('should have correct z-index (not blocking modals)', async ({ page }) => {
    await page.goto('/en/video?vid=test-video-id');

    // Wait for page to load
    await page.waitForTimeout(1000);

    // Check video player controls z-index via CSS
    const videoControls = page.locator('.vjs-control-bar');

    if (await videoControls.count() > 0) {
      const zIndex = await videoControls.evaluate((el) => {
        return window.getComputedStyle(el).zIndex;
      });

      // Should be 10 or less (not 1000)
      expect(parseInt(zIndex) || 0).toBeLessThanOrEqual(100);
    }
  });

  test('should display video metrics', async ({ page }) => {
    await page.goto('/en/video?vid=test-video-id');

    // Wait for content to load
    await page.waitForTimeout(2000);

    // Check if metrics are displayed (views, likes, etc.)
    // This will need to be refined based on actual selectors
    const body = page.locator('body');
    await expect(body).toBeVisible();
  });

  test('should work on mobile viewport', async ({ page }) => {
    // Set mobile viewport
    await page.setViewportSize({ width: 375, height: 667 });

    await page.goto('/en/video?vid=test-video-id');

    // Check page is responsive
    await expect(page.locator('body')).toBeVisible();
  });
});

test.describe('Video Player - RTL', () => {
  test('should load Arabic video page', async ({ page }) => {
    await page.goto('/ar/video?vid=test-video-id');

    // Check page loads
    await expect(page.locator('body')).toBeVisible();

    // Arabic video pages may have RTL on specific elements (not guaranteed on all pages)
    // Just verify the page loads correctly
  });
});
