/** A real upload through the draft life cycle (docs/specs/CREATOR-STUDIO.md §4.4.1). */
import path from 'node:path';
import { encoding, untilEncoded } from './encode';
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
    // Bunny's encode (up to ~9 min on a busy library) comes first: a draft is listed once encoded
    test.setTimeout(15 * 60_000);
    const { user, channelId } = await studioOwner(page, 'rel-studio-draft');
    const videos = `${target().web}/en/studio/${channelId}/content/videos`;
    const title = `Release E2E draft ${Date.now().toString(36)}`;
    let videoId = '';

    const row = (): Locator => page.getByTestId('studio-video-row').filter({ hasText: title });
    const openStatus = async (status: string): Promise<void> => {
      await expect
        .poll(async () => {
          await page.goto(`${videos}?status=${status}`);
          // Client-rendered: read once it shows rows or its empty state, never mid-load
          await expect(page.locator('[data-testid="studio-video-row"], [data-testid="studio-videos-empty"]').first()).toBeVisible({ timeout: 30000 });
          return row().count();
        }, { message: `the video never reached ${status}`, timeout: 90000, intervals: [3000] })
        .toBe(1);
    };
    // A row action runs a server action; navigating before it has been sent cancels it
    // (Firefox and WebKit dispatch it later than Chromium), so wait for its result notice
    const act = async (name: string, done: string, on: Page = page): Promise<void> => {
      await row().getByTestId('studio-video-actions').click();
      await on.getByRole('menuitem', { name }).click();
      await expect(on.getByRole('status').filter({ hasText: new RegExp(`${done}|didn't work`) })).toHaveText(done, { timeout: 30000 });
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

      // Studio lists a video under Drafts once it is encoded (studioVideoStatus: Processing
      // until then). Wait for that on the video itself, so Bunny's encode time is not
      // mistaken for a Studio defect; then Studio must list it promptly.
      await expect
        .poll(async () => {
          const res = await apiFetch(user, `/api/videos/search?limit=100&isOwner=true&channelIds=${channelId}`, { headers: { channelId } });
          videoId = ((await res.json().catch(() => ({}))) as { data?: Array<{ id: string; title: string }> }).data?.find((v) => v.title === title)?.id ?? '';
          return videoId;
        }, { message: 'the uploaded draft is not in the owner\'s videos', timeout: 60000 })
        .not.toBe('');
      const draftStatus = async () => {
        const res = await apiFetch(user, `/api/videos/${videoId}/upload-status`, { headers: { channelId } });
        return ((await res.json().catch(() => ({}))) as { result?: { status?: string } }).result?.status ?? '';
      };
      await untilEncoded('the draft',
        () => expect.poll(draftStatus, { message: 'the draft never finished encoding', timeout: 9 * 60_000, intervals: [5000] }).toBe('ready'),
        async () => encoding(await draftStatus()));

      await openStatus('drafts');
      const listed = await apiFetch(user, `/api/channels/${channelId}/content?status=drafts`);
      const drafts = ((await listed.json()) as { result: { items: Array<{ id: string; title: string }> } }).result.items;
      expect(drafts.map((v) => v.id), 'draft not returned by the API').toContain(videoId);

      // Schedule it
      await row().getByRole('checkbox').check();
      await page.getByTestId('studio-bulk-bar').getByRole('button', { name: 'Schedule' }).click();
      const tomorrow = new Date(Date.now() + 24 * 3600 * 1000);
      const local = new Date(tomorrow.getTime() - tomorrow.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
      await page.getByLabel('Publish the first video at').fill(local);
      await page.getByRole('dialog').getByRole('button', { name: 'Schedule' }).click();
      // The bulk result names any refusal (time, plan, permission) instead of a bare timeout below
      await expect(page.getByRole('status').filter({ hasText: /done|could not|didn't work|plan/ })).toHaveText('1 done.', { timeout: 30000 });
      await openStatus('scheduled');

      // Cancel: back to Drafts
      await act('Cancel schedule', 'Schedule cancelled.');
      await openStatus('drafts');

      // Publish
      await act('Publish now', 'Published.');
      await openStatus('published');
      await expect(row()).not.toContainText('Private');
    } finally {
      if (videoId) await apiFetch(user, `/api/videos/${videoId}/permanent`, { method: 'DELETE', headers: { channelId } });
    }
  });
});
