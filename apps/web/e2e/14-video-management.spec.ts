import { test, expect } from './fixtures';
import type { Locator, Page } from '@playwright/test';
import { AUTH_STATE } from './test-utils/auth-state';
import {
  SEED_TITLES,
  createDisposableVideo,
  deleteVideoQuietly,
  ensureSeedVideos,
  getVideo,
  setupPublicDisposable,
  userApi,
  type E2EVideo,
} from './test-utils/e2e-videos';

/**
 * Video dashboard (/[locale]/dashboard/videos) E2E tests.
 *
 * The dashboard loads videos through a server action, so these tests run
 * against the single-channel E2E user's real QA videos: a fixed seed set for
 * read-only checks (all private), a public disposable video per worker for
 * privacy checks, and per-test disposable videos for delete flows. Everything
 * a test creates is deleted again.
 */

test.use({ storageState: AUTH_STATE.single });

let seed: Record<string, E2EVideo> = {};
const publicVideo = setupPublicDisposable('single', 'dashboard-public');

test.beforeAll(async () => {
  test.setTimeout(180000);
  seed = await ensureSeedVideos('single');
  await publicVideo.create();
});

test.afterAll(async () => {
  await publicVideo.remove();
});

const cards = (page: Page) => page.getByTestId('dashboard-video-card');
const card = (page: Page, video: E2EVideo) => page.locator(`[data-testid="dashboard-video-card"][data-video-id="${video.id}"]`);

async function openDashboard(page: Page, locale: 'en' | 'ar' = 'en') {
  await page.goto(`/${locale}/dashboard/videos`);
  await expect(page.getByTestId('dashboard-search')).toBeVisible();
  await expect(page.getByTestId('dashboard-loading')).toHaveCount(0);
}

/** Every card matching `cardLocator` has `attr` equal to `value` */
async function expectAllCards(list: Locator, attr: string, value: string) {
  const count = await list.count();
  for (let i = 0; i < count; i++) {
    await expect(list.nth(i)).toHaveAttribute(attr, value);
  }
}

test.describe('Video Dashboard', () => {
  test('should display the owner\'s public and private videos', async ({ page }) => {
    await openDashboard(page);

    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(card(page, publicVideo.get())).toBeVisible();
    await expect(card(page, seed[SEED_TITLES.singlePrivate])).toBeVisible();
  });

  test('should show video metadata on cards', async ({ page }) => {
    await openDashboard(page);

    const publicCard = card(page, publicVideo.get());
    await expect(publicCard.getByTestId('dashboard-video-title')).toHaveText(publicVideo.get().title);
    await expect(publicCard).toHaveAttribute('data-privacy', 'public');
    await expect(publicCard.getByTestId('dashboard-video-privacy')).toBeVisible();
    await expect(publicCard.getByTestId('dashboard-video-status')).toBeVisible();

    const privateCard = card(page, seed[SEED_TITLES.singlePrivate]);
    await expect(privateCard).toHaveAttribute('data-privacy', 'private');
    // Privacy badges differ between public and private videos
    const publicLabel = await publicCard.getByTestId('dashboard-video-privacy').textContent();
    await expect(privateCard.getByTestId('dashboard-video-privacy')).not.toHaveText(publicLabel || '');
  });

  test('should link each card to the video and its edit page', async ({ page }) => {
    await openDashboard(page);
    const video = seed[SEED_TITLES.singleVideo];
    const publicCard = card(page, video);

    await expect(publicCard.getByTestId('dashboard-video-view')).toHaveAttribute('href', `/en/video?vid=${video.id}`);
    await publicCard.getByTestId('dashboard-video-edit').click();
    await expect(page).toHaveURL(new RegExp(`/en/video/${video.id}/edit`));
    await expect(page.getByTestId('video-edit-form')).toBeVisible();
  });
});

test.describe('Video Filtering', () => {
  test('should filter videos by privacy', async ({ page }) => {
    await openDashboard(page);

    await page.getByTestId('dashboard-filter-privacy').selectOption('public');
    await expect(card(page, publicVideo.get())).toBeVisible();
    await expect(card(page, seed[SEED_TITLES.singlePrivate])).toHaveCount(0);
    await expectAllCards(cards(page), 'data-privacy', 'public');

    await page.getByTestId('dashboard-filter-privacy').selectOption('private');
    await expect(card(page, seed[SEED_TITLES.singlePrivate])).toBeVisible();
    await expect(card(page, publicVideo.get())).toHaveCount(0);
    await expectAllCards(cards(page), 'data-privacy', 'private');
  });

  test('should filter videos by status', async ({ page }) => {
    await openDashboard(page);
    const target = card(page, seed[SEED_TITLES.singleVideo]);
    await expect(target).toBeVisible();
    const status = (await target.getAttribute('data-status')) || 'ready';

    await page.getByTestId('dashboard-filter-status').selectOption(status);
    await expect(target).toBeVisible();
    await expectAllCards(cards(page), 'data-status', status);

    const other = ['ready', 'processing', 'uploading', 'failed'].find((s) => s !== status)!;
    await page.getByTestId('dashboard-filter-status').selectOption(other);
    await expect(target).toHaveCount(0);
  });

  test('should filter videos by format', async ({ page }) => {
    await openDashboard(page);
    const filter = page.getByTestId('dashboard-filter-duration');
    const target = card(page, seed[SEED_TITLES.singleVideo]);

    // The search API's formats: Shorts are up to 3 minutes AND vertical or square
    await expect(filter.locator('option')).toHaveText(['All Videos', 'Videos', 'Shorts', 'Live']);
    expect(await filter.locator('option').evaluateAll((os) => os.map((o) => (o as HTMLOptionElement).value))).toEqual(['all', 'standard', 'short', 'live']);

    // The seed is a 4-second landscape (426x240) clip: a video, not a Short
    await filter.selectOption('standard');
    await expect(target).toBeVisible();

    await filter.selectOption('short');
    await expect(target).toHaveCount(0);

    await filter.selectOption('live');
    await expect(target).toHaveCount(0);

    await filter.selectOption('all');
    await expect(target).toBeVisible();
  });

  test('should clear filters', async ({ page }) => {
    await openDashboard(page);

    await page.getByTestId('dashboard-filter-privacy').selectOption('private');
    await expect(card(page, publicVideo.get())).toHaveCount(0);

    await page.getByTestId('dashboard-filter-privacy').selectOption('all');
    await expect(card(page, publicVideo.get())).toBeVisible();
    await expect(card(page, seed[SEED_TITLES.singlePrivate])).toBeVisible();
  });
});

test.describe('Video Search', () => {
  test('should search videos by title', async ({ page }) => {
    await openDashboard(page);

    await page.getByTestId('dashboard-search').fill('E2E Seed Private');
    await expect(card(page, seed[SEED_TITLES.singlePrivate])).toBeVisible();
    await expect(card(page, seed[SEED_TITLES.singleVideo])).toHaveCount(0);
  });

  test('should show the empty state when nothing matches', async ({ page }) => {
    await openDashboard(page);

    await page.getByTestId('dashboard-search').fill('no video is called this zq9x');
    await expect(page.getByTestId('dashboard-empty')).toBeVisible();
    await expect(cards(page)).toHaveCount(0);
  });

  test('should clear search', async ({ page }) => {
    await openDashboard(page);

    await page.getByTestId('dashboard-search').fill('E2E Seed Private');
    await expect(card(page, seed[SEED_TITLES.singleVideo])).toHaveCount(0);

    await page.getByTestId('dashboard-search-clear').click();
    await expect(page.getByTestId('dashboard-search')).toHaveValue('');
    await expect(card(page, seed[SEED_TITLES.singleVideo])).toBeVisible();
  });
});

test.describe('Video Deletion', () => {
  let video: E2EVideo | null = null;

  test.beforeEach(async () => {
    video = await createDisposableVideo('single', 'delete');
  });

  test.afterEach(async () => {
    await deleteVideoQuietly('single', video);
  });

  test('should delete a single video', async ({ page }) => {
    await openDashboard(page);
    const target = card(page, video!);
    await expect(target).toBeVisible();

    await target.getByTestId('dashboard-video-delete').click();
    const dialog = page.getByRole('alertdialog');
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button').last().click();

    await expect(dialog).toBeHidden();
    await expect(target).toHaveCount(0);
    await expect(page.getByTestId('dashboard-error')).toHaveCount(0);
    // GET /api/videos/:id is briefly cached after a delete
    await expect.poll(() => getVideo(userApi('single'), video!.id), { timeout: 60000 }).toBeNull();
  });

  test('should cancel deletion', async ({ page }) => {
    await openDashboard(page);
    const target = card(page, video!);
    await expect(target).toBeVisible();

    await target.getByTestId('dashboard-video-delete').click();
    const dialog = page.getByRole('alertdialog');
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button').first().click();

    await expect(dialog).toBeHidden();
    await expect(target).toBeVisible();
    expect(await getVideo(userApi('single'), video!.id)).not.toBeNull();
  });
});

test.describe('Bulk Operations', () => {
  let videos: E2EVideo[] = [];

  test.beforeEach(async () => {
    videos = [await createDisposableVideo('single', 'bulk-a'), await createDisposableVideo('single', 'bulk-b')];
  });

  test.afterEach(async () => {
    for (const v of videos) await deleteVideoQuietly('single', v);
  });

  test('should select multiple videos', async ({ page }) => {
    await openDashboard(page);

    for (const v of videos) await card(page, v).getByTestId('dashboard-video-select').check();
    await expect(page.getByTestId('dashboard-bulk-actions')).toBeVisible();
    await expect(page.getByTestId('dashboard-selected-count')).toHaveAttribute('data-count', '2');

    await card(page, videos[0]).getByTestId('dashboard-video-select').uncheck();
    await expect(page.getByTestId('dashboard-selected-count')).toHaveAttribute('data-count', '1');
  });

  test('should delete multiple videos', async ({ page }) => {
    await openDashboard(page);

    for (const v of videos) await card(page, v).getByTestId('dashboard-video-select').check();
    await page.getByTestId('dashboard-delete-selected').click();
    const dialog = page.getByRole('alertdialog');
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button').last().click();

    await expect(dialog).toBeHidden();
    for (const v of videos) await expect(card(page, v)).toHaveCount(0);
    await expect(page.getByTestId('dashboard-error')).toHaveCount(0);
    const api = userApi('single');
    for (const v of videos) await expect.poll(() => getVideo(api, v.id), { timeout: 60000 }).toBeNull();
  });

  test('should select and deselect all videos', async ({ page }) => {
    await openDashboard(page);

    await card(page, videos[0]).getByTestId('dashboard-video-select').check();
    await page.getByTestId('dashboard-select-all').click();
    const total = await cards(page).count();
    await expect(page.getByTestId('dashboard-selected-count')).toHaveAttribute('data-count', String(total));

    await page.getByTestId('dashboard-select-all').click();
    await expect(page.getByTestId('dashboard-bulk-actions')).toHaveCount(0);
  });
});

test.describe('Video Dashboard - Mobile', () => {
  test('should fit a mobile viewport', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await openDashboard(page);

    const target = card(page, seed[SEED_TITLES.singleVideo]);
    await expect(target).toBeVisible();
    const box = await target.boundingBox();
    expect(box?.width ?? 0).toBeLessThanOrEqual(375);
    await expect(target.getByTestId('dashboard-video-edit')).toBeVisible();
  });
});

test.describe('Video Dashboard - RTL', () => {
  test('should render the Arabic dashboard right-to-left', async ({ page }) => {
    await openDashboard(page, 'ar');

    await expect(page.locator('div[dir="rtl"]').first()).toBeVisible();
    await expect(card(page, seed[SEED_TITLES.singleVideo])).toBeVisible();
    await expect(card(page, seed[SEED_TITLES.singleVideo]).getByTestId('dashboard-video-edit')).toHaveAttribute(
      'href',
      `/ar/video/${seed[SEED_TITLES.singleVideo].id}/edit`,
    );
  });
});

test.describe('Video Dashboard - No Channels', () => {
  test.use({ storageState: AUTH_STATE.none });

  test('should send users without a channel back to the home page', async ({ page }) => {
    await page.goto('/en/dashboard/videos');
    await expect(page).toHaveURL(/\/en\/?$/);
  });
});
