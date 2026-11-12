import { test, expect, consentCookie } from './fixtures';
import { AUTH_STATE, ANONYMOUS_STATE } from './test-utils/auth-state';
import { setupPublicDisposable, userApi } from './test-utils/e2e-videos';

/**
 * Story 29.2: replies, sort, live updates, timestamp links, edited marker and
 * per-video comment settings (on / held / off).
 *
 * One public disposable video owned by the `single` user is created for the
 * file and deleted afterwards (its comments go with it). Comments by other
 * users are written by `multi`.
 */

const video = setupPublicDisposable('single', 'comments');

// Comment settings change during the file: run everything in order
test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  test.setTimeout(180000);
  await video.create();
});

test.afterAll(async () => {
  await video.remove();
});

function unique(label: string): string {
  return `${label} ${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
}

/** Post a comment through the API as `user` (for setup and live-update checks) */
async function apiComment(user: 'single' | 'multi', text: string, parentCommentId?: string): Promise<{ id: string; isHeld: boolean }> {
  const u = userApi(user);
  const res = await u.api.post<{ result: { comment: { id: string; isHeld: boolean } } }>(
    `/api/videos/${video.get().id}/comments`,
    { text, ...(parentCommentId ? { parentCommentId } : {}) },
    { token: u.token, channelId: u.channelIds[0] },
  );
  return res.data.result.comment;
}

async function setCommentSettings(value: 'on' | 'held' | 'off'): Promise<void> {
  const u = userApi('single');
  await u.api.put(`/api/videos/${video.get().id}`, { commentSettings: value }, { token: u.token, channelId: video.get().channelId });
}

test.describe('Video comments - viewer', () => {
  test.use({ storageState: AUTH_STATE.multi });

  test.beforeAll(async () => {
    await setCommentSettings('on');
  });

  test('posts a comment with a timestamp link, edits it and shows the edited marker', async ({ page }) => {
    const text = unique('E2E jump to 0:03 please');
    await page.goto(`/en/video/${video.get().id}`);
    const section = page.getByTestId('comments-section');
    await section.getByTestId('comment-input').fill(text);
    await section.getByTestId('comment-submit').click();

    const comment = section.getByTestId('comment').filter({ hasText: text.split(' 0:03')[0] }).first();
    await expect(comment).toBeVisible();
    const timestamp = comment.getByTestId('comment-timestamp');
    await expect(timestamp).toHaveText('0:03');
    await expect(timestamp).toHaveAttribute('data-seconds', '3');
    await expect(timestamp).toHaveAccessibleName('Jump to 0:03');

    const seek = page.evaluate(() => new Promise<number>((resolve) => {
      window.addEventListener('aun:player-seek', (e) => resolve((e as CustomEvent<{ seconds: number }>).detail.seconds), { once: true });
    }));
    await timestamp.click();
    expect(await seek).toBe(3);

    await comment.getByTestId('comment-edit').click();
    await comment.getByTestId('comment-edit-input').fill(`${text} (updated)`);
    await comment.getByTestId('comment-edit-save').click();
    await expect(comment.getByTestId('comment-edited')).toBeVisible();
    // The marker is optimistic: the editor closes only once the API has saved the edit. Reloading
    // before that aborts the request (WebKit lost the edit this way on main's run 43210282718).
    await expect(comment.getByTestId('comment-edit-input')).toHaveCount(0);

    await page.reload();
    const reloaded = page.getByTestId('comment').filter({ hasText: '(updated)' }).first();
    await expect(reloaded.getByTestId('comment-edited')).toHaveText('(edited)');
  });

  test('replies to a comment (one level) and shows the thread', async ({ page }) => {
    const parentText = unique('E2E parent');
    await apiComment('single', parentText);
    await page.goto(`/en/video/${video.get().id}`);

    const parent = page.getByTestId('comment').filter({ hasText: parentText }).first();
    await parent.getByTestId('comment-reply-button').click();
    const replyText = unique('E2E reply');
    await parent.getByTestId('reply-composer').getByRole('textbox').fill(replyText);
    await parent.getByTestId('reply-submit').click();

    const replies = parent.getByTestId('comment-replies');
    await expect(replies.getByTestId('comment-reply').filter({ hasText: replyText })).toBeVisible();
    // Replies have no reply button (one level deep)
    await expect(replies.getByTestId('comment-reply-button')).toHaveCount(0);

    await page.reload();
    const again = page.getByTestId('comment').filter({ hasText: parentText }).first();
    await again.getByTestId('comment-replies-toggle').click();
    await expect(again.getByTestId('comment-reply').filter({ hasText: replyText })).toBeVisible();
  });

  test('sorts by top comments', async ({ page }) => {
    const liked = unique('E2E most liked');
    const created = await apiComment('single', liked);
    const u = userApi('multi');
    await u.api.post(`/api/videos/${video.get().id}/comments/${created.id}/likes`, {}, { token: u.token, channelId: u.channelIds[0] });
    await apiComment('single', unique('E2E newest unliked'));

    await page.goto(`/en/video/${video.get().id}`);
    // Comments load after hydration; selecting earlier would be reset by React
    await expect(page.getByTestId('comment').first()).toBeVisible();
    // The themed sort menu: its trigger shows (and is named by) the chosen order
    const sort = page.getByTestId('comments-sort');
    await sort.click();
    const top = page.getByTestId('comments-sort-top');
    const topLabel = ((await top.textContent()) ?? '').trim();
    await top.click();
    await expect(sort).toHaveAccessibleName(new RegExp(`${topLabel}$`));
    await expect(page.getByTestId('comment').first()).toContainText(liked);
    await sort.click();
    await expect(top).toHaveAttribute('aria-checked', 'true');
    const newest = page.getByTestId('comments-sort-newest');
    const newestLabel = ((await newest.textContent()) ?? '').trim();
    await newest.click();
    await expect(sort).toHaveAccessibleName(new RegExp(`${newestLabel}$`));
    await expect(page.getByTestId('comment').first()).not.toContainText(liked);
  });

  // Comment dislikes are turned off (owner decision 2026-11-12)
  for (const locale of ['en', 'ar'] as const) {
    test(`a comment has a like button and no dislike control; the dislike API answers 410 (${locale})`, async ({ page }) => {
      const text = unique('E2E no dislike');
      const created = await apiComment('single', text);
      await page.goto(`/${locale}/video/${video.get().id}`);
      const comment = page.getByTestId('comment').filter({ hasText: text }).first();
      await expect(comment).toBeVisible();
      await expect(comment.locator('.lucide-thumbs-up')).toBeVisible();
      await expect(comment.locator('.lucide-thumbs-down')).toHaveCount(0);
      await expect(comment.getByRole('button', { name: /dislike|عدم إعجاب|عدم الإعجاب/i })).toHaveCount(0);

      const u = userApi('multi');
      const res = await u.api.post<{ code?: string }>(
        `/api/videos/${video.get().id}/comments/${created.id}/dislikes`,
        {},
        { token: u.token, channelId: u.channelIds[0], allowStatus: [410] },
      );
      expect(res.status).toBe(410);
      expect(res.data.code).toBe('dislikes_disabled');
    });
  }

  test('shows comments from other viewers live, without a reload', async ({ page }) => {
    await page.goto(`/en/video/${video.get().id}`);
    await expect(page.getByTestId('comments-list')).toBeVisible();
    // Let the realtime subscription settle
    await page.waitForTimeout(2000);
    const text = unique('E2E live comment');
    await apiComment('single', text);
    await expect(page.getByTestId('comment').filter({ hasText: text })).toBeVisible({ timeout: 20000 });
  });

  test('Arabic comments are RTL with Arabic controls', async ({ page }) => {
    await page.goto(`/ar/video/${video.get().id}`);
    const section = page.getByTestId('comments-section');
    await expect(section).toHaveAttribute('dir', 'rtl');
    const sort = section.getByTestId('comments-sort');
    await expect(sort).toHaveAccessibleName(/[\u0600-\u06FF]/);
    await sort.click();
    await expect(page.getByRole('menu')).toHaveCSS('direction', 'rtl');
    await expect(page.getByTestId('comments-sort-top')).toHaveText('أبرز التعليقات');
  });
});

test.describe('Video comment settings', () => {
  test.afterAll(async () => {
    await setCommentSettings('on');
  });

  test.describe('owner', () => {
    test.use({ storageState: AUTH_STATE.single });

    test('turns comments off in video edit', async ({ page }) => {
      await page.goto(`/en/video/${video.get().id}/edit`);
      const settings = page.getByTestId('video-edit-comment-settings');
      await expect(settings.getByTestId('video-edit-comments-on')).toBeChecked();
      await settings.getByTestId('video-edit-comments-off').check();
      await page.getByTestId('video-edit-save').click();
      await expect.poll(async () => {
        const u = userApi('single');
        const res = await u.api.get<{ commentSettings?: string }>(`/api/videos/${video.get().id}`, { token: u.token });
        return res.data.commentSettings;
      }).toBe('off');
    });
  });

  test.describe('viewer while off', () => {
    test.use({ storageState: AUTH_STATE.multi });

    test('sees that comments are off and the API rejects new ones', async ({ page }) => {
      await setCommentSettings('off');
      await page.goto(`/en/video/${video.get().id}`);
      await expect(page.getByTestId('comments-off')).toHaveText('Comments are turned off for this video.');
      await expect(page.getByTestId('comment-input')).toHaveCount(0);

      const u = userApi('multi');
      const res = await u.api.request(`/api/videos/${video.get().id}/comments`, {
        method: 'POST', json: { text: 'blocked' }, token: u.token, channelId: u.channelIds[0], allowStatus: [403],
      });
      expect(res.status).toBe(403);
    });
  });

  test.describe('held for review', () => {
    test.use({ storageState: AUTH_STATE.multi });

    test('a viewer comment waits for the owner, who can approve it', async ({ page, browser, baseURL }) => {
      await setCommentSettings('held');
      const text = unique('E2E held comment');

      await page.goto(`/en/video/${video.get().id}`);
      await expect(page.getByTestId('comments-held-info')).toBeVisible();
      await page.getByTestId('comment-input').fill(text);
      await page.getByTestId('comment-submit').click();
      await expect(page.getByTestId('comment-held-notice')).toBeVisible();
      await expect(page.getByTestId('comment').filter({ hasText: text }).getByTestId('comment-held')).toHaveText('Held for review');

      // Anonymous viewers don't see it
      const anon = await browser.newContext({ storageState: ANONYMOUS_STATE });
      await anon.addCookies([consentCookie(baseURL!)]);
      const anonPage = await anon.newPage();
      await anonPage.goto(`/en/video/${video.get().id}`);
      await expect(anonPage.getByTestId('comments-list')).toBeVisible();
      await expect(anonPage.getByTestId('comment').filter({ hasText: text })).toHaveCount(0);

      // The owner approves it
      const owner = await browser.newContext({ storageState: AUTH_STATE.single });
      await owner.addCookies([consentCookie(baseURL!)]);
      const ownerPage = await owner.newPage();
      await ownerPage.goto(`/en/video/${video.get().id}`);
      const held = ownerPage.getByTestId('comment').filter({ hasText: text });
      await held.getByTestId('comment-approve').click();
      await expect(held.getByTestId('comment-held')).toHaveCount(0);

      await anonPage.reload();
      await expect(anonPage.getByTestId('comment').filter({ hasText: text })).toBeVisible();
      await anon.close();
      await owner.close();
    });
  });
});
