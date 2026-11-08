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
import { ARABIC, expectDarkSurface, getSchedule, scheduleVideoApi } from './test-utils/upload-studio';

/**
 * Video edit page (/[locale]/video/[id]/edit): the Schedule Publication
 * section (ScheduleSection), the category selector, theming, localization and
 * access states. Anything that schedules, publishes or saves works on a
 * disposable video the test uploads and deletes; read-only checks use the
 * single-channel user's seed video.
 */

test.use({ storageState: AUTH_STATE.single });

const DAY = 24 * 60 * 60 * 1000;
let seed: Record<string, E2EVideo> = {};

test.beforeAll(async () => {
  test.setTimeout(180000);
  seed = await ensureSeedVideos('single');
});

async function openEditor(page: Page, video: E2EVideo, locale: 'en' | 'ar' = 'en') {
  await page.goto(`/${locale}/video/${video.id}/edit`);
  await expect(page.getByTestId('video-edit-form')).toBeVisible();
  await page.waitForLoadState('networkidle').catch(() => undefined);
  await expect(page.getByTestId('edit-schedule')).toBeVisible();
}

/** YYYY-MM-DD for a date `ms` from now, in the browser's (local) time zone */
const localDay = (ms: number) => {
  const d = new Date(Date.now() + ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

test.describe('Edit schedule - private video', () => {
  let video: E2EVideo | null = null;

  test.beforeEach(async () => {
    video = await createDisposableVideo('single', 'edit-schedule', { isPublic: false });
  });

  test.afterEach(async () => {
    await deleteVideoQuietly('single', video);
  });

  test('SCHED-201 schedules a private video and cancels the schedule (en)', async ({ page }) => {
    await openEditor(page, video!);
    const section = page.getByTestId('edit-schedule');
    await expect(section).toHaveAttribute('data-state', 'unscheduled');
    await expect(page.getByTestId('edit-schedule-submit')).toBeDisabled();
    await expect(page.getByLabel('Date', { exact: true })).toBeVisible();
    await expect(page.getByLabel('Time', { exact: true })).toBeVisible();
    await expect(page.getByTestId('edit-schedule-timezone')).toContainText('Timezone:');

    // A time in the past is rejected
    await page.getByTestId('edit-schedule-date').fill(localDay(0));
    await page.getByTestId('edit-schedule-time').fill('00:00');
    await page.getByTestId('edit-schedule-submit').click();
    await expect(page.getByTestId('edit-schedule-error')).toHaveText(/future/i);

    await page.getByTestId('edit-schedule-date').fill(localDay(3 * DAY));
    await page.getByTestId('edit-schedule-time').fill('10:30');
    await page.getByTestId('edit-schedule-submit').click();
    // (message wording comes from the synced translations; only its presence is asserted)
    await expect(page.getByTestId('edit-schedule-success')).toBeVisible();
    await expect(section).toHaveAttribute('data-state', 'scheduled');
    await expect(page.getByTestId('edit-schedule-status')).toHaveText(/schedul/i);
    await expect(page.getByTestId('edit-schedule-summary')).toBeVisible();
    await expect(page.getByTestId('edit-schedule-submit')).toHaveText(/Update Schedule/);
    await expect.poll(async () => (await getSchedule('single', video!))?.status, { timeout: 60000 }).toBe('scheduled');

    await page.getByTestId('edit-schedule-cancel').click();
    await expect(page.getByTestId('edit-schedule-success')).toBeVisible();
    await expect(section).toHaveAttribute('data-state', 'unscheduled');
    await expect(page.getByTestId('edit-schedule-date')).toHaveValue('');
    await expect
      .poll(async () => (await getSchedule('single', video!))?.status ?? 'none', { timeout: 60000 })
      .not.toBe('scheduled');
  });

  test('SCHED-202 publishes a scheduled video immediately', async ({ page }) => {
    await scheduleVideoApi('single', video!, 4);
    await openEditor(page, video!);
    await expect(page.getByTestId('edit-schedule-status')).toHaveAttribute('data-status', 'scheduled');

    await page.getByTestId('edit-schedule-publish-now').click();
    await expect(page.getByTestId('edit-schedule-success')).toBeVisible();
    await expect(page.getByTestId('edit-schedule-status')).toHaveAttribute('data-status', 'published');
    await expect(page.getByTestId('edit-schedule-submit')).toHaveCount(0);
    await expect.poll(async () => (await getVideo(userApi('single'), video!.id))?.isPublic, { timeout: 60000 }).toBe(true);
  });

  test.describe('far-east time zone', () => {
    // 12:00 UTC is 02:00 the next day in UTC+14; the editor used to show the UTC day
    test.use({ timezoneId: 'Pacific/Kiritimati' });

    test('SCHED-203 shows a stored schedule in the viewer\'s local date and time', async ({ page }) => {
      const iso = await scheduleVideoApi('single', video!, 5);
      await openEditor(page, video!);

      const local = new Date(new Date(iso).getTime() + 14 * 60 * 60 * 1000);
      const expectedDay = local.toISOString().slice(0, 10);
      await expect(page.getByTestId('edit-schedule-date')).toHaveValue(expectedDay);
      await expect(page.getByTestId('edit-schedule-time')).toHaveValue('02:00');
    });
  });

  test('SCHED-204 localizes the schedule section (ar)', async ({ page }) => {
    await openEditor(page, video!, 'ar');
    const section = page.getByTestId('edit-schedule');
    await expect(section.getByRole('heading')).toHaveText(ARABIC);
    await expect(page.getByTestId('edit-schedule-date')).toHaveAccessibleName(ARABIC);
    await expect(page.getByTestId('edit-schedule-time')).toHaveAccessibleName(ARABIC);
    await expect(page.getByTestId('edit-schedule-submit')).toHaveText(ARABIC);
    await expect(page.getByTestId('edit-schedule-timezone')).toContainText(ARABIC);

    await page.getByTestId('edit-schedule-date').fill(localDay(0));
    await page.getByTestId('edit-schedule-time').fill('00:00');
    await page.getByTestId('edit-schedule-submit').click();
    await expect(page.getByTestId('edit-schedule-error')).toHaveText(ARABIC);
  });

  test('EDIT-101 saves the category chosen on the edit page', async ({ page }) => {
    await openEditor(page, video!);
    await page.getByLabel('Video Category').selectOption('fiqh');
    await expect(page.getByTestId('video-edit-unsaved')).toBeVisible();
    await page.getByTestId('video-edit-save').click();
    await expect(page.getByTestId('video-edit-error')).toHaveCount(0);

    await expect
      .poll(async () => ((await getVideo(userApi('single'), video!.id)) as E2EVideo & { category?: string })?.category, { timeout: 60000 })
      .toBe('fiqh');
  });
});

test.describe('Edit schedule - public video', () => {
  test('SCHED-205 explains that public videos cannot be scheduled (en + ar)', async ({ page }) => {
    const video = await createDisposableVideo('single', 'edit-public', { isPublic: true });
    try {
      await openEditor(page, video);
      await expect(page.getByTestId('edit-schedule')).toHaveAttribute('data-state', 'public');
      await expect(page.getByTestId('edit-schedule-public-note')).toHaveText('This video is already public');
      await expect(page.getByTestId('edit-schedule-date')).toHaveCount(0);

      await openEditor(page, video, 'ar');
      await expect(page.getByTestId('edit-schedule-public-note')).toHaveText(ARABIC);
    } finally {
      await deleteVideoQuietly('single', video);
    }
  });
});

test.describe('Edit page - theme, locale and access', () => {
  test.describe('dark', () => {
    test.use({ colorScheme: 'dark' });

    for (const locale of ['en', 'ar'] as const) {
      test(`EDIT-102 renders the editor in the dark scheme (${locale})`, async ({ page }) => {
        await openEditor(page, seed[SEED_TITLES.singleVideo], locale);
        const form = page.getByTestId('video-edit-form');
        await expectDarkSurface(page, form, form.getByRole('heading', { level: 2 }));
      });
    }
  });

  test('EDIT-103 shows Arabic labels and right-to-left fields (ar)', async ({ page }) => {
    await openEditor(page, seed[SEED_TITLES.singleVideo], 'ar');
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.getByTestId('category-select')).toHaveAccessibleName(ARABIC);
    await expect(page.getByTestId('chapter-mode-manual')).toContainText(ARABIC);
    await expect(page.getByTestId('video-edit-save')).toHaveText(ARABIC);
  });

  test('EDIT-104 reports a video that does not exist', async ({ page }) => {
    await page.goto('/en/video/00000000-0000-0000-0000-000000000000/edit');
    await expect(page.getByTestId('video-edit-page-error')).toBeVisible();
    await expect(page.getByTestId('video-edit-page-error').getByRole('link')).toHaveAttribute('href', '/en/dashboard/videos');
  });

  test.describe('signed out', () => {
    test.use({ storageState: ANONYMOUS_STATE });

    test('EDIT-105 sends anonymous visitors to the home page', async ({ page }) => {
      await page.goto(`/en/video/${seed[SEED_TITLES.singleVideo].id}/edit`);
      await expect(page).toHaveURL(/\/en\/?$/);
      await expect(page.getByTestId('video-edit-form')).toHaveCount(0);
    });
  });
});
