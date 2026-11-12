import { test, expect } from './fixtures';
import type { Page } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { AUTH_STATE } from './test-utils/auth-state';
import {
  BUNNY_BACKLOG,
  BUNNY_WAIT_MS,
  SEED_TITLES,
  createDisposableVideo,
  deleteVideoQuietly,
  getVideo,
  userApi,
  waitForThumbnails,
  type E2EVideo,
  waitForReady,
} from './test-utils/e2e-videos';
import { ownStudioVideos } from './test-utils/own-studio-videos';

/**
 * Thumbnail management on the video edit page.
 *
 * Auto-generated thumbnails are the frames Bunny Stream renders while
 * encoding (thumbnail_N.jpg next to the HLS playlist), so these tests use real
 * QA videos: the seed video for read-only checks and a disposable video for
 * anything that saves. Custom thumbnails are uploaded by the browser straight
 * to the API.
 */

test.use({ storageState: AUTH_STATE.single });

const THUMBNAIL_JPG = path.join(__dirname, 'test-fixtures', 'e2e-thumbnail.jpg');

let seed: Record<string, E2EVideo> = {};

// One worker runs this file's tests in order, so its own data (beforeAll) is made once
test.describe.configure({ mode: 'default' });

/** This file's own Studio videos of the run users (made in beforeAll, deleted afterwards) */
const studioSingle = ownStudioVideos(test, 'single');

test.beforeAll(async () => {
  test.setTimeout(BUNNY_WAIT_MS + 60000);
  seed = studioSingle.videos();
  // The local stack's fake Bunny has the frames once the video is ready (ownStudioVideos waits for
  // that), and its CDN host only resolves in the browser; QA: wait once, capped (#929)
  if (process.env.E2E_ENV !== 'local') await waitForThumbnails('single', seed[SEED_TITLES.singleVideo].id);
});

async function openEditor(page: Page, video: E2EVideo, locale: 'en' | 'ar' = 'en') {
  await page.goto(`/${locale}/video/${video.id}/edit`);
  await expect(page.getByTestId('thumbnail-selector')).toBeVisible();
  // Let post-hydration session/profile checks settle before interacting
  await page.waitForLoadState('networkidle').catch(() => undefined);
  await expect(page.getByTestId('thumbnail-selector')).toBeVisible();
}

test.describe('Thumbnail Selection - Auto-generated', () => {
  test('should display the generated frames', async ({ page }) => {
    await openEditor(page, seed[SEED_TITLES.singleVideo]);

    const options = page.getByTestId('thumbnail-auto-option');
    await expect(options.first()).toBeVisible();
    expect(await options.count()).toBeGreaterThanOrEqual(1);
    expect(await options.count()).toBeLessThanOrEqual(5);
    await expect(options.first().locator('img')).toHaveAttribute('src', new RegExp(`/${seed[SEED_TITLES.singleVideo].id}/thumbnail_1\\.jpg$`));
  });

  test('should select a frame', async ({ page }) => {
    await openEditor(page, seed[SEED_TITLES.singleVideo]);

    const options = page.getByTestId('thumbnail-auto-option');
    await expect(options.first()).toBeVisible();
    const selection = page.getByTestId('thumbnail-current-selection');
    const before = await selection.textContent();

    await options.first().click();
    await expect(options.first()).toHaveAttribute('aria-checked', 'true');
    await expect(page.getByTestId('thumbnail-auto-option').and(page.locator('[aria-checked="true"]'))).toHaveCount(1);
    await expect(selection).not.toHaveText(before || '');
    await expect(page.getByTestId('video-edit-unsaved')).toBeVisible();
  });
});

test.describe('Thumbnail - saving', () => {
  let video: E2EVideo | null = null;

  test.beforeEach(async () => {
    // Auto thumbnails are Bunny's frames: this one needs a real encode
    video = await createDisposableVideo('single', 'thumbnail', { encode: true });
  });

  test.afterEach(async () => {
    await deleteVideoQuietly('single', video);
  });

  test('should save a selected auto-generated frame', async ({ page }) => {
    test.setTimeout(BUNNY_WAIT_MS + 120000);
    if (process.env.E2E_ENV === 'local') {
      // The stack's fake Bunny has the frames once the video is ready; its CDN host only resolves in the browser
      video = await waitForReady('single', video!);
    } else {
      expect(await waitForThumbnails('single', video!.id), `no Bunny frames after ${BUNNY_WAIT_MS / 1000} s: ${BUNNY_BACKLOG}?`).toBe(true);
    }
    await openEditor(page, video!);

    const option = page.getByTestId('thumbnail-auto-option').first();
    await expect(option).toBeVisible();
    const src = await option.locator('img').getAttribute('src');
    await option.click();
    await page.getByTestId('video-edit-save').click();
    await expect(page.getByTestId('video-edit-error')).toHaveCount(0);

    // The same frame file; the CDN token around it is signed afresh on every read (path or query form)
    const frameFile = (url: string | null | undefined) => url?.match(/\/([0-9a-f-]{36}\/thumbnail_\d+\.jpg)/)?.[1] ?? url;
    expect(frameFile(src), `a frame file in ${src}`).toMatch(/thumbnail_\d+\.jpg$/);
    await expect.poll(async () => frameFile((await getVideo(userApi('single'), video!.id))?.thumbnailUrl), { timeout: 60000 }).toBe(frameFile(src));
  });

  test('should upload, preview and save a custom thumbnail', async ({ page }) => {
    await openEditor(page, video!);

    await expect(page.getByTestId('thumbnail-upload-button')).toBeVisible();
    await page.getByTestId('thumbnail-file-input').setInputFiles(THUMBNAIL_JPG);

    const custom = page.getByTestId('thumbnail-custom-option');
    await expect(custom).toBeVisible();
    await expect(page.getByTestId('thumbnail-upload-button')).toBeEnabled({ timeout: 60000 });
    await expect(page.getByTestId('thumbnail-upload-error')).toHaveCount(0);
    await expect(custom).toHaveAttribute('aria-pressed', 'true');
    // Once uploaded, the preview switches from the local data: URL to the CDN URL
    await expect(custom.locator('img')).toHaveAttribute('src', /^https:\/\//);

    await page.getByTestId('video-edit-save').click();
    await expect(page.getByTestId('video-edit-error')).toHaveCount(0);
    await expect.poll(async () => (await getVideo(userApi('single'), video!.id))?.thumbnailUrl, { timeout: 60000 }).toMatch(/^https:\/\//);
  });
});

/** A real drag of a file onto the zone: dragenter, dragover, drop with a DataTransfer holding it */
async function dropFile(page: Page, testId: string, file: string, type: string) {
  const b64 = fs.readFileSync(file).toString('base64');
  const name = path.basename(file);
  const dataTransfer = await page.evaluateHandle(({ b64, name, type }) => {
    const dt = new DataTransfer();
    dt.items.add(new File([Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))], name, { type }));
    return dt;
  }, { b64, name, type });
  const zone = page.getByTestId(testId);
  await zone.dispatchEvent('dragenter', { dataTransfer });
  await expect(zone).toHaveAttribute('data-drag-over', 'true');
  await zone.dispatchEvent('dragover', { dataTransfer });
  await zone.dispatchEvent('drop', { dataTransfer });
  await expect(zone).toHaveAttribute('data-drag-over', 'false');
}

test.describe('Thumbnail Upload - drag and drop', () => {
  let video: E2EVideo | null = null;

  test.beforeEach(async () => {
    video = await createDisposableVideo('single', 'thumbnail-drop');
  });

  test.afterEach(async () => {
    await deleteVideoQuietly('single', video);
  });

  for (const locale of ['en', 'ar'] as const) {
    test(`should upload a dropped image (${locale})`, async ({ page }) => {
      await openEditor(page, video!, locale);

      await dropFile(page, 'thumbnail-upload-button', THUMBNAIL_JPG, 'image/jpeg');

      const custom = page.getByTestId('thumbnail-custom-option');
      await expect(custom).toBeVisible();
      await expect(page.getByTestId('thumbnail-upload-button')).toBeEnabled({ timeout: 60000 });
      await expect(page.getByTestId('thumbnail-upload-error')).toHaveCount(0);
      await expect(custom).toHaveAttribute('aria-pressed', 'true');
      await expect(custom.locator('img')).toHaveAttribute('src', /^https:\/\//);
      expect(page.url()).toContain(`/${locale}/`);
    });
  }

  test('should refuse a dropped file of another type', async ({ page }) => {
    await openEditor(page, video!);
    await dropFile(page, 'thumbnail-upload-button', path.join(__dirname, 'test-fixtures', 'invalid.txt'), 'text/plain');
    await expect(page.getByTestId('thumbnail-upload-error')).toBeVisible();
    await expect(page.getByTestId('thumbnail-custom-option')).toHaveCount(0);
  });
});

test.describe('Thumbnail Upload - Validation', () => {
  test('should reject non-image files', async ({ page }) => {
    await openEditor(page, seed[SEED_TITLES.singleVideo]);

    await page.getByTestId('thumbnail-file-input').setInputFiles({
      name: 'notes.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from('not an image'),
    });

    await expect(page.getByTestId('thumbnail-upload-error')).toBeVisible();
    await expect(page.getByTestId('thumbnail-custom-option')).toHaveCount(0);
  });

  test('should reject images over 2MB', async ({ page }) => {
    await openEditor(page, seed[SEED_TITLES.singleVideo]);

    await page.getByTestId('thumbnail-file-input').setInputFiles({
      name: 'huge.jpg',
      mimeType: 'image/jpeg',
      buffer: Buffer.alloc(2 * 1024 * 1024 + 1, 0xff),
    });

    await expect(page.getByTestId('thumbnail-upload-error')).toBeVisible();
    await expect(page.getByTestId('thumbnail-custom-option')).toHaveCount(0);
  });

  test('should only accept JPEG, PNG and WebP in the file picker', async ({ page }) => {
    await openEditor(page, seed[SEED_TITLES.singleVideo]);

    await expect(page.getByTestId('thumbnail-file-input')).toHaveAttribute('accept', 'image/jpeg,image/png,image/webp');
  });
});

test.describe('Thumbnail Management - Mobile', () => {
  test('should fit a mobile viewport', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await openEditor(page, seed[SEED_TITLES.singleVideo]);

    const selector = page.getByTestId('thumbnail-selector');
    await selector.scrollIntoViewIfNeeded();
    const box = await selector.boundingBox();
    expect(box?.width ?? 0).toBeLessThanOrEqual(375);

    const option = page.getByTestId('thumbnail-auto-option').first();
    await option.tap().catch(() => option.click());
    await expect(option).toHaveAttribute('aria-checked', 'true');
  });
});

test.describe('Thumbnail Management - Accessibility', () => {
  test('should be keyboard accessible', async ({ page }) => {
    await openEditor(page, seed[SEED_TITLES.singleVideo]);

    const option = page.getByTestId('thumbnail-auto-option').first();
    await option.focus();
    await expect(option).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(option).toHaveAttribute('aria-checked', 'true');
  });

  test('should expose frames as a labelled radio group', async ({ page }) => {
    await openEditor(page, seed[SEED_TITLES.singleVideo]);

    const group = page.getByRole('radiogroup');
    await expect(group).toBeVisible();
    const radios = group.getByRole('radio');
    expect(await radios.count()).toBeGreaterThanOrEqual(1);
    await expect(radios.first()).toHaveAccessibleName(/.+ 1$/);
    await expect(page.getByTestId('thumbnail-file-input')).toHaveAttribute('aria-label', /.+/);
  });

  test('should announce the selection in a live region', async ({ page }) => {
    await openEditor(page, seed[SEED_TITLES.singleVideo]);

    const live = page.getByTestId('thumbnail-current-selection');
    await expect(live).toHaveAttribute('aria-live', 'polite');
    await page.getByTestId('thumbnail-auto-option').first().click();
    await expect(live).toContainText('#1');
  });
});

test.describe('Thumbnail Management - RTL', () => {
  test('should render in the Arabic editor', async ({ page }) => {
    await openEditor(page, seed[SEED_TITLES.singleVideo], 'ar');

    await expect(page.locator('div[dir="rtl"]').first()).toBeVisible();
    await expect(page.getByTestId('thumbnail-auto-option').first()).toBeVisible();
  });
});
