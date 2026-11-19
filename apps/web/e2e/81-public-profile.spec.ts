import { test, expect } from './fixtures';
import { AxeBuilder } from '@axe-core/playwright';
import { ANONYMOUS_STATE, AUTH_STATE } from './test-utils/auth-state';
import { API_URL, userApi } from './test-utils/e2e-videos';
import { ownPublicVideos } from './test-utils/own-public-video';

/**
 * Public profile (Story 29.5) with the owner's decisions of 2026-11-14:
 * - "others see your likes? nope": no liked-videos switch, section or API.
 * - "searching users? nope": noindex, nofollow (meta and X-Robots-Tag), no canonical or hreflang,
 *   no ProfilePage JSON-LD.
 * - "only way you reach a user profile is if he comments on a video or post": the signed-in user
 *   picks a @handle in /settings/public-profile and comments on this file's own public video as
 *   themselves; a signed-out visitor clicks their name on that comment and lands on /u/@handle.
 * /u/handle 301s to the @ form, Arabic is right to left and an unknown handle is a 404.
 * afterAll removes the comment and the handle.
 */

test.describe.configure({ mode: 'serial' });

const own = ownPublicVideos(test, 'public-profile');
const HANDLE = `e2e-pp-${Date.now().toString(36)}`;
const COMMENT = `Public profile comment ${Date.now().toString(36)}`;
const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];
let commentId = '';

test.afterAll(async ({ request }) => {
  // Own data only: the comment goes and the handle is freed with the switches back on the defaults
  const u = userApi('single');
  const video = own.videos()[0];
  if (video && commentId) {
    await request.delete(`${API_URL}/api/videos/${encodeURIComponent(video.id)}/comments/${encodeURIComponent(commentId)}`, { headers: { Authorization: `Bearer ${u.token}` } });
  }
  await request.put(`${API_URL}/api/profile/public`, { headers: { Authorization: `Bearer ${u.token}` }, data: { handle: null, showSubscriptions: false, showPlaylists: true } });
});

test.describe('public profile settings (signed in)', () => {
  test.use({ storageState: AUTH_STATE.single });

  test('pick a handle, show subscriptions, save; no liked-videos switch', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name.startsWith('Mobile'), 'Writes the run account profile; covered by the desktop projects');
    await page.goto('/en/settings');
    await page.getByRole('link', { name: /Public profile/ }).click();
    await expect(page).toHaveURL(/\/en\/settings\/public-profile$/);
    const input = page.getByTestId('public-profile-handle-input');
    await expect(input).toBeEnabled();
    await input.fill(HANDLE);
    await expect(page.getByTestId('public-profile-handle-status')).toHaveAttribute('data-state', 'available');
    await expect(page.getByRole('switch')).toHaveCount(2);
    await expect(page.getByRole('switch', { name: /Liked videos/ })).toHaveCount(0);
    const subs = page.getByRole('switch', { name: 'Subscriptions' });
    await expect(subs).toHaveAttribute('aria-checked', 'false');
    await subs.click();
    await page.getByTestId('public-profile-save').click();
    await expect(page.getByTestId('public-profile-save-result')).toHaveText('Saved');
    // The user's own preview link is the one other way in
    await expect(page.getByTestId('public-profile-view-link')).toHaveAttribute('href', `/en/u/@${HANDLE}`);

    const results = await new AxeBuilder({ page }).include('[data-testid="public-profile-settings"]').withTags(WCAG_TAGS).analyze();
    expect(results.violations.map((v) => v.id)).toEqual([]);
  });

  test('comment on a video as themselves (no channel)', async ({ request }, testInfo) => {
    test.skip(testInfo.project.name.startsWith('Mobile'), 'Depends on the desktop settings test');
    const u = userApi('single');
    const res = await request.post(`${API_URL}/api/videos/${own.videos()[0].id}/comments`, {
      // Cloudflare's documented Turnstile test token: the local stack uses the always-pass test secret
      headers: { Authorization: `Bearer ${u.token}`, 'X-Turnstile-Token': 'XXXX.DUMMY.TOKEN.XXXX' },
      data: { text: COMMENT },
    });
    expect(res.ok(), await res.text()).toBe(true);
    commentId = (await res.json()).result.comment.id;
  });
});

test.describe('public profile page (signed out)', () => {
  test.use({ storageState: ANONYMOUS_STATE });

  test('the comment author name opens the profile; never indexed', async ({ page, request }, testInfo) => {
    test.skip(testInfo.project.name.startsWith('Mobile'), 'Depends on the desktop settings test');
    await page.goto(`/en/video/${own.videos()[0].id}`);
    const comment = page.getByTestId('comments-section').getByTestId('comment').filter({ hasText: COMMENT });
    const author = comment.getByTestId('comment-author-link');
    await expect(author).toHaveAttribute('href', `/en/u/@${HANDLE}`);
    // The link may navigate on the client, so the page's own response headers are read directly
    await author.click();
    await expect(page).toHaveURL(new RegExp(`/en/u/@${HANDLE}$`));
    const response = await request.get(`/en/u/@${HANDLE}`);
    expect(response.status()).toBe(200);
    expect(response.headers()['x-robots-tag']).toBe('noindex, nofollow');

    // A person is shown by name, never by @handle (the handle is only in the URL)
    await expect(page.getByTestId('public-profile-header')).not.toContainText(`@${HANDLE}`);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(page.getByTestId('profile-section-playlists')).toBeVisible();
    await expect(page.getByTestId('profile-section-subscriptions')).toBeVisible();
    await expect(page.getByTestId('profile-section-likes')).toHaveCount(0);
    await expect(page.getByTestId('public-profile-owner-note')).toHaveCount(0);

    expect(await page.locator('meta[name="robots"]').getAttribute('content')).toMatch(/^noindex, nofollow/);
    await expect(page.locator('link[rel="canonical"]')).toHaveCount(0);
    await expect(page.locator('link[rel="alternate"][hreflang]')).toHaveCount(0);
    const ld = await page.locator('script[type="application/ld+json"]').allTextContents();
    expect(ld.some((text) => text.includes('"ProfilePage"'))).toBe(false);

    const axe = await new AxeBuilder({ page }).include('[data-testid="public-profile"]').withTags(WCAG_TAGS).analyze();
    expect(axe.violations.map((v) => v.id)).toEqual([]);

    // No likes list at all, and the API is never indexed either
    expect((await request.get(`${API_URL}/api/users/by-handle/${HANDLE}/likes`)).status()).toBe(404);
    expect((await request.get(`${API_URL}/api/users/by-handle/${HANDLE}`)).headers()['x-robots-tag']).toBe('noindex, nofollow');
  });

  test('profiles never show in search or suggestions', async ({ request }, testInfo) => {
    test.skip(testInfo.project.name.startsWith('Mobile'), 'Depends on the desktop settings test');
    for (const path of [
      `/api/search/suggestions?q=${encodeURIComponent(HANDLE)}&types=video,channel,playlist,category`,
      `/api/search?q=${encodeURIComponent(HANDLE)}`,
    ]) {
      const res = await request.get(`${API_URL}${path}`);
      expect(res.ok(), path).toBe(true);
      // The response echoes the query, so only the results are checked: no user, and nothing carries the handle
      const { query: _query, ...rest } = (await res.json()) as Record<string, unknown>;
      const body = JSON.stringify(rest);
      expect(body, path).not.toContain(HANDLE);
      expect(body, path).not.toMatch(/"type":"user"/);
    }
  });

  test('/u/handle redirects to the @ form; Arabic is right to left', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name.startsWith('Mobile'), 'Depends on the desktop settings test');
    await page.goto(`/ar/u/${HANDLE}`);
    await expect(page).toHaveURL(new RegExp(`/ar/u/@${HANDLE}$`));
    await expect(page.getByTestId('public-profile')).toHaveAttribute('dir', 'rtl');
    await expect(page.getByRole('heading', { name: 'الاشتراكات' })).toBeVisible();
  });

  test('an unknown handle is a 404', async ({ page }) => {
    const response = await page.goto(`/en/u/@nobody-${Date.now().toString(36)}`);
    expect(response?.status()).toBe(404);
  });
});
