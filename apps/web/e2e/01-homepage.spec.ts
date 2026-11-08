import { test, expect } from './fixtures';
import type { Page } from '@playwright/test';
import { ANONYMOUS_STATE } from './test-utils/auth-state';

/**
 * Homepage E2E Tests (anonymous visitor, real QA content)
 */

test.use({ storageState: ANONYMOUS_STATE });

async function expectNoHorizontalScroll(page: Page) {
  const { scrollWidth, innerWidth } = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    innerWidth: window.innerWidth,
  }));
  expect(scrollWidth).toBeLessThanOrEqual(innerWidth + 1);
}

test.describe('Homepage - English', () => {
  test('should load successfully', async ({ page }) => {
    const response = await page.goto('/en/');
    expect(response?.status()).toBe(200);

    await expect(page).toHaveTitle(/Al Ummah Now/i);
    await expect(page.getByRole('heading', { level: 1, name: 'Videos' })).toBeVisible();
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  });

  test('should have the header navigation', async ({ page }) => {
    await page.goto('/en/');

    const header = page.getByRole('banner');
    await expect(header).toBeVisible();
    await expect(header.getByRole('button', { name: 'Navigation menu', exact: true })).toBeVisible();
    await expect(page.getByTestId('nav-drawer-toggle')).toBeVisible();
  });

  test('should display the video feed', async ({ page }) => {
    await page.goto('/en/');

    const cards = page.getByTestId('video-card');
    await expect(cards.first()).toBeVisible();
    await expect(cards.first()).toHaveAttribute('href', /^\/en\/video\?vid=/);
    await expect(page.getByTestId('video-grid-loading')).toHaveCount(0);
  });

  test('should be responsive', async ({ page }) => {
    for (const viewport of [
      { width: 1920, height: 1080 },
      { width: 768, height: 1024 },
      { width: 375, height: 667 },
    ]) {
      await page.setViewportSize(viewport);
      await page.goto('/en/');
      await expect(page.getByTestId('video-card').first()).toBeVisible();
      await expectNoHorizontalScroll(page);
    }
  });
});

test.describe('Homepage - Arabic (RTL)', () => {
  test('should load Arabic version', async ({ page }) => {
    await page.goto('/ar/');

    await expect(page).toHaveTitle(/Al Ummah Now/i);
    await expect(page.getByRole('heading', { level: 1 })).toContainText('الفيديوهات');
    await expect(page.locator('html')).toHaveAttribute('lang', 'ar');
  });

  test('should have RTL layout', async ({ page }) => {
    await page.goto('/ar/');

    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    const main = page.getByRole('main');
    await expect(main).toHaveCSS('direction', 'rtl');
    await expect(page.getByTestId('video-card').first()).toHaveAttribute('href', /^\/ar\/video\?vid=/);
  });
});

test.describe('Language Switching', () => {
  test('should switch from English to Arabic', async ({ page }) => {
    await page.goto('/en/');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Videos');

    await page.goto('/ar/');
    await expect(page.getByRole('heading', { level: 1 })).toContainText('الفيديوهات');
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  });

  test('should switch from Arabic to English', async ({ page }) => {
    await page.goto('/ar/');
    await expect(page.getByRole('heading', { level: 1 })).toContainText('الفيديوهات');

    await page.goto('/en/');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Videos');
    await expect(page.locator('html')).toHaveAttribute('dir', 'ltr');
  });
});
