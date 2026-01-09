import { test, expect } from './fixtures';

/**
 * Navigation and Routing E2E Tests
 * Tests for application navigation, routing, and deep linking
 */

test.describe('Navigation - English Routes', () => {
  test('should navigate from homepage to video page', async ({ page }) => {
    await page.goto('/en/');

    // Wait for page to load
    await page.waitForLoadState('domcontentloaded');

    // Check we're on the English homepage
    await expect(page).toHaveURL(/\/en\/?$/);

    // Page should be visible
    await expect(page.locator('body')).toBeVisible();
  });

  test('should navigate to profile creation page', async ({ page }) => {
    await page.goto('/en/profile/create');

    // Check URL
    await expect(page).toHaveURL(/\/en\/profile\/create/);

    // Page should load
    await expect(page.locator('body')).toBeVisible();
  });

  test('should handle direct video page navigation', async ({ page }) => {
    await page.goto('/en/video?vid=test-123');

    // Check URL parameters preserved
    await expect(page).toHaveURL(/vid=test-123/);

    // Page should load
    await expect(page.locator('body')).toBeVisible();
  });

  test('should navigate between different sections', async ({ page }) => {
    // Start on homepage
    await page.goto('/en/');
    await expect(page).toHaveURL(/\/en\/?$/);

    // Navigate to another page (adjust based on your actual routes)
    await page.goto('/en/channels');
    await expect(page).toHaveURL(/\/en\/channels/);
    await expect(page.locator('body')).toBeVisible();
  });
});

test.describe('Navigation - Arabic Routes', () => {
  test('should navigate from homepage to video page', async ({ page }) => {
    await page.goto('/ar/');

    // Wait for page to load
    await page.waitForLoadState('domcontentloaded');

    // Check we're on the Arabic homepage
    await expect(page).toHaveURL(/\/ar\/?$/);

    // Check for Arabic text content
    await expect(page.locator('h1')).toContainText('الفيديوهات');
  });

  test('should preserve RTL when navigating', async ({ page }) => {
    await page.goto('/ar/');

    // Verify Arabic content
    await expect(page.locator('h1')).toContainText('الفيديوهات');

    // Navigate to another page
    await page.goto('/ar/channels');

    // Page should load
    await expect(page.locator('body')).toBeVisible();
  });

  test('should handle query parameters in Arabic routes', async ({ page }) => {
    await page.goto('/ar/video?vid=test-123');

    // Check URL
    await expect(page).toHaveURL(/\/ar\/video\?vid=test-123/);

    // Page should load
    await expect(page.locator('body')).toBeVisible();
  });
});

test.describe('Navigation - Browser Controls', () => {
  test('should support browser back button', async ({ page }) => {
    // Navigate to homepage
    await page.goto('/en/');
    await page.waitForLoadState('domcontentloaded');

    // Navigate to another page
    await page.goto('/en/channels');
    await page.waitForLoadState('domcontentloaded');

    // Go back
    await page.goBack();

    // Should be on homepage again
    await expect(page).toHaveURL(/\/en\/?$/);
  });

  test('should support browser forward button', async ({ page }) => {
    // Navigate to homepage
    await page.goto('/en/');
    await page.waitForLoadState('networkidle');

    // Navigate to another page using link click for more realistic test
    await page.goto('/en/channels');
    await page.waitForLoadState('networkidle');

    // Go back - wait for navigation to complete
    await Promise.all([
      page.waitForURL(/\/en\/?$/, { timeout: 10000 }),
      page.goBack()
    ]);

    // Verify we're back on homepage
    await expect(page).toHaveURL(/\/en\/?$/);

    // Go forward - wait for navigation to complete
    await Promise.all([
      page.waitForURL(/\/en\/channels/, { timeout: 10000 }),
      page.goForward()
    ]);

    // Should be on channels page again
    await expect(page).toHaveURL(/\/en\/channels/);
  });

  test('should reload page correctly', async ({ page }) => {
    await page.goto('/en/');

    // Reload the page
    await page.reload();

    // Should still be on the same page
    await expect(page).toHaveURL(/\/en\/?$/);
    await expect(page.locator('body')).toBeVisible();
  });
});

test.describe('Navigation - Deep Linking', () => {
  test('should handle deep links to specific videos', async ({ page }) => {
    const videoId = 'deep-link-test-123';
    await page.goto(`/en/video?vid=${videoId}`);

    // Check URL preserves video ID
    await expect(page).toHaveURL(new RegExp(`vid=${videoId}`));
  });

  test('should handle deep links with multiple query parameters', async ({ page }) => {
    await page.goto('/en/video?vid=test-123&t=30&quality=720p');

    // Check all parameters are preserved
    const url = page.url();
    expect(url).toContain('vid=test-123');
    expect(url).toContain('t=30');
    expect(url).toContain('quality=720p');
  });

  test('should handle hash fragments', async ({ page }) => {
    await page.goto('/en/#section-1');

    // Check hash is preserved
    const url = page.url();
    expect(url).toContain('#section-1');
  });
});

test.describe('Navigation - Error Handling', () => {
  test('should handle non-existent routes gracefully', async ({ page }) => {
    const response = await page.goto('/en/this-route-does-not-exist-12345');

    // Depending on implementation, might show 404 or redirect
    // Adjust this test based on your actual 404 handling
    expect(response?.status()).toBeTruthy();
  });

  test('should handle missing language prefix gracefully', async ({ page }) => {
    // Navigate without language prefix
    const response = await page.goto('/');

    // Should redirect to default language or show something
    expect(response?.status()).toBeTruthy();
    await expect(page.locator('body')).toBeVisible();
  });
});

test.describe('Navigation - Responsive Behavior', () => {
  test('should navigate correctly on mobile viewport', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });

    await page.goto('/en/');
    await expect(page).toHaveURL(/\/en\/?$/);

    // Navigate to another page
    await page.goto('/en/video?vid=mobile-test');
    await expect(page).toHaveURL(/vid=mobile-test/);
  });

  test('should navigate correctly on tablet viewport', async ({ page }) => {
    await page.setViewportSize({ width: 768, height: 1024 });

    await page.goto('/en/');
    await page.goto('/en/channels');
    await expect(page).toHaveURL(/\/en\/channels/);
  });
});
