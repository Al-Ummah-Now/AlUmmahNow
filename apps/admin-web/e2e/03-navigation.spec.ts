import { accounts } from './support/env';
import { test, expect } from './support/fixtures';
import { horizontalOverflow } from './support/ui';

const PAGES = [
  { path: '/dashboard', nav: 'Dashboard', heading: 'Admin Dashboard' },
  { path: '/moderation', nav: 'Moderation', heading: 'Moderation Queue' },
  { path: '/translations', nav: 'Translations', heading: 'Translation Management' },
  { path: '/indices', nav: 'Indices', heading: 'Video Indices' },
];

test.describe('navigation', () => {
  test('NAV-01 main nav reaches every section and marks the current page', async ({ page }) => {
    await page.goto('/dashboard');
    const nav = page.getByRole('navigation', { name: 'Main navigation' });
    for (const target of PAGES) {
      await nav.getByRole('link', { name: target.nav, exact: true }).click();
      await expect(page).toHaveURL(new RegExp(`${target.path}$`));
      await expect(page.getByRole('heading', { level: 1, name: target.heading })).toBeVisible();
      await expect(nav.getByRole('link', { name: target.nav, exact: true })).toHaveAttribute('aria-current', 'page');
      await expect(nav.locator('[aria-current="page"]')).toHaveCount(1);
    }
  });

  test('NAV-02 brand link returns to the dashboard', async ({ page }) => {
    await page.goto('/translations');
    await page.getByRole('link', { name: /Al Ummah Now\s*Admin/ }).click();
    await expect(page).toHaveURL(/\/dashboard$/);
  });

  test('NAV-03 report detail keeps Moderation highlighted', async ({ page, makeReport }) => {
    const report = await makeReport({ label: 'nav' });
    await page.goto(`/moderation/reports/${report.id}`);
    const nav = page.getByRole('navigation', { name: 'Main navigation' });
    await expect(nav.getByRole('link', { name: 'Moderation', exact: true })).toHaveAttribute('aria-current', 'page');
  });

  test('NAV-04 the nav shows the signed-in email on wide screens and fits narrow ones', async ({ page, isMobile }) => {
    await page.goto('/dashboard');
    if (isMobile) {
      await expect(page.getByTestId('user-email')).toBeHidden();
    } else {
      await expect(page.getByTestId('user-email')).toHaveText(accounts.admin.email);
    }
    await expect(page.getByTestId('logout-button')).toBeVisible();
    expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);
  });

  test('NAV-05 unknown routes render the localized 404 page', async ({ page }) => {
    const response = await page.goto('/this-page-does-not-exist');
    expect(response?.status()).toBe(404);
    await expect(page.getByTestId('not-found')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Page not found' })).toBeVisible();
    await page.getByRole('link', { name: 'Go to Dashboard' }).click();
    await expect(page).toHaveURL(/\/dashboard$/);
  });

  test('NAV-06 browser back/forward work across sections', async ({ page }) => {
    await page.goto('/dashboard');
    const nav = page.getByRole('navigation', { name: 'Main navigation' });
    await nav.getByRole('link', { name: 'Moderation', exact: true }).click();
    await expect(page).toHaveURL(/\/moderation$/);
    await nav.getByRole('link', { name: 'Translations', exact: true }).click();
    await expect(page).toHaveURL(/\/translations$/);
    await page.goBack();
    await expect(page).toHaveURL(/\/moderation$/);
    await page.goForward();
    await expect(page).toHaveURL(/\/translations$/);
  });
});
