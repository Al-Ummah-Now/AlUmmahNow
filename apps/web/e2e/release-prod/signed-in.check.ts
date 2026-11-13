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

/**
 * Submits auth's password form. The click must not own the cross-site redirect chain that
 * follows (POST -> app callback -> code exchange -> app page): with the 15 s action timeout a
 * slow chain right after a promote failed the release (v2026.11.11.3) with no way to tell where
 * it stopped. The caller's toHaveURL waits for where it ends, and `chain()` says how it got there.
 */
async function password(page: Page) {
  await page.fill('input[name="email"]', EMAIL);
  await page.fill('input[name="password"]', PASSWORD);
  await page.click('button[data-component="button"]:not([type="button"])', { noWaitAfter: true });
}

/** Every main-frame navigation request with its time since the test started (redirect hops included). */
const navLog: string[] = [];
const t0 = Date.now();
const chain = () => navLog.slice(-12).join(' -> ');

/** toHaveURL that reports the navigation chain (read when it fails) instead of only "timeout". */
async function landsOn(page: Page, url: string, what: string, timeout = 30000) {
  try {
    await expect(page).toHaveURL(url, { timeout });
  } catch (error) {
    throw new Error(`${what}: did not reach ${url} (now ${page.url()}). Chain: ${chain()}\n${String(error).split('\n')[0]}`);
  }
}

test('production: sign-up, sign-in on web, profile sign-in, admin refuses', async ({ page, context }) => {
  test.setTimeout(240000);
  const hops: string[] = [];
  page.on('framenavigated', (f) => f === page.mainFrame() && hops.push(f.url()));
  page.on('request', (r) => {
    if (!r.isNavigationRequest() || r.frame() !== page.mainFrame()) return;
    const u = new URL(r.url());
    navLog.push(`${((Date.now() - t0) / 1000).toFixed(1)}s ${r.method()} ${u.origin}${u.pathname}`);
  });

  // Web: register through the real sign-in menu
  await page.goto(`${H.web}/en`);
  await page.locator('[data-testid="nav-menu-trigger"]:visible').first().click(); // the header's account menu, not a card's "more" menu
  await page.locator('[role="menu"] form button[type="submit"]').first().click();
  await expect(page).toHaveURL(new RegExp(`^${H.auth}`), { timeout: 30000 });
  await page.click('a:has-text("Register")');
  await page.fill('input[name="email"]', EMAIL);
  await page.fill('input[name="password"]', PASSWORD);
  await page.fill('input[name="repeat"]', PASSWORD);
  const sentAfter = Date.now();
  await page.click('button[data-component="button"]:not([type="button"])');
  await expect(page.locator('input[name="code"]')).toBeVisible({ timeout: 20000 });
  await page.fill('input[name="code"]', await resendCode(EMAIL, sentAfter));
  await page.click('button[data-component="button"]:not([type="button"])');
  await expect(page).toHaveURL(new RegExp(`^${H.web}/en(/|\\?|$)`), { timeout: 30000 });
  const token = await page.evaluate(async () => (await (await fetch('/api/auth/token')).json()) as { accessToken?: string });
  expect(token.accessToken, 'web session has an access token').toBeTruthy();

  // Web: sign in again from a fresh session (password)
  await context.clearCookies();
  await page.goto(`${H.web}/en`);
  await page.locator('[data-testid="nav-menu-trigger"]:visible').first().click(); // the header's account menu, not a card's "more" menu
  await page.locator('[role="menu"] form button[type="submit"]').first().click();
  await expect(page).toHaveURL(new RegExp(`^${H.auth}`), { timeout: 30000 });
  await password(page);
  await expect(page).toHaveURL(new RegExp(`^${H.web}/en(/|\\?|$)`), { timeout: 30000 });

  // Profile app (separate OAuth client)
  await context.clearCookies();
  // Signed out it shows a "Sign In" landing page (before AlUmmahNowAuth#254) or goes
  // straight to the auth server's form (from #254); accept either build.
  await page.goto(H.profile);
  // Only visible matches: the page keeps both views and hides one (strict mode counts hidden ones)
  const landingSignIn = page.locator('#loggedOutView button:has-text("Sign In")').filter({ visible: true });
  await expect(landingSignIn.or(page.locator('input[name="email"]').filter({ visible: true })).first()).toBeVisible({ timeout: 30000 });
  if (await landingSignIn.isVisible()) await landingSignIn.click();
  await expect(page).toHaveURL(new RegExp(`^${H.auth}`), { timeout: 30000 });
  await password(page);
  await expect(page.locator('#loggedInView')).toBeVisible({ timeout: 30000 });
  await expect(page.locator('#loggedInView')).toContainText(EMAIL);

  // Admin-web: a user without the admin role is refused
  await context.clearCookies();
  await page.goto(`${H.adminWeb}/login`);
  await expect(page).toHaveURL(new RegExp(`^${H.auth}`), { timeout: 30000 });
  await password(page);
  await landsOn(page, `${H.adminWeb}/access-denied`, 'admin-web sign-in of a non-admin', 45000);
  await page.goto(`${H.adminWeb}/dashboard`);
  await landsOn(page, `${H.adminWeb}/access-denied`, 'admin-web dashboard for a non-admin');
  expect((await context.cookies()).some((c) => c.name === 'admin_session')).toBe(false);

  const bad = hops.filter((u) => /[?&]error=|\/auth\/error\b/.test(u));
  expect(bad, `went through an error page: ${bad.join(' → ')}`).toEqual([]);
});
