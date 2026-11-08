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
import { completeRegistration, expectNoErrorHop, recordNavigations } from './web-session';

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
    await page.fill('input[name="password"]', TEST_PASSWORD);
    await page.click('button[data-component="button"]');
    await expect(page).toHaveURL(`${target().adminWeb}/dashboard`, { timeout: 30000 });
    await page.reload();
    await expect(page).toHaveURL(`${target().adminWeb}/dashboard`);
    await expect(page.locator('main')).toBeVisible();

    expectNoErrorHop(navigations);
  });
});
