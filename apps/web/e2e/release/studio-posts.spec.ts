/**
 * The channel pages that moved into Studio (#772): Content → Posts (new, edit, delete through the
 * in-app confirm), Customisation → Profile and Layout, Settings → General and Permissions, in English
 * and Arabic. Each test signs up its own run account with its own channel (studioOwner) and deletes
 * what it made; the account and channel go when the run ends.
 */
import { expect, test, type Locator, type Page } from '@playwright/test';
import { skipUntilStudioDeployed, studioOwner } from './studio';
import { apiFetch, expectHydrated, type Locale, type WebUser } from './web-session';
import { target } from './targets';

// Sign-in pages carry the test password: never record them
test.use({ trace: 'off', video: 'off' });

const UI = {
  en: { content: 'Content', edit: 'Edit', del: 'Delete', saved: 'Saved.', general: 'General', owned: 'You own this channel.', team: 'Team', permissions: 'Permissions', newPost: 'New post', editPost: 'Edit post' },
  ar: { content: 'المحتوى', edit: 'تعديل', del: 'حذف', saved: 'تم الحفظ.', general: 'عام', owned: 'أنت مالك هذه القناة.', team: 'الفريق', permissions: 'الأذونات', newPost: 'منشور جديد', editPost: 'تعديل المنشور' },
} as const;

interface PostRow { id: string; content?: string }

async function listPosts(user: WebUser, channelId: string): Promise<PostRow[]> {
  const res = await apiFetch(user, `/api/community/channels/${channelId}/posts?limit=50`, { headers: { channelId } });
  expect(res.status, 'list posts').toBe(200);
  return ((await res.json()) as { posts?: PostRow[] }).posts ?? [];
}

async function deletePostsContaining(user: WebUser, channelId: string, marker: string): Promise<void> {
  for (const post of await listPosts(user, channelId)) {
    if (post.content?.includes(marker)) {
      await apiFetch(user, `/api/community/channels/${channelId}/posts/${post.id}`, { method: 'DELETE', headers: { channelId } });
    }
  }
}

/** Clicks until `done` holds: a click can land before React attached the handler */
async function clickUntil(target: Locator, done: () => Promise<void>): Promise<void> {
  await expect(async () => {
    await target.click();
    await done();
  }).toPass({ timeout: 30000 });
}

/** The post shows in the list (the listing can lag the write a moment: reload until it does) */
async function expectListed(page: Page, card: Locator): Promise<void> {
  await expect(async () => {
    if (!(await card.isVisible())) await page.reload();
    await expect(card).toBeVisible({ timeout: 8000 });
  }).toPass({ timeout: 40000 });
}

test.describe('Release: Studio channel pages', () => {
  test.beforeEach(skipUntilStudioDeployed);

  for (const locale of ['en', 'ar'] as const satisfies readonly Locale[]) {
    const ui = UI[locale];

    test(`writes, edits and deletes a post in Content → Posts (${locale})`, async ({ page }) => {
      const { user, channelId } = await studioOwner(page, `rel-studio-posts-${locale}`, locale);
      const posts = `${target().web}/${locale}/studio/${channelId}/content/posts`;
      const marker = `Release E2E post ${Date.now().toString(36)}`;
      try {
        await page.goto(posts);
        await expect(page.getByTestId('studio-posts-empty')).toBeVisible({ timeout: 30000 });
        await page.getByTestId('studio-new-post').click();
        await expect(page).toHaveURL(`${posts}/new`);
        await expect(page.getByRole('heading', { level: 2, name: ui.newPost })).toBeVisible();

        const text = page.locator('[role="radio"][data-post-type="text"]');
        await clickUntil(text, async () => expect(text).toHaveAttribute('aria-checked', 'true', { timeout: 3000 }));
        const content = page.getByLabel(ui.content);
        await expectHydrated(content);
        await content.fill(`${marker} first`);
        await page.getByTestId('post-publish').click();
        await expect(page).toHaveURL(posts, { timeout: 30000 });

        const card = page.getByTestId('managed-post').filter({ hasText: marker });
        await expectListed(page, card);
        const id = (await card.getAttribute('data-post-id')) as string;
        expect(id).toBeTruthy();

        // Edit: the type is fixed, the text changes
        await card.getByTestId('post-actions').click();
        await page.getByRole('menuitem', { name: ui.edit }).click();
        await expect(page).toHaveURL(`${posts}/${id}/edit`);
        await expect(page.getByRole('heading', { level: 2, name: ui.editPost })).toBeVisible();
        await expect(page.getByRole('radiogroup')).toHaveCount(0);
        const editor = page.getByLabel(ui.content);
        await expect(editor).toHaveValue(`${marker} first`);
        await editor.fill(`${marker} edited`);
        await page.getByTestId('post-save').click();
        await expect(page).toHaveURL(posts, { timeout: 30000 });
        await expect.poll(async () => (await listPosts(user, channelId)).find((p) => p.id === id)?.content).toBe(`${marker} edited`);

        // Delete has no confirm (a 30-day soft delete): the post leaves the list at once and an
        // Undo toast can put it back. Undo once, then delete for good.
        const edited = page.getByTestId('managed-post').filter({ hasText: `${marker} edited` });
        await expectListed(page, edited);
        const remove = async () => {
          await edited.getByTestId('post-actions').click();
          await page.getByRole('menuitem', { name: ui.del }).click();
          await expect(page.getByRole('alertdialog')).toHaveCount(0);
          await expect(edited).toHaveCount(0);
          await expect(page.getByTestId('post-delete-toast')).toBeVisible();
        };
        await remove();
        await expect.poll(async () => (await listPosts(user, channelId)).some((p) => p.id === id)).toBe(false);
        await page.getByTestId('post-delete-toast-undo').click();
        await expect(edited).toHaveCount(1, { timeout: 20000 });
        await expect.poll(async () => (await listPosts(user, channelId)).some((p) => p.id === id)).toBe(true);
        await remove();
        await expect.poll(async () => (await listPosts(user, channelId)).some((p) => p.id === id)).toBe(false);
      } finally {
        await deletePostsContaining(user, channelId, marker);
      }
    });

    test(`Customisation and Settings work in Studio (${locale})`, async ({ page }) => {
      const { user, channelId } = await studioOwner(page, `rel-studio-custom-${locale}`, locale);
      const studio = `${target().web}/${locale}/studio/${channelId}`;

      // Profile: saves in place and says so politely
      await page.goto(`${studio}/customisation/profile`);
      const description = page.locator('#channel-description-en');
      await expectHydrated(description);
      const marker = `Release E2E about ${Date.now().toString(36)}`;
      await description.fill(marker);
      await page.getByTestId('channel-edit-save').click();
      await expect(page.getByTestId('channel-edit-status')).toHaveText(ui.saved, { timeout: 30000 });
      await expect(page).toHaveURL(`${studio}/customisation/profile`);
      await expect
        .poll(async () => ((await (await apiFetch(user, `/api/channels/${channelId}`)).json()) as { descriptionLocalized?: { en?: string }; description?: string }).descriptionLocalized?.en)
        .toBe(marker);

      // Layout: Sections first, Tabs one link away
      await page.goto(`${studio}/customisation/layout`);
      await expect(page.getByTestId('studio-layout-view-sections')).toHaveAttribute('aria-current', 'page');
      await expect(page.getByTestId('studio-layout-sections')).toBeVisible({ timeout: 30000 });
      await page.getByTestId('studio-layout-view-tabs').click();
      await expect(page).toHaveURL(`${studio}/customisation/layout?view=tabs`);
      await expect(page.getByTestId('studio-layout-tabs')).toBeVisible({ timeout: 30000 });

      // General: the owner owns it and has the danger zone
      await page.goto(`${studio}/settings/general`);
      await expect(page.getByRole('heading', { level: 2, name: ui.general })).toBeVisible();
      await expect(page.getByTestId('studio-general-ownership')).toContainText(ui.owned);
      await expect(page.getByTestId('studio-general-danger')).toBeVisible();
      await expect(page.getByTestId('studio-delete-channel')).toBeVisible();

      // Permissions: the channel's team
      await page.goto(`${studio}/settings/permissions`);
      await expect(page.getByRole('heading', { level: 2, name: ui.permissions })).toBeVisible();
      await expect(page.getByTestId('channel-team').getByRole('heading', { name: ui.team })).toBeVisible();
      if (locale === 'ar') await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    });
  }
});
