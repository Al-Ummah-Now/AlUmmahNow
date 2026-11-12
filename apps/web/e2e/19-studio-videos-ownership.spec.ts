/**
 * Studio Content > Videos - ownership and data isolation (replaces the
 * /dashboard/videos specs; that page 301s to Studio). Real QA data: the
 * single- and multi-channel E2E users own seed videos (test-utils/e2e-videos.ts).
 * Studio is per channel, so each channel's list holds only its videos.
 */
import { test, expect } from './fixtures';
import type { Page } from '@playwright/test';
import { AUTH_STATE } from './test-utils/auth-state';
import { API_URL, SEED_TITLES, ensureSeedVideos, setupPublicDisposable, waitForReady, type E2EVideo } from './test-utils/e2e-videos';
import { channelsOf } from './test-utils/channel-content';

let singleSeed: Record<string, E2EVideo> = {};
let multiSeed: Record<string, E2EVideo> = {};
// Ready before the tests: the list opens on Published, which leaves out videos still processing
const publicVideo = setupPublicDisposable('single', 'studio-ownership-public', { ready: true });

test.beforeAll(async () => {
  test.setTimeout(540000);
  // Until Studio is deployed where this runs (PR checks run against QA, which follows main)
  const studio = await fetch(`${process.env.WEB_APP_URL ?? 'https://videos.qa.alummahnow.net'}/en/studio`, { redirect: 'manual' });
  test.skip(studio.status === 404, 'Studio is not deployed to this environment yet');
  singleSeed = await ensureSeedVideos('single');
  multiSeed = await ensureSeedVideos('multi');
  // Seeds uploaded by this run (a freshly seeded QA) may still be encoding
  for (const [user, seed, title] of [
    ['single', singleSeed, SEED_TITLES.singlePrivate],
    ['multi', multiSeed, SEED_TITLES.multiOne],
    ['multi', multiSeed, SEED_TITLES.multiTwo],
  ] as const) {
    seed[title] = await waitForReady(user, seed[title]);
  }
  await publicVideo.create();
});

test.afterAll(async () => {
  await publicVideo.remove();
});

const rowOf = (page: Page, video: E2EVideo) => page.getByTestId('studio-video-row').filter({ has: page.locator(`[data-video-id="${video.id}"]`) });

async function openVideos(page: Page, channelId: string, query = '') {
  await page.goto(`/en/studio/${channelId}/content/videos${query}`);
  await expect(page.getByTestId('studio-videos')).toBeVisible();
  await expect(page.getByTestId('studio-videos-loading')).toHaveCount(0, { timeout: 20000 });
}

test.describe('Studio videos - single channel', () => {
  test.use({ storageState: AUTH_STATE.single });

  test('lists the owner\'s public and private videos, private ones marked', async ({ page }) => {
    const channelId = channelsOf('single').main.id;
    await openVideos(page, channelId);
    await expect(rowOf(page, publicVideo.get())).toBeVisible();
    await expect(rowOf(page, singleSeed[SEED_TITLES.singlePrivate])).toContainText('Private');
  });

  test('filters by visibility, kept in the URL', async ({ page }) => {
    const channelId = channelsOf('single').main.id;
    await openVideos(page, channelId, '?visibility=private');
    await expect(rowOf(page, singleSeed[SEED_TITLES.singlePrivate])).toBeVisible();
    await expect(rowOf(page, publicVideo.get())).toHaveCount(0);
  });

  test('another user\'s Studio is not found, and its API refuses', async ({ page }) => {
    const other = channelsOf('multi').main.id;
    const res = await page.goto(`/en/studio/${other}/content/videos`);
    expect(res?.status()).toBe(404);
    const { accessToken } = (await import('./test-utils/auth-state')).readAccount('single');
    const api = await fetch(`${API_URL}/api/channels/${other}/content`, { headers: { Authorization: `Bearer ${accessToken}` } });
    expect(api.status).toBe(403);
  });
});

test.describe('Studio videos - multiple channels', () => {
  test.use({ storageState: AUTH_STATE.multi });

  test('each channel\'s Studio lists only that channel\'s videos', async ({ page }) => {
    const one = multiSeed[SEED_TITLES.multiOne];
    const two = multiSeed[SEED_TITLES.multiTwo];
    expect(one.channelId).not.toBe(two.channelId);
    await openVideos(page, one.channelId);
    await expect(rowOf(page, one)).toBeVisible();
    await expect(rowOf(page, two)).toHaveCount(0);
    await openVideos(page, two.channelId);
    await expect(rowOf(page, two)).toBeVisible();
    await expect(rowOf(page, one)).toHaveCount(0);
  });
});
