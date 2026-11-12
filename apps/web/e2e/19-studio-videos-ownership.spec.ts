/**
 * Studio Content > Videos - ownership and data isolation (replaces the
 * /dashboard/videos specs; that page 301s to Studio). Real QA data: the
 * single- and multi-channel E2E users own seed videos (test-utils/e2e-videos.ts).
 * Studio is per channel, so each channel's list holds only its videos.
 *
 * Nothing here waits for Bunny: ownership and visibility do not depend on
 * encoding, and QA's shared Bunny library can take 15-50 min to encode even a
 * 4 s clip (2026-11-12). Studio files a video under Processing until it is
 * encoded, then under Published, so each check opens the tab the video is in.
 */
import { test, expect } from './fixtures';
import type { Page } from '@playwright/test';
import { AUTH_STATE, type AuthUser } from './test-utils/auth-state';
import {
  API_URL,
  SEED_TITLES,
  createDisposableVideo,
  deleteVideoQuietly,
  getVideo,
  userApi,
  type E2EVideo,
} from './test-utils/e2e-videos';
import { channelsOf } from './test-utils/channel-content';
import { ownStudioVideos } from './test-utils/own-studio-videos';

let singleSeed: Record<string, E2EVideo> = {};
let multiSeed: Record<string, E2EVideo> = {};
// Record only (no bytes, so Bunny encodes nothing)
let publicVideo: E2EVideo | null = null;
const publicOf = () => {
  if (!publicVideo) throw new Error('Public disposable video was not created');
  return publicVideo;
};

// One worker runs this file's tests in order, so its own data (beforeAll) is made once
test.describe.configure({ mode: 'default' });

/** This file's own Studio videos of the run users (made in beforeAll, deleted afterwards) */
const studioSingle = ownStudioVideos(test, 'single');
const studioMulti = ownStudioVideos(test, 'multi');

test.beforeAll(async () => {
  test.setTimeout(180000);
  // Until Studio is deployed where this runs (PR checks run against QA, which follows main)
  const studio = await fetch(`${process.env.WEB_APP_URL ?? 'https://videos.qa.alummahnow.net'}/en/studio`, { redirect: 'manual' });
  test.skip(studio.status === 404, 'Studio is not deployed to this environment yet');
  singleSeed = studioSingle.videos();
  multiSeed = studioMulti.videos();
  publicVideo = await createDisposableVideo('single', 'studio-ownership-public', { isPublic: true });
});

test.afterAll(async () => {
  await deleteVideoQuietly('single', publicVideo);
  publicVideo = null;
});

const rowOf = (page: Page, video: E2EVideo) => page.getByTestId('studio-video-row').filter({ has: page.locator(`[data-video-id="${video.id}"]`) });

async function openVideos(page: Page, channelId: string, query = '') {
  await page.goto(`/en/studio/${channelId}/content/videos${query}`);
  await expect(page.getByTestId('studio-videos')).toBeVisible();
  await expect(page.getByTestId('studio-videos-loading')).toHaveCount(0, { timeout: 20000 });
}

/** The Studio status tab the video is in now: Processing until Bunny has encoded it, then Published */
async function studioStatusOf(user: AuthUser, video: E2EVideo): Promise<'processing' | 'published'> {
  const fresh = await getVideo(userApi(user), video.id);
  return fresh?.uploadStatus && fresh.uploadStatus !== 'ready' ? 'processing' : 'published';
}

/** Opens the video's channel on the tab it is in and expects its row (re-read if encoding finishes in between) */
async function expectRow(page: Page, user: AuthUser, video: E2EVideo, filters = '') {
  await expect(async () => {
    await openVideos(page, video.channelId, `?status=${await studioStatusOf(user, video)}${filters}`);
    await expect(rowOf(page, video)).toBeVisible({ timeout: 5000 });
  }).toPass({ timeout: 45000 });
  return rowOf(page, video);
}

test.describe('Studio videos - single channel', () => {
  test.use({ storageState: AUTH_STATE.single });

  test('lists the owner\'s public and private videos, private ones marked', async ({ page }) => {
    await expectRow(page, 'single', publicOf());
    await expect(await expectRow(page, 'single', singleSeed[SEED_TITLES.singlePrivate])).toContainText('Private');
  });

  test('filters by visibility, kept in the URL', async ({ page }) => {
    const channelId = channelsOf('single').main.id;
    await expectRow(page, 'single', singleSeed[SEED_TITLES.singlePrivate], '&visibility=private');
    await expect(page).toHaveURL(/visibility=private/);
    // The public video's own tab, filtered to private, leaves it out
    await openVideos(page, channelId, `?status=${await studioStatusOf('single', publicOf())}&visibility=private`);
    await expect(rowOf(page, publicOf())).toHaveCount(0);
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
    await expectRow(page, 'multi', one);
    // Each channel's list, on the tab the other channel's video is in, leaves that video out
    await openVideos(page, one.channelId, `?status=${await studioStatusOf('multi', two)}`);
    await expect(rowOf(page, two)).toHaveCount(0);
    await expectRow(page, 'multi', two);
    await openVideos(page, two.channelId, `?status=${await studioStatusOf('multi', one)}`);
    await expect(rowOf(page, one)).toHaveCount(0);
  });
});
