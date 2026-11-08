import { test, expect } from './fixtures';
import { AxeBuilder } from '@axe-core/playwright';
import { ANONYMOUS_STATE } from './test-utils/auth-state';
import { clickAndWaitForURL } from './test-utils/qa-content';

/**
 * Root redirect and not-found pages: the localized [locale]/not-found page
 * for unknown paths under /en and /ar, and the root not-found page for
 * unsupported locales.
 */

test.use({ storageState: ANONYMOUS_STATE });

const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];

test('ERR-001 the site root redirects to /en', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveURL(/\/en\/?$/);
});

for (const [locale, heading, description, home, back] of [
  ['en', 'Page not found', /does not exist/, 'Go Home', 'Go Back'],
  ['ar', 'الصفحة غير موجودة', /غير موجودة/, 'العودة إلى الرئيسية', 'العودة للخلف'],
] as const) {
  test(`ERR-002 unknown path shows the localized 404 page with status 404 (${locale})`, async ({ page }) => {
    const response = await page.goto(`/${locale}/e2e-no-such-page/${Date.now()}`);
    expect(response?.status()).toBe(404);

    const main = page.getByTestId('not-found-page');
    await expect(main).toBeVisible();
    await expect(page.locator('html')).toHaveAttribute('dir', locale === 'ar' ? 'rtl' : 'ltr');
    await expect(main.getByRole('heading', { level: 1 })).toHaveText(heading);
    await expect(main).toContainText(description);
    await expect(main.getByRole('link', { name: home })).toHaveAttribute('href', `/${locale}`);
    await expect(main.getByRole('button', { name: back })).toBeVisible();

    const axe = await new AxeBuilder({ page }).include('[data-testid="not-found-page"]').withTags(WCAG_TAGS).analyze();
    expect(axe.violations.map((v) => `${v.id}: ${v.nodes.map((n) => `${n.target.join(' ')} ${n.failureSummary ?? ''}`).join(', ')}`)).toEqual([]);
  });

  test(`ERR-003 404 "home" and "back" buttons navigate (${locale})`, async ({ page }) => {
    await page.goto(`/${locale}/history`);
    await page.goto(`/${locale}/e2e-no-such-page`);
    await clickAndWaitForURL(page, page.getByTestId('not-found-page').getByRole('button', { name: back }), new RegExp(`/${locale}/history$`));

    await page.goto(`/${locale}/e2e-no-such-page`);
    await clickAndWaitForURL(page, page.getByTestId('not-found-page').getByRole('link', { name: home }), new RegExp(`/${locale}/?$`));
  });
}

test.describe('404 - dark theme', () => {
  test.use({ colorScheme: 'dark' });

  test('ERR-004 localized 404 page follows the dark colour scheme', async ({ page }) => {
    await page.goto('/en/e2e-no-such-page');
    const main = page.getByTestId('not-found-page');
    await expect(main).toBeVisible();
    const bg = await main.evaluate((el) => getComputedStyle(el).backgroundColor);
    const [r, g, b] = bg.match(/\d+/g)!.map(Number);
    expect((r + g + b) / 3, `404 background ${bg}`).toBeLessThan(60);
  });
});

test('ERR-005 an unsupported locale is redirected to /en and shows the English 404 page', async ({ page }) => {
  const response = await page.goto('/zz/e2e-no-such-page');
  await expect(page).toHaveURL(/\/en\/e2e-no-such-page$/);
  expect(response?.status()).toBe(404);
  const main = page.getByTestId('not-found-page');
  await expect(main.getByRole('heading', { level: 1 })).toHaveText('Page not found');
  await clickAndWaitForURL(page, main.getByRole('link', { name: 'Go Home' }), /\/en\/?$/);
});

test('ERR-006 a path without a locale is moved under /en and 404s with a real 404 status', async ({ page }) => {
  const response = await page.goto('/e2e-no-such-page');
  await expect(page).toHaveURL(/\/en\/e2e-no-such-page$/);
  expect(response?.status()).toBe(404);
  const main = page.getByTestId('not-found-page');
  await expect(main.getByRole('heading', { level: 1 })).toHaveText('Page not found');
  await expect(main.getByRole('link', { name: 'Go Home' })).toHaveAttribute('href', '/en');
});

test('ERR-007 an unprefixed page URL keeps working under /en (query string preserved)', async ({ page }) => {
  await page.goto('/video?vid=00000000-0000-4000-8000-000000000000');
  await expect(page).toHaveURL(/\/en\/video\?vid=00000000-0000-4000-8000-000000000000$/);
  await expect(page.getByTestId('video-not-found')).toBeVisible();
});
