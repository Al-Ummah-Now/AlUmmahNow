import { test, expect, helpers } from './fixtures';
import { AUTH_STATE } from './test-utils/auth-state';
import {
  deleteVideos,
  expectUploadSuccess,
  failTusPatches,
  gotoUpload,
  holdTusPatches,
  startUpload,
  trackUploads,
  TUS_URL_PATTERN,
  uploadUi,
} from './test-utils/upload';

/**
 * TUS Resumable Upload E2E Tests
 *
 * The web uploader sends the file with tus-js-client through the api-videos
 * TUS proxy (src/lib/upload/resilient-tus.ts): 50 MB chunks, and transient
 * failures (network, 5xx, 429) are retried for ~15 minutes while the page says
 * "Reconnecting…" and keeps the progress. These tests interrupt the
 * browser-side TUS requests to check that uploads resume from the server
 * offset instead of starting over.
 */

// Small chunks through the uploader's E2E override, so a small file takes several
const CHUNK_SIZE = 5 * 1024 * 1024;
const CHUNK_SIZE_OVERRIDE_KEY = 'aun:tus-chunk-size';

test.describe('Upload Resume', () => {
  test.use({ storageState: AUTH_STATE.single });

  let tracker: ReturnType<typeof trackUploads>;

  test.beforeEach(async ({ page }) => {
    tracker = trackUploads(page);
  });

  test.afterEach(async ({ page }) => {
    await deleteVideos(page, tracker.videoIds);
  });

  test('should recover from going offline during upload', async ({ page, context }) => {
    await gotoUpload(page, 'en');
    const ui = uploadUi(page);
    const hold = await holdTusPatches(page);

    await startUpload(page, await helpers.createTestVideo('network-offline.mp4', 64), 'Network Offline Test');
    await hold.waitForHeldPatch();

    // The in-flight chunk fails while offline: the upload keeps its place and
    // says it is reconnecting, with no error and no Retry to press
    await context.setOffline(true);
    await hold.release();
    const reconnecting = page.getByTestId('upload-reconnecting');
    await expect(reconnecting).toBeVisible();
    await expect(reconnecting).toHaveAttribute('role', 'status');
    await expect(reconnecting).not.toBeEmpty();
    await expect(ui.progress).toHaveAttribute('data-state', 'uploading');
    await expect(ui.retry).toBeHidden();
    await expect(ui.pageError).toBeHidden();

    // Back online it carries on by itself
    await context.setOffline(false);
    await expect(reconnecting).toBeHidden({ timeout: 60000 });
    await expectUploadSuccess(page, 'Network Offline Test');
    // Same upload resumed: one video record only
    expect(tracker.videoIds.size).toBe(1);
  });

  test('should show an error when the proxy rejects chunks', async ({ page }) => {
    await gotoUpload(page, 'en');
    const ui = uploadUi(page);
    await failTusPatches(page, 403);

    await startUpload(page, await helpers.createTestVideo('network-fail.mp4', 64), 'Network Fail Test');

    await expect(ui.error).toBeVisible();
    await expect(ui.pageError).toBeVisible();
    await expect(ui.retry).toBeVisible();
    // The cancel action discards the failed upload and resets the form
    await ui.cancelForm.click();
    await expect(ui.dropzone).toBeVisible();
  });

  test('should retry a transient server error automatically', async ({ page }) => {
    await gotoUpload(page, 'en');
    const ui = uploadUi(page);
    await failTusPatches(page, 500, 1);

    await startUpload(page, await helpers.createTestVideo('retry-test.mp4', 64), 'Retry Test');

    await expectUploadSuccess(page, 'Retry Test');
    await expect(ui.pageError).toBeHidden();
    const patches = tracker.tusRequests().filter((r) => r.method === 'PATCH');
    expect(patches.length).toBeGreaterThanOrEqual(2);
  });

  test('should resume a multi-chunk upload from the server offset', async ({ page }) => {
    test.slow(); // ~6 MB transfer to the target environment

    await gotoUpload(page, 'en');
    await page.evaluate(([key, size]) => localStorage.setItem(key, size), [CHUNK_SIZE_OVERRIDE_KEY, String(CHUNK_SIZE)]);
    // Fail the second chunk once; tus asks the server for the offset and
    // continues from there instead of re-sending the first chunk
    let patchCount = 0;
    await page.route(TUS_URL_PATTERN, async (route) => {
      if (route.request().method() === 'PATCH' && ++patchCount === 2) {
        await route.abort('failed');
        return;
      }
      await route.continue().catch(() => undefined);
    });

    await startUpload(page, await helpers.createTestVideo('chunk-test.mp4', 6 * 1024), 'Chunk Test');
    await expectUploadSuccess(page, 'Chunk Test', 170_000);

    const offsets = tracker
      .tusRequests()
      .filter((r) => r.method === 'PATCH')
      .map((r) => Number(r.headers['upload-offset']));
    expect(offsets[0]).toBe(0);
    expect(offsets).toContain(CHUNK_SIZE);
    // The first chunk was sent only once
    expect(offsets.filter((o) => o === 0)).toHaveLength(1);
  });

  test('should warn before leaving during an upload', async ({ page }) => {
    await gotoUpload(page, 'en');
    const hold = await holdTusPatches(page);
    await startUpload(page, await helpers.createTestVideo('close-tab.mp4', 64), 'Close Tab Test');
    await hold.waitForHeldPatch();

    const dialog = page.waitForEvent('dialog');
    await page.close({ runBeforeUnload: true });
    const prompt = await dialog;
    expect(prompt.type()).toBe('beforeunload');
    await prompt.accept();
    await hold.release();
  });

  test('should start fresh after a page reload', async ({ page }) => {
    await gotoUpload(page, 'en');
    const ui = uploadUi(page);
    const hold = await holdTusPatches(page);
    await startUpload(page, await helpers.createTestVideo('reload-test.mp4', 64), 'Reload Test');
    await hold.waitForHeldPatch();

    page.on('dialog', (d) => void d.accept());
    await hold.release();
    await page.reload();

    // In-progress form state does not survive a reload; no stale progress or resume prompt
    await expect(ui.dropzone).toBeVisible();
    await expect(ui.progress).toHaveCount(0);
    await expect(page.getByTestId('upload-page-progress')).toHaveCount(0);
    await expect(ui.details).toHaveCount(0);
  });
});
