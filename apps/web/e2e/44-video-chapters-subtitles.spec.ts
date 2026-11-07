import type { Page } from '@playwright/test';
import { test, expect } from './fixtures';
import { AUTH_STATE } from './test-utils/auth-state';
import { createDisposableVideo, deleteVideoQuietly, userApi, type E2EVideo } from './test-utils/e2e-videos';
import { ARABIC } from './test-utils/upload-studio';

/**
 * Chapters (ChapterEditor / ChapterUpload) and subtitles
 * (SubtitleUploadSection / SubtitleUploadModal) on the video edit page.
 * Each test edits its own disposable 40-second video (chapters must be at
 * least 10 seconds long). Chapters are stored on the video and go away with
 * it; subtitle tracks are deleted explicitly before the video is.
 */

test.use({ storageState: AUTH_STATE.single });

let video: E2EVideo | null = null;

test.beforeEach(async () => {
  test.setTimeout(240000);
  video = await createDisposableVideo('single', 'chapters', { sample: 'long' });
});

test.afterEach(async () => {
  if (video) {
    const u = userApi('single');
    for (const lang of ['en', 'ar', 'fr']) {
      await u.api
        .request(`/api/videos/${video.id}/subtitles/${lang}`, { method: 'DELETE', token: u.token, channelId: video.channelId, allowStatus: [400, 403, 404] })
        .catch(() => undefined);
    }
  }
  await deleteVideoQuietly('single', video);
});

async function openEditor(page: Page, locale: 'en' | 'ar' = 'en') {
  await page.goto(`/${locale}/video/${video!.id}/edit`);
  await expect(page.getByTestId('video-edit-form')).toBeVisible();
  await page.waitForLoadState('networkidle').catch(() => undefined);
  await expect(page.getByTestId('chapter-mode-manual')).toBeVisible();
}

async function storedChapters(): Promise<Array<{ startTime: number; title: string }>> {
  const u = userApi('single');
  const res = await u.api.get<{ chapters?: { chapters?: Array<{ startTime: number; title: string }> }; result?: { chapters?: Array<{ startTime: number; title: string }> } }>(
    `/api/videos/${video!.id}/chapters`,
    { token: u.token, allowStatus: [404] },
  );
  return res.data?.chapters?.chapters || res.data?.result?.chapters || [];
}

const rows = (page: Page) => page.getByTestId('chapter-row');

test.describe('Chapters - manual editor', () => {
  test('CHAP-001 adds, validates and saves chapters', async ({ page }) => {
    await openEditor(page);
    await page.getByTestId('chapter-mode-manual').click();

    await expect(rows(page)).toHaveCount(1);
    await expect(rows(page).first().getByTestId('chapter-start')).toHaveValue('0:00');
    await expect(rows(page).first().getByTestId('chapter-start')).toBeDisabled();

    // Titles are required
    await page.getByTestId('chapter-add').click();
    await expect(rows(page)).toHaveCount(2);
    await expect(rows(page).nth(1).getByTestId('chapter-start')).toHaveValue('0:20');
    await page.getByTestId('chapter-save').click();
    await expect(rows(page).first().getByTestId('chapter-error')).toHaveText(/title is required/i);

    await rows(page).nth(0).getByLabel('Chapter Title').fill('Opening');
    await rows(page).nth(1).getByLabel('Chapter Title').fill('Main talk');
    await rows(page).nth(1).getByTestId('chapter-start').fill('0:15');
    await page.getByTestId('chapter-save').click();

    await expect(page.getByTestId('chapter-summary')).toHaveAttribute('data-count', '2');
    await expect(page.getByTestId('video-edit-error')).toHaveCount(0);
    await expect
      .poll(async () => (await storedChapters()).map((c) => [c.startTime, c.title]), { timeout: 60000 })
      .toEqual([[0, 'Opening'], [15, 'Main talk']]);
  });

  test('CHAP-002 rejects chapters shorter than 10 seconds and keeps the order when moving titles', async ({ page }) => {
    await openEditor(page);
    await page.getByTestId('chapter-mode-manual').click();
    await page.getByTestId('chapter-add').click();
    await rows(page).nth(0).getByTestId('chapter-title').fill('First');
    await rows(page).nth(1).getByTestId('chapter-title').fill('Second');

    await rows(page).nth(1).getByTestId('chapter-start').fill('0:05');
    await expect(rows(page).nth(1).getByTestId('chapter-error')).toHaveText(/10/);

    // Moving swaps the titles; the first slot still starts at 0:00
    await rows(page).nth(1).getByTestId('chapter-start').fill('0:20');
    await expect(rows(page).nth(1).getByTestId('chapter-error')).toHaveCount(0);
    await rows(page).nth(1).getByTestId('chapter-move-up').click();
    await expect(rows(page).nth(0).getByTestId('chapter-title')).toHaveValue('Second');
    await expect(rows(page).nth(0).getByTestId('chapter-start')).toHaveValue('0:00');
    await expect(rows(page).nth(0).getByTestId('chapter-move-up')).toBeDisabled();

    // Removing leaves one chapter, which cannot be removed
    await rows(page).nth(1).getByTestId('chapter-remove').click();
    await expect(rows(page)).toHaveCount(1);
    await expect(rows(page).first().getByTestId('chapter-remove')).toBeDisabled();
    await page.getByTestId('chapter-cancel').click();
    await expect(rows(page)).toHaveCount(0);
    await expect(page.getByTestId('chapter-mode-manual')).toBeVisible();
  });

  test('CHAP-003 shows the chapter editor in Arabic with left-to-right timestamps (ar)', async ({ page }) => {
    await openEditor(page, 'ar');
    await page.getByTestId('chapter-mode-manual').click();
    const row = rows(page).first();
    await expect(row.getByTestId('chapter-title')).toHaveAccessibleName(ARABIC);
    await expect(row.getByTestId('chapter-start')).toHaveAccessibleName(ARABIC);
    await expect(row.getByTestId('chapter-start')).toHaveAttribute('dir', 'ltr');
    await expect(page.getByTestId('chapter-add')).toHaveText(ARABIC);
  });
});

test.describe('Chapters - file import', () => {
  test('CHAP-004 imports chapters from a text file', async ({ page }) => {
    await openEditor(page);
    await page.getByTestId('chapter-mode-upload').click();
    await page.getByTestId('chapter-file-input').setInputFiles({
      name: 'chapters.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from('0:00 Opening\n0:20 Questions and answers\n'),
    });

    await expect(page.getByTestId('chapter-file-preview-item')).toHaveCount(2);
    await page.getByTestId('chapter-file-import').click();
    await expect(page.getByTestId('chapter-summary')).toHaveAttribute('data-count', '2');
    await expect
      .poll(async () => (await storedChapters()).map((c) => c.title), { timeout: 60000 })
      .toEqual(['Opening', 'Questions and answers']);
  });

  test('CHAP-005 lists parse errors and blocks the import', async ({ page }) => {
    await openEditor(page);
    await page.getByTestId('chapter-mode-upload').click();
    await page.getByTestId('chapter-file-input').setInputFiles({
      name: 'chapters.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from('0:05 Starts late\nnot a chapter line\n'),
    });

    const errors = page.getByTestId('chapter-file-errors');
    await expect(errors).toContainText('Line 2');
    await expect(errors).toContainText('First chapter must start at 0:00');
    await expect(page.getByTestId('chapter-file-import')).toBeDisabled();

    // Removing the file returns to the picker
    await page.getByTestId('chapter-file-remove').click();
    await expect(page.getByTestId('chapter-file-dropzone')).toBeVisible();
  });

  test('CHAP-006 rejects unsupported chapter files with a localized message (ar)', async ({ page }) => {
    await openEditor(page, 'ar');
    await page.getByTestId('chapter-mode-upload').click();
    await page.getByTestId('chapter-file-input').setInputFiles({ name: 'chapters.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF') });
    await expect(page.getByTestId('chapter-file-errors')).toContainText(ARABIC);
    await expect(page.getByTestId('chapter-file-dropzone')).toContainText(ARABIC);
  });
});

const VTT = 'WEBVTT\n\n00:00:00.000 --> 00:00:04.000\nAssalamu alaikum\n\n00:00:04.000 --> 00:00:08.000\nWelcome\n';

/**
 * Opens the language Select from the keyboard: the dialog's open animation
 * keeps the trigger "unstable" for Playwright's click checks on some runs.
 */
async function openLanguagePicker(page: Page) {
  const trigger = page.getByRole('dialog').getByTestId('subtitle-language');
  await expect(trigger).toBeVisible();
  await trigger.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('listbox')).toBeVisible();
}

async function addSubtitle(page: Page, languageName: RegExp, opts: { makeDefault?: boolean } = {}) {
  await page.getByTestId('subtitle-add').click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await openLanguagePicker(page);
  await page.getByRole('option', { name: languageName }).click();
  await dialog.getByTestId('subtitle-file-input').setInputFiles({ name: 'captions.vtt', mimeType: 'text/vtt', buffer: Buffer.from(VTT) });
  if (opts.makeDefault) await dialog.getByTestId('subtitle-is-default').check();
  await expect(dialog.getByTestId('subtitle-upload-submit')).toBeEnabled();
  await dialog.getByTestId('subtitle-upload-submit').click();
  await expect(dialog.getByTestId('subtitle-upload-success')).toBeVisible({ timeout: 30000 });
  await expect(dialog).toBeHidden({ timeout: 10000 });
}

test.describe('Subtitles', () => {
  test('SUB-001 uploads tracks, switches the default and deletes a track', async ({ page }) => {
    await openEditor(page);
    await expect(page.getByTestId('subtitle-add-first')).toBeVisible();

    await addSubtitle(page, /English/, { makeDefault: true });
    const en = page.locator('[data-testid="subtitle-track"][data-language="en"]');
    await expect(en).toHaveAttribute('data-default', 'true');

    await addSubtitle(page, /Arabic/);
    const ar = page.locator('[data-testid="subtitle-track"][data-language="ar"]');
    await expect(ar).toHaveAttribute('data-default', 'false');

    await ar.getByTestId('subtitle-set-default').click();
    await expect(ar).toHaveAttribute('data-default', 'true');
    await expect(en).toHaveAttribute('data-default', 'false');

    await en.getByTestId('subtitle-delete').click();
    // Keyboard activation: the alert dialog's entry animation can keep a pointer click "unstable"
    await page.getByTestId('subtitle-delete-confirm').press('Enter');
    await expect(en).toHaveCount(0);
    await expect(ar).toBeVisible();

    // The stored state matches after a reload
    await openEditor(page);
    await expect(page.locator('[data-testid="subtitle-track"][data-language="ar"]')).toHaveAttribute('data-default', 'true');
    await expect(page.locator('[data-testid="subtitle-track"][data-language="en"]')).toHaveCount(0);
  });

  test('SUB-002 rejects a file that is not a subtitle track', async ({ page }) => {
    await openEditor(page);
    await page.getByTestId('subtitle-add').click();
    const dialog = page.getByRole('dialog');
    await dialog.getByTestId('subtitle-file-input').setInputFiles({ name: 'broken.srt', mimeType: 'application/x-subrip', buffer: Buffer.from('this is not a subtitle file') });
    await expect(dialog.getByTestId('subtitle-upload-error')).toBeVisible();
    await expect(dialog.getByTestId('subtitle-upload-submit')).toBeDisabled();
    await dialog.getByTestId('subtitle-upload-cancel').click();
    await expect(dialog).toBeHidden();
  });

  test('SUB-003 shows the subtitle dialog in Arabic (ar)', async ({ page }) => {
    await openEditor(page, 'ar');
    await page.getByTestId('subtitle-add').click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByRole('heading')).toHaveText(ARABIC);
    // The file input is visually hidden behind the drop area, so check its label directly
    await expect(dialog.getByTestId('subtitle-file-input')).toHaveAttribute('aria-label', ARABIC);
    await openLanguagePicker(page);
    await expect(page.getByRole('option').first()).toContainText(ARABIC);
    await page.keyboard.press('Escape');
    await dialog.getByTestId('subtitle-upload-cancel').click();
    await expect(dialog).toBeHidden();
  });
});
