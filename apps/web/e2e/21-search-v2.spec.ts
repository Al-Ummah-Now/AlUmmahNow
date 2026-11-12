import { test, expect } from './fixtures';
import type { Page } from '@playwright/test';
import { ANONYMOUS_STATE } from './test-utils/auth-state';
import { ownPublicVideos } from './test-utils/own-public-video';
import { target } from './release/targets';

/**
 * Search v2 (Epic 29, Story 29.8) against this file's own content: index-backed results, Arabic
 * normalisation, type chips, filters (inline panel on desktop, bottom sheet on mobile), removable
 * filter chips and private on-device history.
 *
 * In beforeAll a new creator makes a channel, two public videos (Hadith, Tafsir; English and
 * Arabic titles) and a playlist, all carrying this run's random words TOKEN (Latin) and AR_TOKEN
 * (Arabic), so every query finds only this file's rows; afterAll deletes them.
 */

test.use({ storageState: ANONYMOUS_STATE });

const pick = (letters: string, n: number) => Array.from({ length: n }, () => letters[Math.floor(Math.random() * letters.length)]).join('');
/** This run's Latin word: in every title, so a query for it finds only this file's content */
const TOKEN = `zq${pick('bcdfghjklmnpqrstvwxz', 6)}`;
/** This run's Arabic word (no alef or taa marbuta, so normalisation leaves it as it is) */
const AR_TOKEN = pick('بتثجحخدذرزسشصضطظعغفقكمن', 6);
const HADITH = `${TOKEN} Hadith Basics`;
const TAFSIR = `${TOKEN} Introduction to Tafsir`;

// One worker runs this file's tests in order, so its own data (beforeAll) is made once
test.describe.configure({ mode: 'default' });

const own = ownPublicVideos(
  test,
  `search ${TOKEN}`,
  [
    { title: HADITH, titleAr: `${AR_TOKEN} أساسيات الحديث`, category: 'hadith_studies' },
    { title: TAFSIR, titleAr: `${AR_TOKEN} مقدمة في التفسير`, category: 'quran_tafsir' },
  ],
  { playlist: true },
);

/** The index is written after the API calls: wait until it has every row of this file */
test.beforeAll(async () => {
  const count = async (type: string, q: string) =>
    (((await (await fetch(`${target().api}/api/search?q=${encodeURIComponent(q)}&type=${type}`)).json().catch(() => ({}))) as { results?: unknown[] }).results ?? []).length;
  await expect.poll(() => count('video', TOKEN), { message: 'own videos in the search index', timeout: 60_000 }).toBe(2);
  await expect.poll(() => count('video', AR_TOKEN), { message: 'own Arabic titles in the search index', timeout: 60_000 }).toBe(2);
  await expect.poll(() => count('channel', TOKEN), { message: 'own channel in the search index', timeout: 60_000 }).toBeGreaterThan(0);
  await expect.poll(() => count('playlist', TOKEN), { message: 'own playlist in the search index', timeout: 60_000 }).toBeGreaterThan(0);
  expect(own.videos()).toHaveLength(2);
});

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
  // One search page once the navigation settles (the outgoing render can linger a moment)
  await expect(page.getByTestId('search-page')).toHaveCount(1);
  await expect(page.getByTestId('search-page')).toBeVisible();
  await expect(results(page).first()).toBeVisible();
}

test.describe('Search v2 - English (LTR)', () => {
  test('finds a video by a word prefix', async ({ page }) => {
    await page.goto(`/en/search?q=${TOKEN}+hadi`);
    await expectResults(page);
    await expect(page.locator('[data-result-type="video"]').filter({ hasText: HADITH })).toBeVisible();
    await expect(page.locator('[dir="ltr"]').first()).toBeVisible();
  });

  test('typing and submitting updates the URL', async ({ page }) => {
    await page.goto('/en/search');
    await expect(page.getByTestId('search-idle')).toBeVisible();
    await typeQuery(page, `${TOKEN} tafsir`);
    await page.locator(':is([data-testid="search-submit"],[data-testid="header-search-submit"]):visible').click();
    await expect(page).toHaveURL(new RegExp(`/en/search\\?q=${TOKEN}(\\+|%20)tafsir`));
    await expectResults(page);
  });

  test('type chips restrict results to one type', async ({ page }) => {
    await page.goto(`/en/search?q=${TOKEN}`);
    await expectResults(page);
    await page.getByTestId('search-type-channel').click();
    await expect(page).toHaveURL(/type=channel/);
    await expect(page.getByTestId('search-type-channel')).toHaveAttribute('aria-pressed', 'true');
    await expect(results(page).first()).toBeVisible();
    const types = await results(page).evaluateAll(nodes => nodes.map(n => n.getAttribute('data-result-type')));
    expect(new Set(types)).toEqual(new Set(['channel']));

    await page.getByTestId('search-type-playlist').click();
    await expect(page).toHaveURL(/type=playlist/);
    await expect(page.locator('[data-result-type="playlist"]').first()).toBeVisible();
  });

  test('filters apply from the panel and can be removed as chips', async ({ page, isMobile }) => {
    await page.goto(`/en/search?q=${TOKEN}&type=video`);
    await expectResults(page);

    await page.getByTestId('search-filters-toggle').click();
    const panel = page.getByTestId('search-filter-panel');
    await expect(panel).toBeVisible();
    await panel.getByTestId('search-filter-category').selectOption('hadith_studies');
    await expect(page).toHaveURL(/category=hadith_studies/);
    await expect(page.getByTestId('active-filter-category')).toContainText('Hadith Studies');
    await expect(results(page).filter({ hasText: HADITH })).toBeVisible();
    await expect(results(page).filter({ hasText: TAFSIR })).toHaveCount(0);

    await panel.getByTestId('search-filter-duration-long').click();
    await expect(page).toHaveURL(/duration=long/);
    await expect(page.getByTestId('search-filters-count')).toHaveText('2');
    // This file's videos are 40 s long, so "long" leaves nothing
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
    await page.goto(`/en/search?q=${TOKEN}&type=channel`);
    await page.getByTestId('search-filters-toggle').click();
    await expect(page.getByTestId('search-filter-panel')).toBeVisible();
    await expect(page.getByTestId('search-filter-duration-short')).toHaveCount(0);
  });

  test('search history is kept on the device and can be cleared', async ({ page }) => {
    await page.goto('/en/search');
    const input = await typeQuery(page, TOKEN);
    await input.press('Enter');
    await expect(page).toHaveURL(new RegExp(`q=${TOKEN}`));
    await expectResults(page);

    await page.goto('/en/search');
    await (await searchInput(page)).click();
    // The header box and the page's own box (phones) each render the history;
    // only the one in use is shown
    const items = page.getByTestId('search-history-item').filter({ visible: true });
    await expect(items.filter({ hasText: TOKEN })).toBeVisible();
    await expect(page.getByText('Search history is private and stored only on this device.').filter({ visible: true })).toBeVisible();

    await page.getByTestId('search-history-clear').filter({ visible: true }).click();
    await expect(items).toHaveCount(0);
    await page.reload();
    await (await searchInput(page)).click();
    await expect(items).toHaveCount(0);
  });

  test('suggestions come from the index', async ({ page }) => {
    await page.goto('/en/search');
    await typeQuery(page, TOKEN);
    await expect(page.getByTestId('search-suggestion').filter({ hasText: TOKEN }).first()).toBeVisible();
  });
});

test.describe('Search v2 - Arabic (RTL)', () => {
  test('matches Arabic spelling variants (diacritics, article)', async ({ page }) => {
    for (const q of [`${AR_TOKEN} الحديث`, `${AR_TOKEN} حديث`, `${AR_TOKEN} الحَدِيث`, `${AR_TOKEN[0]}َ${AR_TOKEN.slice(1)} الحديث`]) {
      await page.goto(`/ar/search?q=${encodeURIComponent(q)}&type=video`);
      await expectResults(page);
      await expect(results(page).filter({ hasText: `${AR_TOKEN} أساسيات الحديث` })).toBeVisible();
    }
  });

  test('renders right-to-left with Arabic labels', async ({ page }) => {
    await page.goto(`/ar/search?q=${TOKEN}`);
    await expectResults(page);
    await expect(page.locator('[dir="rtl"]').first()).toBeVisible();
    await expect(page.getByTestId('search-type-all')).toHaveText('الكل');
    await expect(page.getByTestId('search-type-video')).toHaveText('المرئيات');
    await page.getByTestId('search-filters-toggle').click();
    await expect(page.getByTestId('search-filter-panel')).toContainText('تاريخ الرفع');
  });
});

test.describe('Search v2 - mobile', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  // Firefox has no mobile emulation: Playwright rejects isMobile when creating the context
  test.skip(({ browserName }) => browserName === 'firefox', 'isMobile is not supported in Firefox');

  test('filters open as a bottom sheet and close with "Show results"', async ({ page }) => {
    await page.goto(`/en/search?q=${TOKEN}`);
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
    await page.goto(`/ar/search?q=${TOKEN}`);
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
    await input.pressSequentially(TOKEN, { delay: 20 });
    await expect(page.getByTestId('search-suggestion').filter({ hasText: TOKEN }).first()).toBeVisible();
    // Enter without choosing a suggestion runs the full search
    await input.press('Enter');
    await expect(page).toHaveURL(new RegExp(`/en/search\\?.*q=${TOKEN}`));

    await page.goto('/en/explore');
    await input.pressSequentially(TOKEN, { delay: 20 });
    await expect(page.getByTestId('search-suggestion').filter({ hasText: TOKEN }).first()).toBeVisible();
    await input.press('ArrowDown');
    await expect(input).toHaveAttribute('aria-activedescendant', /opt-0$/);
    // Choosing a suggestion opens that item (a category runs a category search)
    await input.press('Enter');
    await expect(page).toHaveURL(/\/en\/(video\?vid=|playlist\/|@|channels\/|c\/|search\?.*category=)/);

    await page.goto('/en/explore');
    await input.click();
    const items = page.getByTestId('search-history-item');
    await expect(items.first()).toBeVisible();
    const before = await items.count();
    await page.getByTestId('search-history-remove').first().click();
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

test.describe('Autocomplete', () => {
  test('SEARCH-AC-001 the header box is an ARIA combobox with grouped, announced, highlighted suggestions', async ({ page, isMobile }) => {
    test.skip(isMobile, 'Desktop header box');
    await page.goto('/en/explore');
    const input = page.locator('[data-testid="header-search-input"][data-ready="true"]:visible');
    await expect(input).toHaveAttribute('role', 'combobox');
    await expect(input).toHaveAttribute('aria-expanded', 'false');
    await input.pressSequentially(TOKEN, { delay: 20 });
    await expect(input).toHaveAttribute('aria-expanded', 'true');
    const listbox = page.locator(`#${await input.getAttribute('aria-controls')}`);
    await expect(listbox).toHaveAttribute('role', 'listbox');
    await expect(listbox.getByRole('group').first()).toBeVisible();
    await expect(listbox.locator('mark').first()).toBeVisible();
    await expect(page.getByTestId('autocomplete-status').first()).toContainText(/suggestion/);
    await input.press('Escape');
    await expect(input).toHaveAttribute('aria-expanded', 'false');
    await expect(input).toHaveValue(TOKEN);
  });

  test('SEARCH-AC-002 Arabic suggestions ignore diacritics and alef/taa marbuta spelling', async ({ page, isMobile }) => {
    test.skip(isMobile, 'Desktop header box');
    await page.goto('/ar/explore');
    const input = page.locator('[data-testid="header-search-input"][data-ready="true"]:visible');
    // This run's Arabic word typed with a diacritic still suggests this file's titles
    await input.pressSequentially(`${AR_TOKEN[0]}َ${AR_TOKEN.slice(1)}`, { delay: 20 });
    await expect(page.getByTestId('search-suggestion').filter({ hasText: AR_TOKEN }).first()).toBeVisible();
    await expect(page.getByTestId('search-dropdown').locator('mark').first()).toBeVisible();
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
    // Explore has its own search box (and dropdown) too: check the sheet's
    await expect(sheet.getByTestId('search-dropdown')).toBeVisible();
    await sheet.getByTestId('header-search-back').click();
    await expect(sheet).toBeHidden();
  });
});
