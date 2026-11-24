import { test, expect } from './fixtures';
import type { APIRequestContext, Page } from '@playwright/test';
import { ANONYMOUS_STATE, AUTH_STATE } from './test-utils/auth-state';
import { openSideDrawer } from './test-utils/navigation';
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
  const clearHistory: string[] = [];

  test.afterEach(async ({ request }) => {
    for (const id of cleanup.splice(0)) await removeFromWatchLater(request, id);
    for (const id of unlike.splice(0)) {
      await request.delete(`${API_URL}/api/videos/${encodeURIComponent(id)}/likes`, { headers: authHeaders() });
    }
    for (const id of clearHistory.splice(0)) {
      await request.delete(`${API_URL}/api/watch-history/${encodeURIComponent(id)}`, { headers: authHeaders() });
    }
  });

  test('hub shows every section with see-all links and is reachable from the side navigation', async ({ page, request }, testInfo) => {
    const seeded = !testInfo.project.name.startsWith('Mobile');
    if (seeded) await seedHub(request, cleanup, unlike);
    await page.goto('/en');
    await openSideDrawer(page);
    await page.getByTestId('side-nav').getByRole('link', { name: 'You', exact: true }).click();
    await expect(page).toHaveURL(/\/en\/library$/);

    await expect(page.getByRole('heading', { level: 1, name: 'You', exact: true })).toBeVisible();
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
    await expect(page.getByRole('heading', { level: 1, name: 'أنت', exact: true })).toBeVisible();
    await expectSeeAllMatchesContent(page, 'watch-later');
    if (seeded) await expect(page.getByTestId('library-see-all-watch-later')).toHaveAttribute('href', '/ar/library/watch-later');
  });

  test('home "Your library" row: Watch later and Liked videos cards open their lists and play them', async ({ page, request }, testInfo) => {
    const playAllName = (lang: 'en' | 'ar', list: 'watch-later' | 'liked') =>
      lang === 'en'
        ? `Play all in ${list === 'liked' ? 'Liked videos' : 'Watch later'}`
        : `تشغيل الكل في ${list === 'liked' ? 'المرئيات التي أعجبتك' : 'المشاهدة لاحقًا'}`;
    test.skip(testInfo.project.name.startsWith('Mobile'), SHARED_STATE_REASON);
    await seedHub(request, cleanup, unlike);
    const video = await ownVideo(request);
    for (const [lang, heading, likedTitle] of [['en', 'Your library', 'Liked videos'], ['ar', 'مكتبتك', 'المرئيات التي أعجبتك']] as const) {
      await page.goto(`/${lang}`);
      const row = page.getByTestId('home-library');
      await expect(row).toBeVisible({ timeout: 30_000 });
      await expect(row.getByRole('heading', { level: 2, name: heading })).toBeVisible();
      // The newest like is this file's video, on the Liked card's cover
      const liked = row.getByTestId('home-library-liked');
      await expect(liked).toHaveAttribute('data-video-id', video.id);
      await expect(liked.getByTestId('home-library-liked-card')).toHaveAttribute('href', `/${lang}/library/liked`);
      await expect(liked.getByRole('heading', { name: likedTitle })).toBeVisible();
      await expect(row.getByTestId('home-library-watch-later-card')).toHaveAttribute('href', `/${lang}/library/watch-later`);
      await expect(row.getByTestId('home-library-watch-later-play')).toHaveAttribute('href', new RegExp(`^/${lang}/video/[^?]+\\?list=WL&index=\\d+$`));
      // Each Play all is named for its list, so the row's buttons are told apart by screen readers
      await expect(row.getByTestId('home-library-watch-later-play')).toHaveAccessibleName(playAllName(lang, 'watch-later'));
      await expect(liked.getByTestId('home-library-liked-play')).toHaveAccessibleName(playAllName(lang, 'liked'));
      // Liked videos play newest first, in place (list LL)
      await expect(liked.getByTestId('home-library-liked-play')).toHaveAttribute('href', `/${lang}/video/${video.id}?list=LL&index=0`);
    }
  });

  test('home "Your library" row is server-rendered with no layout shift or flash on slow library responses', async ({ page, request }, testInfo) => {
    test.skip(testInfo.project.name.startsWith('Mobile'), SHARED_STATE_REASON);
    await seedHub(request, cleanup, unlike);
    const video = await ownVideo(request);
    // Also seed Continue watching so all three library cards render
    const progress = await request.post(`${API_URL}/api/watch-history`, {
      headers: authHeaders(),
      data: { videoId: video.id, progress: 60, duration: 300 },
    });
    expect(progress.ok()).toBe(true);
    clearHistory.push(video.id);

    const SIGNED_URL = /bcdn_token=|[?&](?:amp;|\\u0026)?token=[^&"'\\\s]+(?:&|&amp;|\\u0026)expires=|\/priv\/\d{9,}\./;
    await page.emulateMedia({ colorScheme: 'dark' });
    // Delay any browser-side library/history fetches to verify the home page never waits on them or shifts
    await page.route(/\/api\/(library\/|watch-history)/, async (route) => {
      await new Promise((r) => setTimeout(r, 800));
      await route.continue();
    });

    await page.addInitScript(() => {
      const w = window as unknown as {
        __cls: number | null;
        __firstPaintTop: { hero: number | null; h1: number | null; hasLibrary: boolean };
      };
      w.__cls = PerformanceObserver.supportedEntryTypes?.includes('layout-shift') ? 0 : null;
      w.__firstPaintTop = { hero: null, h1: null, hasLibrary: false };
      if (w.__cls !== null) {
        new PerformanceObserver((list) => {
          for (const e of list.getEntries() as Array<PerformanceEntry & { value: number; hadRecentInput: boolean }>) {
            if (!e.hadRecentInput) w.__cls = (w.__cls ?? 0) + e.value;
          }
        }).observe({ type: 'layout-shift', buffered: true });
      }
      document.addEventListener('DOMContentLoaded', () => {
        const hero = document.querySelector('section.home-hero');
        const h1 = document.querySelector('main h1');
        w.__firstPaintTop = {
          hero: hero ? Math.round(hero.getBoundingClientRect().top) : null,
          h1: h1 ? Math.round(h1.getBoundingClientRect().top) : null,
          hasLibrary: !!document.querySelector('[data-testid="home-library"]'),
        };
      });
    });

    for (const [lang, viewport] of [
      ['en', { width: 1440, height: 900 }],
      ['ar', { width: 390, height: 844 }],
    ] as const) {
      await page.setViewportSize(viewport);
      let docHtml = '';
      const onResponse = async (res: import('@playwright/test').Response) => {
        if (res.request().resourceType() === 'document' && new URL(res.url()).pathname === `/${lang}`) {
          docHtml = await res.text().catch(() => '');
        }
      };
      page.on('response', onResponse);
      await page.goto(`/${lang}`);
      page.off('response', onResponse);

      await expect(page.getByTestId('home-library')).toBeVisible({ timeout: 30_000 });
      await page.waitForLoadState('networkidle').catch(() => undefined);
      await page.waitForTimeout(1000);

      expect(docHtml, `${lang}: Your library must be in the server HTML`).toContain('data-testid="home-library"');
      expect(SIGNED_URL.exec(docHtml), `${lang}: server HTML must not carry signed media URLs`).toBeNull();

      const stats = await page.evaluate(() => {
        const w = window as unknown as {
          __cls: number | null;
          __firstPaintTop: { hero: number | null; h1: number | null; hasLibrary: boolean };
        };
        const hero = document.querySelector('section.home-hero');
        const h1 = document.querySelector('main h1');
        return {
          cls: w.__cls,
          firstPaint: w.__firstPaintTop,
          settledHero: hero ? Math.round(hero.getBoundingClientRect().top) : null,
          settledH1: h1 ? Math.round(h1.getBoundingClientRect().top) : null,
        };
      });
      expect(stats.firstPaint.hasLibrary, `${lang}: library row present at DOMContentLoaded`).toBe(true);
      if (stats.firstPaint.hero !== null && stats.settledHero !== null) {
        expect(Math.abs(stats.settledHero - stats.firstPaint.hero), `${lang}: hero shifted ${stats.firstPaint.hero} -> ${stats.settledHero}`).toBeLessThanOrEqual(2);
      }
      if (stats.firstPaint.h1 !== null && stats.settledH1 !== null) {
        expect(Math.abs(stats.settledH1 - stats.firstPaint.h1), `${lang}: h1 shifted ${stats.firstPaint.h1} -> ${stats.settledH1}`).toBeLessThanOrEqual(2);
      }
      if (stats.cls !== null) {
        expect(stats.cls, `${lang}: CLS while loading home page with library`).toBeLessThan(0.05);
      }
    }
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
    const card = await own.showCard(page);
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
    // YouTube's playlist layout: the panel plays the list in order or shuffled
    const panel = page.getByTestId('library-panel');
    await expect(panel.getByTestId('library-play-all')).toHaveAttribute('href', /\?list=LL&index=0$/);
    await expect(panel.getByRole('button', { name: 'Shuffle' })).toBeVisible();
  });
});

test.describe('Library (signed in, empty library)', () => {
  test.use({ storageState: AUTH_STATE.none, colorScheme: 'dark' });

  test('leaves no hollow library space or shift when the signed-in user has no library items', async ({ page }) => {
    await page.addInitScript(() => {
      const w = window as unknown as { __cls: number | null };
      w.__cls = PerformanceObserver.supportedEntryTypes?.includes('layout-shift') ? 0 : null;
      if (w.__cls !== null) {
        new PerformanceObserver((list) => {
          for (const e of list.getEntries() as Array<PerformanceEntry & { value: number; hadRecentInput: boolean }>) {
            if (!e.hadRecentInput) w.__cls = (w.__cls ?? 0) + e.value;
          }
        }).observe({ type: 'layout-shift', buffered: true });
      }
    });

    await page.goto('/en');
    await expect(page.getByRole('heading', { level: 1, name: 'Videos' })).toBeVisible();
    await page.waitForLoadState('networkidle').catch(() => undefined);
    await page.waitForTimeout(500);

    await expect(page.getByTestId('home-library')).toHaveCount(0);
    const cls = await page.evaluate(() => (window as unknown as { __cls: number | null }).__cls);
    if (cls !== null) expect(cls, 'CLS with empty library').toBeLessThan(0.05);
  });
});

test.describe('Library (anonymous)', () => {
  test.use({ storageState: ANONYMOUS_STATE });

  test('asks visitors to sign in; card menus offer them Copy link only', async ({ page }) => {
    await page.goto('/en/library');
    await expect(page.getByTestId('library-signed-out')).toBeVisible();
    await page.goto('/en');
    const card = await own.showCard(page);
    // Short links (wiki AUN-SHORT-LINKS): everyone can copy a video's link; Watch later needs an account
    await card.locator('xpath=..').getByTestId('video-card-menu').click();
    await expect(page.getByTestId('video-card-copy-link').first()).toBeVisible();
    await expect(page.getByTestId('video-card-save-watch-later')).toHaveCount(0);
  });

  test('library API requires authentication', async ({ request }) => {
    const res = await request.get(`${API_URL}/api/library/watch-later`);
    expect(res.status()).toBe(401);
  });
});
