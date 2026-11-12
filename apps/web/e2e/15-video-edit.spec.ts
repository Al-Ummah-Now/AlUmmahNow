import { test, expect } from './fixtures';
import type { Page } from '@playwright/test';
import { AUTH_STATE } from './test-utils/auth-state';
import {
  SEED_TITLES,
  createDisposableVideo,
  deleteVideoQuietly,
  getVideo,
  userApi,
  type E2EVideo,
} from './test-utils/e2e-videos';
import { ownStudioVideos } from './test-utils/own-studio-videos';

/**
 * The video editor, which lives in Studio: /[locale]/studio/video/{id}/edit
 * (the watch page's owner link; the old /[locale]/video/{id}/edit 301s here)
 * redirects to /[locale]/studio/{channelId}/content/videos/{id}/edit. Save and
 * Cancel return to the channel's Studio video list. English and Arabic titles
 * and descriptions sit side by side (no language tabs).
 *
 * Saving goes through a server action to the real QA API, so tests that save
 * edit a disposable video they upload themselves; read-only tests open the
 * single-channel user's own video of this file and never save it.
 */

test.use({ storageState: AUTH_STATE.single });

let seed: Record<string, E2EVideo> = {};

// One worker runs this file's tests in order, so its own data (beforeAll) is made once
test.describe.configure({ mode: 'default' });

/** This file's own Studio videos of the run users (made in beforeAll, deleted afterwards) */
const studioSingle = ownStudioVideos(test, 'single');

test.beforeAll(async () => {
  test.setTimeout(180000);
  seed = studioSingle.videos();
});

/** The Studio editor's own URL, once /studio/video/{id}/edit has resolved the video's channel */
const editorUrl = (video: E2EVideo, locale: 'en' | 'ar' = 'en') =>
  new RegExp(`/${locale}/studio/[^/]+/content/videos/${video.id}/edit$`);
/** The Studio video list that Save and Cancel return to (filters may ride along in the query) */
const STUDIO_LIST = /\/en\/studio\/[^/]+\/content\/videos(\?.*)?$/;

async function openEditor(page: Page, video: E2EVideo, locale: 'en' | 'ar' = 'en') {
  await page.goto(`/${locale}/studio/video/${video.id}/edit`);
  await expect(page).toHaveURL(editorUrl(video, locale));
  await expect(page.getByTestId('video-edit-form')).toBeVisible();
  // Let the session/profile checks that run after hydration finish before
  // editing, so a late re-render cannot race the test's input
  await page.waitForLoadState('networkidle').catch(() => undefined);
  await expect(page.getByTestId('video-edit-form')).toBeVisible();
}

/**
 * Saves and waits for the outcome: the success message, or the Studio video
 * list the editor returns to right after. Either one proves the save went
 * through; tests verify the stored values through the API.
 */
async function save(page: Page) {
  const saveButton = page.getByTestId('video-edit-save');
  await expect(saveButton).toBeEnabled();
  await saveButton.click();
  const succeeded = await expect(page.getByTestId('video-edit-success'))
    .toBeVisible({ timeout: 15000 })
    .then(() => true, () => false);
  if (!succeeded) await expect(page).toHaveURL(STUDIO_LIST);
}

test.describe('Video Edit - read only', () => {
  test('should load the edit page with the stored metadata', async ({ page }) => {
    const video = seed[SEED_TITLES.singleVideo];
    await openEditor(page, video);

    await expect(page.getByTestId('video-edit-title-en')).toHaveValue(seed[SEED_TITLES.singleVideo].title);
    await expect(page.getByTestId('video-edit-privacy-private')).toBeChecked();
    await expect(page.getByTestId('video-edit-save')).toBeDisabled();
    await expect(page.getByTestId('video-edit-unsaved')).toHaveCount(0);
  });

  test('should show the English and Arabic fields side by side', async ({ page }) => {
    await openEditor(page, seed[SEED_TITLES.singleVideo]);

    for (const field of ['title', 'description']) {
      await expect(page.getByTestId(`video-edit-${field}-en`)).toBeVisible();
      await expect(page.getByTestId(`video-edit-${field}-en`)).toHaveAttribute('dir', 'ltr');
      await expect(page.getByTestId(`video-edit-${field}-ar`)).toBeVisible();
      await expect(page.getByTestId(`video-edit-${field}-ar`)).toHaveAttribute('dir', 'rtl');
      await expect(page.getByTestId(`video-edit-${field}-ar`)).toHaveAttribute('lang', 'ar');
    }
  });

  test('should keep unsaved edits in both languages', async ({ page }) => {
    await openEditor(page, seed[SEED_TITLES.singleVideo]);

    await page.getByTestId('video-edit-title-en').fill('Edited but not saved');
    await page.getByTestId('video-edit-title-ar').fill('تعديل غير محفوظ');

    await expect(page.getByTestId('video-edit-title-en')).toHaveValue('Edited but not saved');
    await expect(page.getByTestId('video-edit-title-ar')).toHaveValue('تعديل غير محفوظ');
    await expect(page.getByTestId('video-edit-unsaved')).toBeVisible();
  });

  test('typing in the form keeps every key: the preview player does not take Space, F or M', async ({ page }) => {
    await openEditor(page, seed[SEED_TITLES.singleVideo]);
    const title = page.getByTestId('video-edit-title-en');
    const description = page.getByTestId('video-edit-description-en');

    // Real keystrokes, as a person types (fill() sets the value without keys)
    await title.click();
    await title.press('ControlOrMeta+A');
    await title.pressSequentially('Fresh film of my mosque');
    await expect(title).toHaveValue('Fresh film of my mosque');
    await description.click();
    await description.press('ControlOrMeta+A');
    await description.pressSequentially('A full moon over the minaret');
    await expect(description).toHaveValue('A full moon over the minaret');

    // "f" did not take the page fullscreen and "m" did not mute the preview
    expect(await page.evaluate(() => document.fullscreenElement)).toBeNull();
    expect(await page.locator('video').first().evaluate((v: HTMLVideoElement) => v.muted)).toBe(false);
    await expect(page.getByTestId('video-edit-unsaved')).toBeVisible();
  });

  test('should flag unsaved changes and clear the flag when reverted', async ({ page }) => {
    await openEditor(page, seed[SEED_TITLES.singleVideo]);
    const description = page.getByTestId('video-edit-description-en');
    const original = await description.inputValue();

    await description.fill('A changed description');
    await expect(page.getByTestId('video-edit-unsaved')).toBeVisible();
    await expect(page.getByTestId('video-edit-save')).toBeEnabled();

    await description.fill(original);
    await expect(page.getByTestId('video-edit-unsaved')).toHaveCount(0);
  });

  test('should require a title before saving', async ({ page }) => {
    await openEditor(page, seed[SEED_TITLES.singleVideo]);

    await page.getByTestId('video-edit-title-en').fill('');
    await page.getByTestId('video-edit-title-ar').fill('');
    await page.getByTestId('video-edit-save').click();

    await expect(page.getByTestId('video-edit-error')).toBeVisible();
    await expect(page.getByTestId('video-edit-success')).toHaveCount(0);
  });

  test('should keep the user on the page when cancel is dismissed', async ({ page }) => {
    const video = seed[SEED_TITLES.singleVideo];
    await openEditor(page, video);
    await page.getByTestId('video-edit-title-en').fill('Unsaved title');

    await page.getByTestId('video-edit-cancel').click();
    await page.getByTestId('video-edit-discard-cancel').click();
    await expect(page).toHaveURL(editorUrl(video));
    await expect(page.getByTestId('video-edit-title-en')).toHaveValue('Unsaved title');
  });

  test('should discard changes when cancel is confirmed', async ({ page }) => {
    const video = seed[SEED_TITLES.singleVideo];
    await openEditor(page, video);
    await page.getByTestId('video-edit-title-en').fill('Unsaved title');

    await page.getByTestId('video-edit-cancel').click();
    await page.getByTestId('video-edit-discard-confirm').click();
    await expect(page).toHaveURL(STUDIO_LIST);

    const stored = await getVideo(userApi('single'), video.id);
    expect(stored?.title).toBe(seed[SEED_TITLES.singleVideo].title);
  });

  test('should leave without a prompt when nothing changed', async ({ page }) => {
    const video = seed[SEED_TITLES.singleVideo];
    await openEditor(page, video);

    await page.getByTestId('video-edit-cancel').click();
    await expect(page).toHaveURL(STUDIO_LIST);
    await expect(page.getByTestId('video-edit-discard')).toHaveCount(0);
  });

  test('should show an error when the save request fails', async ({ page }) => {
    const video = seed[SEED_TITLES.singleVideo];
    await openEditor(page, video);
    // Unique, so the form is dirty even if an earlier attempt's save got through
    await page.getByTestId('video-edit-description-en').fill(`This save is aborted by the test ${Date.now()}`);

    // Server actions are POSTed by the browser to the page URL (the Studio editor); fail them
    await page.route(`**/content/videos/${video.id}/edit`, (route) =>
      route.request().method() === 'POST' ? route.abort('failed') : route.continue(),
    );
    await page.getByTestId('video-edit-save').click();

    await expect(page.getByTestId('video-edit-error')).toBeVisible();
    await expect(page.getByTestId('video-edit-unsaved')).toBeVisible();
  });

  test('should work on a mobile viewport', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await openEditor(page, seed[SEED_TITLES.singleVideo]);

    const form = page.getByTestId('video-edit-form');
    const box = await form.boundingBox();
    expect(box?.width ?? 0).toBeLessThanOrEqual(375);
    await page.getByTestId('video-edit-title-en').fill('Mobile edit');
    await page.getByTestId('video-edit-save').scrollIntoViewIfNeeded();
    await expect(page.getByTestId('video-edit-save')).toBeEnabled();
  });

  test('should render the Arabic editor right-to-left', async ({ page }) => {
    await openEditor(page, seed[SEED_TITLES.singleVideo], 'ar');

    await expect(page.locator('div[dir="rtl"]').first()).toBeVisible();
    await expect(page.getByTestId('video-edit-title-ar')).toHaveValue('فيديو اختبار');
  });
});

test.describe('Video Edit - ownership', () => {
  test.use({ storageState: AUTH_STATE.multi });

  test('should refuse to edit another user\'s video', async ({ page }) => {
    // Studio answers "not found" for a channel the user has no role on (it does not reveal it exists)
    await page.goto(`/en/studio/video/${seed[SEED_TITLES.singleVideo].id}/edit`);

    await expect(page.getByTestId('not-found-page')).toBeVisible();
    await expect(page.getByTestId('video-edit-form')).toHaveCount(0);
  });
});

test.describe('Video Edit - saving', () => {
  let video: E2EVideo | null = null;

  test.beforeEach(async () => {
    video = await createDisposableVideo('single', 'edit', { isPublic: false });
  });

  test.afterEach(async () => {
    await deleteVideoQuietly('single', video);
  });

  test('should save English and Arabic titles and description', async ({ page }) => {
    await openEditor(page, video!);

    await page.getByTestId('video-edit-title-en').fill('E2E edited title');
    await page.getByTestId('video-edit-description-en').fill('E2E edited description');
    await page.getByTestId('video-edit-title-ar').fill('عنوان معدل');
    await page.getByTestId('video-edit-description-ar').fill('وصف معدل');
    await save(page);

    // GET /api/videos/:id is briefly cached, so poll for the saved values
    await expect
      .poll(async () => {
        const stored = (await getVideo(userApi('single'), video!.id)) as E2EVideo & { descriptionLocalized?: Record<string, string> };
        return { title: stored?.titleLocalized, description: stored?.descriptionLocalized };
      }, { timeout: 60000 })
      .toMatchObject({
        title: { en: 'E2E edited title', ar: 'عنوان معدل' },
        description: { en: 'E2E edited description', ar: 'وصف معدل' },
      });
  });

  test('should toggle privacy', async ({ page }) => {
    await openEditor(page, video!);

    await expect(page.getByTestId('video-edit-privacy-private')).toBeChecked();
    await page.getByTestId('video-edit-privacy-public').check();
    await save(page);

    await expect.poll(async () => (await getVideo(userApi('single'), video!.id))?.isPublic, { timeout: 60000 }).toBe(true);
  });

  test('should add and remove tags', async ({ page }) => {
    await openEditor(page, video!);

    await page.getByTestId('video-edit-tag-input').fill('patience');
    await page.getByTestId('video-edit-add-tag').click();
    await page.getByTestId('video-edit-tag-input').fill('sabr');
    await page.getByTestId('video-edit-tag-input').press('Enter');
    await expect(page.getByTestId('video-edit-tag').filter({ hasText: 'patience' })).toBeVisible();
    await expect(page.getByTestId('video-edit-tag').filter({ hasText: 'sabr' })).toBeVisible();

    await page.getByTestId('video-edit-tag').filter({ hasText: 'sabr' }).getByRole('button').click();
    await expect(page.getByTestId('video-edit-tag').filter({ hasText: 'sabr' })).toHaveCount(0);
    await save(page);

    await expect
      .poll(async () => ((await getVideo(userApi('single'), video!.id)) as E2EVideo & { tags?: string[] })?.tags || [], { timeout: 60000 })
      .toEqual(expect.arrayContaining(['patience']));
    const tags = ((await getVideo(userApi('single'), video!.id)) as E2EVideo & { tags?: string[] })?.tags || [];
    expect(tags).not.toContain('sabr');
  });

  test('should return to the Studio video list after saving', async ({ page }) => {
    await openEditor(page, video!);

    await page.getByTestId('video-edit-title-en').fill('E2E saved and redirected');
    await save(page);
    await expect(page).toHaveURL(STUDIO_LIST);
  });
});
