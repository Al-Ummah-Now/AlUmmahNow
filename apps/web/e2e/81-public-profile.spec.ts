import { test, expect } from './fixtures';
import { AxeBuilder } from '@axe-core/playwright';
import { ANONYMOUS_STATE, AUTH_STATE } from './test-utils/auth-state';
import { API_URL, userApi } from './test-utils/e2e-videos';
import { ownPublicVideos } from './test-utils/own-public-video';

/**
 * Public profile (Story 29.5): the signed-in user picks a @handle and turns on liked videos in
 * /settings/public-profile; a signed-out visitor then sees /u/@handle with name, playlists and the
 * liked video, not the subscriptions (off by default), with canonical, hreflang and ProfilePage
 * JSON-LD; /u/handle 301s to the @ form, Arabic is right to left, and an unknown handle is a 404.
 * The like is on this file's own public video; afterAll removes the handle and the like.
 */

test.describe.configure({ mode: 'serial' });

const own = ownPublicVideos(test, 'public-profile');
const HANDLE = `e2e-pp-${Date.now().toString(36)}`;
const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];

function headers() {
  const u = userApi('single');
  return { Authorization: `Bearer ${u.token}`, channelId: u.channelIds[0] || '' };
}

test.afterAll(async ({ request }) => {
  // Own data only: the handle is freed and the switches go back to the defaults
  await request.put(`${API_URL}/api/profile/public`, { headers: headers(), data: { handle: null, showSubscriptions: false, showPlaylists: true, showLikes: false } });
  const video = own.videos()[0];
  if (video) await request.delete(`${API_URL}/api/videos/${encodeURIComponent(video.id)}/likes`, { headers: headers() });
});

test.describe('public profile settings (signed in)', () => {
  test.use({ storageState: AUTH_STATE.single });

  test('pick a handle, show liked videos, save', async ({ page, request }, testInfo) => {
    test.skip(testInfo.project.name.startsWith('Mobile'), 'Writes the run account profile; covered by the desktop projects');
    const liked = await request.post(`${API_URL}/api/videos/${own.videos()[0].id}/likes`, { headers: headers() });
    expect(liked.ok()).toBe(true);

    await page.goto('/en/settings');
    await page.getByRole('link', { name: /Public profile/ }).click();
    await expect(page).toHaveURL(/\/en\/settings\/public-profile$/);
    const input = page.getByTestId('public-profile-handle-input');
    await expect(input).toBeEnabled();
    await input.fill(HANDLE);
    await expect(page.getByTestId('public-profile-handle-status')).toHaveAttribute('data-state', 'available');
    const likes = page.getByRole('switch', { name: 'Liked videos' });
    await expect(likes).toHaveAttribute('aria-checked', 'false');
    await likes.click();
    await page.getByTestId('public-profile-save').click();
    await expect(page.getByTestId('public-profile-save-result')).toHaveText('Saved');
    await expect(page.getByTestId('public-profile-view-link')).toHaveAttribute('href', `/en/u/@${HANDLE}`);

    const results = await new AxeBuilder({ page }).include('[data-testid="public-profile-settings"]').withTags(WCAG_TAGS).analyze();
    expect(results.violations.map((v) => v.id)).toEqual([]);
  });
});

test.describe('public profile page (signed out)', () => {
  test.use({ storageState: ANONYMOUS_STATE });

  test('shows the public things the owner chose, with SEO tags', async ({ page, request }, testInfo) => {
    test.skip(testInfo.project.name.startsWith('Mobile'), 'Depends on the desktop settings test');
    const response = await page.goto(`/en/u/@${HANDLE}`);
    expect(response?.status()).toBe(200);
    await expect(page.getByTestId('public-profile-handle')).toHaveText(`@${HANDLE}`);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(page.getByTestId('profile-section-playlists')).toBeVisible();
    await expect(page.getByTestId('profile-section-likes').locator(`[data-video-id="${own.videos()[0].id}"]`)).toBeVisible();
    await expect(page.getByTestId('profile-section-subscriptions')).toHaveCount(0);
    await expect(page.getByTestId('public-profile-owner-note')).toHaveCount(0);

    const canonical = await page.locator('link[rel="canonical"]').getAttribute('href');
    expect(canonical).toMatch(new RegExp(`/en/u/@${HANDLE}$`));
    expect(await page.locator('link[rel="alternate"][hreflang="ar"]').getAttribute('href')).toMatch(new RegExp(`/ar/u/@${HANDLE}$`));
    expect(await page.locator('meta[name="robots"]').getAttribute('content')).toMatch(/^index, follow/);
    const ld = await page.locator('script[type="application/ld+json"]').allTextContents();
    expect(ld.some((text) => text.includes('"ProfilePage"') && text.includes('"Person"'))).toBe(true);

    const axe = await new AxeBuilder({ page }).include('[data-testid="public-profile"]').withTags(WCAG_TAGS).analyze();
    expect(axe.violations.map((v) => v.id)).toEqual([]);

    // A hidden list answers like an unknown handle
    expect((await request.get(`${API_URL}/api/users/by-handle/${HANDLE}/subscriptions`)).status()).toBe(404);
  });

  test('/u/handle redirects to the @ form; Arabic is right to left', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name.startsWith('Mobile'), 'Depends on the desktop settings test');
    await page.goto(`/ar/u/${HANDLE}`);
    await expect(page).toHaveURL(new RegExp(`/ar/u/@${HANDLE}$`));
    await expect(page.getByTestId('public-profile')).toHaveAttribute('dir', 'rtl');
    await expect(page.getByRole('heading', { name: 'المرئيات المعجب بها' })).toBeVisible();
  });

  test('an unknown handle is a 404', async ({ page }) => {
    const response = await page.goto(`/en/u/@nobody-${Date.now().toString(36)}`);
    expect(response?.status()).toBe(404);
  });
});
