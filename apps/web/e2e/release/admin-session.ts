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
import { sinkEmail, target } from './targets';
import { completeRegistration, submitPasswordSignIn } from './web-session';
import { watchProviderHealth } from './provider-retry';
import { isTimeout } from './provider-rules';

export async function signInAsAdmin(page: Page, prefix = 'rel-admin'): Promise<void> {
  if (process.env.E2E_ADMIN_EMAIL && process.env.E2E_ADMIN_PASSWORD) {
    await page.goto(`${target().adminWeb}/login`);
    await expect(page).toHaveURL(new RegExp(`^${target().auth}`), { timeout: 30000 });
    await submitPasswordSignIn(page, process.env.E2E_ADMIN_EMAIL, process.env.E2E_ADMIN_PASSWORD);
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
  await submitPasswordSignIn(page, email);
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
      // A sign-in that times out (the auth or admin-web pages slow, #1655) is tried once more with a
      // fresh account: the tier admin is a fixture here, admin-signin.spec.ts tests the sign-in itself
      for (let attempt = 1; ; attempt++) {
        const context = await browser.newContext();
        // Its slow pages count as provider trouble for the no-retry upload specs (provider-retry.ts)
        watchProviderHealth(context);
        const page = await context.newPage();
        try {
          await signInAsAdmin(page, 'rel-tier-admin');
          return { browser, context, page };
        } catch (error) {
          await context.close().catch(() => undefined);
          if (attempt === 2 || !isTimeout(error)) {
            await browser.close().catch(() => undefined);
            throw error;
          }
          console.warn(`[admin-session] the tier admin's sign-in timed out (${(error as Error).message.split('\n')[0]}); trying once more`);
        }
      }
    })();
    // A failed sign-in is not cached: the next caller tries again
    admin.catch(() => {
      admin = null;
    });
  }
  return admin.then((a) => a.page);
}
