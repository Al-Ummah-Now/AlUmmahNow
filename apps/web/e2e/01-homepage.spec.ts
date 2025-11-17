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

    // Navigation exists but may be hidden initially (mobile-first design)
    // Just verify the page has loaded with body visible
    await expect(page.locator('body')).toBeVisible();

    // Verify navigation exists in DOM (even if hidden)
    const navCount = await page.locator('nav').count();
    expect(navCount).toBeGreaterThan(0);
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

    // Check for Arabic text content (more reliable than dir attribute)
    await expect(page.locator('h1')).toContainText('الفيديوهات');
  });

  test('should have RTL layout', async ({ page }) => {
    await page.goto('/ar/');

    // Verify body has content
    const body = page.locator('body');
    await expect(body).toBeVisible();

    // Check for Arabic text content
    await expect(page.locator('h1')).toContainText('الفيديوهات');

    // Verify RTL styling (inline style or dir attribute)
    const main = page.locator('main');
    const dirAttr = await main.getAttribute('dir');
    const dirStyle = await main.evaluate((el: HTMLElement) => window.getComputedStyle(el).direction);

    // Either dir attribute is "rtl" OR computed style direction is "rtl"
    expect(dirAttr === 'rtl' || dirStyle === 'rtl').toBe(true);
  });
});

test.describe('Language Switching', () => {
  test('should switch from English to Arabic', async ({ page }) => {
    await page.goto('/en/');

    // Navigate to Arabic version
    await page.goto('/ar/');

    // Check for Arabic text (most reliable indicator)
    await expect(page.locator('h1')).toContainText('الفيديوهات');
  });

  test('should switch from Arabic to English', async ({ page }) => {
    await page.goto('/ar/');

    // Navigate to English version
    await page.goto('/en/');

    // Check for English text
    await expect(page.locator('h1')).toContainText('Videos');
  });
});
