import { test, expect } from './fixtures';
import type { Page } from '@playwright/test';
import { ANONYMOUS_STATE, AUTH_STATE } from './test-utils/auth-state';

/**
 * Analytics dashboard (/analytics) for anonymous visitors, a user without
 * channels and a channel owner. Numbers come from real QA data and change as
 * other runs upload videos, so only structure and formatting are asserted.
 */

const CARD_TITLES_EN = ['Total Views', 'Total Likes', 'Total Comments', 'Subscribers', 'Total Videos', 'Avg Views per Video'];
const CARD_TITLES_AR = ['إجمالي المشاهدات', 'إجمالي الإعجابات', 'إجمالي التعليقات', 'المشتركون', 'إجمالي الفيديوهات', 'متوسط المشاهدات لكل فيديو'];

async function waitForDashboard(page: Page, heading: RegExp) {
  await expect(page.getByRole('heading', { level: 1, name: heading })).toBeVisible({ timeout: 60000 });
}

test.describe('Analytics - anonymous', () => {
  test.use({ storageState: ANONYMOUS_STATE });

  test('ANA-001 asks anonymous visitors to sign in', async ({ page }) => {
    await page.goto('/en/analytics');
    await expect(page.getByRole('heading', { level: 1, name: 'Sign in to see your analytics' })).toBeVisible();
    await expect(page.getByText('Analytics show views, engagement and subscribers for the channels you own.')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Sign In' })).toBeVisible();
    await expect(page.getByText('Total Views')).toHaveCount(0);
  });

  test('ANA-002 Arabic sign-in prompt is RTL', async ({ page }) => {
    await page.goto('/ar/analytics');
    await expect(page.locator('div[dir="rtl"]').filter({ has: page.getByRole('heading', { level: 1 }) }).last()).toBeVisible();
    await expect(page.getByRole('button', { name: 'تسجيل الدخول' })).toBeVisible();
  });
});

test.describe('Analytics - no channel', () => {
  test.use({ storageState: AUTH_STATE.none });

  test('ANA-010 shows zeroed totals for a user without channels', async ({ page }) => {
    await page.goto('/en/analytics');
    await waitForDashboard(page, /^Analytics$/);
    for (const title of CARD_TITLES_EN) await expect(page.getByText(title, { exact: true }).first()).toBeVisible();
    await expect(page.getByText('Total Videos', { exact: true }).locator('..')).toContainText('0');
    await expect(page.getByRole('heading', { name: 'Top Performing Videos' })).toHaveCount(0);
  });
});

test.describe('Analytics - channel owner', () => {
  test.use({ storageState: AUTH_STATE.single });

  test('ANA-020 shows totals, engagement and trends', async ({ page }) => {
    await page.goto('/en/analytics');
    await waitForDashboard(page, /^Analytics$/);
    await expect(page.getByText(/^Track your (channel )?performance/)).toBeVisible();
    for (const title of CARD_TITLES_EN) await expect(page.getByText(title, { exact: true }).first()).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Engagement Overview' })).toBeVisible();
    await expect(page.getByText(/^\d+(\.\d)?%$/).first()).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Performance Trends' })).toBeVisible();
  });

  test('ANA-021 Arabic dashboard is translated and RTL', async ({ page }) => {
    await page.goto('/ar/analytics');
    await waitForDashboard(page, /^التحليلات$/);
    for (const title of CARD_TITLES_AR) await expect(page.getByText(title, { exact: true }).first()).toBeVisible();
    await expect(page.getByRole('heading', { name: 'نظرة عامة على التفاعل' })).toBeVisible();
    await expect(page.locator('div.space-y-8[dir="rtl"]')).toBeVisible();
    await expect(page.getByText('إجمالي الفيديوهات', { exact: true }).first().locator('..')).toContainText(/[0-9٠-٩]/);
  });

  test('ANA-022 dashboard fits the viewport', async ({ page }) => {
    await page.goto('/en/analytics');
    await waitForDashboard(page, /^Analytics$/);
    await expect(page.getByRole('heading', { name: 'Engagement Overview' })).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(1);
  });
});

test.describe('Analytics - dark theme', () => {
  test.use({ storageState: AUTH_STATE.single, colorScheme: 'dark' });

  test('ANA-030 dashboard renders on the dark background', async ({ page }) => {
    await page.goto('/en/analytics');
    await waitForDashboard(page, /^Analytics$/);
    await expect(page.locator('html')).toHaveClass(/\bdark\b/);
    await expect(page.getByRole('heading', { level: 1 })).toHaveCSS('color', 'rgb(255, 255, 255)');
  });
});
