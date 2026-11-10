/**
 * Admin sign-in for the release suite: a new admin through the auth server's
 * sink and promote hooks; or, for a manual run, an existing admin account from
 * E2E_ADMIN_EMAIL / E2E_ADMIN_PASSWORD.
 *
 * Signs in through the auth server: callers keep traces off (the trace would
 * hold the password and code).
 */
import { chromium, expect, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { promoteToAdmin } from './sink';
import { sinkEmail, target, TEST_PASSWORD } from './targets';
import { completeRegistration } from './web-session';
import { fillSecret } from './secret-fill';

export async function signInAsAdmin(page: Page, prefix = 'rel-admin'): Promise<void> {
  if (process.env.E2E_ADMIN_EMAIL && process.env.E2E_ADMIN_PASSWORD) {
    await page.goto(`${target().adminWeb}/login`);
    await expect(page).toHaveURL(new RegExp(`^${target().auth}`), { timeout: 30000 });
    await page.fill('input[name="email"]', process.env.E2E_ADMIN_EMAIL);
    await fillSecret(page.locator('input[name="password"]'), process.env.E2E_ADMIN_PASSWORD);
    await page.click('button[data-component="button"]');
    await expect(page).toHaveURL(`${target().adminWeb}/dashboard`, { timeout: 30000 });
    return;
  }
  const email = sinkEmail(prefix);
  await page.goto(`${target().adminWeb}/login`);
  await expect(page).toHaveURL(new RegExp(`^${target().auth}`), { timeout: 30000 });
  await completeRegistration(page, email);
  await expect(page).toHaveURL(`${target().adminWeb}/access-denied`, { timeout: 30000 });
  await promoteToAdmin(email);
  // New tokens carry the role: drop every session and sign in from scratch
  await page.context().clearCookies();
  await page.goto(`${target().adminWeb}/login`);
  await expect(page).toHaveURL(new RegExp(`^${target().auth}`), { timeout: 30000 });
  await page.fill('input[name="email"]', email);
  await fillSecret(page.locator('input[name="password"]'), TEST_PASSWORD);
  await page.click('button[data-component="button"]');
  await expect(page).toHaveURL(`${target().adminWeb}/dashboard`, { timeout: 30000 });
}

/**
 * One signed-in admin page per worker, in a browser of its own: it is not a
 * test fixture, so it is never traced or recorded (it types the password), and
 * the tests' own pages keep their sessions. Signed in on first use.
 */
let admin: Promise<{ browser: Browser; context: BrowserContext; page: Page }> | null = null;

export function workerAdminPage(): Promise<Page> {
  if (!admin) {
    admin = (async () => {
      const browser = await chromium.launch();
      const context = await browser.newContext();
      const page = await context.newPage();
      await signInAsAdmin(page, 'rel-tier-admin');
      return { browser, context, page };
    })();
    // A failed sign-in is not cached: the next caller tries again
    admin.catch(() => {
      admin = null;
    });
  }
  return admin.then((a) => a.page);
}
