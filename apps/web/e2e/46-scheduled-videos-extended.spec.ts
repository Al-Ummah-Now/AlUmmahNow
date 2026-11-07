import type { Page } from '@playwright/test';
import { test, expect } from './fixtures';
import { AUTH_STATE, ANONYMOUS_STATE } from './test-utils/auth-state';
import {
  SEED_TITLES,
  createDisposableVideo,
  deleteVideoQuietly,
  ensureSeedVideos,
  getVideo,
  userApi,
  type E2EVideo,
} from './test-utils/e2e-videos';
import { ARABIC, expectDarkSurface, expectNoHorizontalScroll, getSchedule, scheduleVideoApi } from './test-utils/upload-studio';

/**
 * Scheduled videos page (/[locale]/scheduled-videos) beyond
 * scheduled-videos-calendar.spec.ts: the list's Publish Now / Cancel Schedule
 * actions (on a disposable video scheduled by the test), item details,
 * Arabic, dark mode, the phone layout and anonymous access.
 */

test.use({ storageState: AUTH_STATE.single });

let scheduledSeed: E2EVideo;

test.beforeAll(async () => {
  test.setTimeout(180000);
  scheduledSeed = (await ensureSeedVideos('single'))[SEED_TITLES.singleScheduled];
});

const item = (page: Page, video: E2EVideo) => page.locator(`[data-testid="scheduled-video-item"][data-video-id="${video.id}"]`);

async function openList(page: Page, locale: 'en' | 'ar' = 'en') {
  await page.goto(`/${locale}/scheduled-videos?view=list`);
  await expect(page.getByTestId('scheduled-videos-page')).toBeVisible();
  await page.waitForLoadState('networkidle').catch(() => undefined);
}

/** The search index can lag a freshly scheduled video by a few seconds; reload until it is listed */
async function waitForItem(page: Page, video: E2EVideo) {
  await expect(async () => {
    if (!(await item(page, video).isVisible())) {
      await page.reload();
      await expect(item(page, video)).toBeVisible({ timeout: 8000 });
    }
  }).toPass({ timeout: 60000 });
}

test.describe('Scheduled list - actions', () => {
  let video: E2EVideo | null = null;

  test.beforeEach(async () => {
    video = await createDisposableVideo('single', 'scheduled-list');
    await scheduleVideoApi('single', video, 3);
  });

  test.afterEach(async () => {
    await deleteVideoQuietly('single', video);
  });

  test('CAL-101 cancels a schedule from the list after confirmation', async ({ page }) => {
    await openList(page);
    await waitForItem(page, video!);
    const row = item(page, video!);

    page.once('dialog', (d) => d.dismiss());
    await row.getByTestId('scheduled-video-cancel').click();
    await expect(row).toBeVisible();
    expect((await getSchedule('single', video!))?.status).toBe('scheduled');

    page.once('dialog', (d) => d.accept());
    await row.getByTestId('scheduled-video-cancel').click();
    await expect(row).toHaveCount(0, { timeout: 30000 });
    await expect.poll(async () => (await getSchedule('single', video!))?.status ?? 'none', { timeout: 60000 }).not.toBe('scheduled');
  });

  test('CAL-102 publishes a scheduled video now from the list', async ({ page }) => {
    await openList(page);
    await waitForItem(page, video!);
    const row = item(page, video!);
    page.once('dialog', (d) => d.accept());
    await row.getByTestId('scheduled-video-publish-now').click();

    await expect(row).toHaveCount(0, { timeout: 30000 });
    await expect.poll(async () => (await getVideo(userApi('single'), video!.id))?.isPublic, { timeout: 60000 }).toBe(true);
  });

  test('CAL-103 shows the publish date, countdown and edit link', async ({ page }) => {
    await openList(page);
    await waitForItem(page, video!);
    const row = item(page, video!);
    await expect(row.getByTestId('scheduled-video-title')).toHaveText(video!.title);
    await expect(row.getByTestId('scheduled-video-date')).toContainText('Scheduled for');
    await expect(row.getByTestId('scheduled-video-countdown')).toContainText(/days/);
    await expect(row.getByTestId('scheduled-video-edit')).toHaveAttribute('href', `/en/video/${video!.id}/edit`);
    await row.getByTestId('scheduled-video-edit').click();
    await expect(page).toHaveURL(new RegExp(`/en/video/${video!.id}/edit`));
    await expect(page.getByTestId('edit-schedule-status')).toHaveAttribute('data-status', 'scheduled');
  });
});

test.describe('Scheduled list - locale, theme and layout', () => {
  test('CAL-104 shows the list in Arabic (ar)', async ({ page }) => {
    await openList(page, 'ar');
    await waitForItem(page, scheduledSeed);
    const row = item(page, scheduledSeed);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(ARABIC);
    await expect(page.getByTestId('scheduled-status-filter')).toHaveAccessibleName(ARABIC);
    await expect(row.getByTestId('scheduled-video-countdown')).toContainText(ARABIC);
    await expect(row.getByTestId('scheduled-video-edit')).toHaveText(ARABIC);
    await expect(row.getByTestId('scheduled-video-edit')).toHaveAttribute('href', `/ar/video/${scheduledSeed.id}/edit`);
  });

  test.describe('dark', () => {
    test.use({ colorScheme: 'dark' });

    test('CAL-105 renders list items and the calendar in the dark scheme', async ({ page }) => {
      await openList(page);
      await waitForItem(page, scheduledSeed);
      const row = item(page, scheduledSeed);
      await expectDarkSurface(page, row, row.getByTestId('scheduled-video-title'));

      await page.getByTestId('view-switch-calendar').click();
      const calendar = page.getByTestId('scheduled-calendar');
      await expect(calendar).toBeVisible();
      await expectDarkSurface(page, calendar, page.getByTestId('calendar-header'));
    });
  });

  test('CAL-106 fits a phone screen in list and calendar views', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 740 });
    await openList(page);
    await waitForItem(page, scheduledSeed);
    await expectNoHorizontalScroll(page);
    await page.getByTestId('view-switch-calendar').click();
    await expect(page.getByTestId('scheduled-calendar')).toBeVisible();
    await expectNoHorizontalScroll(page);
  });
});

test.describe('Scheduled videos - signed out', () => {
  test.use({ storageState: ANONYMOUS_STATE });

  test('CAL-107 sends anonymous visitors to the home page', async ({ page }) => {
    await page.goto('/en/scheduled-videos');
    await expect(page).toHaveURL(/\/en\/?$/);
    await expect(page.getByTestId('scheduled-videos-page')).toHaveCount(0);
  });
});
