import { test, expect } from './fixtures';
import type { APIRequestContext, Page } from '@playwright/test';
import { ANONYMOUS_STATE, AUTH_STATE } from './test-utils/auth-state';
import { canPlayH264, clickAndWaitForURL, expectPlayer } from './test-utils/qa-content';
import { ownPublicVideos } from './test-utils/own-public-video';

/**
 * Video page / player E2E tests against this file's own processed public video (a creator,
 * channel and upload made in beforeAll, deleted afterwards).
 */

// One worker runs this file's tests in order, so its own data (beforeAll) is made once
test.describe.configure({ mode: 'default' });

const own = ownPublicVideos(test, 'player');

async function openOwnVideo(page: Page, _request: APIRequestContext, locale: 'en' | 'ar' = 'en') {
  const video = own.videos()[0];
  await page.goto(`/${locale}/video/${video.id}`);
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
    const card = await own.showCard(page);
    await expect(card).toBeVisible();
    const id = await card.getAttribute('data-video-id');

    await clickAndWaitForURL(page, card, new RegExp(`/en/video/${id}$`));
  });

  test('shows the title and player for a video', async ({ page, request }) => {
    const { title } = await openOwnVideo(page, request);

    await expect(page.getByRole('heading', { level: 1, name: title })).toBeVisible();
    await expectPlayer(page);
  });

  test('player controls do not sit above modals (z-index)', async ({ page, request }) => {
    await openOwnVideo(page, request);
    test.skip(!(await canPlayH264(page)), 'Browser build has no H.264/AAC support, so no control bar renders');
    const controls = page.locator('.vjs-control-bar').first();
    await expect(controls).toBeAttached();

    const zIndex = await controls.evaluate((el) => window.getComputedStyle(el).zIndex);
    expect(Number.parseInt(zIndex, 10) || 0).toBeLessThanOrEqual(100);
  });

  test('displays video metrics', async ({ page, request }) => {
    await openOwnVideo(page, request);

    await expect(page.getByTestId('video-metrics')).toBeVisible();
    // This file's own video is new: "No views" until someone watches it
    await expect(page.getByTestId('video-metrics-views')).toHaveText(/^(No views|\d+(\.\d)?[KM]? views?)$/);
    // Anonymous viewers can't like
    await expect(page.getByTestId('video-like-button')).toBeDisabled();
    // The accessible name includes the visible count (WCAG 2.5.3); the sign-in hint is a description
    await expect(page.getByTestId('video-like-button')).toHaveAccessibleName(/^Like this video \d/);
    await expect(page.getByTestId('video-like-button')).toHaveAccessibleDescription(/sign in/i);
  });

  test('fits a mobile viewport', async ({ page, request }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await openOwnVideo(page, request);

    await expectPlayer(page);
    const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    expect(scrollWidth).toBeLessThanOrEqual(375 + 1);
  });
});

test.describe('Video Player - signed in', () => {
  test.use({ storageState: AUTH_STATE.single });

  test('like button is enabled for signed-in users', async ({ page, request }) => {
    await openOwnVideo(page, request);
    const like = page.getByTestId('video-like-button');
    await expect(like).toBeEnabled();
    await expect(like).toHaveAttribute('aria-pressed', /true|false/);
  });
});

test.describe('Video Player - RTL', () => {
  test.use({ storageState: ANONYMOUS_STATE });

  test('opens an Arabic video page in RTL', async ({ page, request }) => {
    await openOwnVideo(page, request, 'ar');

    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    // The heading shows the Arabic title when the video has one
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(/\S/);
    await expectPlayer(page);
    await expect(page.getByTestId('video-metrics-views')).toHaveText(/مشاهد/);
  });
});
