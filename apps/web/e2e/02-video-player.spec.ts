import { test, expect } from './fixtures';
import type { APIRequestContext, Page } from '@playwright/test';
import { ANONYMOUS_STATE, AUTH_STATE } from './test-utils/auth-state';
import { clickAndWaitForURL, findSeedVideo } from './test-utils/qa-content';
import { canDecodeHls } from './test-utils/watch-page';

/**
 * Video page / player E2E tests against a real, processed QA seed video.
 */

async function openSeedVideo(page: Page, request: APIRequestContext, locale: 'en' | 'ar' = 'en') {
  const video = await findSeedVideo(request);
  await page.goto(`/${locale}/video?vid=${video.id}`);
  return video;
}

test.describe('Video Player', () => {
  test.use({ storageState: ANONYMOUS_STATE });

  test('shows a prompt when no video is selected', async ({ page }) => {
    await page.goto('/en/video');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(page.locator('video')).toHaveCount(0);
  });

  test('opens a video page from a home page card', async ({ page }) => {
    await page.goto('/en');
    const card = page.getByTestId('video-card').first();
    await expect(card).toBeVisible();
    const id = await card.getAttribute('data-video-id');

    await clickAndWaitForURL(page, card, new RegExp(`/en/video\\?vid=${id}$`));
  });

  test('shows the title and player for a video', async ({ page, request }) => {
    const { title } = await openSeedVideo(page, request);

    await expect(page.getByRole('heading', { level: 1, name: title })).toBeVisible();
    // Bundled Chromium cannot decode the stream and shows the error screen instead
    await expect(page.locator('.video-js, [data-testid="video-error"]').first()).toBeAttached();
  });

  test('player controls do not sit above modals (z-index)', async ({ page, request, browserName }, testInfo) => {
    test.skip(!canDecodeHls(browserName, testInfo), 'bundled Chromium cannot decode H.264 HLS: the error screen replaces the player (see 31-video-player PLAYER-002)');
    await openSeedVideo(page, request);
    const controls = page.locator('.vjs-control-bar').first();
    await expect(controls).toBeAttached();

    const zIndex = await controls.evaluate((el) => window.getComputedStyle(el).zIndex);
    expect(Number.parseInt(zIndex, 10) || 0).toBeLessThanOrEqual(100);
  });

  test('displays video metrics', async ({ page, request }) => {
    await openSeedVideo(page, request);

    await expect(page.getByTestId('video-metrics')).toBeVisible();
    await expect(page.getByTestId('video-metrics-views')).toHaveText(/\d+(\.\d)?[KM]? views?/);
    // Anonymous viewers can't like
    await expect(page.getByTestId('video-like-button')).toBeDisabled();
    // The accessible name includes the visible count (WCAG 2.5.3); the sign-in hint is a description
    await expect(page.getByTestId('video-like-button')).toHaveAccessibleName(/^Like this video \d/);
    await expect(page.getByTestId('video-like-button')).toHaveAccessibleDescription(/sign in/i);
  });

  test('fits a mobile viewport', async ({ page, request }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await openSeedVideo(page, request);

    // Bundled Chromium cannot decode the stream and shows the error screen instead
    await expect(page.locator('.video-js, [data-testid="video-error"]').first()).toBeAttached();
    const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    expect(scrollWidth).toBeLessThanOrEqual(375 + 1);
  });
});

test.describe('Video Player - signed in', () => {
  test.use({ storageState: AUTH_STATE.single });

  test('like button is enabled for signed-in users', async ({ page, request }) => {
    await openSeedVideo(page, request);
    const like = page.getByTestId('video-like-button');
    await expect(like).toBeEnabled();
    await expect(like).toHaveAttribute('aria-pressed', /true|false/);
  });
});

test.describe('Video Player - RTL', () => {
  test.use({ storageState: ANONYMOUS_STATE });

  test('opens an Arabic video page in RTL', async ({ page, request }) => {
    await openSeedVideo(page, request, 'ar');

    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    // The heading shows the Arabic title when the video has one
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(/\S/);
    // Bundled Chromium cannot decode the stream and shows the error screen instead
    await expect(page.locator('.video-js, [data-testid="video-error"]').first()).toBeAttached();
    await expect(page.getByTestId('video-metrics-views')).toHaveText(/مشاهد/);
  });
});
