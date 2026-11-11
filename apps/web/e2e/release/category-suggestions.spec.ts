/**
 * Release regressions for AI category suggestions ("AI suggests, uploader
 * confirms") and Explore's category grid:
 * - the upload form preselects the AI's category, marked as a suggestion, and
 *   the uploader can change it; when the AI is unsure it offers options instead
 *   (en and ar);
 * - a video initiated without a category gets the AI's category, its owner sees
 *   it as a suggestion in the edit form, and an admin accepts it on the admin
 *   "Category suggestions" page;
 * - Explore shows only categories that have videos, and a category lists them.
 *
 * The model is not called on QA/stage for these: the processor answers text
 * holding "[e2e-category:<value>]" (or "[e2e-category:low]") from its test hook
 * (CATEGORY_AI_TEST_HOOK, off in production; pinned by check:config). Nothing is
 * uploaded or published: the form is never submitted and the API-initiated
 * video is private and deleted afterwards.
 */
import * as path from 'path';
import { test, expect, type Page, type TestInfo } from '@playwright/test';
import { promoteToAdmin } from './sink';
import { releaseEnv, sinkEmail, target, TEST_PASSWORD } from './targets';
import { apiFetch, completeRegistration, createProfile, signUpOnWeb, type Locale, type WebUser } from './web-session';
import { fillSecret } from './secret-fill';
import { grantCreatorTier } from './creator-tier';
import { createChannelInMenu } from './account-menu';

// Signs users in through the auth server: traces would hold the typed password and code
test.use({ trace: 'off' });

const VIDEO = path.join(__dirname, '..', 'test-fixtures', 'e2e-sample.mp4');
// The queued job (queue batching + processor) answers within seconds; leave room for a busy queue
const AI_TIMEOUT = 120_000;
const hookOnly = () => test.skip(releaseEnv() === 'production', 'the category test hook is off in production');

async function shot(page: Page, info: TestInfo, name: string): Promise<void> {
  const dir = process.env.E2E_SCREENSHOT_DIR;
  await page.screenshot({ path: dir ? path.join(dir, `${name}-${info.project.name}.png`) : info.outputPath(`${name}.png`), fullPage: false });
}

async function acceptConsent(page: Page): Promise<void> {
  await page.context().addCookies([{ name: 'aun_consent', value: `v1.a0.e0.p0.${Date.now()}`, url: target().web, sameSite: 'Lax' }]);
}

async function openUploadForm(page: Page, locale: Locale): Promise<void> {
  await page.goto(`${target().web}/${locale}/upload`);
  await expect(page.getByTestId('upload-dropzone')).toBeVisible({ timeout: 30000 });
  await page.getByTestId('upload-file-input').setInputFiles(VIDEO);
  await expect(page.getByTestId('upload-details')).toBeVisible();
}

async function fillTitle(page: Page, locale: Locale, title: string): Promise<void> {
  if (locale === 'ar') {
    await page.getByTestId('upload-lang-tab-ar').click();
    await page.getByTestId('upload-title-ar').fill(title);
  } else {
    await page.getByTestId('upload-title-en').fill(title);
  }
}

async function createChannel(user: WebUser): Promise<string> {
  const res = await apiFetch(user, '/api/channels', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: `Release E2E categories ${Date.now().toString(36)}`, description: 'Created by the release E2E suite', isMain: true }),
  });
  const text = await res.text();
  expect(res.status, `POST /api/channels: ${text}`).toBeLessThan(300);
  const id = (JSON.parse(text) as { result?: { channel?: { id?: string } } }).result?.channel?.id;
  expect(id, 'channel create returned no id').toBeTruthy();
  return id as string;
}

/**
 * A fresh uploader as the upload page needs one: a Creator (uploading is by
 * invitation) with a channel in the web session (without one the page says
 * "Channel required"), created in the account menu as users do.
 */
async function newUploader(page: Page, prefix: string, locale: Locale): Promise<WebUser & { channelId: string }> {
  const user = await signUpOnWeb(page, prefix, locale);
  await createProfile(user);
  await grantCreatorTier(user);
  const channelId = await createChannelInMenu(page, user, `Release E2E categories ${prefix} ${Date.now().toString(36)}`);
  return { ...user, channelId };
}

/** Nothing is uploaded: the uploader's channel is removed afterwards (soft: never hides the test's own failure). */
async function deleteChannel(user: WebUser & { channelId: string }): Promise<void> {
  const res = await apiFetch(user, `/api/channels/${user.channelId}`, { method: 'DELETE', headers: { channelId: user.channelId } });
  expect.soft(res.status, `DELETE /api/channels/${user.channelId}: ${await res.clone().text()}`).toBeLessThan(300);
}

const LOCALES: Array<{ locale: Locale; title: string; badge: RegExp }> = [
  { locale: 'en', title: 'Rulings of fasting while travelling', badge: /Suggested by AI/ },
  { locale: 'ar', title: 'أحكام الصيام في السفر', badge: /اقترحه الذكاء الاصطناعي/ },
];

test.describe('Release: AI category suggestions', () => {
  for (const { locale, title, badge } of LOCALES) {
    test(`upload form preselects the AI's category and the uploader changes it (${locale})`, async ({ page }, info) => {
      hookOnly();
      const user = await newUploader(page, `rel-cat-${locale}`, locale);
      try {
        await acceptConsent(page);
        await openUploadForm(page, locale);

        await fillTitle(page, locale, `${title} [e2e-category:fiqh] ${Date.now().toString(36)}`);
        const select = page.getByTestId('category-select');
        await expect(select).toHaveValue('fiqh', { timeout: AI_TIMEOUT });
        const suggested = page.getByTestId('category-ai-suggested');
        await expect(suggested).toBeVisible();
        await expect(suggested).toContainText(badge);
        await suggested.scrollIntoViewIfNeeded();
        await shot(page, info, `upload-ai-preselected-${locale}`);

        // The uploader's choice wins and is no longer marked as the AI's
        await select.selectOption('ramadan');
        await expect(select).toHaveValue('ramadan');
        await expect(suggested).toBeHidden();
        // Later text changes never override it
        await fillTitle(page, locale, `${title} [e2e-category:aqeedah] ${Date.now().toString(36)}`);
        await page.waitForTimeout(3000);
        await expect(select).toHaveValue('ramadan');
      } finally {
        await deleteChannel(user);
      }
    });
  }

  test('when the AI is unsure the form offers its top options instead of preselecting (ar)', async ({ page }, info) => {
    hookOnly();
    const user = await newUploader(page, 'rel-cat-low', 'ar');
    try {
      await acceptConsent(page);
      await openUploadForm(page, 'ar');

      await fillTitle(page, 'ar', `درس عام [e2e-category:low] ${Date.now().toString(36)}`);
      const options = page.getByTestId('category-ai-options');
      await expect(options).toBeVisible({ timeout: AI_TIMEOUT });
      await expect(page.getByTestId('category-select')).toHaveValue('');
      await expect(options.getByTestId('category-ai-option')).toHaveCount(3);
      await shot(page, info, 'upload-ai-options-ar');

      await options.locator('[data-category="dawah"]').click();
      await expect(page.getByTestId('category-select')).toHaveValue('dawah');
      await expect(options).toBeHidden();
    } finally {
      await deleteChannel(user);
    }
  });

  test('a video without a category gets the AI\'s, shown to its owner as a suggestion; an admin accepts it', async ({ page, browser }, info) => {
    hookOnly();
    test.skip(!process.env.TEST_PROMOTE_SECRET, 'TEST_PROMOTE_SECRET is not set: cannot create an admin user');
    test.setTimeout(6 * 60_000);
    const owner = await signUpOnWeb(page, 'rel-cat-owner');
    await createProfile(owner);
    await grantCreatorTier(owner);
    const channelId = await createChannel(owner);

    // Initiated the way the upload page does, without a category (private; no file needed)
    const created = await apiFetch(owner, '/api/videos/upload/initiate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', channelId },
      body: JSON.stringify({ title: `Hadith of intentions explained [e2e-category:hadith_studies] ${Date.now().toString(36)}`, fileSize: 1024, mimeType: 'video/mp4', isPublic: false }),
    });
    const createdText = await created.text();
    expect(created.status, `POST /api/videos/upload/initiate: ${createdText}`).toBeLessThan(300);
    const videoId = (JSON.parse(createdText) as { result?: { videoId?: string } }).result?.videoId ?? '';
    expect(videoId, 'upload initiate returned no video id').toBeTruthy();

    const adminContext = await browser.newContext();
    try {
      // The queued job writes the AI's category (confident) onto the video
      await expect
        .poll(async () => {
          const res = await apiFetch(owner, `/api/videos/category-suggestions?videoId=${videoId}`);
          if (!res.ok) return `HTTP ${res.status}`;
          const body = (await res.json()) as { result?: { status?: string; category?: string; categorySource?: string } };
          return `${body.result?.status}:${body.result?.category}:${body.result?.categorySource}`;
        }, { message: 'the AI suggestion was not applied to the video', timeout: AI_TIMEOUT, intervals: [2000, 3000, 5000] })
        .toBe('done:hadith_studies:ai');

      // The owner sees it in the edit form as the AI's suggestion
      await acceptConsent(page);
      // The editor lives in Studio (the old /video/:id/edit 301s there)
      await page.goto(`${target().web}/en/studio/${channelId}/content/videos/${videoId}/edit`);
      await expect(page.getByTestId('category-select')).toHaveValue('hadith_studies', { timeout: 30000 });
      await expect(page.getByTestId('category-ai-suggested')).toBeVisible({ timeout: 30000 });
      await page.getByTestId('category-ai-suggested').scrollIntoViewIfNeeded();
      await shot(page, info, 'edit-ai-suggested-en');

      // An admin accepts it on the admin review page
      const admin = await adminContext.newPage();
      const email = sinkEmail('rel-cat-admin');
      await admin.goto(`${target().adminWeb}/login`);
      await completeRegistration(admin, email);
      await expect(admin).toHaveURL(`${target().adminWeb}/access-denied`, { timeout: 30000 });
      await promoteToAdmin(email);
      await adminContext.clearCookies();
      await admin.goto(`${target().adminWeb}/login`);
      await expect(admin).toHaveURL(new RegExp(`^${target().auth}`), { timeout: 30000 });
      await admin.fill('input[name="email"]', email);
      await fillSecret(admin.locator('input[name="password"]'), TEST_PASSWORD);
      await admin.click('button[data-component="button"]');
      await expect(admin).toHaveURL(`${target().adminWeb}/dashboard`, { timeout: 30000 });

      await admin.goto(`${target().adminWeb}/category-suggestions?view=review&video=${videoId}`);
      const row = admin.locator(`[data-testid="category-row"][data-video-id="${videoId}"]`);
      await expect(row).toBeVisible({ timeout: 30000 });
      await expect(row.getByTestId('category-suggested')).toHaveAttribute('data-category', 'hadith_studies');
      await expect(row.getByTestId('category-source')).toHaveAttribute('data-source', 'ai');
      await shot(admin, info, 'admin-review-before-accept');
      await row.getByTestId('category-accept').click();
      await expect(admin.getByTestId('category-action-result')).toBeVisible({ timeout: 30000 });

      await admin.goto(`${target().adminWeb}/category-suggestions?view=reviewed&video=${videoId}`);
      const reviewed = admin.locator(`[data-testid="category-row"][data-video-id="${videoId}"]`);
      await expect(reviewed.getByTestId('category-source')).toHaveAttribute('data-source', 'admin');
      await expect(reviewed.getByTestId('category-current')).toHaveAttribute('data-category', 'hadith_studies');
      await shot(admin, info, 'admin-review-accepted');

      // The video now carries the admin-confirmed category
      const after = await apiFetch(owner, `/api/videos/category-suggestions?videoId=${videoId}`);
      const afterBody = (await after.json()) as { result?: { outcome?: string; categorySource?: string } };
      expect({ outcome: afterBody.result?.outcome, source: afterBody.result?.categorySource }).toEqual({ outcome: 'accepted', source: 'admin' });
    } finally {
      await adminContext.close();
      await apiFetch(owner, `/api/videos/${videoId}`, { method: 'DELETE', headers: { channelId } });
    }
  });
});

test.describe('Release: Explore categories', () => {
  for (const locale of ['en', 'ar'] as const) {
    test(`Explore shows only categories with videos, and a category lists them (${locale})`, async ({ page }, info) => {
      await acceptConsent(page);
      await page.goto(`${target().web}/${locale}/explore`);
      const tiles = page.getByTestId('explore-category');
      await expect(tiles.first()).toBeVisible({ timeout: 30000 });
      const counts = await tiles.evaluateAll((list) => list.map((t) => ({ category: t.getAttribute('data-category'), count: Number(t.getAttribute('data-count')) })));
      expect(counts.filter((c) => !(c.count > 0)), 'empty category tiles').toEqual([]);
      await page.getByTestId('explore-categories').scrollIntoViewIfNeeded();
      await shot(page, info, `explore-categories-${locale}`);

      // The most populated category opens search with its videos
      const top = counts.reduce((best, c) => (c.count > best.count ? c : best));
      await page.locator(`[data-testid="explore-category"][data-category="${top.category}"]`).click();
      await expect(page).toHaveURL(new RegExp(`/${locale}/search\\?type=video&category=${top.category}`), { timeout: 30000 });
      await expect(page.getByTestId('search-result').first()).toBeVisible({ timeout: 30000 });
    });
  }
});
