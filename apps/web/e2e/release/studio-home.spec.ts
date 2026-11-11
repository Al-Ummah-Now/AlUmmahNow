/**
 * Studio is the creator home (owner, 2026-11-10): the old creator pages
 * redirect into it, menus and channel links open it, and deletes are soft
 * (Recently deleted: restore, or queue for permanent deletion).
 */
import { expect, test } from '@playwright/test';
import { skipUntilStudioDeployed, studioDraftRecord, studioOwner } from './studio';
import { apiFetch } from './web-session';
import { target } from './targets';
import { fetchRetry } from './net';

// Sign-in pages carry the test password: never record them
test.use({ trace: 'off', video: 'off' });

test.describe('Release: Studio is the creator home', () => {
  test.beforeEach(skipUntilStudioDeployed);

  test('old creator pages redirect into Studio for the active channel', async ({ page }) => {
    const { channelId } = await studioOwner(page, 'rel-studio-home');
    const web = target().web;
    const studio = `${web}/en/studio/${channelId}`;
    for (const [old, landing] of [
      ['/en/dashboard/videos', `${studio}/content/videos`],
      ['/en/settings/channel/' + channelId + '/videos', `${studio}/content/videos`],
      ['/en/analytics', `${studio}/analytics`],
      ['/en/scheduled-videos', `${studio}/content/videos?status=scheduled&view=calendar`],
      ['/en/dashboard', `${studio}/dashboard`],
    ] as const) {
      const first = await fetchRetry(`${web}${old}`, { redirect: 'manual' });
      expect(first.status, `${old} answers 301`).toBe(301);
      // WebKit reports the redirect's follow-up as an interrupted navigation: that is the landing itself
      await page.goto(`${web}${old}`).catch((e: unknown) => {
        if (!/interrupted by another navigation/.test(String(e))) throw e;
      });
      await expect(page, `${old} lands in Studio`).toHaveURL(landing);
      await expect(page.getByTestId('studio-frame')).toBeVisible();
    }
  });

  test('menus, Upload and Manage open Studio on this channel', async ({ page }) => {
    const { channelId } = await studioOwner(page, 'rel-studio-links');
    await page.goto(`${target().web}/en/studio/${channelId}/dashboard`);
    await expect(page.getByTestId('studio-upload').first()).toHaveAttribute('href', `/en/upload?channel=${channelId}`);
    // Sections Studio hasn't rebuilt open the channel settings pages, never a dead end
    await expect(page.getByTestId('studio-nav-playlists').first()).toHaveAttribute('href', `/en/settings/channel/${channelId}/playlists`);
    await page.getByTestId('studio-upload').first().click();
    await expect(page).toHaveURL(new RegExp(`/en/upload\\?channel=${channelId}$`));
  });

  test('a deleted video is restorable, then can be queued for permanent deletion', async ({ page }) => {
    const { user, channelId } = await studioOwner(page, 'rel-studio-trash');
    const title = `Release E2E trash ${Date.now().toString(36)}`;
    const videoId = await studioDraftRecord(user, channelId, title);
    const videos = `${target().web}/en/studio/${channelId}/content/videos`;

    await page.goto(`${videos}?status=processing`);
    const row = page.getByTestId('studio-video-row').filter({ hasText: title });
    await expect(row).toHaveCount(1, { timeout: 30000 });
    await row.getByTestId('studio-video-select').check();
    await page.getByTestId('studio-bulk-delete').click();
    // The in-app dialog, never a browser prompt; it says the delete can be undone for 30 days
    await expect(page.getByTestId('studio-confirm-delete')).toContainText('30 days');
    await page.getByTestId('studio-confirm-delete-confirm').click();
    await expect(page.getByRole('status').filter({ hasText: 'moved to Recently deleted' })).toBeVisible();

    await page.getByTestId('studio-status-deleted').click();
    const deleted = page.getByTestId('studio-deleted-row').filter({ hasText: title });
    await expect(deleted).toHaveCount(1);
    await expect(deleted.getByTestId('studio-deleted-status')).toContainText('Deleted permanently in');
    await deleted.getByRole('button', { name: 'Restore' }).click();
    await expect(page.getByText('1 restored.')).toBeVisible();
    await expect(deleted).toHaveCount(0);
    const listed = await apiFetch(user, `/api/channels/${channelId}/content/deleted`);
    expect(((await listed.json()) as { result: { items: Array<{ id: string }> } }).result.items.map((v) => v.id)).not.toContain(videoId);

    // Delete again, then queue it for permanent deletion (type-to-confirm)
    expect((await apiFetch(user, `/api/videos/${videoId}`, { method: 'DELETE', headers: { channelId } })).status).toBe(200);
    await page.reload();
    await deleted.getByRole('button', { name: 'Delete permanently' }).click();
    await page.getByTestId('studio-confirm-purge-typed').fill('DELETE');
    await page.getByTestId('studio-confirm-purge-confirm').click();
    await expect(deleted.getByTestId('studio-deleted-status')).toHaveText('Queued for permanent deletion');
  });
});
