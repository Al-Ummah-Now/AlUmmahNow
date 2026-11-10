/**
 * Dashboard videos - ownership and data isolation (/[locale]/dashboard/videos).
 *
 * Runs against real QA data: the single-channel and multi-channel E2E users
 * each own seed videos (see test-utils/e2e-videos.ts). The dashboard fetches
 * through a server action, so isolation is asserted on what each signed-in
 * user actually sees, and the API's owner checks are exercised directly.
 */

import { test, expect } from './fixtures';
import type { Page } from '@playwright/test';
import { AUTH_STATE } from './test-utils/auth-state';
import {
  API_URL,
  SEED_TITLES,
  createDisposableVideo,
  deleteVideoQuietly,
  ensureSeedVideos,
  getVideo,
  setupPublicDisposable,
  userApi,
  type E2EVideo,
} from './test-utils/e2e-videos';

let singleSeed: Record<string, E2EVideo> = {};
let multiSeed: Record<string, E2EVideo> = {};
// Seed videos are private; privacy checks use a public video this file creates and deletes
const publicVideo = setupPublicDisposable('single', 'ownership-public');

test.beforeAll(async () => {
  test.setTimeout(240000);
  singleSeed = await ensureSeedVideos('single');
  multiSeed = await ensureSeedVideos('multi');
  await publicVideo.create();
});

test.afterAll(async () => {
  await publicVideo.remove();
});

const card = (page: Page, video: E2EVideo) => page.locator(`[data-testid="dashboard-video-card"][data-video-id="${video.id}"]`);

async function openDashboard(page: Page) {
  await page.goto('/en/dashboard/videos');
  await expect(page.getByTestId('dashboard-search')).toBeVisible();
  await expect(page.getByTestId('dashboard-loading')).toHaveCount(0);
}

test.describe('Dashboard Videos - Single Channel', () => {
  test.use({ storageState: AUTH_STATE.single });

  test('should display all videos (public + private) for the owner', async ({ page }) => {
    await openDashboard(page);

    await expect(card(page, publicVideo.get())).toHaveAttribute('data-privacy', 'public');
    await expect(card(page, singleSeed[SEED_TITLES.singlePrivate])).toHaveAttribute('data-privacy', 'private');
    // Scheduled videos stay private until they publish, and owners see them too
    await expect(card(page, singleSeed[SEED_TITLES.singleScheduled])).toBeVisible();
  });

  test('should only list videos from the user\'s own channel', async ({ page }) => {
    await openDashboard(page);
    const channelId = singleSeed[SEED_TITLES.singleVideo].channelId;

    const channels = await page.getByTestId('dashboard-video-card').evaluateAll((els) =>
      [...new Set(els.map((el) => el.getAttribute('data-channel-id')))],
    );
    expect(channels).toEqual([channelId]);
  });

  // The format filter follows the one Short rule: up to 3 minutes AND vertical
  // or square (or chosen by the uploader). The seed clips are a few seconds
  // long but landscape (426x240), so they are videos, not Shorts.
  test('should filter by format - Shorts', async ({ page }) => {
    await openDashboard(page);
    await expect(card(page, singleSeed[SEED_TITLES.singleVideo])).toBeVisible();

    await page.getByTestId('dashboard-filter-duration').selectOption('short');
    await expect(card(page, singleSeed[SEED_TITLES.singleVideo])).toHaveCount(0);
    await expect(card(page, singleSeed[SEED_TITLES.singlePrivate])).toHaveCount(0);
    const durations = await page.getByTestId('dashboard-video-card').evaluateAll((els) =>
      els.map((el) => Number(el.getAttribute('data-duration') || 0)),
    );
    for (const d of durations) expect(d).toBeLessThanOrEqual(180);
  });

  test('should filter by format - videos', async ({ page }) => {
    await openDashboard(page);

    await page.getByTestId('dashboard-filter-duration').selectOption('standard');
    // Short landscape clips are videos
    await expect(card(page, singleSeed[SEED_TITLES.singleVideo])).toBeVisible();
    await expect(card(page, singleSeed[SEED_TITLES.singlePrivate])).toBeVisible();
  });

  test('should filter by privacy - public', async ({ page }) => {
    await openDashboard(page);

    await page.getByTestId('dashboard-filter-privacy').selectOption('public');
    await expect(card(page, publicVideo.get())).toBeVisible();
    await expect(card(page, singleSeed[SEED_TITLES.singlePrivate])).toHaveCount(0);
    await expect(page.locator('[data-testid="dashboard-video-card"][data-privacy="private"]')).toHaveCount(0);
  });

  test('should filter by privacy - private', async ({ page }) => {
    await openDashboard(page);

    await page.getByTestId('dashboard-filter-privacy').selectOption('private');
    await expect(card(page, singleSeed[SEED_TITLES.singlePrivate])).toBeVisible();
    await expect(card(page, publicVideo.get())).toHaveCount(0);
    await expect(page.locator('[data-testid="dashboard-video-card"][data-privacy="public"]')).toHaveCount(0);
  });
});

test.describe('Dashboard Videos - Multiple Channels', () => {
  test.use({ storageState: AUTH_STATE.multi });

  test('should display videos from all of the user\'s channels', async ({ page }) => {
    await openDashboard(page);

    const one = multiSeed[SEED_TITLES.multiOne];
    const two = multiSeed[SEED_TITLES.multiTwo];
    expect(one.channelId).not.toBe(two.channelId);
    await expect(card(page, one)).toHaveAttribute('data-channel-id', one.channelId);
    await expect(card(page, two)).toHaveAttribute('data-channel-id', two.channelId);
  });

  test('should not show duplicate videos', async ({ page }) => {
    await openDashboard(page);
    await expect(card(page, multiSeed[SEED_TITLES.multiOne])).toBeVisible();

    const ids = await page.getByTestId('dashboard-video-card').evaluateAll((els) => els.map((el) => el.getAttribute('data-video-id')));
    expect(new Set(ids).size).toBe(ids.length);
  });

  test('should filter by format across all channels', async ({ page }) => {
    await openDashboard(page);

    // Each channel's landscape seed is a video: listed under Videos, not under Shorts
    await page.getByTestId('dashboard-filter-duration').selectOption('standard');
    await expect(card(page, multiSeed[SEED_TITLES.multiOne])).toBeVisible();
    await expect(card(page, multiSeed[SEED_TITLES.multiTwo])).toBeVisible();

    await page.getByTestId('dashboard-filter-duration').selectOption('short');
    await expect(card(page, multiSeed[SEED_TITLES.multiOne])).toHaveCount(0);
    await expect(card(page, multiSeed[SEED_TITLES.multiTwo])).toHaveCount(0);
  });

  test('should bulk delete videos across channels', async ({ page }) => {
    const videos = [
      await createDisposableVideo('multi', 'bulk-ch1', { channelIndex: 0 }),
      await createDisposableVideo('multi', 'bulk-ch2', { channelIndex: 1 }),
    ];
    try {
      await openDashboard(page);
      for (const v of videos) await card(page, v).getByTestId('dashboard-video-select').check();
      await page.getByTestId('dashboard-delete-selected').click();
      const dialog = page.getByRole('alertdialog');
      await dialog.getByRole('button').last().click();

      for (const v of videos) await expect(card(page, v)).toHaveCount(0);
      await expect(page.getByTestId('dashboard-error')).toHaveCount(0);
      const api = userApi('multi');
      for (const v of videos) await expect.poll(() => getVideo(api, v.id), { timeout: 60000 }).toBeNull();
    } finally {
      for (const v of videos) await deleteVideoQuietly('multi', v);
    }
  });
});

test.describe('Dashboard Videos - Ownership Validation (API)', () => {
  test('should return 403 when requesting an unowned channel', async ({ request }) => {
    const single = userApi('single');
    const multi = userApi('multi');

    const res = await request.get(`${API_URL}/api/videos/search?isOwner=true&channelIds=${multi.channelIds.join(',')}`, {
      headers: { Authorization: `Bearer ${single.token}` },
    });
    expect(res.status()).toBe(403);

    const mixed = await request.get(`${API_URL}/api/videos/search?isOwner=true&channelIds=${single.channelIds[0]},${multi.channelIds[0]}`, {
      headers: { Authorization: `Bearer ${single.token}` },
    });
    expect(mixed.status()).toBe(403);
  });

  test('should return 403 when isOwner=true without authentication', async ({ request }) => {
    const single = userApi('single');
    const res = await request.get(`${API_URL}/api/videos/search?isOwner=true&channelIds=${single.channelIds[0]}`);
    expect(res.status()).toBe(403);
  });
});

test.describe('Dashboard Videos - Privacy and Data Isolation', () => {
  test.use({ storageState: AUTH_STATE.multi });

  test('should only show the signed-in user\'s videos', async ({ page }) => {
    await openDashboard(page);
    await expect(card(page, multiSeed[SEED_TITLES.multiOne])).toBeVisible();

    for (const v of [...Object.values(singleSeed), publicVideo.get()]) await expect(card(page, v)).toHaveCount(0);
  });

  test('should show private videos only to their owner', async ({ request }) => {
    const privateVideo = singleSeed[SEED_TITLES.singlePrivate];

    // Public search never returns another user's private video
    const publicIds = async () => {
      const anonymous = await request.get(`${API_URL}/api/videos/search?limit=100&channelIds=${privateVideo.channelId}`);
      expect(anonymous.ok()).toBe(true);
      return ((await anonymous.json()) as { data?: E2EVideo[] }).data?.map((v) => v.id) || [];
    };
    await expect.poll(publicIds, { timeout: 60000 }).toContain(publicVideo.get().id);
    expect(await publicIds()).not.toContain(privateVideo.id);
  });
});

test.describe('Dashboard Videos - Edge Cases', () => {
  test.describe('no channels', () => {
    test.use({ storageState: AUTH_STATE.none });

    test('should send a user with no channels to the home page', async ({ page }) => {
      await page.goto('/en/dashboard/videos');
      await expect(page).toHaveURL(/\/en\/?$/);
      await expect(page.getByTestId('dashboard-video-card')).toHaveCount(0);
    });
  });

  test.describe('signed out', () => {
    test.use({ storageState: { cookies: [], origins: [] } });

    test('should not render the dashboard for anonymous visitors', async ({ page }) => {
      await page.goto('/en/dashboard/videos');
      await expect(page).toHaveURL(/\/en\/?$/);
      await expect(page.getByTestId('dashboard-search')).toHaveCount(0);
    });
  });
});

test.describe('Dashboard Videos - Performance', () => {
  test.use({ storageState: AUTH_STATE.single });

  test('should render the owner\'s videos within 15 seconds', async ({ page }) => {
    const start = Date.now();
    await page.goto('/en/dashboard/videos');
    await expect(card(page, singleSeed[SEED_TITLES.singleVideo])).toBeVisible({ timeout: 15000 });
    expect(Date.now() - start).toBeLessThan(15000);
  });

  test('should settle on the last of several rapid filter changes', async ({ page }) => {
    await openDashboard(page);
    const select = page.getByTestId('dashboard-filter-privacy');

    await select.selectOption('private');
    await select.selectOption('public');
    await select.selectOption('private');

    await expect(card(page, singleSeed[SEED_TITLES.singlePrivate])).toBeVisible();
    await expect(page.locator('[data-testid="dashboard-video-card"][data-privacy="public"]')).toHaveCount(0);
  });
});
