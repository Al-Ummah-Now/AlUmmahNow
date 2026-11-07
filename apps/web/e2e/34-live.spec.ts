import { test, expect } from './fixtures';
import type { Page } from '@playwright/test';
import { ANONYMOUS_STATE } from './test-utils/auth-state';

/**
 * Live streams list (/en/live, /ar/live).
 *
 * QA usually has no live stream, so the page must settle on its empty state;
 * when streams exist it must show the grid instead. Either way it must never
 * end on the error state or keep showing skeletons. The route error
 * boundaries (error.tsx) are covered by jest (src/app/{en,ar}/live/__tests__).
 */

test.use({ storageState: ANONYMOUS_STATE });

const TEXT = {
  en: {
    title: 'Live Streams',
    empty: 'No Live Streams',
    failed: 'Failed to Load Streams',
    count: /Showing \d+ live streams?/,
  },
  ar: {
    title: 'البث المباشر',
    empty: 'لا توجد بثوث مباشرة',
    failed: /فشل/,
    count: /\d+/,
  },
} as const;

async function settle(page: Page, locale: 'en' | 'ar') {
  const t = TEXT[locale];
  const empty = page.getByRole('heading', { level: 2, name: t.empty });
  const grid = page.locator('main .grid').filter({ has: page.locator('a, article, [role="button"]') });
  // Either outcome is fine, but one of them must appear (not the error, not endless skeletons)
  await expect(empty.or(grid).first()).toBeVisible({ timeout: 30000 });
  await expect(page.getByRole('heading', { name: t.failed })).toHaveCount(0);
  return { empty, grid };
}

for (const locale of ['en', 'ar'] as const) {
  test(`LIVE-001 live list loads to its empty state or stream grid (${locale})`, async ({ page }) => {
    const t = TEXT[locale];
    await page.goto(`/${locale}/live`);
    await expect(page.locator('html')).toHaveAttribute('dir', locale === 'ar' ? 'rtl' : 'ltr');
    await expect(page.getByRole('heading', { level: 1, name: t.title })).toBeVisible();
    await expect(page).toHaveTitle(locale === 'en' ? /Live Streams/ : /البث المباشر/);

    const { empty } = await settle(page, locale);
    if (await empty.isVisible()) {
      await expect(page.locator('main')).toContainText(locale === 'en' ? /no live streams at the moment/i : /لا توجد بثوث مباشرة في الوقت الحالي/);
    } else {
      await expect(page.locator('main')).toContainText(t.count);
    }
    // The error message must never leak raw technical text
    await expect(page.locator('main')).not.toContainText('Invalid response format');
  });
}

test.describe('live list - dark theme', () => {
  test.use({ colorScheme: 'dark' });

  test('LIVE-002 live list uses the dark background in dark mode', async ({ page }) => {
    await page.goto('/en/live');
    await settle(page, 'en');
    await expect(page.locator('html')).toHaveClass(/dark/);
    const bg = await page.locator('main').evaluate((el) => getComputedStyle(el).backgroundColor);
    const [r, g, b] = bg.match(/\d+/g)!.map(Number);
    expect((r + g + b) / 3, `main background ${bg}`).toBeLessThan(60);
  });
});

test('LIVE-003 live list layout fits the viewport (no horizontal scroll)', async ({ page }) => {
  await page.goto('/ar/live');
  await settle(page, 'ar');
  const { scrollWidth, innerWidth } = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    innerWidth: window.innerWidth,
  }));
  expect(scrollWidth).toBeLessThanOrEqual(innerWidth + 1);
});
