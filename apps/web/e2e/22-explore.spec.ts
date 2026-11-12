import { test, expect } from './fixtures';
import { ANONYMOUS_STATE } from './test-utils/auth-state';
import { clickAndWaitForURL } from './test-utils/qa-content';
import { openSideDrawer } from './test-utils/navigation';
import { ownPublicVideos } from './test-utils/own-public-video';

/**
 * Explore page (Epic 29, Story 29.7) against this file's own content (a creator, its channel and a
 * public Quran Tafsir video, made in beforeAll and deleted afterwards):
 * trending, category grid, live now, new channels, language switch and
 * navigation entry in LTR and RTL.
 */

test.use({ storageState: ANONYMOUS_STATE });

const TAFSIR_TITLE = `E2E Tafsir explore ${Date.now().toString(36)}`;
// One worker runs this file's tests in order, so its own data (beforeAll) is made once
test.describe.configure({ mode: 'default' });

const own = ownPublicVideos(test, 'explore', [{ title: TAFSIR_TITLE, category: 'quran_tafsir' }]);

test.describe('Explore - English (LTR)', () => {
  test('shows every section', async ({ page }) => {
    await page.goto('/en/explore');
    await expect(page.getByRole('heading', { level: 1, name: 'Explore' })).toBeVisible();
    await expect(page.getByTestId('explore-trending')).toBeVisible();
    await expect(page.getByTestId('explore-categories')).toBeVisible();
    await expect(page.getByTestId('explore-live')).toBeVisible();
    await expect(page.getByTestId('explore-new-channels')).toBeVisible();
    await expect(page.locator('[dir="ltr"]').first()).toBeVisible();
  });

  test('category grid lists the platform categories with counts and opens search', async ({ page }) => {
    await page.goto('/en/explore');
    const tafsir = page.locator('[data-testid="explore-category"][data-category="quran_tafsir"]');
    await expect(tafsir).toBeVisible();
    await expect(tafsir).toContainText('Quran Tafsir');
    // Only categories with videos are shown (never an empty tile)
    for (const count of await page.getByTestId('explore-category').evaluateAll((tiles) => tiles.map((t) => Number(t.getAttribute('data-count'))))) {
      expect(count).toBeGreaterThan(0);
    }

    await clickAndWaitForURL(page, tafsir, /\/en\/search\?type=video&category=quran_tafsir/);
    await expect(page.getByTestId('active-filter-category')).toContainText('Quran Tafsir');
    await expect(page.getByTestId('search-result').filter({ hasText: own.videos()[0].title })).toBeVisible();
  });

  test('new channels include this file\'s channel', async ({ page }) => {
    await page.goto('/en/explore');
    const section = page.getByTestId('explore-new-channels');
    await expect(section.getByTestId('channel-tile').first()).toBeVisible();
    await expect(section.getByTestId('channel-tile').filter({ hasText: own.channelName() })).toBeVisible();
  });

  test('content language switch updates the URL', async ({ page }) => {
    await page.goto('/en/explore');
    await page.getByTestId('explore-language-ar').click();
    await expect(page).toHaveURL(/\/en\/explore\?language=ar/);
    await expect(page.getByTestId('explore-language-ar')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('explore-trending')).toBeVisible();
    await page.getByTestId('explore-language-all').click();
    await expect(page).not.toHaveURL(/language=/);
  });

  test('Explore is in the side navigation', async ({ page }) => {
    await page.goto('/en/');
    const drawer = await openSideDrawer(page);
    await clickAndWaitForURL(page, drawer.getByRole('link', { name: 'Explore' }), /\/en\/explore$/);
  });
});

test.describe('Explore - Arabic (RTL)', () => {
  test('renders right-to-left with Arabic labels', async ({ page }) => {
    await page.goto('/ar/explore');
    await expect(page.getByRole('heading', { level: 1, name: 'استكشف' })).toBeVisible();
    await expect(page.locator('[dir="rtl"]').first()).toBeVisible();
    await expect(page.getByTestId('explore-categories')).toContainText('التصنيفات');
    await expect(page.locator('[data-testid="explore-category"][data-category="quran_tafsir"]')).toContainText('تفسير القرآن');
    await expect(page.getByTestId('explore-live')).toContainText('مباشر الآن');
  });

  test('Explore is in the Arabic side navigation', async ({ page }) => {
    await page.goto('/ar/');
    const drawer = await openSideDrawer(page);
    await clickAndWaitForURL(page, drawer.getByRole('link', { name: 'استكشف' }), /\/ar\/explore$/);
  });
});

test.describe('Explore - mobile', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  // Firefox has no mobile emulation: Playwright rejects isMobile when creating the context
  test.skip(({ browserName }) => browserName === 'firefox', 'isMobile is not supported in Firefox');

  test('rails scroll inside the page without horizontal page overflow', async ({ page }) => {
    await page.goto('/en/explore');
    await expect(page.getByTestId('explore-categories')).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(1);
  });
});
