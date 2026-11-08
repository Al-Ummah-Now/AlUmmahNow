/**
 * Production post-promote signed-in check (release.yml, after the 100% promote):
 * one test-release-*@delivered.resend.dev user signs up on the web app (code read
 * through the Resend API, RESEND_API_KEY), signs in again from a fresh session,
 * signs in to the profile app, and is refused by admin-web.
 *
 * The address is appended to PROD_USER_FILE before the account exists, and the
 * workflow deletes every address in it afterwards (scripts/release/delete-test-user.ts),
 * pass or fail. Never prints codes or the key. Not part of the QA/stage suites
 * (*.check.ts; playwright.release-prod.config.ts).
 */
import { test, expect, type Page } from '@playwright/test';
import { appendFileSync } from 'fs';
import { randomBytes } from 'crypto';

const H = {
  web: 'https://videos.alummahnow.net',
  auth: 'https://auth.alummahnow.net',
  profile: 'https://profile.auth.alummahnow.net',
  adminWeb: 'https://admin.alummahnow.net',
};
const RESEND_KEY = process.env.RESEND_API_KEY ?? '';
if (!RESEND_KEY || !process.env.PROD_USER_FILE) throw new Error('RESEND_API_KEY and PROD_USER_FILE are required');
const EMAIL = `test-release-${Date.now()}-${randomBytes(3).toString('hex')}@delivered.resend.dev`;
const PASSWORD = `Rel-${randomBytes(12).toString('base64url')}-1!`;
appendFileSync(process.env.PROD_USER_FILE, `${EMAIL}\n`);

async function resendCode(email: string, after: number): Promise<string> {
  const auth = { Authorization: `Bearer ${RESEND_KEY}` };
  for (let i = 0; i < 30; i++) {
    const list = (await (await fetch('https://api.resend.com/emails?limit=50', { headers: auth })).json()) as {
      data?: { id: string; to: string[] | string; created_at: string }[];
    };
    const hit = (list.data ?? []).find(
      (e) => [e.to].flat().includes(email) && Date.parse(e.created_at.replace(' ', 'T').replace(/\+00$/, 'Z')) >= after - 5000,
    );
    if (hit) {
      const mail = (await (await fetch(`https://api.resend.com/emails/${hit.id}`, { headers: auth })).json()) as { html?: string; text?: string };
      const code = `${mail.text ?? ''} ${(mail.html ?? '').replace(/<[^>]+>/g, ' ')}`.match(/\b(\d{6})\b/)?.[1];
      if (code) return code;
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
  throw new Error(`no verification email for ${email} in Resend`);
}

async function password(page: Page) {
  await page.fill('input[name="email"]', EMAIL);
  await page.fill('input[name="password"]', PASSWORD);
  await page.click('button[data-component="button"]');
}

test('production: sign-up, sign-in on web, profile sign-in, admin refuses', async ({ page, context }) => {
  test.setTimeout(240000);
  const hops: string[] = [];
  page.on('framenavigated', (f) => f === page.mainFrame() && hops.push(f.url()));

  // Web: register through the real sign-in menu
  await page.goto(`${H.web}/en`);
  await page.locator('button[aria-haspopup="menu"]').first().click();
  await page.locator('[role="menu"] form button[type="submit"]').first().click();
  await expect(page).toHaveURL(new RegExp(`^${H.auth}`), { timeout: 30000 });
  await page.click('a:has-text("Register")');
  await page.fill('input[name="email"]', EMAIL);
  await page.fill('input[name="password"]', PASSWORD);
  await page.fill('input[name="repeat"]', PASSWORD);
  const sentAfter = Date.now();
  await page.click('button[data-component="button"]');
  await expect(page.locator('input[name="code"]')).toBeVisible({ timeout: 20000 });
  await page.fill('input[name="code"]', await resendCode(EMAIL, sentAfter));
  await page.click('button[data-component="button"]');
  await expect(page).toHaveURL(new RegExp(`^${H.web}/en(/|\\?|$)`), { timeout: 30000 });
  const token = await page.evaluate(async () => (await (await fetch('/api/auth/token')).json()) as { accessToken?: string });
  expect(token.accessToken, 'web session has an access token').toBeTruthy();

  // Web: sign in again from a fresh session (password)
  await context.clearCookies();
  await page.goto(`${H.web}/en`);
  await page.locator('button[aria-haspopup="menu"]').first().click();
  await page.locator('[role="menu"] form button[type="submit"]').first().click();
  await expect(page).toHaveURL(new RegExp(`^${H.auth}`), { timeout: 30000 });
  await password(page);
  await expect(page).toHaveURL(new RegExp(`^${H.web}/en(/|\\?|$)`), { timeout: 30000 });

  // Profile app (separate OAuth client)
  await context.clearCookies();
  await page.goto(H.profile);
  await page.locator('#loggedOutView button:has-text("Sign In")').click();
  await expect(page).toHaveURL(new RegExp(`^${H.auth}`), { timeout: 30000 });
  await password(page);
  await expect(page.locator('#loggedInView')).toBeVisible({ timeout: 30000 });
  await expect(page.locator('#loggedInView')).toContainText(EMAIL);

  // Admin-web: a user without the admin role is refused
  await context.clearCookies();
  await page.goto(`${H.adminWeb}/login`);
  await expect(page).toHaveURL(new RegExp(`^${H.auth}`), { timeout: 30000 });
  await password(page);
  await expect(page).toHaveURL(`${H.adminWeb}/access-denied`, { timeout: 30000 });
  await page.goto(`${H.adminWeb}/dashboard`);
  await expect(page).toHaveURL(`${H.adminWeb}/access-denied`, { timeout: 30000 });
  expect((await context.cookies()).some((c) => c.name === 'admin_session')).toBe(false);

  const bad = hops.filter((u) => /[?&]error=|\/auth\/error\b/.test(u));
  expect(bad, `went through an error page: ${bad.join(' → ')}`).toEqual([]);
});
