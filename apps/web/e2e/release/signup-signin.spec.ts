/**
 * Release regression R1: sign-up → email code → sign-in → session, web client.
 *
 * Incident 2026-11-07: login() authorized with /api/callback?locale=en and the
 * callback exchanged with /api/callback; the issuer rejected every code and each
 * sign-in ended on /en/auth/error. The add-account flow had the same bug. This
 * drives the real OAuth round trip through the UI and fails on any error hop.
 */
import { test, expect, type Page } from '@playwright/test';
import { readSinkCode } from './sink';
import { sinkEmail, target, TEST_PASSWORD } from './targets';

function recordNavigations(page: Page): string[] {
  const urls: string[] = [];
  page.on('framenavigated', (frame) => {
    if (frame === page.mainFrame()) urls.push(frame.url());
  });
  return urls;
}

function expectNoErrorHop(urls: string[]): void {
  const bad = urls.filter((u) => {
    const url = new URL(u);
    return url.searchParams.has('error') || /\/auth\/error\b/.test(url.pathname);
  });
  expect(bad, `navigation went through an error: ${bad.join(' → ')}`).toEqual([]);
}

/** Opens the anonymous menu and starts sign-in (the login() server action). */
async function startSignIn(page: Page, locale: 'en' | 'ar'): Promise<void> {
  await page.goto(`${target().web}/${locale}`);
  await page.locator('button[aria-haspopup="menu"]').first().click();
  await page.locator('[role="menu"] form button[type="submit"]').first().click();
  await expect(page).toHaveURL(new RegExp(`^${target().auth}`), { timeout: 30000 });
}

/** True when the web app is back with a session (the callback redirects with session_updated). */
async function expectSignedIn(page: Page, locale: 'en' | 'ar'): Promise<void> {
  await expect(page).toHaveURL(new RegExp(`^${target().web}/${locale}(/|\\?|$)`), { timeout: 30000 });
  const cookies = await page.context().cookies(target().web);
  expect(cookies.map((c) => c.name).some((n) => /session|access_token/i.test(n)), `no session cookie: ${cookies.map((c) => c.name).join(', ')}`).toBe(true);
}

test.describe('Release R1: web sign-up and sign-in', () => {
  test.setTimeout(120000);

  for (const locale of ['en', 'ar'] as const) {
    test(`register, then sign in again from a fresh session (${locale})`, async ({ page, context }) => {
      const email = sinkEmail(`r1-web-${locale}`);
      const navigations = recordNavigations(page);

      // Sign-up: auth server registration form → code from the sink → callback
      await startSignIn(page, locale);
      await page.click('a:has-text("Register")');
      await page.fill('input[name="email"]', email);
      await page.fill('input[name="password"]', TEST_PASSWORD);
      await page.fill('input[name="repeat"]', TEST_PASSWORD);
      await page.click('button[data-component="button"]');
      await expect(page.locator('input[name="code"]')).toBeVisible({ timeout: 20000 });
      await page.fill('input[name="code"]', await readSinkCode(email));
      await page.click('button[data-component="button"]');
      await expectSignedIn(page, locale);

      // Sign-in with no session to fall back on: a full authorize → code → exchange
      await context.clearCookies();
      await startSignIn(page, locale);
      await page.fill('input[name="email"]', email);
      await page.fill('input[name="password"]', TEST_PASSWORD);
      await page.click('button[data-component="button"]');
      await expectSignedIn(page, locale);

      expectNoErrorHop(navigations);
    });
  }
});
