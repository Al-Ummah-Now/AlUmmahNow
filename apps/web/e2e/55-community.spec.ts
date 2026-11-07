import { test, expect } from './fixtures';
import type { Locator, Page } from '@playwright/test';
import { ANONYMOUS_STATE, AUTH_STATE } from './test-utils/auth-state';
import {
  centerX,
  channelsOf,
  clickUntil,
  createTextPost,
  deletePostsContaining,
  expectRtl,
  fillStable,
  listPosts,
  tempName,
  unlikePost,
} from './test-utils/channel-content';

/**
 * Community posts: the owner's post manager
 * (/settings/channel/[id]/community and /community/new: text, poll and quiz
 * posts, validation, delete) and how posts render on the channel Community
 * tab (post card, like/unlike, comments as they exist today).
 *
 * Posts are created on the single user's own channel with a unique
 * "E2E Temp …" marker and deleted afterwards (which also removes their likes
 * and comments). The multi user acts as the viewer that likes and comments.
 */

const owner = 'single' as const;
const channelId = () => channelsOf(owner).main.id;

function postCard(page: Page, marker: string): Locator {
  return page.getByRole('article').filter({ hasText: marker });
}

/**
 * The manager lists the new post after publishing. The post listing on QA can
 * lag a moment behind the create call under parallel load, so reload once
 * or twice before failing.
 */
async function expectListed(page: Page, managed: Locator) {
  await expect(async () => {
    if (!(await managed.isVisible())) {
      await page.reload();
    }
    await expect(managed).toBeVisible({ timeout: 8000 });
  }).toPass({ timeout: 40000 });
}

async function openNewPost(page: Page, locale: 'en' | 'ar' = 'en') {
  await page.goto(`/${locale}/settings/channel/${channelId()}/community/new`);
  await expect(page.getByRole('radiogroup')).toBeVisible();
}

/** Selects a post type card (retried: the first click can land before hydration) */
async function selectType(page: Page, type: string) {
  const option = page.locator(`[role="radio"][data-post-type="${type}"]`);
  await clickUntil(option, async () => expect(option).toHaveAttribute('aria-checked', 'true', { timeout: 3000 }));
}

test.describe('Post manager', () => {
  test.use({ storageState: AUTH_STATE.single });

  test('COMM-001 lists published posts with search and type filter (en)', async ({ page }) => {
    const marker = tempName('Listed');
    try {
      await createTextPost(owner, channelId(), `${marker} hello community`);
      await page.goto(`/en/settings/channel/${channelId()}/community`);
      await expect(page.getByRole('heading', { level: 1, name: 'Manage Posts' })).toBeVisible();
      await expect(page.getByRole('tab', { name: /Published/ })).toHaveAttribute('aria-selected', 'true');

      const card = page.getByTestId('managed-post').filter({ hasText: marker });
      await expect(card).toBeVisible();
      await expect(card).toContainText('Text');
      await expect(card).toContainText('Published');

      await fillStable(page.getByRole('textbox', { name: /^Search/ }), marker);
      await expect(page.getByTestId('managed-post')).toHaveCount(1);
      await fillStable(page.getByRole('textbox', { name: /^Search/ }), `${marker} no-such-text`);
      await expect(page.getByTestId('managed-post')).toHaveCount(0);
      await expect(page.getByText(/^No results/)).toBeVisible();

      // View opens the channel Community tab
      await page.getByRole('textbox', { name: /^Search/ }).fill('');
      await card.getByTestId('post-actions').click();
      await expect(page.getByRole('menuitem', { name: 'Edit' })).toHaveCount(0);
      await page.getByRole('menuitem', { name: 'View' }).click();
      await expect(page).toHaveURL(new RegExp(`/en/channels/${channelId()}\\?tab=community$`));
      await expect(postCard(page, marker)).toBeVisible();
    } finally {
      await deletePostsContaining(owner, channelId(), marker);
    }
  });

  test('COMM-002 publishes a text post, shows it publicly, then deletes it', async ({ page }) => {
    const marker = tempName('Text');
    try {
      await openNewPost(page);
      await expect(page.getByRole('heading', { level: 1, name: 'New Post' })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Publish' })).toBeDisabled();
      await expect(page.getByRole('button', { name: 'Save Draft' })).toHaveCount(0);

      await selectType(page, 'text');
      await fillStable(page.getByLabel('Content'), `${marker} — assalamu alaikum`);
      await expect(page.getByText(/characters remaining/)).toBeVisible();
      await page.getByRole('button', { name: 'Publish' }).click();

      await expect(page).toHaveURL(new RegExp(`/en/settings/channel/${channelId()}/community$`));
      const managed = page.getByTestId('managed-post').filter({ hasText: marker });
      await expectListed(page, managed);

      await page.goto(`/en/channels/${channelId()}?tab=community`);
      await expect(postCard(page, marker)).toBeVisible();
      await expect(postCard(page, marker).getByRole('heading', { level: 3 })).toHaveText(channelsOf(owner).main.name);

      // Delete from the manager (confirmation dialog)
      await page.goto(`/en/settings/channel/${channelId()}/community`);
      await managed.getByTestId('post-actions').click();
      await page.getByRole('menuitem', { name: 'Delete' }).click();
      const confirm = page.getByRole('alertdialog');
      await expect(confirm.getByRole('heading', { name: 'Confirm Delete' })).toBeVisible();
      await confirm.getByRole('button', { name: 'Delete' }).click();
      await expect(managed).toHaveCount(0);
      await expect.poll(async () => (await listPosts(owner, channelId(), channelId())).some((p) => p.content?.includes(marker))).toBe(false);
    } finally {
      await deletePostsContaining(owner, channelId(), marker);
    }
  });

  test('COMM-003 publishes a poll post that visitors see with its options', async ({ page }) => {
    const marker = tempName('Poll');
    try {
      await openNewPost(page);
      await selectType(page, 'poll');
      await fillStable(page.getByLabel(/Question/), `${marker} which day?`);
      await page.getByPlaceholder('Option 1').fill('Friday');
      // Empty option is rejected
      await page.getByRole('button', { name: 'Publish' }).click();
      await expect(page.getByText('All options must be filled')).toBeVisible();
      await page.getByPlaceholder('Option 2').fill('Monday');
      await page.getByRole('button', { name: 'Add Option' }).click();
      await page.getByPlaceholder('Option 3').fill('Thursday');
      await page.getByRole('button', { name: 'Publish' }).click();
      await expect(page).toHaveURL(new RegExp(`/settings/channel/${channelId()}/community$`));

      await page.goto(`/en/channels/${channelId()}?tab=community`);
      const card = postCard(page, marker);
      await expect(card).toBeVisible();
      for (const option of ['Friday', 'Monday', 'Thursday']) {
        await expect(card.getByRole('button', { name: option })).toBeVisible();
      }
    } finally {
      await deletePostsContaining(owner, channelId(), marker);
    }
  });

  test('COMM-004 publishes a quiz post', async ({ page }) => {
    const marker = tempName('Quiz');
    try {
      await openNewPost(page);
      await selectType(page, 'quiz');
      await fillStable(page.getByLabel(/Question/), `${marker} how many pillars?`);
      const options = page.getByPlaceholder(/^Option \d/);
      await options.nth(0).fill('Five');
      await options.nth(1).fill('Three');
      await page.getByRole('button', { name: 'Publish' }).click();
      await expect(page).toHaveURL(new RegExp(`/settings/channel/${channelId()}/community$`));
      const managed = page.getByTestId('managed-post').filter({ hasText: marker });
      await expectListed(page, managed);
      await expect(managed).toContainText('Quiz');

      await page.goto(`/en/channels/${channelId()}?tab=community`);
      await expect(postCard(page, marker)).toContainText('Five');
    } finally {
      await deletePostsContaining(owner, channelId(), marker);
    }
  });

  test('COMM-005 text post requires content', async ({ page }) => {
    await openNewPost(page);
    await selectType(page, 'text');
    await page.getByRole('button', { name: 'Publish' }).click();
    await expect(page.getByText('Content is required')).toBeVisible();
    await expect(page).toHaveURL(/\/community\/new$/);
  });

  test('COMM-006 Arabic post editor is RTL and translated', async ({ page }) => {
    await openNewPost(page, 'ar');
    await expectRtl(page);
    await expect(page.getByRole('heading', { level: 1, name: 'منشور جديد' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'اختر نوع المنشور' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'رجوع' })).toBeVisible();
    await selectType(page, 'text');
    await expect(page.getByPlaceholder('شارك أفكارك مع مجتمعك...')).toHaveAttribute('dir', 'rtl');
    await page.getByRole('button', { name: 'نشر' }).click();
    await expect(page.getByText('المحتوى مطلوب')).toBeVisible();
  });
});

test.describe('Community tab - engagement', () => {
  test.use({ storageState: AUTH_STATE.multi });

  test('COMM-010 a signed-in viewer likes and unlikes a post', async ({ page }) => {
    const marker = tempName('Like');
    const viewer = channelsOf('multi').main.id;
    const post = await createTextPost(owner, channelId(), `${marker} please like`);
    try {
      await page.goto(`/en/channels/${channelId()}?tab=community`);
      const card = postCard(page, marker);
      const like = card.getByRole('button', { name: 'Like' });
      await expect(like).toBeEnabled();
      await expect(like).toHaveAttribute('aria-pressed', 'false');
      await expect(like).toHaveText('0');

      await like.click();
      const unlike = card.getByRole('button', { name: 'Unlike' });
      await expect(unlike).toHaveAttribute('aria-pressed', 'true');
      await expect(unlike).toHaveText('1');
      await expect.poll(async () => (await listPosts('multi', channelId(), viewer)).find((p) => p.id === post.id)?.viewerHasLiked).toBe(true);

      await unlike.click();
      await expect(card.getByRole('button', { name: 'Like' })).toHaveAttribute('aria-pressed', 'false');
      await expect(card.getByRole('button', { name: 'Like' })).toHaveText('0');
      await expect.poll(async () => (await listPosts('multi', channelId(), viewer)).find((p) => p.id === post.id)?.viewerHasLiked).toBe(false);
    } finally {
      await unlikePost('multi', viewer, channelId(), post.id);
      await deletePostsContaining(owner, channelId(), marker);
    }
  });

  test('COMM-011 a signed-in viewer comments on a post', async ({ page }) => {
    const marker = tempName('Comment');
    await createTextPost(owner, channelId(), `${marker} comment here`);
    try {
      await page.goto(`/en/channels/${channelId()}?tab=community`);
      const card = postCard(page, marker);
      await clickUntil(card.getByRole('button', { name: 'Comments' }), async () =>
        expect(card.getByPlaceholder('Add a public comment...')).toBeVisible({ timeout: 3000 })
      );
      await expect(card.getByText('Be the first to comment!')).toBeVisible();
      const text = `Jazakallah khair ${Date.now()}`;
      await card.getByPlaceholder('Add a public comment...').fill(text);
      await card.getByRole('button', { name: 'Comment', exact: true }).click();
      await expect(card.getByText(text)).toBeVisible();
    } finally {
      // Deleting the post removes its comments
      await deletePostsContaining(owner, channelId(), marker);
    }
  });
});

test.describe('Community tab - visitor', () => {
  test.use({ storageState: ANONYMOUS_STATE });

  test('COMM-020 anonymous visitors can read posts and comments but not like', async ({ page }) => {
    const marker = tempName('Anon');
    await createTextPost(owner, channelId(), `${marker} public post`);
    try {
      await page.goto(`/en/channels/${channelId()}?tab=community`);
      const card = postCard(page, marker);
      await expect(card).toBeVisible();
      await expect(card.getByText(/^(just now|\d+ minutes? ago)$/)).toBeVisible();
      await expect(card.getByRole('button', { name: 'Like' })).toBeDisabled();
      await clickUntil(card.getByRole('button', { name: 'Comments' }), async () =>
        expect(card.getByText('Be the first to comment!')).toBeVisible({ timeout: 3000 })
      );
      // The submit button appears once the box is focused; it stays disabled without a signed-in channel
      await card.getByPlaceholder('Add a public comment...').click();
      await expect(card.getByRole('button', { name: 'Comment', exact: true })).toBeDisabled();
    } finally {
      await deletePostsContaining(owner, channelId(), marker);
    }
  });

  test('COMM-021 Arabic post card is RTL: avatar at the right, Arabic relative time', async ({ page }) => {
    const marker = tempName('Rtl');
    await createTextPost(owner, channelId(), `${marker} منشور`);
    try {
      await page.goto(`/ar/channels/${channelId()}?tab=community`);
      await expectRtl(page);
      await expect(page.getByTestId('tabpanel-community')).toHaveAttribute('dir', 'rtl');
      const card = postCard(page, marker);
      await expect(card).toBeVisible();
      await expect(card.getByText(/^(الآن|منذ .+)$/)).toBeVisible();
      const name = card.getByRole('heading', { level: 3 });
      const avatar = card.locator('.rounded-full').first();
      expect(await centerX(avatar)).toBeGreaterThan(await centerX(name));
      await expect(card.getByRole('button', { name: 'التعليقات' })).toBeVisible();
    } finally {
      await deletePostsContaining(owner, channelId(), marker);
    }
  });

  test('COMM-022 a channel without posts shows the empty state', async ({ page }) => {
    // The multi user's second channel never gets posts in these specs
    const empty = channelsOf('multi').other!.id;
    expect((await listPosts('multi', empty)).length).toBe(0);
    await page.goto(`/en/channels/${empty}?tab=community`);
    await expect(page.getByTestId('tabpanel-community').getByRole('heading', { name: 'No posts yet' })).toBeVisible();
    await expect(page.getByText('This channel has not shared any community posts yet.')).toBeVisible();
  });
});
