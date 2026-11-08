import { test, expect, helpers } from './fixtures';
import { AUTH_STATE, ANONYMOUS_STATE } from './test-utils/auth-state';
import {
  deleteVideos,
  expectUploadSuccess,
  failTusPatches,
  gotoUpload,
  holdTusPatches,
  selectVideo,
  startUpload,
  trackUploads,
  uploadUi,
} from './test-utils/upload';

/**
 * Video Upload Flow E2E Tests
 *
 * Runs the real upload flow against the target environment as the
 * single-channel E2E user: server-side initiate, browser TUS upload through
 * the api-videos proxy, then completion/processing. Only the browser TUS
 * requests are intercepted (to hold or fail chunks deterministically).
 * Every video a test creates is deleted afterwards.
 */

const ARABIC = /[؀-ۿ]/;

test.describe('Video Upload Flow', () => {
  test.use({ storageState: AUTH_STATE.single });

  let tracker: ReturnType<typeof trackUploads>;

  test.beforeEach(async ({ page }) => {
    tracker = trackUploads(page);
  });

  test.afterEach(async ({ page }) => {
    await deleteVideos(page, tracker.videoIds);
  });

  test('should upload video with complete metadata', async ({ page }) => {
    await gotoUpload(page, 'en');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();

    const videoPath = await helpers.createTestVideo('test-video.mp4', 64);
    await helpers.uploadTestVideo(page, {
      videoPath,
      titleEn: 'Test Islamic Lecture',
      titleAr: 'محاضرة إسلامية تجريبية',
      descriptionEn: 'A test video about Islamic teachings',
      descriptionAr: 'فيديو تجريبي عن التعاليم الإسلامية',
      isPublic: true,
    });

    await expectUploadSuccess(page, 'Test Islamic Lecture');
    const ui = uploadUi(page);
    await expect(ui.viewVideo).toBeVisible();
    await expect(ui.uploadAnother).toBeVisible();
    expect(tracker.videoIds.size).toBe(1);

    // "Upload Another" returns to an empty drop zone
    await ui.uploadAnother.click();
    await expect(ui.dropzone).toBeVisible();
  });

  test('should show upload progress tracking', async ({ page }) => {
    await gotoUpload(page, 'en');
    const hold = await holdTusPatches(page);
    const ui = uploadUi(page);

    await startUpload(page, await helpers.createTestVideo('test-progress.mp4', 64), 'Progress Test Video');

    // While the chunk is in flight the form shows the uploading state
    await hold.waitForHeldPatch();
    await expect(ui.progress).toHaveAttribute('data-state', 'uploading');
    await expect(ui.progressPercent).toHaveText(/^\d+%$/);
    await expect(ui.progressBar).toHaveAttribute('aria-valuenow', /\d+/);
    await expect(ui.pause).toBeVisible();
    await expect(ui.cancel).toBeVisible();
    // Inputs are locked during the transfer
    await expect(ui.titleEn).toBeDisabled();

    await hold.release();
    await expectUploadSuccess(page, 'Progress Test Video');
  });

  test('should validate file type', async ({ page }) => {
    await gotoUpload(page, 'en');
    const ui = uploadUi(page);

    await ui.fileInput.setInputFiles(await helpers.createTestVideo('invalid.txt', 4));

    await expect(ui.pageError).toBeVisible();
    await expect(ui.pageError).toContainText('MP4');
    await expect(ui.details).toBeHidden();
    await expect(ui.dropzone).toBeVisible();
  });

  test('should accept files larger than 2GB (no client-side size limit)', async ({ page }) => {
    // TUS uploads have no size cap, so the client must not reject big files.
    // Report a 3 GB size for the selected file instead of creating one.
    await gotoUpload(page, 'en');
    await page.evaluate(() => {
      Object.defineProperty(File.prototype, 'size', { configurable: true, get: () => 3 * 1024 ** 3 });
    });
    const ui = uploadUi(page);

    await selectVideo(page, await helpers.createTestVideo('large-video.mp4', 16));

    await expect(ui.details).toContainText('3.00 GB');
    await expect(ui.pageError).toBeHidden();
    await expect(ui.submit).toBeEnabled();
  });

  test('should pause and resume upload', async ({ page }) => {
    await gotoUpload(page, 'en');
    const hold = await holdTusPatches(page);
    const ui = uploadUi(page);

    await startUpload(page, await helpers.createTestVideo('pause-resume.mp4', 64), 'Pause Resume Test');
    await hold.waitForHeldPatch();

    await ui.pause.click();
    await expect(ui.progress).toHaveAttribute('data-state', 'paused');
    await expect(ui.resume).toBeVisible();
    await expect(ui.pause).toBeHidden();

    // Resume continues the same TUS upload (no new video is created)
    await hold.release();
    await ui.resume.click();
    await expectUploadSuccess(page, 'Pause Resume Test');
    expect(tracker.videoIds.size).toBe(1);
  });

  test('should cancel upload', async ({ page }) => {
    await gotoUpload(page, 'en');
    const hold = await holdTusPatches(page);
    const ui = uploadUi(page);

    await startUpload(page, await helpers.createTestVideo('cancel-test.mp4', 64), 'Cancel Test Video');
    await hold.waitForHeldPatch();
    await expect(ui.progress).toBeVisible();

    await ui.cancel.click();

    await expect(ui.details).toBeHidden();
    await expect(ui.progress).toBeHidden();
    await expect(page.getByTestId('upload-page-progress')).toBeHidden();
    await expect(ui.dropzone).toBeVisible();
    await hold.release();
  });

  test('should work in RTL (Arabic) interface', async ({ page }) => {
    await gotoUpload(page, 'ar');
    const ui = uploadUi(page);

    // The upload page renders inside the RTL locale container with Arabic UI text
    expect(await ui.dropzone.evaluate((el) => (el.closest('[dir]') as HTMLElement | null)?.dir)).toBe('rtl');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(ARABIC);

    await selectVideo(page, await helpers.createTestVideo('arabic-test.mp4', 64));

    await ui.langTabAr.click();
    await expect(ui.langTabAr).toHaveAttribute('aria-selected', 'true');
    await expect(ui.titleAr).toHaveAttribute('dir', 'rtl');
    await ui.titleAr.fill('فيديو تجريبي');

    // English title is required
    await ui.langTabEn.click();
    await ui.titleEn.fill('Test Video');
    await ui.submit.click();

    await expectUploadSuccess(page, 'Test Video');
  });
});

test.describe('Video Upload - Drag and Drop', () => {
  test.use({ storageState: AUTH_STATE.single });

  test('should accept a video dropped on the drop zone', async ({ page }) => {
    await gotoUpload(page, 'en');
    const ui = uploadUi(page);
    await expect(ui.dropzone).toContainText(/drag/i);

    const dataTransfer = await page.evaluateHandle(() => {
      const dt = new DataTransfer();
      dt.items.add(new File([new Uint8Array(1024)], 'drag-drop.mp4', { type: 'video/mp4' }));
      return dt;
    });

    await ui.dropzone.dispatchEvent('dragover', { dataTransfer });
    await expect(ui.dropzone).toHaveAttribute('data-drag-over', 'true');

    await ui.dropzone.dispatchEvent('drop', { dataTransfer });
    await expect(ui.details).toBeVisible();
    await expect(ui.fileName).toHaveText('drag-drop.mp4');
    // The title defaults to the file name without its extension
    await expect(ui.titleEn).toHaveValue('drag-drop');
  });
});

test.describe('Video Upload - Validation', () => {
  test.use({ storageState: AUTH_STATE.single });

  test('should require title before upload', async ({ page }) => {
    await gotoUpload(page, 'en');
    const ui = uploadUi(page);
    await selectVideo(page, await helpers.createTestVideo('no-title.mp4', 16));

    await expect(ui.submit).toBeEnabled();
    await ui.titleEn.fill('');
    await expect(ui.submit).toBeDisabled();
    await ui.titleEn.fill('   ');
    await expect(ui.submit).toBeDisabled();
  });

  test('should discard the form when closed', async ({ page }) => {
    await gotoUpload(page, 'en');
    const ui = uploadUi(page);
    await selectVideo(page, await helpers.createTestVideo('unsaved.mp4', 16));
    await ui.titleEn.fill('Unsaved Test');

    await ui.close.click();
    await expect(ui.details).toBeHidden();
    await expect(ui.dropzone).toBeVisible();

    // Selecting again starts from a fresh form
    await selectVideo(page, await helpers.createTestVideo('unsaved.mp4', 16));
    await expect(ui.titleEn).toHaveValue('unsaved');
  });
});

test.describe('Video Upload - Mobile', () => {
  test.use({ storageState: AUTH_STATE.single, viewport: { width: 375, height: 667 } });

  test('should work on mobile viewport', async ({ page }) => {
    await gotoUpload(page, 'en');
    const ui = uploadUi(page);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    // Mode toggle buttons keep an accessible name when their label is hidden
    await expect(page.getByTestId('upload-mode-single')).toHaveAccessibleName(/.+/);

    await selectVideo(page, await helpers.createTestVideo('mobile-test.mp4', 16));
    await ui.titleEn.fill('Mobile Upload Test');

    await ui.langTabAr.click();
    await expect(ui.titleAr).toBeVisible();
    await ui.langTabEn.click();
    await expect(ui.titleEn).toHaveValue('Mobile Upload Test');

    await ui.submit.scrollIntoViewIfNeeded();
    await expect(ui.submit).toBeInViewport();
    const box = await ui.details.boundingBox();
    expect(box?.width ?? 0).toBeLessThanOrEqual(375);
  });
});

test.describe('Video Upload - Error Handling', () => {
  test.describe('signed in', () => {
    test.use({ storageState: AUTH_STATE.single });

    let tracker: ReturnType<typeof trackUploads>;
    test.beforeEach(async ({ page }) => {
      tracker = trackUploads(page);
    });
    test.afterEach(async ({ page }) => {
      await deleteVideos(page, tracker.videoIds);
    });

    test('should report a rejected upload and allow retry', async ({ page }) => {
      await gotoUpload(page, 'en');
      const ui = uploadUi(page);
      const restore = await failTusPatches(page, 403);

      await startUpload(page, await helpers.createTestVideo('network-error.mp4', 64), 'Network Error Test');

      await expect(ui.progress).toHaveAttribute('data-state', 'error');
      await expect(ui.error).toBeVisible();
      await expect(ui.pageError).toBeVisible();
      await expect(ui.retry).toBeVisible();

      // Retry resumes the same upload once the proxy accepts chunks again
      await restore();
      await ui.retry.click();
      await expect(ui.pageError).toBeHidden();
      await expectUploadSuccess(page, 'Network Error Test');
      expect(tracker.videoIds.size).toBe(1);
    });
  });

  test.describe('signed out', () => {
    test.use({ storageState: ANONYMOUS_STATE });

    test('should ask anonymous visitors to sign in', async ({ page }) => {
      await page.goto('/en/upload');
      const ui = uploadUi(page);
      await expect(ui.signIn).toBeVisible();
      await expect(ui.signIn.getByRole('button')).toBeVisible();
      await expect(ui.dropzone).toHaveCount(0);
      await expect(ui.channelRequired).toHaveCount(0);
    });
  });

  test.describe('without a channel', () => {
    test.use({ storageState: AUTH_STATE.none });

    test('should explain that a channel is required', async ({ page }) => {
      await page.goto('/en/upload');
      const ui = uploadUi(page);
      await expect(ui.channelRequired).toBeVisible();
      await expect(page.getByTestId('upload-create-channel')).toBeVisible();
      await expect(ui.dropzone).toHaveCount(0);
    });

    test('should explain that a channel is required in Arabic', async ({ page }) => {
      await page.goto('/ar/upload');
      const ui = uploadUi(page);
      await expect(ui.channelRequired).toBeVisible();
      await expect(ui.channelRequired.getByRole('heading')).toHaveText(ARABIC);
    });
  });
});

test.describe('Video Upload - Accessibility', () => {
  test.use({ storageState: AUTH_STATE.single });

  test('should be keyboard accessible', async ({ page }) => {
    await gotoUpload(page, 'en');
    const ui = uploadUi(page);
    await selectVideo(page, await helpers.createTestVideo('keyboard-test.mp4', 16));

    // Language tabs, title and the upload button are reachable and operable by keyboard
    await ui.langTabAr.focus();
    await page.keyboard.press('Enter');
    await expect(ui.langTabAr).toHaveAttribute('aria-selected', 'true');
    await ui.langTabEn.focus();
    await page.keyboard.press('Enter');

    await ui.titleEn.focus();
    await page.keyboard.press('ControlOrMeta+A');
    await page.keyboard.type('Keyboard Accessibility Test');
    await expect(ui.titleEn).toHaveValue('Keyboard Accessibility Test');

    await ui.submit.focus();
    await expect(ui.submit).toBeFocused();
    await expect(ui.submit).toBeEnabled();
  });

  test('should have proper ARIA labels', async ({ page }) => {
    await gotoUpload(page, 'en');
    const ui = uploadUi(page);

    await expect(ui.fileInput).toHaveAccessibleName(/.+/);
    await selectVideo(page, await helpers.createTestVideo('aria-test.mp4', 16));

    await expect(ui.titleEn).toHaveAccessibleName(/.+/);
    await expect(ui.descriptionEn).toHaveAccessibleName(/.+/);
    await expect(ui.close).toHaveAccessibleName(/.+/);
    await expect(ui.submit).toHaveAccessibleName(/.+/);
    await expect(page.getByRole('tablist').getByRole('tab')).toHaveCount(2);
    await expect(ui.isPublic).toHaveAccessibleName(/.+/);
  });
});
