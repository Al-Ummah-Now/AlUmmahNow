import { expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { ADMIN_WEB_URL, OPENAUTH_URL, type Account } from './env';
import { fillSecret } from './secret-fill';
import type { Locale, Theme } from '../../src/i18n/config';

/**
 * Log in through the real auth server password form. Specs that call this set
 * test.use({ trace: 'off' }) at the top level (see fillSecret).
 */
export async function uiLogin(page: Page, account: Account, expectedPath: RegExp = /\/dashboard$/) {
  await page.goto('/login');
  await page.waitForURL((url) => url.href.startsWith(OPENAUTH_URL) || expectedPath.test(url.pathname));
  if (page.url().startsWith(OPENAUTH_URL)) {
    await page.locator('input[name="email"]').fill(account.email);
    // Seed password: never through fill(), whose step title the HTML report keeps
    await fillSecret(page.locator('input[name="password"]'), account.password);
    await page.locator('button[data-component="button"]').click();
  }
  await page.waitForURL((url) => expectedPath.test(url.pathname), { timeout: 45_000 });
}

/**
 * Pick a theme in the header select and wait for the server refresh it starts
 * (PreferencesControls: router.refresh() in a transition, aria-busy while
 * pending). Navigating while it is in flight is interrupted by it in WebKit.
 */
/**
 * The main navigation (sidebar). On phones it is a drawer behind the menu button and hidden from
 * the accessibility tree until opened, so open it first; on wider screens it is always there.
 * PR runs test the deployed QA build, which may still have the old top nav (no admin-sidebar):
 * then the nav is the always-visible "Main navigation" landmark.
 */
export async function openMainNav(page: Page) {
  const sidebar = page.getByTestId('admin-sidebar');
  if ((await sidebar.count()) === 0) {
    const legacy = page.getByRole('navigation', { name: /^(Main navigation|التنقل الرئيسي)$/ });
    await expect(legacy).toBeVisible();
    return legacy;
  }
  const menu = page.getByTestId('nav-open');
  if ((await menu.isVisible()) && !(await sidebar.isVisible())) await menu.click();
  await expect(sidebar).toBeVisible();
  return sidebar;
}

/**
 * The light/dark preference on <html>: data-color-mode (with the .dark class) since the shell
 * follows the site theme; the deployed QA build may still use data-theme for it.
 */
export async function expectColorMode(page: Page, mode: Theme) {
  const html = page.locator('html');
  if (await html.getAttribute('data-color-mode')) {
    await expect(html).toHaveAttribute('data-color-mode', mode);
    if (mode === 'dark') await expect(html).toHaveClass(/\bdark\b/);
    if (mode === 'light') await expect(html).not.toHaveClass(/\bdark\b/);
  } else if (mode === 'system') {
    await expect(html).not.toHaveAttribute('data-theme', /^(light|dark)$/);
  } else {
    await expect(html).toHaveAttribute('data-theme', mode);
  }
}

export async function chooseTheme(page: Page, theme: Theme) {
  await openMainNav(page);
  const select = page.getByTestId('theme-select');
  await select.selectOption(theme);
  await expect(page.locator('[aria-busy]').filter({ has: select })).toHaveAttribute('aria-busy', 'false', { timeout: 15_000 });
}

/** Persist UI preferences the same way the preference selects do. */
export async function setPreferences(page: Page, prefs: { locale?: Locale; theme?: Theme }) {
  const url = new URL(page.url() === 'about:blank' ? ADMIN_WEB_URL : page.url());
  const cookies = [];
  if (prefs.locale) cookies.push({ name: 'admin_locale', value: prefs.locale, domain: url.hostname, path: '/' });
  if (prefs.theme) cookies.push({ name: 'admin_theme', value: prefs.theme, domain: url.hostname, path: '/' });
  await page.context().addCookies(cookies);
}

export async function expectDirection(page: Page, locale: Locale) {
  await expect(page.locator('html')).toHaveAttribute('lang', locale);
  await expect(page.locator('html')).toHaveAttribute('dir', locale === 'ar' ? 'rtl' : 'ltr');
}

/**
 * Run axe (WCAG 2.1 A/AA) and fail with a readable summary of violations.
 */
export async function expectNoAxeViolations(page: Page, context: string) {
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  const summary = results.violations.map((v) => ({
    id: v.id,
    impact: v.impact,
    help: v.help,
    targets: v.nodes.slice(0, 5).map((n) => `${n.target.join(' ')} :: ${(n.failureSummary ?? '').replace(/\s+/g, ' ').slice(0, 200)}`),
  }));
  expect(summary, `axe violations on ${context}`).toEqual([]);
}

/** Computed background colour of <body>, as an [r, g, b] triple. */
export async function bodyBackground(page: Page): Promise<[number, number, number]> {
  const color = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  const match = color.match(/\d+(\.\d+)?/g)?.map(Number) ?? [0, 0, 0];
  return [match[0], match[1], match[2]];
}

export const isDark = ([r, g, b]: [number, number, number]) => (r * 299 + g * 587 + b * 114) / 1000 < 128;

/** Elements whose box extends past the viewport horizontally (RTL/mobile overflow). */
export async function horizontalOverflow(page: Page): Promise<number> {
  return page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
}
