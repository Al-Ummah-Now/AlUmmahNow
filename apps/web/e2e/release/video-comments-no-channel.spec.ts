/**
 * #1151: a signed-in viewer without a channel comments on videos as
 * themselves, as on community posts since #1139/#1144. The watch page used to
 * show "No active channel selected" instead of the composer and disabled
 * every comment like.
 *
 * For each language a new viewer with no channel, on a creator's video:
 * the composer says it posts as the viewer; posting shows the comment under
 * the viewer's name (the API stores no channel); liking the creator's comment
 * sticks across a reload and unliking clears it; a reply posts; the viewer
 * edits and then deletes their own comment. The creator, channel, video,
 * comments and viewer are this spec's own, removed by the data scope
 * afterwards, pass or fail.
 */
import { expect, type BrowserContext, type Locator } from '@playwright/test';
import { test, ns } from './builders';
import { target } from './targets';
import { watchUrl } from './videos';
import { apiFetch, gotoSettled, type Locale, type WebUser } from './web-session';

// Signs users up through the auth server: traces would hold the password and code
test.use({ trace: 'off' });

const LOCALES: Locale[] = ['en', 'ar'];
const COMMENTING_AS: Record<Locale, string> = { en: 'Commenting as', ar: 'تعلّق باسم' };

async function answerConsent(context: BrowserContext): Promise<void> {
  await context.addCookies([{ name: 'aun_consent', value: `v1.a0.e0.p0.${Date.now()}`, url: target().web, sameSite: 'Lax' }]);
}

/** Fills a box once the section is interactive (it re-renders while the session loads). */
async function typeDraft(box: Locator, submit: Locator, text: string): Promise<void> {
  await expect(async () => {
    await box.fill(text);
    await expect(submit).toBeEnabled({ timeout: 2000 });
  }).toPass({ timeout: 30000 });
}

async function setDisplayName(user: WebUser, name: string): Promise<void> {
  const res = await apiFetch(user, '/api/profile', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ displayName: name }),
  });
  expect(res.status, `PUT /api/profile: ${await res.clone().text()}`).toBeLessThan(300);
}

test.describe('video comments without a channel', () => {
  for (const locale of LOCALES) {
    test(`a viewer with no channel comments, replies, likes, edits and deletes (${locale})`, async ({ browser, page, context, ownData }) => {
      test.setTimeout(300000);
      const stamp = Date.now().toString(36);
      const creator = await ownData.createCreator(browser, `vcnc-creator-${locale}`);
      const channelId = creator.channelIds[0];
      const video = await ownData.createVideo(creator.user, channelId);
      const creatorText = `Creator comment ${ns()} ${stamp}`;
      await ownData.createComment(creator.user, video.id, channelId, creatorText);

      await answerConsent(context);
      await page.setViewportSize({ width: 1280, height: 900 });
      const viewer = await ownData.createUser(page, `vcnc-viewer-${locale}`, locale);
      const access = (await (await apiFetch(viewer, '/api/channels/access')).json().catch(() => ({}))) as { data?: unknown[] };
      expect(access.data ?? [], 'the viewer must have no channel').toHaveLength(0);
      const name = `Viewer ${stamp}`;
      await setDisplayName(viewer, name);

      await gotoSettled(page, watchUrl(video.id, locale));
      const section = page.getByTestId('comments-section');
      await expect(section).toBeVisible({ timeout: 30000 });
      // The composer, not "select a channel", and it says who will post
      await expect(section.getByTestId('comment-identity')).toHaveText(`${COMMENTING_AS[locale]} ${name}`, { timeout: 30000 });
      await expect(section.getByTestId('comment-identity')).toHaveAttribute('data-as', 'member');

      // Post as themselves
      const myText = `No-channel comment ${stamp}`;
      await typeDraft(section.getByTestId('comment-input'), section.getByTestId('comment-submit'), myText);
      await section.getByTestId('comment-submit').click();
      const mine = section.getByTestId('comment').filter({ hasText: myText }).first();
      await expect(mine).toBeVisible({ timeout: 30000 });
      await expect(mine).toContainText(name);
      const listed = (await (await apiFetch(viewer, `/api/videos/${video.id}/comments?limit=50`)).json()) as { result: { comments: Array<{ text: string; channelId: string | null; userId: string }> } };
      const stored = listed.result.comments.find((c) => c.text === myText);
      expect(stored?.userId).toBe(viewer.userId);
      expect(stored?.channelId, 'a comment without a channel stores no channel').toBeNull();

      // Like the creator's comment: enabled, and it sticks across a reload
      const theirs = section.getByTestId('comment').filter({ hasText: creatorText }).first();
      const like = theirs.locator('button[aria-pressed]').first();
      await expect(like).toBeEnabled();
      await expect(like).toHaveAttribute('aria-pressed', 'false');
      await like.click();
      await expect(like).toHaveAttribute('aria-pressed', 'true', { timeout: 30000 });
      await page.reload();
      await expect(section.getByTestId('comment').filter({ hasText: creatorText }).first().locator('button[aria-pressed]').first()).toHaveAttribute('aria-pressed', 'true', { timeout: 30000 });
      await section.getByTestId('comment').filter({ hasText: creatorText }).first().locator('button[aria-pressed]').first().click();
      await expect(section.getByTestId('comment').filter({ hasText: creatorText }).first().locator('button[aria-pressed]').first()).toHaveAttribute('aria-pressed', 'false', { timeout: 30000 });

      // Reply to the creator's comment
      const replyText = `No-channel reply ${stamp}`;
      await section.getByTestId('comment').filter({ hasText: creatorText }).first().getByTestId('comment-reply-button').click();
      const composer = section.getByTestId('reply-composer');
      await typeDraft(composer.getByRole('textbox'), composer.getByTestId('reply-submit'), replyText);
      await composer.getByTestId('reply-submit').click();
      await expect(section.getByTestId('comment-reply').filter({ hasText: replyText }).first()).toBeVisible({ timeout: 30000 });

      // Edit, then delete their own comment
      const own = section.getByTestId('comment').filter({ hasText: myText }).first();
      await own.getByTestId('comment-edit').click();
      await own.getByTestId('comment-edit-input').fill(`${myText} edited`);
      await own.getByTestId('comment-edit-save').click();
      await expect(own.getByTestId('comment-edited')).toBeVisible({ timeout: 30000 });
      await own.getByTestId('comment-delete').click();
      await page.getByTestId('comment-delete-dialog-confirm').click();
      await expect(section.getByTestId('comment').filter({ hasText: myText })).toHaveCount(0, { timeout: 30000 });
    });
  }
});
