/**
 * The Videos list on the shared list foundation, end to end on QA:
 *
 * - LIST-01 filters live in the URL: a search and a status filter survive a
 *   reload, the detail page's Back link and the browser's Back button.
 * - LIST-02 undo instead of confirm: the row's Unpublish acts at once (no
 *   dialog), a toast offers Undo, `u` undoes it and admin-api shows the video
 *   published again.
 *
 * Data: one throwaway channel and one video record (upload initiated, no file)
 * made by the seeded super admin for this test file and deleted afterwards, as
 * 14-channel-transfer does. Nothing shared is changed. Chromium only (the
 * test changes its own video's state). PR runs skip while QA's admin-web
 * predates the client lists.
 */
import { test, expect, type Page } from '@playwright/test';
import { adminApi, readTokens } from './support/api';
import { RUN_ID, VIDEOS_API_URL } from './support/env';
import { skipUntilClientListsDeployed } from './support/deployed';

const superToken = () => readTokens().superadmin;
let channelId = '';
let videoId = '';

async function videosApi(path: string, init: RequestInit = {}): Promise<{ status: number; body: Record<string, unknown> & { result?: Record<string, unknown> } }> {
  const res = await fetch(`${VIDEOS_API_URL}${path}`, {
    ...init,
    headers: { authorization: `Bearer ${superToken()}`, 'content-type': 'application/json', ...(init.headers as Record<string, string>) },
  });
  const text = await res.text();
  let body: Record<string, unknown> = {};
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    body = { error: text.slice(0, 200) };
  }
  return { status: res.status, body };
}

const row = (page: Page) => page.locator(`[data-testid="video-row"][data-video-id="${videoId}"]`);

/** The admin index is updated by the processor a moment after the upload: reload until the row is listed. */
async function openListed(page: Page, url: string) {
  await expect
    .poll(
      async () => {
        await page.goto(url);
        await expect(page.getByTestId('videos-list')).toHaveAttribute('data-list-ready', 'true');
        return row(page).count();
      },
      { message: `video not listed at ${url}`, timeout: 90_000, intervals: [2_000, 5_000] },
    )
    .toBeGreaterThan(0);
}

async function holds(): Promise<string[]> {
  const { status, body } = await adminApi<{ suspensionHolds?: string[] }>(`/api/content/videos/${encodeURIComponent(videoId)}`);
  expect(status, 'admin-api video detail').toBe(200);
  return body.result?.suspensionHolds ?? [];
}

test.describe('videos list', () => {
  test.describe.configure({ mode: 'serial' });

  test.beforeAll(async ({}, testInfo) => {
    test.skip(testInfo.project.name !== 'chromium', 'One project only: the tests change their own video');
    await skipUntilClientListsDeployed();
    const tag = `${RUN_ID || 'local'}-${Date.now().toString(36)}`;
    const channel = await videosApi('/api/channels', {
      method: 'POST',
      body: JSON.stringify({ name: `E2E list ${tag}`, description: '[e2e-admin] videos list', isMain: false }),
    });
    channelId = String((channel.body.result as { channel?: { id?: string } } | undefined)?.channel?.id ?? '');
    expect(channelId, `channel create -> ${channel.status}`).toBeTruthy();
    const video = await videosApi('/api/videos/upload/initiate', {
      method: 'POST',
      headers: { channelId },
      body: JSON.stringify({ title: `E2E list video ${tag}`, description: '[e2e-admin] videos list', isPublic: true, fileSize: 1024, mimeType: 'video/mp4' }),
    });
    videoId = String((video.body.result as { videoId?: string } | undefined)?.videoId ?? '');
    expect(videoId, `upload initiate -> ${video.status}`).toBeTruthy();
  });

  test.afterAll(async () => {
    if (videoId) await videosApi(`/api/videos/${encodeURIComponent(videoId)}`, { method: 'DELETE', headers: { channelId } }).catch(() => undefined);
    if (channelId) await adminApi(`/api/content/channels/${encodeURIComponent(channelId)}`, { method: 'DELETE', token: superToken() }).catch(() => undefined);
  });

  test('LIST-01 filters persist in the URL across reload, the Back link and the browser Back', async ({ page }) => {
    await openListed(page, `/videos?q=${encodeURIComponent(videoId)}`);

    // A filter applies at once and is written to the URL without a reload
    await page.getByTestId('videos-filters-visibility').selectOption('public');
    await expect(page).toHaveURL(new RegExp(`\\?q=${videoId}&visibility=public$`));
    await expect(row(page)).toBeVisible();
    await expect(page.locator('[data-testid="filter-chip"][data-filter="visibility"]')).toBeVisible();

    // Typing in the search box is written after a pause
    await page.getByTestId('videos-filters-q-input').fill(`${videoId}-nothing`);
    await expect(page).toHaveURL(/q=[^&]*-nothing/);
    await expect(page.getByTestId('content-empty')).toBeVisible();
    await page.getByTestId('videos-filters-q-input').fill(videoId);
    await expect(page).toHaveURL(new RegExp(`\\?q=${videoId}&visibility=public$`));
    await expect(row(page)).toBeVisible();

    // Reload: the same list
    await page.reload();
    await expect(row(page)).toBeVisible();
    await expect(page.getByTestId('videos-filters-visibility')).toHaveValue('public');
    await expect(page.getByTestId('videos-filters-q-input')).toHaveValue(videoId);

    // The detail page's Back link returns to the filtered list
    await row(page).getByTestId('video-link').click();
    await expect(page).toHaveURL(new RegExp(`/videos/${videoId}\\?list=`));
    await page.getByRole('link', { name: /Back to Videos/ }).click();
    await expect(page).toHaveURL(new RegExp(`/videos\\?q=${videoId}&visibility=public$`));
    await expect(row(page)).toBeVisible();

    // And so does the browser's Back button
    await row(page).getByTestId('video-link').click();
    await expect(page).toHaveURL(new RegExp(`/videos/${videoId}`));
    await page.goBack();
    await expect(page).toHaveURL(new RegExp(`/videos\\?q=${videoId}&visibility=public$`));
    await expect(row(page)).toBeVisible();
    await expect(page.getByTestId('videos-filters-visibility')).toHaveValue('public');

    // A saved view replaces the filters
    await page.getByTestId('saved-view-all').click();
    await expect(page).toHaveURL(/\/videos$/);
    await expect(page.getByTestId('saved-view-all')).toHaveAttribute('aria-current', 'page');
  });

  test('LIST-02 Unpublish acts at once with an Undo toast; u undoes it', async ({ page }) => {
    page.on('dialog', (d) => {
      throw new Error(`A browser dialog opened: ${d.type()} ${d.message()}`);
    });
    await openListed(page, `/videos?q=${encodeURIComponent(videoId)}`);
    await expect(row(page)).toHaveAttribute('data-hidden', 'false');

    await row(page).getByTestId('video-row-unpublish').click();
    const toast = page.getByTestId('undo-toast').filter({ hasText: 'Video unpublished' });
    await expect(toast).toBeVisible();
    await expect(toast).toHaveAttribute('data-status', 'done');
    await expect(row(page)).toHaveAttribute('data-hidden', 'true');
    await expect(row(page).getByTestId('video-row-republish')).toBeVisible();
    expect(await holds(), 'unpublished in admin-api').toContain('admin:unpublished');

    // u undoes the newest change (focus is on the row's button, not a text field)
    await page.keyboard.press('u');
    await expect(toast.or(page.getByTestId('undo-toast').filter({ hasText: 'Undone' })).first()).toHaveAttribute('data-status', 'undone');
    await expect(row(page)).toHaveAttribute('data-hidden', 'false');
    await expect.poll(holds, { message: 'republished in admin-api', timeout: 15_000 }).not.toContain('admin:unpublished');
  });
});
