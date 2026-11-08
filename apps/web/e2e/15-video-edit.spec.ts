import { test, expect } from './fixtures';
import type { Page } from '@playwright/test';
import { AUTH_STATE } from './test-utils/auth-state';
import {
  SEED_TITLES,
  createDisposableVideo,
  deleteVideoQuietly,
  ensureSeedVideos,
  getVideo,
  userApi,
  type E2EVideo,
} from './test-utils/e2e-videos';

/**
 * Video edit page (/[locale]/video/[id]/edit) E2E tests.
 *
 * Saving goes through a server action to the real QA API, so tests that save
 * edit a disposable video they upload themselves; read-only tests open the
 * single-channel user's seed video and never save it.
 */

test.use({ storageState: AUTH_STATE.single });

let seed: Record<string, E2EVideo> = {};

test.beforeAll(async () => {
  test.setTimeout(180000);
  seed = await ensureSeedVideos('single');
});

async function openEditor(page: Page, video: E2EVideo, locale: 'en' | 'ar' = 'en') {
  await page.goto(`/${locale}/video/${video.id}/edit`);
  await expect(page.getByTestId('video-edit-form')).toBeVisible();
  // Let the session/profile checks that run after hydration finish before
  // editing, so a late re-render cannot race the test's input
  await page.waitForLoadState('networkidle').catch(() => undefined);
  await expect(page.getByTestId('video-edit-form')).toBeVisible();
}

/**
 * Saves and waits for the outcome: the success message, which is shown for
 * ~1.5s before the page moves on to the video page. Either one proves the
 * save went through; tests verify the stored values through the API.
 */
async function save(page: Page) {
  const saveButton = page.getByTestId('video-edit-save');
  await expect(saveButton).toBeEnabled();
  await saveButton.click();
  const succeeded = await expect(page.getByTestId('video-edit-success'))
    .toBeVisible({ timeout: 15000 })
    .then(() => true, () => false);
  if (!succeeded) await expect(page).toHaveURL(/\/video\?vid=/);
}

test.describe('Video Edit - read only', () => {
  test('should load the edit page with the stored metadata', async ({ page }) => {
    const video = seed[SEED_TITLES.singleVideo];
    await openEditor(page, video);

    await expect(page.getByTestId('video-edit-title-en')).toHaveValue(SEED_TITLES.singleVideo);
    await expect(page.getByTestId('video-edit-privacy-private')).toBeChecked();
    await expect(page.getByTestId('video-edit-save')).toBeDisabled();
    await expect(page.getByTestId('video-edit-unsaved')).toHaveCount(0);
  });

  test('should switch between language tabs', async ({ page }) => {
    await openEditor(page, seed[SEED_TITLES.singleVideo]);

    await page.getByTestId('video-edit-tab-ar').click();
    await expect(page.getByTestId('video-edit-tab-ar')).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByTestId('video-edit-title-ar')).toBeVisible();
    await expect(page.getByTestId('video-edit-title-ar')).toHaveAttribute('dir', 'rtl');
    await expect(page.getByTestId('video-edit-title-en')).toHaveCount(0);

    await page.getByTestId('video-edit-tab-en').click();
    await expect(page.getByTestId('video-edit-title-en')).toBeVisible();
  });

  test('should preserve unsaved changes when switching tabs', async ({ page }) => {
    await openEditor(page, seed[SEED_TITLES.singleVideo]);

    await page.getByTestId('video-edit-title-en').fill('Edited but not saved');
    await page.getByTestId('video-edit-tab-ar').click();
    await page.getByTestId('video-edit-title-ar').fill('تعديل غير محفوظ');
    await page.getByTestId('video-edit-tab-en').click();

    await expect(page.getByTestId('video-edit-title-en')).toHaveValue('Edited but not saved');
    await page.getByTestId('video-edit-tab-ar').click();
    await expect(page.getByTestId('video-edit-title-ar')).toHaveValue('تعديل غير محفوظ');
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
    await page.getByTestId('video-edit-tab-ar').click();
    await page.getByTestId('video-edit-title-ar').fill('');
    await page.getByTestId('video-edit-save').click();

    await expect(page.getByTestId('video-edit-error')).toBeVisible();
    await expect(page.getByTestId('video-edit-success')).toHaveCount(0);
  });

  test('should keep the user on the page when cancel is dismissed', async ({ page }) => {
    const video = seed[SEED_TITLES.singleVideo];
    await openEditor(page, video);
    await page.getByTestId('video-edit-title-en').fill('Unsaved title');

    page.once('dialog', (dialog) => dialog.dismiss());
    await page.getByTestId('video-edit-cancel').click();
    await expect(page).toHaveURL(new RegExp(`/video/${video.id}/edit`));
    await expect(page.getByTestId('video-edit-title-en')).toHaveValue('Unsaved title');
  });

  test('should discard changes when cancel is confirmed', async ({ page }) => {
    const video = seed[SEED_TITLES.singleVideo];
    await openEditor(page, video);
    await page.getByTestId('video-edit-title-en').fill('Unsaved title');

    page.once('dialog', (dialog) => dialog.accept());
    await page.getByTestId('video-edit-cancel').click();
    await expect(page).toHaveURL(new RegExp(`/en/video\\?vid=${video.id}`));

    const stored = await getVideo(userApi('single'), video.id);
    expect(stored?.title).toBe(SEED_TITLES.singleVideo);
  });

  test('should leave without a prompt when nothing changed', async ({ page }) => {
    const video = seed[SEED_TITLES.singleVideo];
    await openEditor(page, video);

    let prompted = false;
    page.once('dialog', (dialog) => {
      prompted = true;
      return dialog.dismiss();
    });
    await page.getByTestId('video-edit-cancel').click();
    await expect(page).toHaveURL(new RegExp(`/en/video\\?vid=${video.id}`));
    expect(prompted).toBe(false);
  });

  test('should show an error when the save request fails', async ({ page }) => {
    const video = seed[SEED_TITLES.singleVideo];
    await openEditor(page, video);
    await page.getByTestId('video-edit-description-en').fill('This save is aborted by the test');

    // Server actions are POSTed by the browser to the page URL; fail them
    await page.route(`**/video/${video.id}/edit`, (route) =>
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
    await page.getByTestId('video-edit-tab-ar').click();
    await expect(page.getByTestId('video-edit-title-ar')).toHaveValue('فيديو اختبار');
  });
});

test.describe('Video Edit - ownership', () => {
  test.use({ storageState: AUTH_STATE.multi });

  test('should refuse to edit another user\'s video', async ({ page }) => {
    await page.goto(`/en/video/${seed[SEED_TITLES.singleVideo].id}/edit`);

    await expect(page.getByTestId('video-edit-page-error')).toBeVisible();
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
    await page.getByTestId('video-edit-tab-ar').click();
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

  test('should return to the video page after saving', async ({ page }) => {
    await openEditor(page, video!);

    await page.getByTestId('video-edit-title-en').fill('E2E saved and redirected');
    await save(page);
    await expect(page).toHaveURL(new RegExp(`/en/video\\?vid=${video!.id}`));
  });
});
