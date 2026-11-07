import { test, expect } from './fixtures';

/**
 * Channel page E2E tests.
 *
 * The channel page is server-rendered, so browser-side route mocks never
 * reach it. These tests run against a real channel from the target
 * environment's API (QA in CI).
 */

const API_URL = process.env.API_URL || 'https://videos.api.qa.alummahnow.net';

async function findChannelId(request: import('@playwright/test').APIRequestContext): Promise<string | null> {
  const res = await request.get(`${API_URL}/api/channels?scope=all&limit=20`);
  if (!res.ok()) return null;
  const body = (await res.json()) as { data?: Array<{ id: string }> };
  return body.data?.[0]?.id ?? null;
}

test.describe('Channel Pages', () => {
  let channelId: string | null = null;

  test.beforeAll(async ({ request }) => {
    channelId = await findChannelId(request);
  });

  test.beforeEach(() => {
    test.skip(!channelId, 'No channels exist in the target environment');
  });

  test('should load channel page with tabs', async ({ page }) => {
    await page.goto(`/en/channels/${channelId}`);

    await expect(page.getByTestId('channel-tabs')).toBeVisible();
    await expect(page.getByTestId('tab-home')).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByTestId('tabpanel-home')).toBeVisible();
  });

  test('should switch between channel tabs', async ({ page }) => {
    await page.goto(`/en/channels/${channelId}`);

    for (const tab of ['videos', 'playlists', 'about']) {
      const button = page.getByTestId(`tab-${tab}`);
      if ((await button.count()) === 0) continue; // tab disabled for this channel
      await button.click();
      await expect(button).toHaveAttribute('aria-selected', 'true');
      await expect(page.getByTestId(`tabpanel-${tab}`)).toBeVisible();
    }
  });

  test('should handle tab navigation via URL parameters', async ({ page }) => {
    await page.goto(`/en/channels/${channelId}?tab=videos`);
    await expect(page.getByTestId('tab-videos')).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByTestId('tabpanel-videos')).toBeVisible();
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

  test.beforeAll(async ({ request }) => {
    channelId = await findChannelId(request);
  });

  test.beforeEach(() => {
    test.skip(!channelId, 'No channels exist in the target environment');
  });

  test('should load Arabic channel page with RTL layout', async ({ page }) => {
    await page.goto(`/ar/channels/${channelId}`);

    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.getByTestId('channel-tabs')).toBeVisible();
    await expect(page.getByTestId('channel-tabs')).toHaveAttribute('dir', 'rtl');
  });

  test('should switch tabs in Arabic', async ({ page }) => {
    await page.goto(`/ar/channels/${channelId}`);

    const videos = page.getByTestId('tab-videos');
    await videos.click();
    await expect(videos).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByTestId('tabpanel-videos')).toBeVisible();
  });
});
