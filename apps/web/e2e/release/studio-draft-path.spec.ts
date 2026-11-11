/** A real upload through the draft life cycle (docs/specs/CREATOR-STUDIO.md §4.4.1). */
import path from 'node:path';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { skipUntilStudioDeployed, studioOwner } from './studio';
import { apiFetch } from './web-session';
import { target } from './targets';

// Sign-in pages carry the test password: never record them
test.use({ trace: 'off', video: 'off' });

const VIDEO = path.join(__dirname, '..', 'test-fixtures', 'e2e-sample.mp4');

test.describe('Release: Studio draft path', () => {
  test.beforeEach(skipUntilStudioDeployed);

  test('upload, save draft, schedule, cancel, draft, publish', async ({ page }) => {
    test.setTimeout(420000);
    const { user, channelId } = await studioOwner(page, 'rel-studio-draft');
    const videos = `${target().web}/en/studio/${channelId}/content/videos`;
    const title = `Release E2E draft ${Date.now().toString(36)}`;
    let videoId = '';

    const row = (): Locator => page.getByTestId('studio-video-row').filter({ hasText: title });
    const openStatus = async (status: string): Promise<void> => {
      await expect
        .poll(async () => {
          await page.goto(`${videos}?status=${status}`);
          await page.getByTestId('studio-videos').waitFor();
          await page.waitForLoadState('networkidle');
          return row().count();
        }, { message: `the video never reached ${status}`, timeout: 180000, intervals: [5000] })
        .toBe(1);
    };
    const act = async (name: string, on: Page = page): Promise<void> => {
      await row().getByTestId('studio-video-actions').click();
      await on.getByRole('menuitem', { name }).click();
    };

    try {
      // Upload, saved as a draft
      await page.goto(`${target().web}/en/upload`);
      await expect(page.getByTestId('upload-dropzone')).toBeVisible({ timeout: 30000 });
      await page.getByTestId('upload-file-input').setInputFiles(VIDEO);
      await expect(page.getByTestId('upload-details')).toBeVisible();
      await page.getByTestId('upload-title-en').fill(title);
      await page.getByTestId('upload-save-draft').check();
      await page.getByTestId('upload-submit').click();
      await expect(page.getByTestId('upload-success')).toBeVisible({ timeout: 150000 });

      await openStatus('drafts');
      const listed = await apiFetch(user, `/api/channels/${channelId}/content?status=drafts`);
      videoId = ((await listed.json()) as { result: { items: Array<{ id: string; title: string }> } }).result.items.find((v) => v.title === title)?.id ?? '';
      expect(videoId, 'draft not returned by the API').toBeTruthy();

      // Schedule it
      await row().getByRole('checkbox').check();
      await page.getByTestId('studio-bulk-bar').getByRole('button', { name: 'Schedule' }).click();
      const tomorrow = new Date(Date.now() + 24 * 3600 * 1000);
      const local = new Date(tomorrow.getTime() - tomorrow.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
      await page.getByLabel('Publish the first video at').fill(local);
      await page.getByRole('dialog').getByRole('button', { name: 'Schedule' }).click();
      await openStatus('scheduled');

      // Cancel: back to Drafts
      await act('Cancel schedule');
      await openStatus('drafts');

      // Publish
      await act('Publish now');
      await openStatus('published');
      await expect(row()).not.toContainText('Private');
    } finally {
      if (videoId) await apiFetch(user, `/api/videos/${videoId}`, { method: 'DELETE', headers: { channelId } });
    }
  });
});
