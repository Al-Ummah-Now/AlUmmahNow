/**
 * Studio → Comments (#771, docs/specs/CREATOR-STUDIO.md §4.7): a run account's channel gets a
 * public text post and a second run account comments on it; the owner sees the comment in Inbox,
 * replies as the channel, removes it through the in-app confirm, finds it under Removed with who
 * removed it, restores it, blocks the commenter and unblocks them in Blocked people, and the
 * Dashboard lists it under Recent comments. en and ar. A moderator opens Comments; an editor's
 * role doesn't include it. The post (and with it its comments) is deleted afterwards; the run
 * accounts and channel go when the run ends. Skips while the build has no comments API.
 */
import { expect, test, type Browser, type Page } from '@playwright/test';
import { skipUntilStudioDeployed, studioOwner } from './studio';
import { apiFetch, createProfile, signUpOnWeb, type Locale, type WebUser } from './web-session';
import { target } from './targets';

// Sign-in pages carry the test password: never record them
test.use({ trace: 'off', video: 'off' });

const COMMENTER_NAME = 'Release E2E';

function json(body: unknown, channelId?: string): RequestInit {
  return { method: 'POST', headers: { 'Content-Type': 'application/json', ...(channelId ? { channelId } : {}) }, body: JSON.stringify(body) };
}

/** Skips the test while the build predates the comments API (the backend lands separately). */
async function skipUntilCommentsApi(user: WebUser, channelId: string): Promise<void> {
  const res = await apiFetch(user, `/api/channels/${channelId}/comments?tab=inbox`, { headers: { channelId } });
  test.skip(res.status === 404, 'the build predates the Studio comments API (GET /api/channels/:id/comments is 404)');
  expect(res.status, 'GET /api/channels/:id/comments').toBe(200);
}

async function createPost(user: WebUser, channelId: string, text: string): Promise<string> {
  const res = await apiFetch(user, `/api/community/channels/${channelId}/posts`, json({ type: 'text', content: text, visibility: 'public', commentsEnabled: true }, channelId));
  const body = await res.text();
  expect(res.status, `POST post: ${body}`).toBeLessThan(300);
  const parsed = JSON.parse(body) as { post?: { id?: string }; result?: { post?: { id?: string } }; id?: string };
  const id = parsed.post?.id ?? parsed.result?.post?.id ?? parsed.id;
  expect(id, 'post create returned no id').toBeTruthy();
  return id as string;
}

/** A signed-in run account in its own browser context, with a profile (no channel: it comments as itself). */
async function newAccount(browser: Browser, prefix: string): Promise<{ page: Page; user: WebUser; close: () => Promise<void> }> {
  const context = await browser.newContext();
  await context.addCookies([{ name: 'aun_consent', value: `v1.a0.e0.p0.${Date.now()}`, url: target().web, sameSite: 'Lax' }]);
  const page = await context.newPage();
  const user = await signUpOnWeb(page, prefix);
  await createProfile(user);
  return { page, user, close: () => context.close() };
}

/** Reloads until `marker` shows in the current list: the comments index fills in from a queue */
async function expectComment(page: Page, marker: string) {
  const row = page.getByTestId('studio-comment').filter({ hasText: marker });
  await expect(async () => {
    if (!(await row.isVisible())) await page.reload();
    await expect(row).toBeVisible({ timeout: 8000 });
  }).toPass({ timeout: 90000 });
  return row;
}

test.describe('Release: Studio Comments', () => {
  test.beforeEach(skipUntilStudioDeployed);

  for (const locale of ['en', 'ar'] as const satisfies readonly Locale[]) {
    test(`moderates a post comment: reply, remove, restore, block, unblock (${locale})`, async ({ page, browser }) => {
      test.setTimeout(300_000);
      const { user: owner, channelId } = await studioOwner(page, `rel-comments-owner-${locale}`, locale);
      await skipUntilCommentsApi(owner, channelId);
      const commenter = await newAccount(browser, `rel-comments-viewer-${locale}`);
      const stamp = Date.now().toString(36);
      const marker = `Release E2E comment ${stamp}`;
      const reply = `Release E2E channel reply ${stamp}`;
      const studio = `${target().web}/${locale}/studio/${channelId}`;
      let postId: string | undefined;
      let blocked = false;
      try {
        postId = await createPost(owner, channelId, `Release E2E post ${stamp}`);
        const made = await apiFetch(commenter.user, `/api/community/channels/${channelId}/posts/${postId}/comments`, json({ content: marker }));
        expect(made.status, `POST post comment: ${await made.clone().text()}`).toBeLessThan(300);

        // Inbox lists it
        await page.goto(`${studio}/comments`);
        await expect(page.getByTestId('studio-comments')).toHaveAttribute('data-tab', 'inbox');
        const row = await expectComment(page, marker);
        await expect(row.getByTestId('studio-comment-text')).toHaveText(marker);

        // Reply as the channel
        await row.getByTestId('studio-comment-reply').click();
        await row.getByTestId('studio-comment-reply-text').fill(reply);
        await row.getByTestId('studio-comment-reply-send').click();
        await expect(row.getByTestId('studio-comment-reply-form')).toHaveCount(0, { timeout: 30000 });
        await expect
          .poll(async () => {
            // The list has top-level comments only; the channel's reply is under the comment's replies
            const base = `/api/community/channels/${channelId}/posts/${postId}/comments`;
            const list = (await (await apiFetch(owner, `${base}?limit=50`)).json()) as { comments?: Array<{ id: string; content: string }> };
            const parent = list.comments?.find((c) => c.content === marker);
            if (!parent) return '';
            return JSON.stringify(await (await apiFetch(owner, `${base}/${parent.id}/replies?limit=50`)).json());
          }, { timeout: 30000 })
          .toContain(reply);

        // Remove through the in-app confirm, then find it under Removed with who removed it
        await row.getByTestId('studio-comment-remove').click();
        const removeDialog = page.getByRole('alertdialog');
        await expect(removeDialog).toBeVisible();
        await page.getByTestId('studio-comment-remove-dialog-confirm').click();
        await expect(page.getByTestId('studio-comment').filter({ hasText: marker })).toHaveCount(0, { timeout: 30000 });
        await page.getByTestId('studio-comments-tab-removed').click();
        await expect(page.getByTestId('studio-comments')).toHaveAttribute('data-tab', 'removed');
        const removed = await expectComment(page, marker);
        await expect(removed.getByTestId('studio-comment-removed-by')).toBeVisible();

        // Restore: back in Inbox
        await removed.getByTestId('studio-comment-restore').click();
        await expect(page.getByTestId('studio-comment').filter({ hasText: marker })).toHaveCount(0, { timeout: 30000 });
        await page.getByTestId('studio-comments-tab-inbox').click();
        await expect(page.getByTestId('studio-comments')).toHaveAttribute('data-tab', 'inbox');
        const back = await expectComment(page, marker);

        // Block the commenter (in-app confirm), then unblock them in Blocked people
        await back.getByTestId('studio-comment-more').click();
        await page.getByTestId('studio-comment-block').click();
        await expect(page.getByRole('alertdialog')).toBeVisible();
        await page.getByTestId('studio-comment-block-dialog-confirm').click();
        blocked = true;
        await page.getByTestId('studio-comments-blocks').click();
        const blocks = page.getByTestId('studio-blocks-dialog');
        const person = blocks.getByTestId('studio-block');
        await expect(person).toHaveCount(1, { timeout: 30000 });
        await expect(person).toContainText(COMMENTER_NAME);
        await person.getByTestId('studio-unblock').click();
        await expect(blocks.getByTestId('studio-blocks-empty')).toBeVisible({ timeout: 30000 });
        blocked = false;
        await page.keyboard.press('Escape');

        // The Dashboard's Recent comments lists it
        await page.goto(`${studio}/dashboard`);
        const recent = page.getByTestId('studio-dash-comment').filter({ hasText: marker });
        // Reload only once the card has loaded without it (the index fills in from a queue);
        // the Dashboard shows skeletons until all of its cards' data is in
        await expect(async () => {
          await expect(page.getByTestId('studio-dash-comments-body')).toBeVisible({ timeout: 45000 });
          if (!(await recent.isVisible())) {
            await page.reload();
            throw new Error('not in Recent comments yet');
          }
        }).toPass({ timeout: 120000 });
        if (locale === 'ar') await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
      } finally {
        if (blocked) await apiFetch(owner, `/api/channels/${channelId}/blocks/${commenter.user.userId}`, { method: 'DELETE', headers: { channelId } });
        // Deleting the post removes its comments (the commenter's and the channel's reply)
        if (postId) await apiFetch(owner, `/api/community/channels/${channelId}/posts/${postId}`, { method: 'DELETE', headers: { channelId } });
        await commenter.close();
      }
    });
  }

  test('a moderator opens Comments; an editor\'s role does not include it', async ({ page, browser }) => {
    test.setTimeout(300_000);
    const { user: owner, channelId } = await studioOwner(page, 'rel-comments-roles');
    await skipUntilCommentsApi(owner, channelId);
    const moderator = await newAccount(browser, 'rel-comments-mod');
    const editor = await newAccount(browser, 'rel-comments-editor');
    try {
      // Roles are given by invitation only (docs/specs/CHANNEL-ROLES.md §4): the owner invites, the member accepts
      for (const [member, role] of [[moderator, 'moderator'], [editor, 'editor']] as const) {
        const sent = await apiFetch(owner, `/api/channels/${channelId}/invites`, json({ email: member.user.email, role }));
        expect(sent.status, `invite ${role}: ${await sent.clone().text()}`).toBe(200);
        const mine = (await (await apiFetch(member.user, '/api/channel-invites')).json()) as { data?: { invites?: Array<{ id: string; channel: { id: string } }> } };
        const invitation = mine.data?.invites?.find((i) => i.channel.id === channelId);
        expect(invitation, `the ${role} does not see the invitation`).toBeTruthy();
        const accepted = await apiFetch(member.user, `/api/channel-invites/${invitation!.id}/accept`, { method: 'POST' });
        expect(accepted.status, `accept ${role}: ${await accepted.clone().text()}`).toBe(200);
      }
      await moderator.page.goto(`${target().web}/en/studio/${channelId}/comments`);
      await expect(moderator.page.getByTestId('studio-comments')).toBeVisible({ timeout: 30000 });
      await expect(moderator.page.getByTestId('studio-nav-comments').first()).toHaveAttribute('aria-current', 'page');

      await editor.page.goto(`${target().web}/en/studio/${channelId}/comments`);
      await expect(editor.page.getByTestId('studio-no-access')).toBeVisible({ timeout: 30000 });
      await expect(editor.page.getByTestId('studio-comments')).toHaveCount(0);
      await expect(editor.page.getByTestId('studio-nav-comments')).toHaveCount(0);
    } finally {
      await moderator.close();
      await editor.close();
    }
  });
});
