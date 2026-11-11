/**
 * Release regression: admin-web (admin.*) lets an admin in and turns everyone
 * else away. Each test registers its own sink user through admin-web's own
 * OAuth client; the admin test then promotes it with the auth server's
 * /test/promote route (TEST_PROMOTE_SECRET) and signs in again for a token
 * that carries the role.
 */
import { test, expect, type Page } from '@playwright/test';
import { promoteToAdmin } from './sink';
import { sinkEmail, target, TEST_PASSWORD } from './targets';
import { completeRegistration, expectNoErrorHop, recordNavigations, signUpOnWeb } from './web-session';
import { fillSecret } from './secret-fill';

// This file signs users in through the auth server: its traces would hold the
// typed password and email code (fillSecret args, form POST bodies). Trace off.
test.use({ trace: 'off' });

async function openAdminSignIn(page: Page): Promise<void> {
  await page.goto(`${target().adminWeb}/login`);
  await expect(page).toHaveURL(new RegExp(`^${target().auth}`), { timeout: 30000 });
}

async function registerThroughAdmin(page: Page, email: string): Promise<void> {
  await openAdminSignIn(page);
  await completeRegistration(page, email);
  // A fresh account has no admin role
  await expect(page).toHaveURL(`${target().adminWeb}/access-denied`, { timeout: 30000 });
}

test.describe('Release: admin-web access', () => {
  test('a signed-up user without an admin role is refused', async ({ page }) => {
    await registerThroughAdmin(page, sinkEmail('rel-admin-no'));
    await expect(page.locator('h1, h2').first()).toBeVisible();

    // Protected pages send it back out too
    await page.goto(`${target().adminWeb}/dashboard`);
    await expect(page).not.toHaveURL(new RegExp(`^${target().adminWeb}/dashboard`));
  });

  // The production post-promote check's case (v2026.11.11.3 rolled back on it): an EXISTING
  // account without the admin role, signed in elsewhere first, signs in with its PASSWORD through
  // admin-web's /login from a fresh browser. It must land on /access-denied promptly, with no
  // admin_session, and the redirect chain must not loop.
  test('an existing non-admin signs in with a password and is refused, without a loop', async ({ page, context }) => {
    const { email } = await signUpOnWeb(page, 'rel-admin-pw');
    await context.clearCookies();
    const hops: string[] = [];
    const t0 = Date.now();
    page.on('request', (r) => {
      if (r.isNavigationRequest() && r.frame() === page.mainFrame()) hops.push(`${((Date.now() - t0) / 1000).toFixed(1)}s ${r.method()} ${new URL(r.url()).origin}${new URL(r.url()).pathname}`);
    });
    await openAdminSignIn(page);
    await page.fill('input[name="email"]', email);
    await fillSecret(page.locator('input[name="password"]'), TEST_PASSWORD);
    // The click must not own the whole cross-site redirect chain: wait for where it ends instead
    await page.click('button[data-component="button"]', { noWaitAfter: true });
    await expect(page).toHaveURL(`${target().adminWeb}/access-denied`, { timeout: 30000 }).catch((error) => {
      throw new Error(`did not reach /access-denied (now ${page.url()}). Chain: ${hops.join(' -> ')}\n${String(error).split('\n')[0]}`);
    });
    await page.waitForLoadState('load');
    await page.waitForTimeout(3000);
    expect(new URL(page.url()).pathname, `kept navigating: ${hops.join(' -> ')}`).toBe('/access-denied');
    // authorize, password form, POST, callback, access-denied (+ /login and /api/auth/start)
    expect(hops.length, `too many hops (loop?): ${hops.join(' -> ')}`).toBeLessThanOrEqual(8);
    expect((await context.cookies()).some((c) => c.name === 'admin_session'), 'a refused user got an admin session').toBe(false);
    await page.goto(`${target().adminWeb}/dashboard`);
    await expect(page).toHaveURL(`${target().adminWeb}/access-denied`, { timeout: 30000 });
  });

  test('an admin signs in and reaches the dashboard', async ({ page, context }) => {
    test.skip(!process.env.TEST_PROMOTE_SECRET, 'TEST_PROMOTE_SECRET is not set: cannot create an admin user');
    const email = sinkEmail('rel-admin');
    await registerThroughAdmin(page, email);
    await promoteToAdmin(email);

    // New tokens carry the role: drop every session and sign in from scratch
    await context.clearCookies();
    const navigations = recordNavigations(page);
    await openAdminSignIn(page);
    await page.fill('input[name="email"]', email);
    await fillSecret(page.locator('input[name="password"]'), TEST_PASSWORD);
    await page.click('button[data-component="button"]');
    await expect(page).toHaveURL(`${target().adminWeb}/dashboard`, { timeout: 30000 });
    await page.reload();
    await expect(page).toHaveURL(`${target().adminWeb}/dashboard`);
    await expect(page.locator('main')).toBeVisible();

    expectNoErrorHop(navigations);
  });
});
