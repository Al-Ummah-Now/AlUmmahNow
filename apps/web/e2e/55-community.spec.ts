import { test as fixturesTest, expect } from './fixtures';
import type { Locator, Page } from '@playwright/test';
import { ANONYMOUS_STATE } from './test-utils/auth-state';
import { centerX, clickUntil, expectRtl, fillStable, tempName } from './test-utils/channel-content';
import { useOwnData, type Creator } from './release/builders';
import { apiFetch, expectHydrated } from './release/web-session';

/**
 * Community posts: the owner's post manager
 * (/settings/channel/[id]/community and /community/new: text, poll and quiz
 * posts, validation, delete) and how posts render on the channel Community
 * tab (post card, like/unlike, comments as they exist today).
 *
 * Own data (release/builders.ts): an owner and a viewer, each a creator with
 * one channel, made for this spec and deleted afterwards. The owner's posts
 * carry a unique "E2E Temp …" marker; those made through the API are
 * registered with the scope, those made through the UI are deleted in the
 * test's finally, and every post of the owner's channel is swept at cleanup.
 * The viewer acts as the signed-in visitor that likes and comments, and its
 * channel never gets a post (the empty state).
 */

const data = useOwnData(fixturesTest);
let owner: Creator;
let viewer: Creator;

/**
 * The file's creators, made in a worker fixture rather than beforeAll: Playwright resolves a context
 * option such as storageState before beforeAll runs, so a creator made there was undefined in
 * test.use (every signed-in test failed with "reading 'state'"). Deleted by the file's DataScope.
 */
const test = fixturesTest.extend<object, { creators: { owner: Creator; viewer: Creator } }>({
  creators: [
    async ({ browser }, use) => {
      owner = await data.createCreator(browser, 'comm-owner');
      viewer = await data.createCreator(browser, 'comm-viewer');
      await use({ owner, viewer });
    },
    { scope: 'worker', timeout: 300_000 },
  ],
});
const channelId = () => owner.channelIds[0];

interface PostRow {
  id: string;
  content?: string;
  type: string;
  likes: number;
  viewerHasLiked?: boolean;
  poll?: { question: string };
  quiz?: { question: string };
}

/** The channel's posts, as `as` sees them (acting as `actingChannel`) */
async function listPosts(as: Creator, postsOf: string, actingChannel?: string): Promise<PostRow[]> {
  const res = await apiFetch(as.user, `/api/community/channels/${postsOf}/posts?limit=50`, { headers: actingChannel ? { channelId: actingChannel } : {} });
  expect(res.status, `list posts of ${postsOf}`).toBe(200);
  return ((await res.json()) as { posts?: PostRow[] }).posts ?? [];
}

async function deletePost(id: string) {
  return apiFetch(owner.user, `/api/community/channels/${channelId()}/posts/${id}`, { method: 'DELETE', headers: { channelId: channelId() } });
}

/** Deletes the owner's posts whose text or question contains `marker` (posts made through the UI) */
async function deletePostsContaining(marker: string) {
  for (const post of await listPosts(owner, channelId(), channelId())) {
    if (`${post.content ?? ''} ${post.poll?.question ?? ''} ${post.quiz?.question ?? ''}`.includes(marker)) await deletePost(post.id);
  }
}

const createTextPost = async (text: string) => ({ id: await data.createPost(owner.user, channelId(), { text }) });

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

/**
 * The channel's Community tab in a second tab of the same session. The manager
 * page stays open where it is: on Linux WebKit a document navigation away from
 * the loaded manager crashed the renderer every time ("page.goto: Page
 * crashed", run 43239837875), the same Playwright-WebKit crash on navigation
 * release/admin-content.spec.ts notes; no other browser shows it (#996).
 */
async function openCommunityTab(page: Page): Promise<Page> {
  const tab = await page.context().newPage();
  await tab.goto(`/en/channels/${channelId()}?tab=community`);
  return tab;
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

test.beforeAll(async ({ browser, creators }) => {
    void browser;
    void creators;
  test.setTimeout(300000);
  // Every post of the owner's channel is the spec's: swept at cleanup, before the channel goes
  data.onCleanup(`posts of channel ${channelId()}`, async () => {
    for (const post of await listPosts(owner, channelId(), channelId())) await deletePost(post.id);
  });
});

test.describe('Post manager', () => {
  test.use({ storageState: async ({ creators }, use) => use(creators.owner.state) });

  test('COMM-001 lists published posts with search and type filter (en)', async ({ page }) => {
    const marker = tempName('Listed');
    await createTextPost(`${marker} hello community`);
    await page.goto(`/en/settings/channel/${channelId()}/community`);
    await expect(page.getByRole('heading', { level: 1, name: 'Manage Posts' })).toBeVisible();
    await expect(page.getByRole('tab', { name: /Published/ })).toHaveAttribute('aria-selected', 'true');

    const card = page.getByTestId('managed-post').filter({ hasText: marker });
    await expect(card).toBeVisible();
    await expect(card).toContainText('Text');
    await expect(card).toContainText('Published');

    // The post search is a live autocomplete (01e81c4f): a combobox, not a plain textbox
    const search = page.getByRole('combobox', { name: /^Search posts/ });
    await expectHydrated(search);
    await fillStable(search, marker);
    await expect(page.getByTestId('managed-post')).toHaveCount(1);
    await fillStable(search, `${marker} no-such-text`);
    await expect(page.getByTestId('managed-post')).toHaveCount(0);
    await expect(page.getByText(/^No results/)).toBeVisible();

    // View opens the channel Community tab
    await search.fill('');
    await search.press('Escape');
    await card.getByTestId('post-actions').click();
    await expect(page.getByRole('menuitem', { name: 'Edit' })).toHaveCount(0);
    await page.getByRole('menuitem', { name: 'View' }).click();
    await expect(page).toHaveURL(new RegExp(`/en/channels/${channelId()}\\?tab=community$`));
    await expect(postCard(page, marker)).toBeVisible();
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

      const community = await openCommunityTab(page);
      await expect(postCard(community, marker)).toBeVisible();
      const channelName = ((await (await apiFetch(owner.user, `/api/channels/${channelId()}`)).json()) as { name: string }).name;
      await expect(postCard(community, marker).getByRole('heading', { level: 3 })).toHaveText(channelName);
      await community.close();

      // Delete from the manager (confirmation dialog)
      await managed.getByTestId('post-actions').click();
      await page.getByRole('menuitem', { name: 'Delete' }).click();
      const confirm = page.getByRole('alertdialog');
      await expect(confirm.getByRole('heading', { name: 'Confirm Delete' })).toBeVisible();
      await confirm.getByRole('button', { name: 'Delete' }).click();
      await expect(managed).toHaveCount(0);
      await expect.poll(async () => (await listPosts(owner, channelId(), channelId())).some((p) => p.content?.includes(marker))).toBe(false);
    } finally {
      await deletePostsContaining(marker);
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

      const community = await openCommunityTab(page);
      const card = postCard(community, marker);
      await expect(card).toBeVisible();
      for (const option of ['Friday', 'Monday', 'Thursday']) {
        await expect(card.getByRole('button', { name: option })).toBeVisible();
      }
      await community.close();
    } finally {
      await deletePostsContaining(marker);
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

      const community = await openCommunityTab(page);
      await expect(postCard(community, marker)).toContainText('Five');
      await community.close();
    } finally {
      await deletePostsContaining(marker);
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
    // The way back is a link to the post list, named for it (00bb5d05), not a "رجوع" button
    const back = page.getByTestId('new-post-back');
    await expect(back).toHaveAccessibleName('العودة إلى منشورات المجتمع');
    await expect(back).toHaveAttribute('href', `/ar/settings/channel/${channelId()}/community`);
    await selectType(page, 'text');
    await expect(page.getByPlaceholder('شارك أفكارك مع مجتمعك...')).toHaveAttribute('dir', 'rtl');
    await page.getByRole('button', { name: 'نشر' }).click();
    await expect(page.getByText('المحتوى مطلوب')).toBeVisible();
  });
});

test.describe('Community tab - engagement', () => {
  test.use({ storageState: async ({ creators }, use) => use(creators.viewer.state) });

  test('COMM-010 a signed-in viewer likes and unlikes a post', async ({ page }) => {
    const marker = tempName('Like');
    const acting = viewer.channelIds[0];
    const post = await createTextPost(`${marker} please like`);
    await page.goto(`/en/channels/${channelId()}?tab=community`);
    const card = postCard(page, marker);
    const like = card.getByRole('button', { name: 'Like' });
    await expectHydrated(like);
    await expect(like).toBeEnabled();
    await expect(like).toHaveAttribute('aria-pressed', 'false');
    await expect(like.getByTestId('post-like-count')).toHaveText('0');

    await like.click();
    const unlike = card.getByRole('button', { name: 'Unlike' });
    await expect(unlike).toHaveAttribute('aria-pressed', 'true');
    await expect(unlike.getByTestId('post-like-count')).toHaveText('1');
    await expect.poll(async () => (await listPosts(viewer, channelId(), acting)).find((p) => p.id === post.id)?.viewerHasLiked).toBe(true);

    await unlike.click();
    await expect(card.getByRole('button', { name: 'Like' })).toHaveAttribute('aria-pressed', 'false');
    await expect(card.getByRole('button', { name: 'Like' }).getByTestId('post-like-count')).toHaveText('0');
    await expect.poll(async () => (await listPosts(viewer, channelId(), acting)).find((p) => p.id === post.id)?.viewerHasLiked).toBe(false);
  });

  test('COMM-011 a signed-in viewer comments on a post', async ({ page }) => {
    const marker = tempName('Comment');
    // Deleting the post (scope cleanup) removes its comments
    await createTextPost(`${marker} comment here`);
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
  });
});

test.describe('Community tab - visitor', () => {
  test.use({ storageState: ANONYMOUS_STATE });

  test('COMM-020 anonymous visitors can read posts and comments but not like', async ({ page }) => {
    const marker = tempName('Anon');
    await createTextPost(`${marker} public post`);
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
  });

  test('COMM-021 Arabic post card is RTL: avatar at the right, Arabic relative time', async ({ page }) => {
    const marker = tempName('Rtl');
    await createTextPost(`${marker} منشور`);
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
  });

  test('COMM-022 a channel without posts shows the empty state', async ({ page }) => {
    // The viewer's channel never gets posts in this spec
    const empty = viewer.channelIds[0];
    expect((await listPosts(viewer, empty)).length).toBe(0);
    await page.goto(`/en/channels/${empty}?tab=community`);
    await expect(page.getByTestId('tabpanel-community').getByRole('heading', { name: 'No posts yet' })).toBeVisible();
    await expect(page.getByText('This channel has not shared any community posts yet.')).toBeVisible();
  });
});
