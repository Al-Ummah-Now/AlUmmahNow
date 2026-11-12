import { test, expect } from './fixtures';
import type { APIRequestContext, Page } from '@playwright/test';
import { ANONYMOUS_STATE, AUTH_STATE } from './test-utils/auth-state';
import { API_URL, userApi } from './test-utils/e2e-videos';
import { ownPublicVideos } from './test-utils/own-public-video';

/**
 * Library (Story 29.6): hub, Watch later (watch page + card menu), liked videos
 * from the per-user index, on this file's own public video (made in beforeAll,
 * deleted afterwards). Every item a test saves or likes is removed again in afterEach.
 */

// One worker runs this file's tests in order, so its own data (beforeAll) is made once
test.describe.configure({ mode: 'default' });

const own = ownPublicVideos(test, 'library');
const ownVideo = async (_request: APIRequestContext) => own.videos()[0];

function authHeaders(user: 'single' = 'single') {
  const u = userApi(user);
  return { Authorization: `Bearer ${u.token}`, channelId: u.channelIds[0] || '' };
}

async function removeFromWatchLater(request: APIRequestContext, videoId: string) {
  await request.delete(`${API_URL}/api/library/watch-later/${encodeURIComponent(videoId)}`, { headers: authHeaders() });
}

async function watchLaterIds(request: APIRequestContext): Promise<string[]> {
  const res = await request.get(`${API_URL}/api/library/watch-later?limit=50`, { headers: authHeaders() });
  expect(res.ok()).toBe(true);
  return ((await res.json()) as { result: { videoIds: string[] } }).result.videoIds;
}

/** Mutating tests share one QA account; the mobile job runs concurrently with the desktop job. */
const SHARED_STATE_REASON = 'Writes shared QA library state; covered by the desktop projects';

const HUB_SECTIONS = ['history', 'watch-later', 'liked', 'playlists', 'saved-posts'] as const;

/**
 * A section offers "See all" exactly when it lists something; an empty section
 * shows its empty text instead (the redesign hides the link with nothing to see).
 */
async function expectSeeAllMatchesContent(page: Page, id: (typeof HUB_SECTIONS)[number]) {
  const section = page.getByTestId(`library-section-${id}`);
  const empty = page.getByTestId(`library-empty-${id}`);
  // Loaded: items or the empty text (an error state fails here). Playlists come
  // from GET /api/playlists?channelId=, which scans the whole bucket: about 13 s
  // on a quiet QA, over 30 s while the E2E jobs run (#909)
  await expect(section.locator('ul > li').or(empty).first()).toBeVisible({ timeout: id === 'playlists' ? 90_000 : undefined });
  const items = await section.locator('ul > li').count();
  if (items > 0) await expect(page.getByTestId(`library-see-all-${id}`)).toBeVisible();
  else {
    await expect(empty).toBeVisible();
    await expect(page.getByTestId(`library-see-all-${id}`)).toHaveCount(0);
  }
}

/** Puts a seed video in Watch later and in the liked videos (desktop projects only). */
async function seedHub(request: APIRequestContext, cleanup: string[], unlike: string[]) {
  const video = await ownVideo(request);
  const saved = await request.post(`${API_URL}/api/library/watch-later`, { headers: authHeaders(), data: { videoId: video.id } });
  expect(saved.ok()).toBe(true);
  cleanup.push(video.id);
  const liked = await request.post(`${API_URL}/api/videos/${video.id}/likes`, { headers: authHeaders() });
  expect(liked.ok()).toBe(true);
  unlike.push(video.id);
}

test.describe('Library (signed in)', () => {
  test.use({ storageState: AUTH_STATE.single });
  test.describe.configure({ mode: 'serial' });

  const cleanup: string[] = [];
  const unlike: string[] = [];

  test.afterEach(async ({ request }) => {
    for (const id of cleanup.splice(0)) await removeFromWatchLater(request, id);
    for (const id of unlike.splice(0)) {
      await request.delete(`${API_URL}/api/videos/${encodeURIComponent(id)}/likes`, { headers: authHeaders() });
    }
  });

  test('hub shows every section with see-all links and is reachable from the side navigation', async ({ page, request }, testInfo) => {
    const seeded = !testInfo.project.name.startsWith('Mobile');
    if (seeded) await seedHub(request, cleanup, unlike);
    await page.goto('/en');
    await page.getByTestId('nav-drawer-toggle').click();
    await page.getByTestId('side-nav').getByRole('link', { name: 'Library' }).click();
    await expect(page).toHaveURL(/\/en\/library$/);

    await expect(page.getByRole('heading', { level: 1, name: 'Library' })).toBeVisible();
    for (const id of HUB_SECTIONS) {
      await expect(page.getByTestId(`library-section-${id}`)).toBeVisible();
      await expectSeeAllMatchesContent(page, id);
    }
    if (seeded) {
      await expect(page.getByTestId('library-see-all-watch-later')).toHaveAttribute('href', '/en/library/watch-later');
      await expect(page.getByTestId('library-see-all-liked')).toHaveAttribute('href', '/en/library/liked');
    }
    // History fills as the account watches; when it lists something, it links to the history page
    if (await page.getByTestId('library-see-all-history').count()) {
      await expect(page.getByTestId('library-see-all-history')).toHaveAttribute('href', '/en/history');
    }
  });

  test('Arabic hub renders right-to-left', async ({ page, request }, testInfo) => {
    const seeded = !testInfo.project.name.startsWith('Mobile');
    if (seeded) await seedHub(request, cleanup, unlike);
    await page.goto('/ar/library');
    await expect(page.getByTestId('library-page')).toHaveAttribute('dir', 'rtl');
    await expect(page.getByRole('heading', { level: 1, name: 'المكتبة' })).toBeVisible();
    await expectSeeAllMatchesContent(page, 'watch-later');
    if (seeded) await expect(page.getByTestId('library-see-all-watch-later')).toHaveAttribute('href', '/ar/library/watch-later');
  });

  test('saves a video to Watch later from the watch page and removes it from the list', async ({ page, request }, testInfo) => {
    test.skip(testInfo.project.name.startsWith('Mobile'), SHARED_STATE_REASON);
    const video = await ownVideo(request);
    await removeFromWatchLater(request, video.id);
    cleanup.push(video.id);

    await page.goto(`/en/video?vid=${video.id}`);
    const toggle = page.getByTestId('watch-later-button');
    await expect(toggle).toHaveAttribute('data-saved', 'false');
    await toggle.click();
    await expect(toggle).toHaveAttribute('data-saved', 'true');
    // The toggle and the list update optimistically; the API call settles after.
    await expect.poll(() => watchLaterIds(request)).toContain(video.id);

    await page.goto('/en/library/watch-later');
    const item = page.locator(`[data-testid="library-list-item"][data-video-id="${video.id}"]`);
    await expect(item).toBeVisible();
    await item.getByTestId('watch-later-remove').click();
    await expect(item).toHaveCount(0);
    await expect.poll(() => watchLaterIds(request)).not.toContain(video.id);
  });

  test('saves from a video card overflow menu with the keyboard', async ({ page, request }, testInfo) => {
    test.skip(testInfo.project.name.startsWith('Mobile'), SHARED_STATE_REASON);
    await page.goto('/en');
    const card = own.card(page);
    await expect(card).toBeVisible();
    const videoId = (await card.getAttribute('data-video-id')) as string;
    await removeFromWatchLater(request, videoId);
    cleanup.push(videoId);

    const menu = card.locator('xpath=..').getByTestId('video-card-menu');
    await menu.focus();
    await page.keyboard.press('Enter');
    const item = page.getByRole('menuitem', { name: 'Save to Watch later' });
    await expect(item).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('video-card-menu-status').first()).toHaveText('Saved to Watch later');
    await expect.poll(() => watchLaterIds(request)).toContain(videoId);
  });

  test('liked videos page lists a liked video from the per-user index', async ({ page, request }, testInfo) => {
    test.skip(testInfo.project.name.startsWith('Mobile'), SHARED_STATE_REASON);
    const video = await ownVideo(request);
    const liked = await request.post(`${API_URL}/api/videos/${video.id}/likes`, { headers: authHeaders() });
    expect(liked.ok()).toBe(true);
    unlike.push(video.id);

    await page.goto('/en/library/liked');
    await expect(page.getByRole('heading', { level: 1, name: /Liked videos/ })).toBeVisible();
    await expect(page.locator(`[data-testid="library-list-item"][data-video-id="${video.id}"]`)).toBeVisible();
  });
});

test.describe('Library (anonymous)', () => {
  test.use({ storageState: ANONYMOUS_STATE });

  test('asks visitors to sign in and hides card menus', async ({ page }) => {
    await page.goto('/en/library');
    await expect(page.getByTestId('library-signed-out')).toBeVisible();
    await page.goto('/en');
    await expect(own.card(page)).toBeVisible();
    await expect(page.getByTestId('video-card-menu')).toHaveCount(0);
  });

  test('library API requires authentication', async ({ request }) => {
    const res = await request.get(`${API_URL}/api/library/watch-later`);
    expect(res.status()).toBe(401);
  });
});
