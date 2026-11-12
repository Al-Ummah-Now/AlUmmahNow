import type { Page } from '@playwright/test';
import { test, expect } from './fixtures';
import { AUTH_STATE } from './test-utils/auth-state';
import { listOwnVideos, userApi } from './test-utils/e2e-videos';
import { createTestFile, gotoUpload, removeTestFiles, uploadPlaylistsDeployed } from './test-utils/upload';
import { ARABIC, deleteVideosTitled, expectDarkSurface, tempName } from './test-utils/upload-studio';
import { apiAs, channelsOf, createPlaylist, deletePlaylistQuietly, deletePlaylistsTitled } from './test-utils/channel-content';

/**
 * Batch upload mode on /[locale]/upload (BatchUploadQueue / FileQueueItem /
 * useBatchUpload). Adding files already creates the video records on QA
 * (batch initiate), and batch mode has no visibility setting, so they are
 * public. Every test names its files with a unique "E2E Temp" prefix and
 * deletes the single-channel user's videos with that prefix afterwards,
 * whatever state the queue ended in (#464):
 * - afterEach closes the page first, so no further initiate or upload runs,
 *   then lists and deletes until a listing comes back empty (a record created
 *   just before the page closed shows up a moment later);
 * - afterAll sweeps every prefix of this file once more, in case an afterEach
 *   timed out or its listing failed.
 * scripts/qa/cleanup-e2e-leftovers.ts (scheduled QA sweep) removes anything
 * that still slips through.
 */

test.use({ storageState: AUTH_STATE.single });

let prefix = '';
const prefixes: string[] = [];

test.beforeEach(() => {
  prefix = tempName('batch');
  prefixes.push(prefix);
});

test.afterEach(async ({ page }) => {
  await page.close().catch(() => undefined);
  await deleteVideosTitled('single', prefix, { passes: 3, waitMs: 3000 });
});

test.afterAll(async () => {
  for (const p of prefixes) {
    await deleteVideosTitled('single', p);
    removeTestFiles(p);
  }
});

async function openBatch(page: Page, locale: 'en' | 'ar' = 'en') {
  await gotoUpload(page, locale);
  await page.getByTestId('upload-mode-batch').click();
  await expect(page.getByTestId('upload-mode-batch')).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByTestId('batch-dropzone')).toBeVisible();
}

/** Writes `count` small MP4s named "<prefix> <n>.mp4" */
function batchFiles(count: number, sizeKB = 64): string[] {
  return Array.from({ length: count }, (_, i) => createTestFile(`${prefix} ${i + 1}.mp4`, sizeKB));
}

const items = (page: Page) => page.getByTestId('batch-file');

test.describe('Batch upload - queue', () => {
  test('BATCH-001 switches to batch mode with its own drop zone and guideline (en)', async ({ page }) => {
    await openBatch(page);
    await expect(page.getByTestId('upload-mode-single')).toHaveAttribute('aria-selected', 'false');
    await expect(page.getByTestId('upload-dropzone')).toHaveCount(0);
    await expect(page.getByTestId('batch-dropzone')).toContainText('1-15');
    await expect(page.getByText('Batch uploads support 1-15 videos at once')).toBeVisible();
    await expect(page.getByTestId('batch-file-input')).toHaveAttribute('multiple', '');

    await page.getByTestId('upload-mode-single').click();
    await expect(page.getByTestId('upload-dropzone')).toBeVisible();
  });

  test('BATCH-002 rejects non-video files and more than 15 files', async ({ page }) => {
    await openBatch(page);
    const input = page.getByTestId('batch-file-input');

    await input.setInputFiles([createTestFile(`${prefix} ok.mp4`, 8), createTestFile(`${prefix} notes.txt`, 1)]);
    // (The message text comes from the synced translations, so only its presence is checked)
    await expect(page.getByTestId('upload-page-error')).toBeVisible();
    await expect(items(page)).toHaveCount(0);
    await expect(page.getByTestId('batch-dropzone')).toBeVisible();
    await page.getByTestId('upload-page-error-dismiss').click();

    const sixteen = Array.from({ length: 16 }, (_, i) => ({
      name: `${prefix} many ${i}.mp4`,
      mimeType: 'video/mp4',
      buffer: Buffer.alloc(1024),
    }));
    await input.setInputFiles(sixteen);
    await expect(page.getByTestId('upload-page-error')).toBeVisible();
    await expect(items(page)).toHaveCount(0);
    await expect(page.getByTestId('batch-queue')).toHaveCount(0);
  });

  test('BATCH-003 queues files, removes one, uploads the rest and can add more afterwards', async ({ page }) => {
    await openBatch(page);
    await page.getByTestId('batch-file-input').setInputFiles(batchFiles(3));

    await expect(items(page)).toHaveCount(3);
    for (let i = 0; i < 3; i++) await expect(items(page).nth(i)).toHaveAttribute('data-status', 'pending');
    await expect(page.getByTestId('batch-queue')).toHaveAttribute('data-total', '3');
    await expect(page.getByTestId('batch-queue')).toHaveAttribute('data-completed', '0');

    // Removing a pending file takes it out of the queue for good
    await items(page).filter({ hasText: `${prefix} 3` }).getByTestId('batch-file-remove').click();
    await expect(items(page)).toHaveCount(2);

    await page.getByTestId('batch-start').click();
    await expect(page.getByTestId('batch-queue')).toHaveAttribute('data-completed', '2', { timeout: 120000 });
    await expect(page.getByTestId('batch-queue')).toHaveAttribute('data-total', '2');
    await expect(items(page)).toHaveCount(2);
    for (let i = 0; i < 2; i++) await expect(items(page).nth(i)).toHaveAttribute('data-status', 'completed');
    await expect(page.getByTestId('batch-overall-percent')).toHaveText('100%');

    // Once the batch is done the actions come back, and "Add Videos" opens the picker
    await expect(page.getByTestId('batch-start')).toBeDisabled();
    const chooser = page.waitForEvent('filechooser');
    await page.getByTestId('batch-add-videos').click();
    const picker = await chooser;
    expect(picker.isMultiple()).toBe(true);
    // Adding through the picker after a finished batch queues the file (production 2026-11-10)
    await picker.setFiles(createTestFile(`${prefix} 4.mp4`, 64));
    await expect(items(page)).toHaveCount(3);
    await expect(items(page).filter({ hasText: `${prefix} 4` })).toHaveAttribute('data-status', 'pending');
    await expect(page.getByTestId('upload-page-error')).toHaveCount(0);
    await expect(page.getByTestId('batch-start')).toBeEnabled();

    // The two uploaded files exist on QA; the removed one was never uploaded
    const titles = (await listOwnVideos(userApi('single'))).map((v) => v.title).filter((t) => t.startsWith(prefix));
    expect(titles.sort()).toEqual(expect.arrayContaining([`${prefix} 1`, `${prefix} 2`]));
  });

  test('BATCH-004 cancels every queued upload at once', async ({ page }) => {
    await openBatch(page);
    await page.getByTestId('batch-file-input').setInputFiles(batchFiles(2));
    await expect(items(page)).toHaveCount(2);

    await page.getByTestId('batch-cancel-all').click();
    for (let i = 0; i < 2; i++) await expect(items(page).nth(i)).toHaveAttribute('data-status', 'cancelled');
    await expect(page.getByTestId('batch-cancel-all')).toHaveCount(0);
    await expect(page.getByTestId('batch-start')).toBeDisabled();
  });
});

const ALREADY_UPLOADED = { en: 'Already uploaded', ar: 'تم رفعه من قبل' } as const;

test.describe('Batch upload - more files after a finished batch', () => {
  for (const locale of ['en', 'ar'] as const) {
    test(`BATCH-007 uploads, adds more (one already uploaded), uploads again and clears finished (${locale})`, async ({ page }) => {
      test.setTimeout(300000);
      await openBatch(page, locale);
      const input = page.getByTestId('batch-file-input');
      const [first, second] = batchFiles(2, 32);

      await input.setInputFiles([first, second]);
      await expect(items(page)).toHaveCount(2);
      await page.getByTestId('batch-start').click();
      await expect(page.getByTestId('batch-queue')).toHaveAttribute('data-completed', '2', { timeout: 120000 });

      // Add more: two new files plus one that is already uploaded
      const third = createTestFile(`${prefix} 3.mp4`, 32);
      const fourth = createTestFile(`${prefix} 4.mp4`, 32);
      await input.setInputFiles([first, third, fourth]);
      await expect(items(page)).toHaveCount(4);
      await expect(page.getByTestId('upload-page-error')).toHaveCount(0);
      const firstRow = items(page).filter({ hasText: `${prefix} 1` });
      await expect(firstRow).toHaveCount(1);
      await expect(firstRow).toHaveAttribute('data-status', 'completed');
      await expect(firstRow.getByTestId('batch-file-already-uploaded')).toContainText(ALREADY_UPLOADED[locale]);
      const videoId = await firstRow.getAttribute('data-video-id');
      expect(videoId).toBeTruthy();
      await expect(firstRow.getByTestId('batch-file-view-video')).toHaveAttribute('href', `/${locale}/video/${videoId}`);
      for (const n of [3, 4]) await expect(items(page).filter({ hasText: `${prefix} ${n}` })).toHaveAttribute('data-status', 'pending');

      // Upload again: only the two new files
      await page.getByTestId('batch-start').click();
      await expect(page.getByTestId('batch-queue')).toHaveAttribute('data-completed', '4', { timeout: 120000 });
      await expect(page.getByTestId('upload-page-error')).toHaveCount(0);

      // One video per file: picking the uploaded file again did not create a second one
      await expect
        .poll(async () => (await listOwnVideos(userApi('single'))).map((v) => v.title).filter((t) => t.startsWith(prefix)).sort(), { timeout: 30000 })
        .toEqual([1, 2, 3, 4].map((n) => `${prefix} ${n}`));

      // Clear finished empties the queue and brings the drop zone back; a new pick still works
      await page.getByTestId('batch-clear-finished').click();
      await expect(items(page)).toHaveCount(0);
      await expect(page.getByTestId('batch-dropzone')).toBeVisible();
      await input.setInputFiles(createTestFile(`${prefix} 5.mp4`, 32));
      await expect(items(page)).toHaveCount(1);
      await expect(items(page)).toHaveAttribute('data-status', 'pending');
    });
  }
});

test.describe('Batch upload - playlists', () => {
  test.beforeEach(async () => {
    test.skip(!(await uploadPlaylistsDeployed()), 'Upload playlists are not deployed on the target yet (they land with the PR that adds them)');
  });
  const channelId = () => channelsOf('single').main.id;
  // Playlists this test created (through the API or inline on the page), deleted by id
  // even when the title sweep's listing is slow, fails or does not reach them
  const playlistIds = new Set<string>();
  test.afterEach(async () => {
    for (const id of playlistIds) await deletePlaylistQuietly('single', channelId(), id);
    playlistIds.clear();
    await deletePlaylistsTitled('single', channelId(), prefix).catch((error) => {
      console.warn(`[cleanup] playlists titled "${prefix}…" may be left on QA`, error);
    });
  });

  const playlistVideos = async (id: string) => (await apiAs<{ videos?: string[] }>('single', 'GET', `/api/playlists/${id}`)).body.videos ?? [];

  test('BATCH-PL-001 adds every video to the batch playlists in upload order, a row to its own, and creates one inline', async ({ page }) => {
    test.setTimeout(300000);
    page.on('response', (response) => {
      if (response.request().method() !== 'POST' || !/\/api\/playlists(\?|$)/.test(new URL(response.url()).pathname)) return;
      response
        .json()
        .then((body: { result?: { playlist?: { id?: string } } }) => {
          if (body?.result?.playlist?.id) playlistIds.add(body.result.playlist.id);
        })
        .catch(() => undefined);
    });
    const forAll = await createPlaylist('single', channelId(), { title: `${prefix} all` });
    playlistIds.add(forAll.id);
    const own = await createPlaylist('single', channelId(), { title: `${prefix} own` });
    playlistIds.add(own.id);
    await openBatch(page);

    // Playlists for all videos: one picked, one created inline (selected at once)
    const defaults = page.getByTestId('batch-playlists-default');
    await defaults.getByTestId('batch-playlists-default-toggle').click();
    await defaults.getByTestId('batch-playlists-default-search').fill(`${prefix} all`);
    // The picker lists the channel's playlists with GET /api/playlists?channelId=, which
    // scans the whole bucket: 13 s on a quiet QA, over 30 s under the E2E jobs (#909)
    const allOption = defaults.getByLabel(`${prefix} all`);
    await expect(allOption).toBeVisible({ timeout: 90_000 });
    await allOption.check();
    await defaults.getByTestId('batch-playlists-default-new').click();
    await defaults.getByTestId('batch-playlists-default-name').fill(`${prefix} created`);
    await defaults.getByTestId('batch-playlists-default-create').click();
    await expect(defaults.getByTestId('batch-playlists-default-chip')).toHaveCount(2);

    await page.getByTestId('batch-file-input').setInputFiles(batchFiles(3, 32));
    await expect(items(page)).toHaveCount(3);

    // The second video goes to its own playlist only
    const second = items(page).filter({ hasText: `${prefix} 2` });
    const row = second.getByTestId('batch-row-playlists');
    await expect(row).toHaveAttribute('data-mode', 'batch');
    await row.getByTestId('batch-row-playlists-mode').click();
    await expect(row).toHaveAttribute('data-mode', 'own');
    // Remove the copied batch playlists one at a time: each removal re-renders
    // the list, so always take the first chip and wait for the count to drop
    const chips = row.getByTestId('batch-row-playlist-picker-chip');
    await expect(chips).toHaveCount(2);
    for (let left = 2; left > 0; left--) {
      await chips.first().getByRole('button').click();
      await expect(chips).toHaveCount(left - 1);
    }
    await row.getByTestId('batch-row-playlist-picker-toggle').click();
    await row.getByTestId('batch-row-playlist-picker-search').fill(`${prefix} own`);
    await row.getByLabel(`${prefix} own`).check();

    await page.getByTestId('batch-start').click();
    await expect(row).toHaveAttribute('data-mode', 'locked');
    await expect(page.getByTestId('batch-queue')).toHaveAttribute('data-completed', '3', { timeout: 120000 });
    const ids = await Promise.all([1, 2, 3].map((n) => items(page).filter({ hasText: `${prefix} ${n}` }).getAttribute('data-video-id')));

    const created = (await apiAs<{ data?: Array<{ id: string; title: string }> }>('single', 'GET', `/api/playlists?channelId=${channelId()}&limit=100`))
      .body.data?.find((p) => p.title === `${prefix} created`);
    expect(created).toBeTruthy();
    playlistIds.add(created!.id);
    await expect.poll(() => playlistVideos(forAll.id), { timeout: 90000 }).toEqual([ids[0], ids[2]]);
    await expect.poll(() => playlistVideos(created!.id), { timeout: 90000 }).toEqual([ids[0], ids[2]]);
    await expect.poll(() => playlistVideos(own.id), { timeout: 90000 }).toEqual([ids[1]]);
    await expect(page.getByTestId('playlist-add-notice')).toHaveCount(0);
  });
});

test.describe('Batch upload - localization and theme', () => {
  test('BATCH-005 shows the batch queue in Arabic (ar)', async ({ page }) => {
    await openBatch(page, 'ar');
    await expect(page.getByTestId('batch-dropzone')).toContainText(ARABIC);
    await page.getByTestId('batch-file-input').setInputFiles(batchFiles(1, 16));

    await expect(items(page)).toHaveCount(1);
    await expect(items(page).getByTestId('batch-file-status')).toHaveText(ARABIC);
    await expect(page.getByTestId('batch-summary')).toHaveText(ARABIC);
    await expect(page.getByTestId('batch-start')).toHaveText(ARABIC);
    await expect(page.getByTestId('batch-cancel-all')).toHaveAccessibleName(ARABIC);
  });

  test.describe('dark', () => {
    test.use({ colorScheme: 'dark' });

    test('BATCH-006 renders the queue in the dark scheme', async ({ page }) => {
      await openBatch(page);
      await page.getByTestId('batch-file-input').setInputFiles(batchFiles(1, 16));
      const queue = page.getByTestId('batch-queue');
      await expect(queue).toBeVisible();
      await expectDarkSurface(page, queue, queue.getByRole('heading').first());
    });
  });
});
