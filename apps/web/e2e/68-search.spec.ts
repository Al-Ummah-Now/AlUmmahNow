import { test, expect } from './fixtures';
import type { Page } from '@playwright/test';
import { ANONYMOUS_STATE } from './test-utils/auth-state';

/**
 * Search page (/[locale]/search) as it is today: query + results, empty
 * state, filters panel, suggestions and the trending block. Results come from
 * the QA seed videos ("QA Lecture ...").
 */

test.use({ storageState: ANONYMOUS_STATE });

function searchInput(page: Page) {
  return page.getByTestId('search-input');
}

async function search(page: Page, query: string) {
  const input = searchInput(page);
  await expect(input).toBeEditable();
  // Retried: typing before hydration is dropped by the controlled input
  await expect(async () => {
    await input.fill(query);
    await expect(input).toHaveValue(query, { timeout: 1000 });
  }).toPass();
  await page.getByTestId('search-submit').click();
}

test.describe('Search - English', () => {
  test('SRCH-001 initial state: labelled input, trending videos, no active filters', async ({ page }) => {
    await page.goto('/en/search');
    await expect(page.getByRole('heading', { level: 1, name: /^Search/ })).toBeVisible();
    await expect(page.getByRole('textbox', { name: /^Search(\.\.\.| videos, channels, and more\.\.\.)$/ })).toBeVisible();
    await expect(page.getByRole('heading', { name: /Trending Videos/ })).toBeVisible();
    // The default sort order must not count as an active filter
    await expect(page.getByTestId('search-filters-toggle')).toHaveText('Filters');
    await expect(page.getByTestId('search-active-filters')).toHaveCount(0);
  });

  test('SRCH-002 a query lists matching videos with a result summary', async ({ page }) => {
    await page.goto('/en/search');
    await search(page, 'QA Lecture');
    const summary = page.getByTestId('search-summary');
    await expect(summary).toHaveText(/^Found \d+ results for "QA Lecture"$/, { timeout: 30000 });
    const results = page.getByTestId('search-results').getByTestId('video-card');
    await expect(results.first()).toBeVisible();
    await expect(results.filter({ hasText: /QA Lecture/ }).first()).toBeVisible();
    // Trending block is replaced by the results
    await expect(page.getByRole('heading', { name: /Trending Videos/ })).toHaveCount(0);
  });

  test('SRCH-003 Enter in the input searches', async ({ page }) => {
    await page.goto('/en/search');
    const input = searchInput(page);
    await expect(async () => {
      await input.fill('Seerah');
      await expect(input).toHaveValue('Seerah', { timeout: 1000 });
    }).toPass();
    // Close any suggestion list first so Enter submits the typed query
    await input.press('Escape');
    await input.press('Enter');
    await expect(page.getByTestId('search-summary')).toHaveText(/results for "Seerah"/, { timeout: 30000 });
  });

  test('SRCH-004 an unmatched query shows the empty state', async ({ page }) => {
    await page.goto('/en/search');
    const nonsense = `zzqx${Date.now()}`;
    await search(page, nonsense);
    const empty = page.getByTestId('search-empty');
    await expect(empty.getByRole('heading', { name: 'No results found' })).toBeVisible({ timeout: 30000 });
    await expect(page.getByTestId('search-summary')).toHaveText(`Found 0 results for "${nonsense}"`);
    await expect(empty.getByRole('button', { name: /Clear/ })).toBeVisible();
  });

  test('SRCH-005 an empty query does nothing', async ({ page }) => {
    await page.goto('/en/search');
    await expect(searchInput(page)).toBeEditable();
    await page.getByTestId('search-submit').click();
    await expect(page.getByTestId('search-summary')).toHaveCount(0);
    await expect(page.getByRole('heading', { name: /Trending Videos/ })).toBeVisible();
  });

  test('SRCH-006 filters panel: labelled controls, apply marks filters active, clear resets', async ({ page }) => {
    await page.goto('/en/search');
    const toggle = page.getByTestId('search-filters-toggle');
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await toggle.click();
    const panel = page.getByTestId('search-filters-panel');
    await expect(panel).toBeVisible();
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    // The panel stays on screen (it used to overflow the right edge on phones)
    const box = await panel.boundingBox();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(page.viewportSize()!.width);

    await panel.getByLabel('Language').selectOption('ar');
    await panel.getByLabel('Duration').selectOption('short');
    await expect(panel.getByLabel('Category')).toBeVisible();
    await expect(panel.getByLabel('Sort By', { exact: true }).first()).toHaveValue('relevance');
    await panel.getByRole('button', { name: /^Apply( Filters)?$/ }).click();
    await expect(panel).toBeHidden();

    const active = page.getByTestId('search-active-filters');
    await expect(active).toContainText('Language: ar');
    await expect(active).toContainText('Duration: short');
    await expect(toggle).toContainText('Active');
    // Filters alone run a search
    await expect(page.getByTestId('search-summary')).toHaveText(/^Found \d+ results$/, { timeout: 30000 });

    await toggle.click();
    await panel.getByRole('button', { name: 'Clear' }).click();
    await expect(active).toHaveCount(0);
    await expect(toggle).toHaveText('Filters');
  });

  test('SRCH-007 suggestions appear while typing and pick a query', async ({ page }) => {
    await page.goto('/en/search');
    const input = searchInput(page);
    await expect(async () => {
      await input.fill('QA');
      await expect(input).toHaveValue('QA', { timeout: 1000 });
    }).toPass();
    const suggestion = page.getByTestId('search-suggestion').first();
    await expect(suggestion).toBeVisible({ timeout: 15000 });
    const text = (await suggestion.innerText()).trim().split('\n')[0];
    await suggestion.click();
    await expect(input).toHaveValue(text);
    await expect(page.getByTestId('search-summary')).toBeVisible({ timeout: 30000 });
  });

  test('SRCH-008 trending period tabs switch', async ({ page }) => {
    await page.goto('/en/search');
    await expect(page.getByRole('heading', { name: /Trending Videos/ })).toBeVisible();
    const week = page.getByRole('button', { name: 'This Week' });
    await week.click();
    await expect(page.getByRole('heading', { name: /Trending Videos/ })).toBeVisible();
  });
});

test.describe('Search - Arabic', () => {
  test('SRCH-010 Arabic page is RTL with Arabic labels and RTL filter panel', async ({ page }) => {
    await page.goto('/ar/search');
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.getByRole('main')).toHaveAttribute('dir', 'rtl');
    await expect(page.getByRole('textbox', { name: /^(بحث\.\.\.|ابحث عن فيديوهات وقنوات والمزيد\.\.\.)$/ })).toBeVisible();
    await expect(page.getByRole('heading', { name: /الفيديوهات الرائجة/ })).toBeVisible();
    await expect(page.getByTestId('search-filters-toggle')).toHaveText(/^(المرشحات|الفلاتر)$/);

    await page.getByTestId('search-filters-toggle').click();
    const panel = page.getByTestId('search-filters-panel');
    await expect(panel.getByRole('button', { name: /^تطبيق( المرشحات)?$/ })).toBeVisible();
    // The toggle is the last control (left edge in RTL): the panel opens from
    // its left edge into the page instead of off-screen
    const toggleBox = await page.getByTestId('search-filters-toggle').boundingBox();
    const panelBox = await panel.boundingBox();
    expect(Math.abs(panelBox!.x - toggleBox!.x)).toBeLessThan(2);
    expect(panelBox!.x + panelBox!.width).toBeLessThanOrEqual(page.viewportSize()!.width);
  });

  test('SRCH-011 Arabic results summary and RTL cards', async ({ page }) => {
    await page.goto('/ar/search');
    await search(page, 'QA Lecture');
    await expect(page.getByTestId('search-summary')).toHaveText(/^تم العثور على \d+ نتيجة لـ "QA Lecture"$/, { timeout: 30000 });
    await expect(page.getByTestId('search-results').getByTestId('video-card').first()).toHaveAttribute('href', /^\/ar\/video\?vid=/);
  });
});

test.describe('Search - dark theme', () => {
  test.use({ colorScheme: 'dark' });

  test('SRCH-020 the search input is readable in dark mode', async ({ page }) => {
    await page.goto('/en/search');
    const input = searchInput(page);
    await expect(input).toBeVisible();
    const { color, bg } = await input.evaluate((el) => ({ color: getComputedStyle(el).color, bg: getComputedStyle(el).backgroundColor }));
    expect(color).not.toBe(bg);
    expect(bg).not.toBe('rgb(255, 255, 255)');
  });
});
