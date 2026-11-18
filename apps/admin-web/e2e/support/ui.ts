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
    await page.locator('button[data-component="button"]:not([type="button"])').click();
  }
  await page.waitForURL((url) => expectedPath.test(url.pathname), { timeout: 45_000 });
}

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
 * Sign out from the top bar. Since the shared nav (docs/design/NAV.md) the one sign-out entry is
 * in the account menu; the deployed QA build a PR runs against may still have the separate
 * "Log out" button (logout-button), so both are handled.
 */
export async function clickSignOut(page: Page) {
  const legacy = page.getByTestId('logout-button');
  if (await legacy.isVisible().catch(() => false)) {
    await legacy.click();
    return;
  }
  const trigger = page.getByTestId('account-menu-trigger');
  await expect(trigger).toBeVisible();
  if ((await trigger.getAttribute('aria-expanded')) !== 'true') await trigger.click();
  await page.getByTestId('account-menu').getByTestId('account-sign-out-all').click();
}

/** The account control at the top bar's inline end: the menu button (or the old "Log out"). */
export async function accountControl(page: Page) {
  const legacy = page.getByTestId('logout-button');
  if (await legacy.isVisible().catch(() => false)) return legacy;
  return page.getByTestId('account-menu-trigger');
}

/**
 * The light/dark mode on <html>: data-color-mode is the saved choice (absent = none yet, the device
 * decides) and the .dark class is what shows. No "System" option (owner decision 2026-11-13).
 */
export async function expectColorMode(page: Page, mode: Theme | null) {
  const html = page.locator('html');
  if (mode === null) await expect(html).not.toHaveAttribute('data-color-mode', /./);
  else {
    await expect(html).toHaveAttribute('data-color-mode', mode);
    if (mode === 'dark') await expect(html).toHaveClass(/\bdark\b/);
    else await expect(html).not.toHaveClass(/\bdark\b/);
  }
}

/**
 * A language / light-dark control. Since the unified header (docs/design/NAV.md "Header") they sit in
 * the top bar at every width; the deployed QA build a PR runs against may still have them in the
 * sidebar footer, behind the phone drawer, so the drawer is opened only when the control is not shown.
 */
export async function headerControl(page: Page, testId: 'theme-toggle' | 'language-toggle') {
  const control = page.getByTestId(testId);
  await control.waitFor({ state: 'attached' });
  if (!(await control.isVisible())) await openMainNav(page);
  return control;
}

/**
 * Wait for the server refresh a preference starts (PreferencesControls: router.refresh() in a
 * transition, aria-busy while pending). Navigating while it is in flight is interrupted by it in WebKit.
 */
async function preferenceSettled(page: Page, control: ReturnType<Page['getByTestId']>) {
  await expect(page.locator('[aria-busy]').filter({ has: control })).toHaveAttribute('aria-busy', 'false', { timeout: 15_000 });
}

/**
 * Switch the language with the header's language button (the other language's own name; the
 * admin_locale cookie, then a refresh of this page), or the old select on a build before it.
 */
export async function chooseLanguage(page: Page, locale: Locale) {
  const toggle = page.getByTestId('language-toggle');
  await toggle.or(page.getByTestId('language-select')).first().waitFor({ state: 'attached' });
  if ((await toggle.count()) > 0) {
    if ((await page.locator('html').getAttribute('lang')) !== locale) await toggle.click();
    await expectDirection(page, locale);
    await preferenceSettled(page, toggle);
    return;
  }
  await openMainNav(page);
  await page.getByTestId('language-select').selectOption(locale);
}

/**
 * Switch to Light or Dark with the header's toggle (one icon button named for the mode it
 * switches to, as on the videos site), and wait for the refresh. A no-op when it already shows.
 */
export async function chooseTheme(page: Page, theme: Theme) {
  const button = await headerControl(page, 'theme-toggle');
  const shown = (await page.locator('html').getAttribute('class'))?.split(/\s+/).includes('dark') ? 'dark' : 'light';
  if (shown !== theme) await button.click();
  await expect(button).toHaveAccessibleName(theme === 'dark' ? /^(Switch to light mode|التبديل إلى الوضع الفاتح)$/ : /^(Switch to dark mode|التبديل إلى الوضع الداكن)$/);
  await preferenceSettled(page, button);
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
export async function expectNoAxeViolations(page: Page, context: string, options: { skipFrames?: string[] } = {}) {
  let builder = new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']);
  // A sandboxed srcdoc frame (the email preview) breaks axe's helper page in WebKit: leave the frame out and
  // run frame by frame in the page itself (legacy mode opens no helper page)
  if (options.skipFrames?.length) {
    for (const selector of options.skipFrames) builder = builder.exclude(selector);
    builder = builder.setLegacyMode(true);
  }
  const results = await builder.analyze();
  const summary = results.violations.map((v) => ({
    id: v.id,
    impact: v.impact,
    help: v.help,
    targets: v.nodes.slice(0, 5).map((n) => `${n.target.join(' ')} :: ${(n.failureSummary ?? '').replace(/\s+/g, ' ').slice(0, 200)}`),
  }));
  expect(summary, `axe violations on ${context}`).toEqual([]);
}

/** Computed background colour of <body>, as an [r, g, b] triple. */
/** The page's background colour: the body's, or html's when the body is transparent (the Fawanees street paints the page on html). */
export async function bodyBackground(page: Page): Promise<[number, number, number]> {
  const color = await page.evaluate(() => {
    const transparent = (c: string) => c === 'transparent' || /rgba\([^)]*,\s*0\)$/.test(c);
    const body = getComputedStyle(document.body).backgroundColor;
    return transparent(body) ? getComputedStyle(document.documentElement).backgroundColor : body;
  });
  const match = color.match(/\d+(\.\d+)?/g)?.map(Number) ?? [0, 0, 0];
  return [match[0], match[1], match[2]];
}

export const isDark = ([r, g, b]: [number, number, number]) => (r * 299 + g * 587 + b * 114) / 1000 < 128;

/** Elements whose box extends past the viewport horizontally (RTL/mobile overflow). */
export async function horizontalOverflow(page: Page): Promise<number> {
  return page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
}

/**
 * Waits until React has hydrated `locator` (it carries React's props). Text typed into a
 * server-rendered controlled field before that is reset by hydration (NEWSLETTER-02 on WebKit,
 * #1459: the first field filled came back empty).
 */
export async function waitForHydration(locator: import('@playwright/test').Locator) {
  await expect
    .poll(() => locator.evaluate((el) => Object.keys(el).some((k) => k.startsWith('__reactProps$'))).catch(() => false), {
      message: 'the field never hydrated',
      timeout: 30_000,
    })
    .toBe(true);
}
