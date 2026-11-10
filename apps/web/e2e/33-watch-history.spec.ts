import { test, expect } from './fixtures';
import type { APIRequestContext } from '@playwright/test';
import { ANONYMOUS_STATE, AUTH_STATE, readAccount } from './test-utils/auth-state';
import { apiCall, qaLectures, type QaVideo } from './test-utils/watch-page';

/**
 * Watch history page (/[locale]/history).
 *
 * Entries are recorded through POST /api/watch-history for the profile-only
 * ("none") E2E user, which no other spec uses for history, and removed again.
 */

const USER = 'none' as const;

async function record(request: APIRequestContext, video: QaVideo, progress: number) {
  const { accessToken } = readAccount(USER);
  const duration = video.duration || 60;
  const res = await apiCall(request, 'POST', '/api/watch-history', {
    token: accessToken,
    data: { videoId: video.id, progress: Math.round(duration * progress), duration },
  });
  expect(res.status(), await res.text()).toBeLessThan(300);
}

async function remove(request: APIRequestContext, videoId: string) {
  const { accessToken } = readAccount(USER);
  await apiCall(request, 'DELETE', `/api/watch-history/${videoId}`, { token: accessToken });
}

test.describe('watch history - anonymous', () => {
  test.use({ storageState: ANONYMOUS_STATE });

  for (const [locale, title, prompt] of [
    ['en', 'Watch History', 'Sign in to see your watch history.'],
    ['ar', 'سجل المشاهدة', 'سجل الدخول لعرض سجل المشاهدة.'],
  ] as const) {
    test(`HIST-001 asks anonymous visitors to sign in (${locale})`, async ({ page }) => {
      await page.goto(`/${locale}/history`);
      await expect(page.getByRole('heading', { level: 1, name: title })).toBeVisible();
      await expect(page.getByText(prompt)).toBeVisible();
      await expect(page.locator('html')).toHaveAttribute('dir', locale === 'ar' ? 'rtl' : 'ltr');
      await expect(page.getByRole('listitem')).toHaveCount(0);
    });
  }
});

test.describe('watch history - signed in', () => {
  test.use({ storageState: AUTH_STATE[USER] });
  test.describe.configure({ mode: 'serial' });

  let videos: QaVideo[] = [];

  test.beforeAll(async ({ request }) => {
    videos = (await qaLectures(request)).slice(0, 2);
    expect(videos.length).toBeGreaterThan(0);
  });
  test.afterEach(async ({ request }) => {
    for (const v of videos) await remove(request, v.id);
  });

  for (const [locale, percent, removeLabel] of [
    ['en', /40% watched/, 'Remove from history'],
    ['ar', /تمت مشاهدة 40%/, 'إزالة من السجل'],
  ] as const) {
    test(`HIST-002 lists a watched video with progress, links to it, and removes it (${locale})`, async ({ page, request }) => {
      const video = videos[0];
      await record(request, video, 0.4);
      await page.goto(`/${locale}/history`);

      const entry = page.getByRole('listitem').filter({ has: page.locator(`a[href="/${locale}/video/${video.id}"]`) });
      await expect(entry).toBeVisible();
      await expect(entry).toContainText(video.title);
      await expect(entry).toContainText(percent);
      await expect(entry.getByRole('link', { name: video.title })).toHaveAttribute('href', `/${locale}/video/${video.id}`);

      await entry.getByRole('button', { name: removeLabel }).click();
      await expect(entry).toHaveCount(0);

      // Gone on the server too
      await page.reload();
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      await expect(page.locator(`a[href="/${locale}/video/${video.id}"]`)).toHaveCount(0);
    });
  }

  test('HIST-003 opening an entry goes to its watch page', async ({ page, request }) => {
    const video = videos[0];
    await record(request, video, 0.97);
    await page.goto('/en/history');
    const entry = page.getByRole('listitem').filter({ has: page.locator(`a[href="/en/video/${video.id}"]`) });
    // >= 95% counts as completed
    await expect(entry).toContainText('Watched');
    await entry.getByRole('link', { name: video.title }).click();
    await expect(page).toHaveURL(new RegExp(`/en/video/${video.id}$`));
    await expect(page.getByTestId('video-metrics')).toBeVisible();
  });

  test('HIST-004 "clear all" asks for confirmation and empties the history', async ({ page, request }) => {
    for (const v of videos) await record(request, v, 0.2);
    await page.goto('/en/history');
    await expect(page.getByRole('listitem')).toHaveCount(videos.length);
    await expect(page.getByText(`${videos.length} videos`)).toBeVisible();

    // Dismissing the confirmation keeps everything
    await page.getByRole('button', { name: 'Clear all history' }).click();
    await page.getByTestId('watch-history-clear-dialog-cancel').click();
    await expect(page.getByRole('listitem')).toHaveCount(videos.length);

    // Clearing everything needs the delete word typed first
    await page.getByRole('button', { name: 'Clear all history' }).click();
    const dialog = page.getByTestId('watch-history-clear-dialog');
    await expect(dialog).toContainText('Clear your entire watch history?');
    await expect(page.getByTestId('watch-history-clear-dialog-confirm')).toBeDisabled();
    await page.getByTestId('watch-history-clear-dialog-typed').fill('DELETE');
    await page.getByTestId('watch-history-clear-dialog-confirm').click();
    await expect(page.getByRole('heading', { name: 'No watch history yet' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Browse Videos' })).toHaveAttribute('href', '/en');
  });

  test('HIST-005 empty history shows the Arabic empty state in RTL', async ({ page, request }) => {
    for (const v of videos) await remove(request, v.id);
    const { accessToken } = readAccount(USER);
    await apiCall(request, 'DELETE', '/api/watch-history', { token: accessToken });
    await page.goto('/ar/history');
    await expect(page.getByRole('heading', { name: 'لا يوجد سجل مشاهدة بعد' })).toBeVisible();
    await expect(page.locator('main [dir="rtl"], [dir="rtl"]').first()).toBeVisible();
  });
});
