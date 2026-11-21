import { test as fixturesTest, expect } from './fixtures';
import type { Locator, Page } from '@playwright/test';
import { ANONYMOUS_STATE } from './test-utils/auth-state';
import { centerX, clickUntil, expectRtl, fillStable, tempName } from './test-utils/channel-content';
import { useOwnData, type Creator } from './release/builders';
import { apiFetch, expectHydrated } from './release/web-session';
import { AxeBuilder } from '@axe-core/playwright';
import { SITE_THEMES } from '@al-ummah/shared-types';
import { actionRowContrast } from './test-utils/action-row-contrast';

/** A time `ms` from now as a datetime-local value in the browser's zone (the runner's) */
const localIn = (ms: number) => {
  const d = new Date(Date.now() + ms);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
};

/**
 * Community posts: the owner's post manager in Studio
 * (/studio/[id]/content/posts, /new and /[postId]/edit:
 * text, poll and quiz posts, validation, edit, scheduling, publish now, delete),
 * the owner's Edit/Delete menu on the post card, the subscriber notification
 * for a new post (Story 29.4), and how posts render on the channel Community
 * tab (post card, like/unlike, comments).
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

// One worker runs this file's tests in order: its afterAll deletes the creators' channels, so a
// worker must not come back to this file afterwards with the (worker-scoped) creators still set
fixturesTest.describe.configure({ mode: 'default' });

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
  await page.goto(`/${locale}/studio/${channelId()}/content/posts/new`);
  await expect(page.getByRole('radiogroup')).toBeVisible();
}

/** Selects a post type card (retried: the first click can land before hydration) */
/**
 * Picks a `YYYY-MM-DDTHH:mm` local time in the composer: the day in the localized calendar (by its
 * full English name), then the time from the 15-minute list (rounded down to its step).
 */
async function fillSchedule(page: Page, local: string) {
  const [date, time] = local.split('T');
  const [y, m, d] = date.split('-').map(Number);
  const dayName = new Intl.DateTimeFormat('en-u-nu-latn', { timeZone: 'UTC', dateStyle: 'full' }).format(new Date(Date.UTC(y, m - 1, d)));
  const calendar = page.getByTestId('post-schedule-date-calendar');
  if (!(await calendar.isVisible())) await page.getByTestId('post-schedule-date-button').click();
  const day = calendar.getByRole('button', { name: dayName, exact: true });
  for (let i = 0; i < 2 && !(await day.isVisible()); i++) await page.getByTestId('post-schedule-date-next').click();
  await day.click();
  await expect(calendar).toBeHidden();
  const [hh, mm] = time.split(':').map(Number);
  const slot = `${String(hh).padStart(2, '0')}:${String(mm - (mm % 15)).padStart(2, '0')}`;
  await page.getByTestId('post-schedule-time').click();
  await page.getByTestId(`post-schedule-time-${slot}`).click();
}

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

/** Resolves once every running CSS transition/animation on the page has finished (a frame later). */
async function settleTransitions(page: Page): Promise<void> {
  await page.evaluate(async () => {
    await new Promise((r) => requestAnimationFrame(() => r(null)));
    const finite = document.getAnimations().filter((a) => a.playState === 'running' && a.effect?.getComputedTiming().iterations !== Infinity);
    await Promise.race([Promise.all(finite.map((a) => a.finished.catch(() => undefined))), new Promise((r) => setTimeout(r, 3000))]);
    await new Promise((r) => requestAnimationFrame(() => r(null)));
  });
}

test.describe('Post manager', () => {
  test.use({ storageState: async ({ creators }, use) => use(creators.owner.state) });

  test('COMM-001 lists published posts with search and type filter (en)', async ({ page }) => {
    const marker = tempName('Listed');
    await createTextPost(`${marker} hello community`);
    await page.goto(`/en/studio/${channelId()}/content/posts`);
    await expect(page.getByTestId('studio-frame')).toBeVisible();
    await expect(page.getByRole('heading', { level: 2, name: 'Manage posts' })).toBeVisible();
    // Status is a link in the URL (?status=); Published is the default
    await expect(page.getByTestId('studio-posts-status-published')).toHaveAttribute('aria-current', 'page');
    await expect(page.getByTestId('studio-posts-status-scheduled')).toHaveAttribute('href', `/en/studio/${channelId()}/content/posts?status=scheduled`);

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

    // View opens the post's own page; Edit is offered too
    await search.fill('');
    await search.press('Escape');
    await card.getByTestId('post-actions').click();
    await expect(page.getByRole('menuitem', { name: 'Edit' })).toBeVisible();
    await page.getByRole('menuitem', { name: 'View' }).click();
    await expect(page).toHaveURL(/\/en\/post\/[^/?#]+$/);
    await expect(postCard(page, marker)).toBeVisible();
  });

  test('COMM-002 publishes a text post, shows it publicly, then deletes it', async ({ page }) => {
    const marker = tempName('Text');
    try {
      await openNewPost(page);
      await expect(page.getByRole('heading', { level: 2, name: 'New post' })).toBeVisible();
      // Publish is never a dead disabled pill: without a type it says what is missing
      await page.getByRole('button', { name: 'Publish' }).click();
      await expect(page.getByTestId('new-post-type-error')).toHaveText('Select a post type');
      await expect(page.getByRole('button', { name: 'Save Draft' })).toHaveCount(0);

      await selectType(page, 'text');
      await fillStable(page.getByLabel('Content'), `${marker} — assalamu alaikum`);
      await expect(page.getByText(/characters remaining/)).toBeVisible();
      await page.getByRole('button', { name: 'Publish' }).click();

      await expect(page).toHaveURL(new RegExp(`/en/studio/${channelId()}/content/posts$`));
      const managed = page.getByTestId('managed-post').filter({ hasText: marker });
      await expectListed(page, managed);

      const community = await openCommunityTab(page);
      await expect(postCard(community, marker)).toBeVisible();
      const channelName = ((await (await apiFetch(owner.user, `/api/channels/${channelId()}`)).json()) as { name: string }).name;
      await expect(postCard(community, marker).getByRole('heading', { level: 3 })).toHaveText(channelName);
      await community.close();

      // Delete from the manager: at once, no confirm (a soft delete with an Undo toast)
      await managed.getByTestId('post-actions').click();
      await page.getByRole('menuitem', { name: 'Delete' }).click();
      await expect(page.getByRole('alertdialog')).toHaveCount(0);
      await expect(page.getByTestId('post-delete-toast')).toContainText('Post deleted');
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
      await expect(page).toHaveURL(new RegExp(`/studio/${channelId()}/content/posts$`));

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
      await expect(page).toHaveURL(new RegExp(`/studio/${channelId()}/content/posts$`));
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
    await expect(page).toHaveURL(/\/content\/posts\/new$/);
  });

  test('COMM-007 edits a text post in Studio and keeps it published', async ({ page }) => {
    const marker = tempName('Edit');
    const { id } = await createTextPost(`${marker} before`);
    await page.goto(`/en/studio/${channelId()}/content/posts`);
    const managed = page.getByTestId('managed-post').filter({ hasText: marker });
    await expectListed(page, managed);
    await managed.getByTestId('post-actions').click();
    await page.getByRole('menuitem', { name: 'Edit' }).click();
    await expect(page).toHaveURL(new RegExp(`/en/studio/${channelId()}/content/posts/${id}/edit$`));
    await expect(page.getByRole('heading', { level: 2, name: 'Edit post' })).toBeVisible();
    // The type can't change after publishing: no type picker
    await expect(page.getByRole('radiogroup')).toHaveCount(0);
    const content = page.getByLabel('Content');
    await expect(content).toHaveValue(`${marker} before`);
    await fillStable(content, `${marker} after`);
    await page.getByTestId('post-save').click();
    await expect(page).toHaveURL(new RegExp(`/en/studio/${channelId()}/content/posts$`));
    await expect.poll(async () => (await listPosts(owner, channelId(), channelId())).find((p) => p.id === id)?.content).toBe(`${marker} after`);
  });

  test('COMM-008 an unknown post id is a 404, never an empty editor', async ({ page }) => {
    const res = await page.goto(`/en/studio/${channelId()}/content/posts/no-such-post/edit`);
    expect(res?.status()).toBe(404);
  });

  test('COMM-016 schedules a post: hidden from visitors, listed as scheduled, then published now', async ({ page }) => {
    const marker = tempName('Sched');
    try {
      await openNewPost(page);
      await selectType(page, 'text');
      await fillStable(page.getByLabel('Content'), `${marker} for later`);
      await page.getByTestId('post-schedule-later').check();
      await expect(page.getByTestId('post-publish')).toHaveText('Schedule');
      // The zone by a friendly name with its offset, never the raw id; changeable through search
      await expect(page.getByTestId('post-schedule-timezone')).toContainText('(GMT');
      await expect(page.getByTestId('post-schedule-timezone')).not.toContainText('/');
      // Too soon is refused in the composer
      await fillSchedule(page, localIn(60_000));
      await page.getByTestId('post-publish').click();
      await expect(page.getByTestId('post-schedule-error')).toHaveText('Pick a time at least 5 minutes from now');
      await fillSchedule(page, localIn(3 * 3600_000));
      await page.getByTestId('post-publish').click();
      await expect(page).toHaveURL(new RegExp(`/en/studio/${channelId()}/content/posts$`));

      // Not on the channel for anyone else until its time
      let postId = '';
      await expect.poll(async () => {
        postId = (await listPosts(owner, channelId(), channelId())).find((p) => p.content?.includes(marker))?.id ?? '';
        return postId;
      }).not.toBe('');
      const post = { id: postId };
      expect((await listPosts(viewer, channelId(), viewer.channelIds[0])).some((p) => p.id === post.id)).toBe(false);

      await page.getByTestId('studio-posts-status-scheduled').click();
      await expect(page).toHaveURL(/\?status=scheduled$/);
      const managed = page.getByTestId('managed-post').filter({ hasText: marker });
      await expectListed(page, managed);
      await expect(managed.getByTestId('managed-post-scheduled-at')).toContainText('Scheduled for');
      await expect(page.getByTestId('studio-posts-status-draft')).toHaveCount(0);

      await managed.getByTestId('managed-post-publish-now').click();
      await expect(managed).toHaveCount(0);
      await page.getByTestId('studio-posts-status-published').click();
      await expect(page.getByTestId('managed-post').filter({ hasText: marker })).toBeVisible();
      await expect.poll(async () => (await listPosts(viewer, channelId(), viewer.channelIds[0])).some((p) => p.id === post.id)).toBe(true);
    } finally {
      await deletePostsContaining(marker);
    }
  });

  test('COMM-009 the owner deletes a post from its card, then Undo brings it back', async ({ page }) => {
    const marker = tempName('CardDel');
    const { id } = await createTextPost(`${marker} delete me`);
    try {
      await page.goto(`/en/channels/${channelId()}?tab=community`);
      const card = postCard(page, marker);
      const actions = card.getByRole('button', { name: 'Post actions' });
      await expectHydrated(actions);
      await clickUntil(actions, async () => expect(page.getByRole('menuitem', { name: 'Delete' })).toBeVisible({ timeout: 3000 }));
      await expect(page.getByRole('menuitem', { name: 'Edit' })).toHaveAttribute('href', `/en/studio/${channelId()}/content/posts/${id}/edit`);
      await page.getByRole('menuitem', { name: 'Delete' }).click();
      // No confirm: the post goes at once and the toast offers Undo
      await expect(page.getByRole('alertdialog')).toHaveCount(0);
      const toast = page.getByTestId('post-delete-toast');
      await expect(toast).toContainText('Post deleted');
      await expect(card).toHaveCount(0);
      await expect.poll(async () => (await listPosts(owner, channelId(), channelId())).some((p) => p.id === id)).toBe(false);

      await toast.getByRole('button', { name: 'Undo' }).click();
      await expect(toast).toHaveCount(0);
      await expect(card).toBeVisible();
      await expect.poll(async () => (await listPosts(owner, channelId(), channelId())).some((p) => p.id === id)).toBe(true);
    } finally {
      await deletePostsContaining(marker);
    }
  });

  test('COMM-014 Arabic delete toast is RTL and translated', async ({ page }) => {
    const marker = tempName('ArDel');
    await createTextPost(`${marker} delete me`);
    try {
      await page.goto(`/ar/channels/${channelId()}?tab=community`);
      const card = postCard(page, marker);
      const actions = card.getByRole('button', { name: 'إجراءات المنشور' });
      await expectHydrated(actions);
      await clickUntil(actions, async () => expect(page.getByRole('menuitem', { name: 'حذف' })).toBeVisible({ timeout: 3000 }));
      await page.getByRole('menuitem', { name: 'حذف' }).click();
      const toast = page.getByTestId('post-delete-toast');
      await expect(toast).toContainText('حُذف المنشور');
      await expect(toast).toHaveAttribute('dir', 'rtl');
      await expect(toast.getByRole('button', { name: 'تراجع' })).toBeVisible();
      await expect(toast.getByRole('button', { name: 'إغلاق' })).toBeVisible();
    } finally {
      await deletePostsContaining(marker);
    }
  });

  test('COMM-013 Arabic editor and schedule controls are RTL and translated', async ({ page }) => {
    const marker = tempName('ArEdit');
    const { id } = await createTextPost(`${marker} نص`);
    await page.goto(`/ar/studio/${channelId()}/content/posts/${id}/edit`);
    await expectRtl(page);
    await expect(page.getByRole('heading', { level: 2, name: 'تعديل المنشور' })).toBeVisible();
    await expect(page.getByTestId('post-save')).toHaveText('حفظ التغييرات');
    await expect(page.getByTestId('studio-back')).toHaveAccessibleName('العودة إلى المنشورات');
    await openNewPost(page, 'ar');
    await expect(page.getByText('وقت النشر')).toBeVisible();
    await page.getByTestId('post-schedule-later').check();
    await expect(page.getByTestId('post-publish')).toHaveText('جدولة');
    // Arabic date, time and zone: Arabic-Indic digits, no browser date or time field
    await expect(page.locator('input[type="date"], input[type="time"]')).toHaveCount(0);
    await page.getByTestId('post-schedule-date-button').click();
    await expect(page.getByTestId('post-schedule-date-calendar').getByRole('grid')).toContainText('١٥');
    await expect(page.getByTestId('post-schedule-timezone')).toContainText('GMT');
    await expect(page.getByTestId('post-schedule-timezone')).not.toContainText(/[0-9]/);
    await expect(page.getByTestId('community-post-allow')).toHaveAttribute('role', 'switch');
    await expect(page.getByTestId('community-post-allow')).toHaveAccessibleName('السماح بالتعليقات');
  });

  test('COMM-006 Arabic post editor is RTL and translated', async ({ page }) => {
    await openNewPost(page, 'ar');
    await expectRtl(page);
    await expect(page.getByRole('heading', { level: 2, name: 'منشور جديد' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'اختر نوع المنشور' })).toBeVisible();
    // The way back is a link to the post list, named for it (00bb5d05), not a "رجوع" button
    const back = page.getByTestId('studio-back');
    await expect(back).toHaveAccessibleName('العودة إلى المنشورات');
    await expect(back).toHaveAttribute('href', `/ar/studio/${channelId()}/content/posts`);
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

  test('COMM-015 every count and icon in the action row meets AA in every theme, light and dark, idle and active', async ({ page }) => {
    test.setTimeout(240_000);
    const marker = tempName('Contrast');
    await createTextPost(`${marker} contrast check`);
    const failures: string[] = [];
    for (const mode of ['light', 'dark'] as const) {
      await page.emulateMedia({ colorScheme: mode });
      await page.goto(`/en/channels/${channelId()}?tab=community`);
      await page.evaluate((m) => localStorage.setItem('theme', m), mode);
      await page.reload();
      const card = postCard(page, marker);
      const row = card.getByTestId('post-actions-row');
      await expectHydrated(card.getByRole('button', { name: 'Like' }));
      for (const state of ['idle', 'active'] as const) {
        if (state === 'active') {
          // Liked and comments open: the active colour on Like and Comment
          await card.getByRole('button', { name: 'Like' }).click();
          await expect(card.getByRole('button', { name: 'Unlike' })).toHaveAttribute('aria-pressed', 'true');
          const comments = card.getByRole('button', { name: /Comments/ });
          if ((await comments.getAttribute('aria-pressed')) !== 'true') await comments.click();
          await expect(comments).toHaveAttribute('aria-pressed', 'true');
        }
        for (const theme of SITE_THEMES) {
          await page.evaluate((t) => document.documentElement.setAttribute('data-theme', t), theme);
          // Measure once every colour transition has finished (the theme switch and, on the first theme
          // after the clicks, the idle→active change): a fixed wait read colours mid-transition
          await settleTransitions(page);
          // Against the real pixels behind each count and icon (the card is glass over the page)
          for (const r of await actionRowContrast(page, row)) {
            if (r.ratio < r.required) failures.push(`${theme} ${mode} ${state} ${r.name}: ${r.ratio}:1 < ${r.required}:1 (${r.color})`);
          }
          const axe = await new AxeBuilder({ page }).include('[data-testid="post-actions-row"]').withRules(['color-contrast']).analyze();
          for (const v of axe.violations) failures.push(`${theme} ${mode} ${state} axe ${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`);
        }
      }
      // Back to idle for the next mode
      await card.getByRole('button', { name: 'Unlike' }).click();
      await expect(card.getByRole('button', { name: 'Like' })).toHaveAttribute('aria-pressed', 'false');
    }
    expect(failures, failures.join('\n')).toEqual([]);
  });

  test('COMM-012 a subscriber is notified of a new post and the notification opens it', async ({ page }) => {
    const marker = tempName('Notify');
    const acting = viewer.channelIds[0];
    const sub = await apiFetch(viewer.user, `/api/channels/${channelId()}/subscriptions`, { method: 'POST', headers: { channelId: acting } });
    expect(sub.status, 'subscribe').toBeLessThan(300);
    try {
      const { id } = await createTextPost(`${marker} news for subscribers`);
      // CommunityPostCreated → processor → paged fan-out → the subscriber's stored notification
      await expect.poll(async () => {
        const res = await apiFetch(viewer.user, '/api/notifications?limit=50');
        const items = ((await res.json()) as { result?: { items?: Array<{ notificationKey: string; actionUrl?: string }> } }).result?.items ?? [];
        return items.some((n) => n.notificationKey === 'newPost' && n.actionUrl === `/post/${id}`);
      }, { timeout: 60_000 }).toBe(true);
      await page.goto('/en/notifications');
      const row = page.getByRole('link', { name: new RegExp(marker) }).first();
      await expect(row).toBeVisible();
      await row.click();
      await expect(page).toHaveURL(new RegExp(`/en/post/${id}$`));
      await expect(postCard(page, marker)).toBeVisible();
      // A viewer has no owner menu on someone else's post
      await expect(postCard(page, marker).getByRole('button', { name: 'Post actions' })).toHaveCount(0);
    } finally {
      await apiFetch(viewer.user, `/api/channels/${channelId()}/subscriptions`, { method: 'DELETE', headers: { channelId: acting } });
    }
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
    // No owner menu (and no dead "more" button) for visitors
    await expect(card.getByRole('button', { name: /Post actions|More options/ })).toHaveCount(0);
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
    await expect(card.getByText(/^(الآن|منذ .+|قبل .+)$/)).toBeVisible();
    const name = card.getByRole('heading', { level: 3 });
    const avatar = card.locator('.rounded-full').first();
    expect(await centerX(avatar)).toBeGreaterThan(await centerX(name));
    await expect(card.getByRole('button', { name: 'التعليقات' })).toBeVisible();
  });

  test('COMM-022 a channel without posts has no Community tab for visitors', async ({ page }) => {
    // The viewer's channel never gets posts in this spec. #1669: no hollow pages, an empty
    // Community tab is hidden from visitors and a link to it falls back to the default tab
    const empty = viewer.channelIds[0];
    expect((await listPosts(viewer, empty)).length).toBe(0);
    await page.goto(`/en/channels/${empty}?tab=community`);
    await expect(page).not.toHaveURL(/tab=community/);
    await expect(page.getByTestId('channel-tabs-strip')).not.toHaveAttribute('data-measuring', /.*/);
    await expect(page.getByTestId('tab-community')).toHaveCount(0);
    await expect(page.getByTestId('channel-tabs-strip-more')).toHaveCount(0);
    await expect(page.getByTestId('tabpanel-community')).toHaveCount(0);
  });
});
