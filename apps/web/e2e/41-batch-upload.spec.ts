import type { Page } from '@playwright/test';
import { test, expect } from './fixtures';
import { AUTH_STATE } from './test-utils/auth-state';
import { listOwnVideos, userApi } from './test-utils/e2e-videos';
import { createTestFile, gotoUpload } from './test-utils/upload';
import { ARABIC, deleteVideosTitled, expectDarkSurface, tempName } from './test-utils/upload-studio';

/**
 * Batch upload mode on /[locale]/upload (BatchUploadQueue / FileQueueItem /
 * useBatchUpload). Adding files already creates the video records on QA
 * (batch initiate), so every test names its files with a unique "E2E Temp"
 * prefix and deletes the single-channel user's videos with that prefix
 * afterwards, whatever state the queue ended in.
 */

test.use({ storageState: AUTH_STATE.single });

let prefix = '';

test.beforeEach(() => {
  prefix = tempName('batch');
});

test.afterEach(async () => {
  await deleteVideosTitled('single', prefix);
});

async function openBatch(page: Page, locale: 'en' | 'ar' = 'en') {
  await gotoUpload(page, locale);
  await page.getByTestId('upload-mode-batch').click();
  await expect(page.getByTestId('upload-mode-batch')).toHaveAttribute('aria-pressed', 'true');
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
    await expect(page.getByTestId('upload-mode-single')).toHaveAttribute('aria-pressed', 'false');
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
    expect((await chooser).isMultiple()).toBe(true);

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
