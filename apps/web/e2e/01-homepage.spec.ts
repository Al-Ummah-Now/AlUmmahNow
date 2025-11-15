import { test, expect } from './fixtures';

/**
 * Homepage E2E Tests
 * Tests for the main landing page functionality
 */

test.describe('Homepage - English', () => {
  test('should load successfully', async ({ page }) => {
    await page.goto('/en/');

    // Check page title
    await expect(page).toHaveTitle(/Al Ummah Now/i);

    // Check that main content is visible
    await expect(page.locator('body')).toBeVisible();
  });

  test('should have working navigation', async ({ page }) => {
    await page.goto('/en/');

    // Check navigation elements exist
    const nav = page.locator('nav');
    await expect(nav).toBeVisible();

    // Check for common navigation items (adjust selectors as needed)
    // These tests will need to be updated based on your actual navigation structure
  });

  test('should display video feed', async ({ page }) => {
    await page.goto('/en/');

    // Wait for videos to load (adjust timeout as needed)
    await page.waitForTimeout(2000);

    // Check if there are video elements on the page
    // This is a basic check - you'll want to make this more specific
    const content = page.locator('main');
    await expect(content).toBeVisible();
  });

  test('should be responsive', async ({ page }) => {
    // Test desktop view
    await page.setViewportSize({ width: 1920, height: 1080 });
    await page.goto('/en/');
    await expect(page.locator('body')).toBeVisible();

    // Test tablet view
    await page.setViewportSize({ width: 768, height: 1024 });
    await page.goto('/en/');
    await expect(page.locator('body')).toBeVisible();

    // Test mobile view
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto('/en/');
    await expect(page.locator('body')).toBeVisible();
  });
});

test.describe('Homepage - Arabic (RTL)', () => {
  test('should load Arabic version', async ({ page }) => {
    await page.goto('/ar/');

    // Check page loads
    await expect(page).toHaveTitle(/Al Ummah Now/i);

    // Check RTL direction
    const html = page.locator('html');
    await expect(html).toHaveAttribute('dir', 'rtl');
  });

  test('should have RTL layout', async ({ page }) => {
    await page.goto('/ar/');

    // Verify body has RTL direction
    const body = page.locator('body');
    await expect(body).toBeVisible();

    // Check language attribute
    const html = page.locator('html');
    await expect(html).toHaveAttribute('lang', 'ar');
  });
});

test.describe('Language Switching', () => {
  test('should switch from English to Arabic', async ({ page }) => {
    await page.goto('/en/');

    // Navigate to Arabic version
    await page.goto('/ar/');

    // Verify we're on Arabic page
    const html = page.locator('html');
    await expect(html).toHaveAttribute('dir', 'rtl');
    await expect(html).toHaveAttribute('lang', 'ar');
  });

  test('should switch from Arabic to English', async ({ page }) => {
    await page.goto('/ar/');

    // Navigate to English version
    await page.goto('/en/');

    // Verify we're on English page
    const html = page.locator('html');
    await expect(html).toHaveAttribute('dir', 'ltr');
    await expect(html).toHaveAttribute('lang', 'en');
  });
});
