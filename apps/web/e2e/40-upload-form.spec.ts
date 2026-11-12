import * as path from 'path';
import { test, expect, helpers } from './fixtures';
import { AUTH_STATE, ANONYMOUS_STATE } from './test-utils/auth-state';
import { getVideo, userApi, type E2EVideo } from './test-utils/e2e-videos';
import { deleteVideos, expectUploadSuccess, gotoUpload, selectVideo, trackUploads, uploadPlaylistsDeployed, uploadUi } from './test-utils/upload';
import { ARABIC, expectDarkSurface, expectLightSurface, expectNoHorizontalScroll } from './test-utils/upload-studio';
import { chooseThemedOption, themedNative, themedTrigger } from './test-utils/themed-select';
import { apiAs, channelsOf, createPlaylist, deletePlaylistsTitled, tempName } from './test-utils/channel-content';

/**
 * Upload page (/[locale]/upload): the single-upload metadata form and its
 * sub-sections (CategorySelector, ThumbnailUploadSection,
 * ScheduleDateTimeSelector), plus the signed-out / no-channel states in both
 * locales and colour schemes. Real uploads go through the QA TUS proxy as the
 * single-channel user and are deleted afterwards.
 */

const THUMBNAIL_JPG = path.join(__dirname, 'test-fixtures', 'e2e-thumbnail.jpg');
const SAMPLE_WEBM = path.join(__dirname, 'test-fixtures', 'e2e-sample.webm');
/** 360x640 (9:16) VP8 clip with a centred circle */
const VERTICAL_WEBM = path.join(__dirname, 'test-fixtures', 'e2e-sample-vertical-9x16.webm');

/** datetime-local value for a date `ms` from now (local time) */
function localDateTime(ms: number): string {
  const d = new Date(Date.now() + ms);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

const DAY = 24 * 60 * 60 * 1000;

test.describe('Upload form - metadata', () => {
  test.use({ storageState: AUTH_STATE.single });

  test('UPL-001 shows the upload modes and a labelled metadata form (en)', async ({ page }) => {
    await gotoUpload(page, 'en');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(/upload/i);
    await expect(page.getByTestId('upload-mode-single')).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByTestId('upload-mode-batch')).toHaveAttribute('aria-selected', 'false');
    // The mode switch is a tab list that owns the upload panel, not a pair of buttons
    const tabs = page.getByRole('tablist', { name: 'How many videos' });
    await expect(tabs.getByRole('tab')).toHaveCount(2);
    await expect(page.getByRole('tab', { name: 'Single video', selected: true })).toBeVisible();
    await expect(page.getByRole('tabpanel', { name: 'Single video', exact: true })).toContainText(/./);
    // Roving tabindex: arrows move focus, Enter selects
    await page.getByTestId('upload-mode-single').focus();
    await page.keyboard.press('ArrowRight');
    await expect(page.getByTestId('upload-mode-batch')).toBeFocused();
    await expect(page.getByTestId('upload-mode-single')).toHaveAttribute('aria-selected', 'true');
    await page.keyboard.press('Enter');
    await expect(page.getByRole('tabpanel', { name: 'Batch upload', exact: true })).toBeVisible();
    await page.keyboard.press('ArrowLeft');
    await page.keyboard.press('Space');
    await expect(page.getByTestId('upload-mode-single')).toHaveAttribute('aria-selected', 'true');

    await selectVideo(page, await helpers.createTestVideo('upl-001.mp4', 16));
    // Dropdowns are reachable by their visible labels (the themed trigger)
    await expect(page.getByLabel('Upload Template')).toBeVisible();
    await expect(themedNative(page.getByLabel('Upload Template'))).toHaveValue('');
    await expect(page.getByLabel('Video Category')).toBeVisible();
    await expect(themedNative(page.getByLabel('Video Category')).locator('option')).not.toHaveCount(0);
    await expect(uploadUi(page).isPublic).toBeChecked();
    await expect(page.getByTestId('upload-schedule-now')).toBeChecked();
  });

  test('UPL-002 renders the form right-to-left with Arabic labels (ar)', async ({ page }) => {
    await gotoUpload(page, 'ar');
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(ARABIC);
    // Mode tabs: Arabic names, first tab on the right, ArrowLeft moves to the next tab in RTL
    const single = page.getByTestId('upload-mode-single');
    const batch = page.getByTestId('upload-mode-batch');
    // Named by content: the visible label first, then the visible hint (WCAG 2.5.3)
    await expect(single).toHaveAccessibleName(/^فيديو واحد\s*، \S/);
    await expect(batch).toHaveAccessibleName(/^رفع جماعي\s*، \S/);
    const [singleBox, batchBox] = [await single.boundingBox(), await batch.boundingBox()];
    expect(singleBox!.x).toBeGreaterThan(batchBox!.x);
    await single.focus();
    await page.keyboard.press('ArrowLeft');
    await expect(batch).toBeFocused();
    await page.keyboard.press('ArrowRight');
    await expect(single).toBeFocused();
    await selectVideo(page, await helpers.createTestVideo('upl-002.mp4', 16));

    const category = page.getByTestId('category-select');
    await expect(themedTrigger(category)).toHaveAccessibleName(ARABIC);
    await expect(category).toHaveAttribute('dir', 'rtl');
    await expect(category.locator('option').nth(1)).toHaveText(ARABIC);
    await expect(themedTrigger(page.getByTestId('upload-template-select'))).toHaveAccessibleName(ARABIC);
    await expect(page.getByTestId('upload-thumbnail-section').getByRole('heading').first()).toHaveText(ARABIC);
    await expect(page.getByTestId('upload-schedule')).toContainText(ARABIC);
  });

  test('UPL-003 selecting a category shows the helper text and can be cleared', async ({ page }) => {
    await gotoUpload(page, 'en');
    await selectVideo(page, await helpers.createTestVideo('upl-003.mp4', 16));
    const category = page.getByTestId('category-select');

    await chooseThemedOption(category, 'quran_tafsir');
    await expect(page.getByText('Category helps viewers find your content')).toBeVisible();
    await chooseThemedOption(category, '');
    await expect(page.getByText('Category helps viewers find your content')).toHaveCount(0);
  });

  test('UPL-004 fits a phone screen without horizontal scrolling', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 740 });
    await gotoUpload(page, 'en');
    await selectVideo(page, await helpers.createTestVideo('upl-004.mp4', 16));
    await page.getByTestId('upload-schedule-later').check();
    await expect(page.getByTestId('upload-schedule-datetime')).toBeVisible();
    await expectNoHorizontalScroll(page);
  });
});

test.describe('Upload form - colour schemes', () => {
  test.use({ storageState: AUTH_STATE.single });

  test.describe('dark', () => {
    test.use({ colorScheme: 'dark' });

    for (const locale of ['en', 'ar'] as const) {
      test(`UPL-005 follows the dark colour scheme (${locale})`, async ({ page }) => {
        await gotoUpload(page, locale);
        await selectVideo(page, await helpers.createTestVideo(`upl-005-${locale}.mp4`, 16));
        const details = uploadUi(page).details;
        await expectDarkSurface(page, details, details.getByRole('heading').first());
      });
    }
  });

  test.describe('light', () => {
    test.use({ colorScheme: 'light' });

    test('UPL-006 uses light surfaces in the light colour scheme', async ({ page }) => {
      await gotoUpload(page, 'en');
      await selectVideo(page, await helpers.createTestVideo('upl-006.mp4', 16));
      await expectLightSurface(page, uploadUi(page).details);
    });
  });
});

test.describe('Upload form - thumbnail section', () => {
  test.use({ storageState: AUTH_STATE.single });

  test('THUMB-101 offers a custom thumbnail with preview and clear (en)', async ({ page }) => {
    await gotoUpload(page, 'en');
    await selectVideo(page, await helpers.createTestVideo('thumb-101.mp4', 16));
    const section = page.getByTestId('upload-thumbnail-section');
    await expect(page.getByTestId('upload-thumbnail-input')).toHaveAccessibleName(/thumbnail/i);
    await expect(page.getByTestId('upload-thumbnail-input')).toHaveAttribute('accept', 'image/jpeg,image/png,image/webp');

    await page.getByTestId('upload-thumbnail-input').setInputFiles(THUMBNAIL_JPG);
    const preview = page.getByTestId('upload-thumbnail-preview');
    await expect(preview).toHaveAttribute('data-type', 'custom');
    await expect(preview).toContainText('e2e-thumbnail.jpg');
    await expect(preview.locator('img')).toHaveAttribute('src', /^data:image\/jpeg;base64,/);

    await section.getByTestId('upload-thumbnail-clear').click();
    await expect(preview).toHaveCount(0);
  });

  test('THUMB-104 extracts frames from the selected video and selects one', async ({ page, browserName }) => {
    // Environmental: headless Playwright WebKit cannot seek/draw either sample clip to a canvas
    test.skip(browserName === 'webkit', 'Playwright WebKit cannot decode the sample clips for frame extraction');
    await gotoUpload(page, 'en');
    // Playwright's Chromium build has no H.264 decoder, so it gets the VP8 clip
    await selectVideo(page, browserName === 'chromium' ? SAMPLE_WEBM : await helpers.createTestVideo('thumb-104.mp4', 16));

    const frames = page.getByTestId('upload-thumbnail-frame');
    await expect(frames).toHaveCount(5, { timeout: 30000 });
    await expect(frames.first()).toHaveAccessibleName('Thumbnail at 10%');
    await frames.nth(2).click();
    await expect(frames.nth(2)).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('[data-testid="upload-thumbnail-frame"][aria-pressed="true"]')).toHaveCount(1);
    await expect(page.getByTestId('upload-thumbnail-preview')).toHaveAttribute('data-type', 'auto');
  });

  test('THUMB-105 frames of a vertical video keep its 9:16 shape and are never stretched', async ({ page, browserName }) => {
    test.skip(browserName === 'webkit', 'Playwright WebKit cannot decode the sample clips for frame extraction');
    test.skip(browserName !== 'chromium' && browserName !== 'firefox', 'VP8 clip');
    await gotoUpload(page, 'en');
    await selectVideo(page, VERTICAL_WEBM);

    const frames = page.getByTestId('upload-thumbnail-frame');
    await expect(frames).toHaveCount(5, { timeout: 30000 });
    // Each extracted frame is 720x1280, not a squashed 1280x720
    const sizes = await frames.locator('img[data-testid="thumbnail-image"]').evaluateAll((imgs) =>
      (imgs as HTMLImageElement[]).map((i) => [i.naturalWidth, i.naturalHeight]),
    );
    expect(sizes).toHaveLength(5);
    for (const [w, h] of sizes) expect(w / h).toBeCloseTo(9 / 16, 2);
    // Shown whole in the 16:9 tiles
    await expect(frames.first().locator('img[data-testid="thumbnail-image"]')).toHaveAttribute('data-fit', 'contain');

    await frames.nth(2).click();
    const preview = page.getByTestId('upload-thumbnail-preview').locator('img');
    await expect(preview).toBeVisible();
    const box = await preview.evaluate((i: HTMLImageElement) => {
      const r = i.getBoundingClientRect();
      return { natural: i.naturalWidth / i.naturalHeight, rendered: r.width / r.height };
    });
    expect(box.natural).toBeCloseTo(9 / 16, 2);
    // The preview is drawn at the image's own shape (no distortion)
    expect(Math.abs(box.rendered - box.natural)).toBeLessThan(0.02);
  });

  test('THUMB-102 rejects a non-image file with a localized error (ar)', async ({ page }) => {
    await gotoUpload(page, 'ar');
    await selectVideo(page, await helpers.createTestVideo('thumb-102.mp4', 16));

    await page.getByTestId('upload-thumbnail-input').setInputFiles({
      name: 'notes.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from('not an image'),
    });
    await expect(page.getByTestId('upload-thumbnail-error')).toHaveText(ARABIC);
    await expect(page.getByTestId('upload-thumbnail-preview')).toHaveCount(0);
  });

  test('THUMB-103 rejects images over 2MB', async ({ page }) => {
    await gotoUpload(page, 'en');
    await selectVideo(page, await helpers.createTestVideo('thumb-103.mp4', 16));

    await page.getByTestId('upload-thumbnail-input').setInputFiles({
      name: 'huge.jpg',
      mimeType: 'image/jpeg',
      buffer: Buffer.alloc(2 * 1024 * 1024 + 1, 0xff),
    });
    await expect(page.getByTestId('upload-thumbnail-error')).toContainText(/2MB/i);
    await expect(page.getByTestId('upload-thumbnail-preview')).toHaveCount(0);
  });
});

test.describe('Upload form - scheduling', () => {
  test.use({ storageState: AUTH_STATE.single });

  test('SCHED-101 validates the publish time and keeps scheduled uploads private (en)', async ({ page }) => {
    await gotoUpload(page, 'en');
    await selectVideo(page, await helpers.createTestVideo('sched-101.mp4', 16));
    const ui = uploadUi(page);

    await page.getByTestId('upload-schedule-later').check();
    const input = page.getByTestId('upload-schedule-datetime');
    await expect(input).toBeVisible();
    await expect(page.getByLabel('Date and Time', { exact: true })).toBeVisible();
    await expect(page.getByTestId('upload-schedule-timezone')).toContainText(/\w+\/\w+|UTC/);

    // Less than 15 minutes ahead is rejected
    await input.fill(localDateTime(5 * 60 * 1000));
    await expect(page.getByTestId('upload-schedule-error')).toContainText('minutes');
    await expect(ui.isPublic).toBeEnabled();

    // A valid time shows the preview and forces the video private
    await input.fill(localDateTime(3 * DAY));
    await expect(page.getByTestId('upload-schedule-error')).toHaveCount(0);
    await expect(page.getByTestId('upload-schedule-preview')).toBeVisible();
    await expect(ui.isPublic).not.toBeChecked();
    await expect(ui.isPublic).toBeDisabled();

    // Clearing the date and going back to "publish immediately" restores the toggle
    await page.getByTestId('upload-schedule-clear').click();
    await expect(input).toHaveValue('');
    await page.getByTestId('upload-schedule-now').check();
    await expect(input).toHaveCount(0);
    await expect(ui.isPublic).toBeEnabled();
    await expect(ui.isPublic).toBeChecked();
  });

  test('SCHED-102 rejects publish times more than a year ahead', async ({ page }) => {
    await gotoUpload(page, 'en');
    await selectVideo(page, await helpers.createTestVideo('sched-102.mp4', 16));
    await page.getByTestId('upload-schedule-later').check();

    await page.getByTestId('upload-schedule-datetime').fill(localDateTime(400 * DAY));
    await expect(page.getByTestId('upload-schedule-error')).toContainText(/1 year/);
    await expect(page.getByTestId('upload-schedule-preview')).toHaveCount(0);
  });

  test('SCHED-103 localizes the schedule preview and controls (ar)', async ({ page }) => {
    await gotoUpload(page, 'ar');
    await selectVideo(page, await helpers.createTestVideo('sched-103.mp4', 16));
    await page.getByTestId('upload-schedule-later').check();
    await page.getByTestId('upload-schedule-datetime').fill(localDateTime(3 * DAY));

    const preview = page.getByTestId('upload-schedule-preview');
    await expect(preview).toBeVisible();
    // Both the label and the formatted date are Arabic (the date used to be en-US)
    expect(((await preview.innerText()).match(/[؀-ۿ]/g) || []).length).toBeGreaterThan(15);
    await expect(page.getByTestId('upload-schedule-clear')).toHaveAccessibleName(ARABIC);
    await expect(page.getByTestId('upload-schedule-datetime')).toHaveAccessibleName(ARABIC);
  });
});

test.describe('Upload form - real uploads', () => {
  test.use({ storageState: AUTH_STATE.single });

  let tracker: ReturnType<typeof trackUploads>;
  test.beforeEach(async ({ page }) => {
    tracker = trackUploads(page);
  });
  test.afterEach(async ({ page }) => {
    await deleteVideos(page, tracker.videoIds);
  });

  test('SCHED-104 uploads a scheduled video that stays private until its publish date', async ({ page }) => {
    await gotoUpload(page, 'en');
    const ui = uploadUi(page);
    await selectVideo(page, await helpers.createTestVideo('sched-104.mp4', 64));
    await ui.titleEn.fill('E2E Temp scheduled upload');
    await page.getByTestId('upload-schedule-later').check();
    await page.getByTestId('upload-schedule-datetime').fill(localDateTime(5 * DAY));
    await ui.submit.click();

    await expectUploadSuccess(page, 'E2E Temp scheduled upload');
    expect(tracker.videoIds.size).toBe(1);
    const [videoId] = [...tracker.videoIds];
    await expect
      .poll(async () => {
        const v = (await getVideo(userApi('single'), videoId)) as E2EVideo | null;
        return { isPublic: v?.isPublic, status: v?.scheduledPublishStatus };
      }, { timeout: 60000 })
      .toEqual({ isPublic: false, status: 'scheduled' });
  });

  test('UPL-007 stores the Arabic title, description and category chosen on upload', async ({ page }) => {
    await gotoUpload(page, 'en');
    const ui = uploadUi(page);
    await selectVideo(page, await helpers.createTestVideo('upl-007.mp4', 64));
    await ui.titleEn.fill('E2E Temp bilingual upload');
    await ui.langTabAr.click();
    await ui.titleAr.fill('رفع ثنائي اللغة');
    await ui.descriptionAr.fill('وصف عربي');
    await page.getByTestId('category-select').selectOption('islamic_lectures');
    await ui.submit.click();

    await expectUploadSuccess(page, 'E2E Temp bilingual upload');
    const [videoId] = [...tracker.videoIds];
    await expect
      .poll(async () => {
        const v = (await getVideo(userApi('single'), videoId)) as
          | (E2EVideo & { category?: string; descriptionLocalized?: Record<string, string> })
          | null;
        return { title: v?.titleLocalized?.ar, description: v?.descriptionLocalized?.ar, category: v?.category };
      }, { timeout: 60000 })
      .toEqual({ title: 'رفع ثنائي اللغة', description: 'وصف عربي', category: 'islamic_lectures' });
  });
});

test.describe('Upload form - playlists', () => {
  test.use({ storageState: AUTH_STATE.single });
  test.beforeEach(async () => {
    test.skip(!(await uploadPlaylistsDeployed()), 'Upload playlists are not deployed on the target yet (they land with the PR that adds them)');
  });

  let tracker: ReturnType<typeof trackUploads>;
  let prefix = '';
  const channelId = () => channelsOf('single').main.id;
  test.beforeEach(async ({ page }) => {
    tracker = trackUploads(page);
    prefix = tempName('upl-playlist');
  });
  test.afterEach(async ({ page }) => {
    await deleteVideos(page, tracker.videoIds);
    await deletePlaylistsTitled('single', channelId(), prefix);
  });

  test('UPL-PL-001 picks an existing playlist, creates one inline, and the new video is added to both (en)', async ({ page }) => {
    const existing = await createPlaylist('single', channelId(), { title: `${prefix} existing` });
    await gotoUpload(page, 'en');
    const ui = uploadUi(page);
    await selectVideo(page, await helpers.createTestVideo('upl-pl-001.mp4', 64));
    await ui.titleEn.fill(`${prefix} video`);

    const picker = page.getByTestId('upload-playlists');
    await picker.getByTestId('upload-playlists-toggle').click();
    await picker.getByTestId('upload-playlists-search').fill(`${prefix} exi`);
    // The picker lists the channel's playlists with GET /api/playlists?channelId=, which
    // scans the whole bucket: 13 s on a quiet QA, over 30 s under the E2E jobs (#909)
    const existingOption = picker.getByLabel(`${prefix} existing`);
    await expect(existingOption).toBeVisible({ timeout: 90_000 });
    await existingOption.check();
    await picker.getByTestId('upload-playlists-new').click();
    await picker.getByTestId('upload-playlists-name').fill(`${prefix} created`);
    await picker.getByTestId('upload-playlists-visibility-private').check();
    await picker.getByTestId('upload-playlists-description').fill('Made while uploading');
    await picker.getByTestId('upload-playlists-create').click();
    await expect(picker.getByTestId('upload-playlists-message')).toContainText(`Created "${prefix} created" and selected it`);
    await expect(picker.getByTestId('upload-playlists-chip')).toHaveCount(2);

    await ui.submit.click();
    await expectUploadSuccess(page, `${prefix} video`);
    const [videoId] = [...tracker.videoIds];
    const created = (await apiAs<{ data?: Array<{ id: string; title: string; isPublic?: boolean; description?: string }> }>('single', 'GET', `/api/playlists?channelId=${channelId()}&limit=100`))
      .body.data?.find((p) => p.title === `${prefix} created`);
    expect(created).toMatchObject({ isPublic: false, description: 'Made while uploading' });
    for (const id of [existing.id, created!.id]) {
      await expect
        .poll(async () => (await apiAs<{ videos?: string[] }>('single', 'GET', `/api/playlists/${id}`)).body.videos ?? [], { timeout: 90000 })
        .toEqual([videoId]);
    }
    await expect(page.getByTestId('playlist-add-notice')).toHaveCount(0);
  });

  test('UPL-PL-002 shows the playlist picker right-to-left in Arabic', async ({ page }) => {
    await gotoUpload(page, 'ar');
    await selectVideo(page, await helpers.createTestVideo('upl-pl-002.mp4', 16));
    const picker = page.getByTestId('upload-playlists');
    await expect(picker).toHaveAttribute('dir', 'rtl');
    await expect(picker).toContainText(ARABIC);
    await picker.getByTestId('upload-playlists-toggle').click();
    await expect(picker.getByTestId('upload-playlists-search')).toHaveAttribute('placeholder', 'ابحث في قوائم التشغيل');
    await expectNoHorizontalScroll(page);
  });
});

test.describe('Upload page - access states', () => {
  test.describe('signed out', () => {
    test.use({ storageState: ANONYMOUS_STATE });

    test('UPL-008 asks anonymous visitors to sign in (ar)', async ({ page }) => {
      await page.goto('/ar/upload');
      const signIn = uploadUi(page).signIn;
      await expect(signIn).toBeVisible();
      await expect(signIn.getByRole('heading')).toHaveText(ARABIC);
      await expect(signIn.getByRole('button')).toHaveText(ARABIC);
      await expect(page.getByTestId('upload-dropzone')).toHaveCount(0);
    });

    test.describe('dark', () => {
      test.use({ colorScheme: 'dark' });

      test('UPL-009 renders the sign-in prompt in the dark scheme', async ({ page }) => {
        await page.goto('/en/upload');
        const signIn = uploadUi(page).signIn;
        await expectDarkSurface(page, signIn, signIn.getByRole('heading'));
      });
    });
  });

  test.describe('without a creator tier', () => {
    test.use({ storageState: AUTH_STATE.none });

    test('UPL-010 tells users without a tier that uploading is by invitation (ar)', async ({ page }) => {
      await page.goto('/ar/upload');
      const notice = uploadUi(page).byInvitation;
      await expect(notice).toBeVisible();
      await expect(notice.getByRole('heading')).toHaveText(ARABIC);
      await expect(page.getByTestId('upload-create-channel')).toHaveCount(0);
    });
  });
});
