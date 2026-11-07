import { test, expect } from './fixtures';
import type { Page } from '@playwright/test';
import { readSession } from './test-utils/auth-state';

/**
 * Channel page E2E tests.
 *
 * The channel page is server-rendered, so browser-side route mocks never
 * reach it. These tests use the single-channel E2E user's own channel
 * (provisioned by auth.setup.ts with the default tab configuration) so they do
 * not depend on how other channels in the target environment are configured.
 */

function findChannelId(): string | null {
  try {
    return readSession('single').channels[0]?.id ?? null;
  } catch {
    return null;
  }
}

/** The selected tab must be unique and its panel rendered */
async function expectSelectedTabPanel(page: Page, tab: string) {
  const tabs = page.getByTestId('channel-tabs');
  await expect(tabs.locator('[role="tab"][aria-selected="true"]')).toHaveCount(1);
  await expect(page.getByTestId(`tab-${tab}`)).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByTestId(`tabpanel-${tab}`)).toBeVisible();
}

test.describe('Channel Pages', () => {
  let channelId: string | null = null;

  test.beforeAll(() => {
    channelId = findChannelId();
  });

  test.beforeEach(() => {
    test.skip(!channelId, 'E2E single-channel user has no channel');
  });

  test('should load channel page with tabs', async ({ page }) => {
    await page.goto(`/en/channels/${channelId}`);

    await expect(page.getByTestId('channel-tabs')).toBeVisible();
    await expectSelectedTabPanel(page, 'home');
  });

  test('should switch between channel tabs', async ({ page }) => {
    await page.goto(`/en/channels/${channelId}`);
    await expect(page.getByTestId('channel-tabs')).toBeVisible();

    for (const tab of ['videos', 'playlists', 'about']) {
      const button = page.getByTestId(`tab-${tab}`);
      if ((await button.count()) === 0) continue; // tab disabled for this channel
      await button.click();
      await expect(page).toHaveURL(new RegExp(`tab=${tab}`));
      await expectSelectedTabPanel(page, tab);
    }
  });

  test('should handle tab navigation via URL parameters', async ({ page }) => {
    await page.goto(`/en/channels/${channelId}?tab=videos`);
    await expectSelectedTabPanel(page, 'videos');
  });

  test('channel page should be responsive', async ({ page }) => {
    for (const viewport of [
      { width: 1920, height: 1080 },
      { width: 768, height: 1024 },
      { width: 375, height: 667 },
    ]) {
      await page.setViewportSize(viewport);
      await page.goto(`/en/channels/${channelId}`);
      await expect(page.getByTestId('channel-tabs')).toBeVisible();
    }
  });
});

test.describe('Channel Pages - non-existent', () => {
  test('should not render channel tabs for an unknown channel', async ({ page }) => {
    await page.goto('/en/channels/00000000-0000-0000-0000-000000000000');
    await expect(page.locator('body')).toBeVisible();
    await expect(page.getByTestId('channel-tabs')).toHaveCount(0);
  });
});

test.describe('Channel Pages - RTL', () => {
  let channelId: string | null = null;

  test.beforeAll(() => {
    channelId = findChannelId();
  });

  test.beforeEach(() => {
    test.skip(!channelId, 'E2E single-channel user has no channel');
  });

  test('should load Arabic channel page with RTL layout', async ({ page }) => {
    await page.goto(`/ar/channels/${channelId}`);

    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.locator('html')).toHaveAttribute('lang', 'ar');
    await expect(page.getByTestId('channel-tabs')).toBeVisible();
    await expect(page.getByTestId('channel-tabs')).toHaveAttribute('dir', 'rtl');
    await expect(page.getByTestId('tab-home')).toHaveText('الرئيسية');
  });

  test('should switch tabs in Arabic', async ({ page }) => {
    await page.goto(`/ar/channels/${channelId}`);

    await page.getByTestId('tab-videos').click();
    await expectSelectedTabPanel(page, 'videos');
  });
});
