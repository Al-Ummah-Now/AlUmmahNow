import { test, expect } from './support/fixtures';
import { expectNoAxeViolations, setPreferences } from './support/ui';
import { storageStatePath } from './support/env';
import type { Locale, Theme } from '../src/i18n/config';
import type { Page } from '@playwright/test';

const VARIANTS: { locale: Locale; theme: Theme }[] = [
  { locale: 'en', theme: 'light' },
  { locale: 'en', theme: 'dark' },
  { locale: 'ar', theme: 'light' },
  { locale: 'ar', theme: 'dark' },
];

const AUTH_PAGES: { name: string; path: string; ready: (page: Page) => Promise<void> }[] = [
  { name: 'dashboard', path: '/dashboard', ready: async (p) => expect(p.getByTestId('stat-total')).toBeVisible() },
  { name: 'moderation', path: '/moderation', ready: async (p) => expect(p.getByTestId('reports-total')).toBeVisible() },
  { name: 'translations', path: '/translations', ready: async (p) => expect(p.getByTestId('translation-row').first()).toBeVisible({ timeout: 30_000 }) },
  { name: 'site-visits', path: '/site-visits', ready: async (p) => expect(p.getByTestId('site-visits-panel').or(p.getByTestId('site-visits-error'))).toBeVisible({ timeout: 30_000 }) },
  { name: 'indices', path: '/indices', ready: async (p) => expect(p.getByRole('heading', { level: 1 })).toBeVisible() },
  { name: 'not-found', path: '/no-such-page', ready: async (p) => expect(p.getByTestId('not-found')).toBeVisible() },
];

// Scan settled colours, not mid-transition ones
test.use({ contextOptions: { reducedMotion: 'reduce' } });

test.describe('axe - signed in pages', () => {
  for (const variant of VARIANTS) {
    for (const target of AUTH_PAGES) {
      test(`A11Y-01 ${target.name} [${variant.locale}/${variant.theme}]`, async ({ page }) => {
        await setPreferences(page, variant);
        await page.goto(target.path);
        await target.ready(page);
        await expectNoAxeViolations(page, `${target.path} ${variant.locale}/${variant.theme}`);
      });
    }

    test(`A11Y-02 report detail with actions [${variant.locale}/${variant.theme}]`, async ({ page, makeReport }) => {
      const report = await makeReport({ label: 'a11y' });
      await setPreferences(page, variant);
      await page.goto(`/moderation/reports/${report.id}`);
      await expect(page.getByTestId('report-actions')).toBeVisible();
      // Selected state and error alert are part of the scanned UI too
      await page.getByTestId('report-actions').locator('button[data-action="removed"]').click();
      await expectNoAxeViolations(page, `report ${variant.locale}/${variant.theme}`);
    });
  }
});

test.describe('axe - public pages', () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  for (const variant of VARIANTS) {
    test(`A11Y-03 login error [${variant.locale}/${variant.theme}]`, async ({ page }) => {
      await setPreferences(page, variant);
      await page.goto('/login?error=auth_failed');
      await expectNoAxeViolations(page, `login error ${variant.locale}/${variant.theme}`);
    });
  }
});

test.describe('axe - access denied', () => {
  test.use({ storageState: storageStatePath('nonadmin') });

  for (const variant of VARIANTS) {
    test(`A11Y-04 access denied [${variant.locale}/${variant.theme}]`, async ({ page }) => {
      await setPreferences(page, variant);
      await page.goto('/access-denied');
      await expectNoAxeViolations(page, `access-denied ${variant.locale}/${variant.theme}`);
    });
  }
});

test.describe('keyboard', () => {
  test.beforeEach(({ isMobile }) => {
    test.skip(isMobile, 'keyboard navigation is checked on desktop projects');
  });

  test('KBD-01 skip link is the first tab stop and moves focus to main', async ({ page, browserName }) => {
    await page.goto('/dashboard');
    // WebKit only tabs to links with the "Press Tab to highlight each item" setting
    await page.keyboard.press(browserName === 'webkit' ? 'Alt+Tab' : 'Tab');
    const skip = page.getByRole('link', { name: 'Skip to main content' });
    await expect(skip).toBeFocused();
    await expect(skip).toBeVisible();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/#main-content$/);
    await expect(page.locator('#main-content')).toBeFocused();
  });

  test('KBD-02 nav links are reachable and show a focus indicator', async ({ page, browserName }) => {
    await page.goto('/dashboard');
    const tab = browserName === 'webkit' ? 'Alt+Tab' : 'Tab';
    const labels = ['Dashboard', 'Moderation', 'Translations', 'Indices'];
    const reached: string[] = [];
    // Tabs until every label is reached (the nav grows; a fixed count broke when items were added)
    for (let i = 0; i < 40 && !labels.every((l) => reached.includes(l)); i++) {
      await page.keyboard.press(tab);
      const name = await page.evaluate(() => (document.activeElement as HTMLElement | null)?.innerText?.trim() ?? '');
      reached.push(name);
    }
    for (const label of labels) {
      expect(reached, `tab order: ${reached.join(' | ')}`).toContain(label);
    }
    await page.getByRole('link', { name: 'Moderation', exact: true }).focus();
    const outline = await page.evaluate(() => {
      const el = document.activeElement as HTMLElement;
      const style = getComputedStyle(el);
      return style.boxShadow !== 'none' || (style.outlineStyle !== 'none' && style.outlineWidth !== '0px');
    });
    expect(outline).toBe(true);
  });

  test('KBD-03 a moderation action can be completed with the keyboard', async ({ page, makeReport }) => {
    const report = await makeReport({ label: 'kbd' });
    await page.goto(`/moderation/reports/${report.id}`);
    const dismiss = page.getByTestId('report-actions').locator('button[data-action="dismissed"]');
    await dismiss.focus();
    await page.keyboard.press('Space');
    await expect(dismiss).toHaveAttribute('aria-pressed', 'true');
    await page.getByLabel('Notes (optional)').focus();
    await page.keyboard.type('keyboard only');
    await page.getByTestId('confirm-action').focus();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\/moderation$/, { timeout: 30_000 });
  });

  test('KBD-04 translation edit opens with focus in the textbox and Escape cancels', async ({ page }) => {
    await page.goto('/translations');
    const edit = page.getByRole('button', { name: 'Edit appName' });
    await edit.focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('textbox', { name: 'Value for appName' })).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('textbox', { name: 'Value for appName' })).toHaveCount(0);
  });
});
