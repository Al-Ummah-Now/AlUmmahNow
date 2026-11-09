import { test, expect } from './fixtures';
import type { Page } from '@playwright/test';
import { ANONYMOUS_STATE } from './test-utils/auth-state';

/**
 * Search v2 (Epic 29, Story 29.8) against the seeded QA content
 * (e2e/seed/seed-config.ts): index-backed results, Arabic normalisation,
 * type chips, filters (inline panel on desktop, bottom sheet on mobile),
 * removable filter chips and private on-device history.
 */

test.use({ storageState: ANONYMOUS_STATE });

const results = (page: Page) => page.getByTestId('search-result');

/** The search input once React has hydrated it (typing earlier is lost). */
async function searchInput(page: Page) {
  const input = page.locator(':is([data-testid="search-input"],[data-testid="header-search-input"])[data-ready="true"]:visible');
  await expect(input).toBeVisible();
  return input;
}

/** Types into the search box, retrying until React keeps the value (early input can be dropped while the page settles). */
async function typeQuery(page: Page, text: string) {
  const input = await searchInput(page);
  await expect(async () => {
    await input.fill('');
    await input.pressSequentially(text, { delay: 20 });
    // The clear button renders from React state, so it proves React saw the input
    await expect(page.locator(':is([data-testid="search-input-clear"],[data-testid="header-search-clear"]):visible')).toBeVisible({ timeout: 1000 });
    await expect(input).toHaveValue(text, { timeout: 500 });
  }).toPass();
  return input;
}

async function expectResults(page: Page) {
  await expect(page.getByTestId('search-page')).toBeVisible();
  await expect(results(page).first()).toBeVisible();
}

test.describe('Search v2 - English (LTR)', () => {
  test('finds a seeded video by a word prefix', async ({ page }) => {
    await page.goto('/en/search?q=hadi');
    await expectResults(page);
    await expect(page.locator('[data-result-type="video"]').filter({ hasText: 'Hadith Basics' }).first()).toBeVisible();
    await expect(page.locator('[dir="ltr"]').first()).toBeVisible();
  });

  test('typing and submitting updates the URL', async ({ page }) => {
    await page.goto('/en/search');
    await expect(page.getByTestId('search-idle')).toBeVisible();
    await typeQuery(page, 'seerah');
    await page.locator(':is([data-testid="search-submit"],[data-testid="header-search-submit"]):visible').click();
    await expect(page).toHaveURL(/\/en\/search\?q=seerah/);
    await expectResults(page);
  });

  test('type chips restrict results to one type', async ({ page }) => {
    await page.goto('/en/search?q=QA');
    await expectResults(page);
    await page.getByTestId('search-type-channel').click();
    await expect(page).toHaveURL(/type=channel/);
    await expect(page.getByTestId('search-type-channel')).toHaveAttribute('aria-pressed', 'true');
    await expect(results(page).first()).toBeVisible();
    const types = await results(page).evaluateAll(nodes => nodes.map(n => n.getAttribute('data-result-type')));
    expect(new Set(types)).toEqual(new Set(['channel']));

    await page.getByTestId('search-type-playlist').click();
    await expect(page).toHaveURL(/type=playlist/);
    // Playlists only exist in the index after the search backfill has run on this environment
    const apiUrl = process.env.API_URL || 'https://videos.api.qa.alummahnow.net';
    const indexed = await page.request
      .get(`${apiUrl}/api/search?q=QA&type=playlist`)
      .then(async r => ((await r.json())?.results?.length ?? 0) > 0)
      .catch(() => false);
    test.skip(!indexed, 'No playlists in the search index yet (run the search backfill)');
    await expect(page.locator('[data-result-type="playlist"]').first()).toBeVisible();
  });

  test('filters apply from the panel and can be removed as chips', async ({ page, isMobile }) => {
    await page.goto('/en/search?q=QA&type=video');
    await expectResults(page);

    await page.getByTestId('search-filters-toggle').click();
    const panel = page.getByTestId('search-filter-panel');
    await expect(panel).toBeVisible();
    await panel.getByTestId('search-filter-category').selectOption('hadith_studies');
    await expect(page).toHaveURL(/category=hadith_studies/);
    await expect(page.getByTestId('active-filter-category')).toContainText('Hadith Studies');
    await expect(results(page).filter({ hasText: 'Hadith Basics' }).first()).toBeVisible();
    await expect(results(page).filter({ hasText: 'Introduction to Tafsir' })).toHaveCount(0);

    await panel.getByTestId('search-filter-duration-long').click();
    await expect(page).toHaveURL(/duration=long/);
    await expect(page.getByTestId('search-filters-count')).toHaveText('2');
    // Seeded videos are about a minute long, so "long" leaves nothing
    await expect(page.getByTestId('search-empty')).toBeVisible();

    // On phones the panel is a bottom sheet that covers the active-filter chips
    if (isMobile) await panel.getByRole('button', { name: 'Close filters' }).click();
    await page.getByTestId('active-filter-duration').click();
    await expect(page).not.toHaveURL(/duration=/);
    await expect(results(page).first()).toBeVisible();
    if (isMobile) await page.getByTestId('search-filters-toggle').click();

    await page.getByTestId('search-filters-clear').click();
    await expect(page).not.toHaveURL(/category=/);
  });

  test('duration filter is hidden for non-video types', async ({ page }) => {
    await page.goto('/en/search?q=QA&type=channel');
    await page.getByTestId('search-filters-toggle').click();
    await expect(page.getByTestId('search-filter-panel')).toBeVisible();
    await expect(page.getByTestId('search-filter-duration-short')).toHaveCount(0);
  });

  test('search history is kept on the device and can be cleared', async ({ page }) => {
    await page.goto('/en/search');
    const input = await typeQuery(page, 'tafsir');
    await input.press('Enter');
    await expect(page).toHaveURL(/q=tafsir/);
    await expectResults(page);

    await page.goto('/en/search');
    await (await searchInput(page)).click();
    const item = page.getByTestId('search-history-item').filter({ hasText: 'tafsir' });
    await expect(item).toBeVisible();
    await expect(page.getByText('Search history is private and stored only on this device.')).toBeVisible();

    await page.getByTestId('search-history-clear').click();
    await expect(page.getByTestId('search-history-item')).toHaveCount(0);
    await page.reload();
    await (await searchInput(page)).click();
    await expect(page.getByTestId('search-history-item')).toHaveCount(0);
  });

  test('suggestions come from the index', async ({ page }) => {
    await page.goto('/en/search');
    await typeQuery(page, 'Hadith');
    await expect(page.getByTestId('search-suggestion').first()).toBeVisible();
  });
});

test.describe('Search v2 - Arabic (RTL)', () => {
  test('matches Arabic spelling variants (diacritics, article)', async ({ page }) => {
    for (const q of ['الحديث', 'حديث', 'الحَدِيث']) {
      await page.goto(`/ar/search?q=${encodeURIComponent(q)}&type=video`);
      await expectResults(page);
      await expect(results(page).filter({ hasText: 'الحديث' }).first()).toBeVisible();
    }
  });

  test('renders right-to-left with Arabic labels', async ({ page }) => {
    await page.goto('/ar/search?q=QA');
    await expectResults(page);
    await expect(page.locator('[dir="rtl"]').first()).toBeVisible();
    await expect(page.getByTestId('search-type-all')).toHaveText('الكل');
    await expect(page.getByTestId('search-type-video')).toHaveText('الفيديوهات');
    await page.getByTestId('search-filters-toggle').click();
    await expect(page.getByTestId('search-filter-panel')).toContainText('تاريخ الرفع');
  });
});

test.describe('Search v2 - mobile', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  // Firefox has no mobile emulation: Playwright rejects isMobile when creating the context
  test.skip(({ browserName }) => browserName === 'firefox', 'isMobile is not supported in Firefox');

  test('filters open as a bottom sheet and close with "Show results"', async ({ page }) => {
    await page.goto('/en/search?q=QA');
    await expectResults(page);
    await page.getByTestId('search-filters-toggle').click();
    const sheet = page.getByTestId('search-filter-panel');
    await expect(sheet).toBeVisible();
    const box = await sheet.boundingBox();
    expect(box).not.toBeNull();
    expect(Math.round(box!.y + box!.height)).toBeGreaterThanOrEqual(840);
    await sheet.getByTestId('search-filter-date-year').click();
    await expect(page).toHaveURL(/date=year/);
    await sheet.getByRole('button', { name: 'Show results' }).click();
    await expect(sheet).toBeHidden();
    await expect(page.getByTestId('active-filter-date')).toBeVisible();
  });

  test('type chips scroll horizontally without overflowing the page', async ({ page }) => {
    await page.goto('/ar/search?q=QA');
    await expectResults(page);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(1);
  });
});

test.describe('Header search', () => {
  test('SEARCH-HDR-001 suggestions, keyboard choice and history work from any page', async ({ page, isMobile }) => {
    test.skip(isMobile, 'Phones open it from the icon: SEARCH-HDR-003');
    await page.goto('/en/explore');
    const input = page.locator('[data-testid="header-search-input"][data-ready="true"]:visible');
    await input.pressSequentially('mosque', { delay: 20 });
    await expect(page.getByTestId('search-suggestion').first()).toBeVisible();
    await input.press('ArrowDown');
    await expect(input).toHaveAttribute('aria-activedescendant', /opt-0$/);
    await input.press('Enter');
    await expect(page).toHaveURL(/\/en\/search\?.*q=/);

    await page.goto('/en/explore');
    await input.click();
    const items = page.getByTestId('search-history-item');
    await expect(items.first()).toBeVisible();
    const before = await items.count();
    await items.first().getByTestId('search-history-remove').dispatchEvent('pointerdown');
    await expect(items).toHaveCount(before - 1);
  });

  test('SEARCH-HDR-002 the search page has one box on desktop and keeps filters on a new query', async ({ page, isMobile }) => {
    test.skip(isMobile, 'Desktop layout only');
    await page.goto('/en/search?q=mosque&type=video');
    await expect(page.locator('[data-testid="search-input"]')).toBeHidden();
    const input = page.locator('[data-testid="header-search-input"][data-ready="true"]:visible');
    await expect(input).toHaveValue('mosque');
    await input.fill('adhan');
    await input.press('Enter');
    await expect(page).toHaveURL(/type=video/);
    await expect(page).toHaveURL(/q=adhan/);
  });
});

test.describe('Header search on phones', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  test.skip(({ browserName }) => browserName === 'firefox', 'isMobile is not supported in Firefox');

  test('SEARCH-HDR-003 the icon opens the box with its dropdown, in Arabic too', async ({ page }) => {
    await page.goto('/ar/explore');
    await page.getByTestId('header-search-open').click();
    const sheet = page.getByTestId('header-search-sheet');
    await expect(sheet).toBeVisible();
    await sheet.locator('[data-testid="header-search-input"]').click();
    await expect(page.getByTestId('search-dropdown')).toBeVisible();
    await sheet.getByTestId('header-search-back').click();
    await expect(sheet).toBeHidden();
  });
});
