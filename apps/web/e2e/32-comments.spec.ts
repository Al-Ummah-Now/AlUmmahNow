import { test, expect } from './fixtures';
import type { APIRequestContext, Locator, Page } from '@playwright/test';
import { ANONYMOUS_STATE, AUTH_STATE, readAccount } from './test-utils/auth-state';
import { apiCall, tempName, watchUrl, type QaVideo } from './test-utils/watch-page';
import { ownPublicVideos } from './test-utils/own-public-video';
import { watchSignInRedirect } from './test-utils/sign-in-redirect';

/**
 * Comments section on the watch page, tested as it is today: anonymous and
 * channel-less prompts, posting, cancelling and deleting a comment (LTR + RTL).
 *
 * Comments are posted on this file's own public video (made in beforeAll, deleted afterwards)
 * and always deleted again; assertions only look at the comment this test wrote.
 */

// One worker runs this file's tests in order, so its own data (beforeAll) is made once
test.describe.configure({ mode: 'default' });

const own = ownPublicVideos(test, 'comments', [{ titleAr: 'مرئي التعليقات' }]);
const ownLecture = (n: number): QaVideo => own.videos()[n - 1];

interface ApiComment { id: string; text: string; channelId?: string }

async function listComments(request: APIRequestContext, videoId: string): Promise<ApiComment[]> {
  const res = await request.get(`${(process.env.API_URL || 'http://localhost:3086')}/api/videos/${videoId}/comments?limit=100`);
  if (!res.ok()) return [];
  const body = (await res.json()) as { result?: { comments?: ApiComment[] } };
  return body.result?.comments ?? [];
}

async function deleteCommentsWithText(request: APIRequestContext, videoId: string, text: string) {
  const account = readAccount('single');
  for (const comment of (await listComments(request, videoId)).filter((c) => c.text === text)) {
    for (const channelId of account.channels.map((c) => c.id)) {
      await apiCall(request, 'DELETE', `/api/videos/${videoId}/comments/${comment.id}`, { token: account.accessToken, channelId });
    }
  }
}

/**
 * Fills the composer once it is interactive. The section re-renders while the
 * session / active channel load, which can drop a value typed too early.
 */
async function typeDraft(box: Locator, submit: Locator, text: string) {
  await expect(async () => {
    await box.fill(text);
    await expect(submit).toBeEnabled({ timeout: 2000 });
  }).toPass({ timeout: 20000 });
}

async function openComments(page: Page, video: QaVideo, locale: 'en' | 'ar' = 'en') {
  await page.goto(watchUrl(video.id, locale));
  const section = page.locator('#comments');
  await expect(section.getByRole('heading', { level: 2 })).toHaveText(locale === 'en' ? /^Comments \(\d+\)$/ : /^التعليقات \(\d+\)$/);
  return section;
}

test.describe('comments - anonymous', () => {
  test.use({ storageState: ANONYMOUS_STATE });

  for (const [locale, prompt] of [
    ['en', /sign in/i],
    ['ar', /سجل الدخول|تسجيل الدخول/],
  ] as const) {
    test(`CMT-001 anonymous viewers see a sign-in prompt instead of the composer (${locale})`, async ({ page }) => {
      const video = ownLecture(1);
      const section = await openComments(page, video, locale);

      await expect(section.getByRole('textbox')).toHaveCount(0);
      await expect(section).toContainText(prompt);
      await expect(section.locator('div[dir]').first()).toHaveAttribute('dir', locale === 'ar' ? 'rtl' : 'ltr');

      // Sign-in returns to this video, in this language
      const signIn = watchSignInRedirect(page, { locale, returnPath: new URL(page.url()).pathname });
      await section.getByRole('button', { name: prompt }).click();
      await signIn.verify();
    });
  }
});

test.describe('comments - signed in without a channel', () => {
  test.use({ storageState: AUTH_STATE.none });

  for (const [locale, create] of [
    ['en', 'Create Channel'],
    ['ar', 'إنشاء قناة'],
  ] as const) {
    test(`CMT-002 accounts without a channel are asked to create one (${locale})`, async ({ page }) => {
      const video = ownLecture(1);
      const section = await openComments(page, video, locale);

      await expect(section.getByRole('textbox')).toHaveCount(0);
      const link = section.getByRole('link').filter({ hasText: create });
      await expect(link).toHaveAttribute('href', `/${locale}/profile`);
    });
  }
});

test.describe('comments - post and delete (single-channel user)', () => {
  test.use({ storageState: AUTH_STATE.single });
  // The API rewrites the whole video record per comment, so concurrent writes
  // to one video can drop each other's comment: run these one after another
  test.describe.configure({ mode: 'serial' });

  let video: QaVideo;
  let text = '';

  test.beforeAll(async () => {
    // One video per project: parallel projects writing comments to the same
    // video object can overwrite each other's change on the API side
    video = ownLecture(1);
  });
  test.afterEach(async ({ request }) => {
    if (text) await deleteCommentsWithText(request, video.id, text);
    text = '';
  });

  for (const [locale, submit, del] of [
    ['en', 'Comment', 'Delete comment'],
    ['ar', 'تعليق', 'حذف التعليق'],
  ] as const) {
    test(`CMT-003 posts a comment, shows it with its author, then deletes it (${locale})`, async ({ page, request }) => {
      const section = await openComments(page, video, locale);
      text = tempName(locale === 'ar' ? 'تعليق' : 'Comment');

      const box = section.getByRole('textbox');
      const submitButton = section.getByRole('button', { name: submit, exact: true });
      await expect(submitButton).toBeDisabled();
      await typeDraft(box, submitButton, text);
      await submitButton.click();
      await expect(box).toHaveValue('');

      const mine = section.locator('p', { hasText: text }).locator('xpath=ancestor::div[contains(@class,"items-start")][1]');
      await expect(mine).toBeVisible();
      await expect(mine.getByRole('heading', { level: 4 })).toHaveText(/\S/);
      await expect(mine).toHaveAttribute('dir', locale === 'ar' ? 'rtl' : 'ltr');

      // Stored on the server, not only optimistic
      await expect.poll(async () => (await listComments(request, video.id)).some((c) => c.text === text)).toBe(true);

      await mine.getByRole('button', { name: del }).click();
      await page.getByTestId('comment-delete-dialog-confirm').click();
      await expect(section.locator('p', { hasText: text })).toHaveCount(0);
      await expect.poll(async () => (await listComments(request, video.id)).some((c) => c.text === text)).toBe(false);
    });
  }

  test('CMT-004 cancel clears the draft and dismissing the delete confirmation keeps the comment', async ({ page, request }) => {
    const section = await openComments(page, video);
    const box = section.getByRole('textbox');
    await typeDraft(box, section.getByRole('button', { name: 'Comment', exact: true }), 'draft that is never posted');
    await section.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(box).toHaveValue('');
    await expect(section.getByRole('button', { name: 'Comment', exact: true })).toBeDisabled();

    text = tempName('Comment keep');
    await typeDraft(box, section.getByRole('button', { name: 'Comment', exact: true }), text);
    await section.getByRole('button', { name: 'Comment', exact: true }).click();
    const mine = section.locator('p', { hasText: text }).locator('xpath=ancestor::div[contains(@class,"items-start")][1]');
    await expect(mine).toBeVisible();
    await expect.poll(async () => (await listComments(request, video.id)).some((c) => c.text === text)).toBe(true);
    await page.reload();
    await expect(mine).toBeVisible();

    await mine.getByRole('button', { name: 'Delete comment' }).click();
    await page.getByTestId('comment-delete-dialog-cancel').click();
    await expect(page.getByTestId('comment-delete-dialog')).toHaveCount(0);
    await expect(mine).toBeVisible();
    // Other people's comments offer Report, never Delete
    await expect(mine.getByRole('button', { name: 'Report' })).toHaveCount(0);
  });
});
