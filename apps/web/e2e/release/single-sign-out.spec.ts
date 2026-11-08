/**
 * Release regression: signing out of the videos site or the videos admin ends
 * the shared sign-in on the auth server (single sign-out).
 *
 * #291: the header's "Sign out" only removed the local account; the auth
 * server's __session survived and the next "Sign In" came straight back
 * signed in, without a form. #295: admin-web's "Log out" was local only too.
 * Both now go through the auth server's /logout, which walks every app's
 * front-channel logout (profile, auth admin, videos, admin, www, cms).
 */
import { test, expect, type Page } from '@playwright/test';
import { sinkEmail, target } from './targets';
import { completeRegistration, createProfile, expectNoErrorHop, recordNavigations, signUpOnWeb } from './web-session';

/** The web app's same-origin token endpoint: 200 with a token only while signed in. */
async function webSignedIn(page: Page): Promise<boolean> {
  if (new URL(page.url()).origin !== target().web) await page.goto(`${target().web}/en`);
  // Let a callback's redirects (/api/callback → /en/...) finish before evaluating
  await page.waitForURL((u) => u.origin === target().web && !u.pathname.startsWith('/api/'), { timeout: 30000 });
  await page.waitForLoadState('load');
  let signedIn = false;
  await expect(async () => {
    signedIn = await page.evaluate(async () => {
      const res = await fetch('/api/auth/token', { credentials: 'same-origin', cache: 'no-store' });
      if (!res.ok) return false;
      const body = (await res.json().catch(() => ({}))) as { accessToken?: string | null };
      return !!body.accessToken;
    });
  }).toPass({ timeout: 20000 });
  return signedIn;
}

/** Header → account menu → "Sign out of <account>" (retried until the header has hydrated). */
async function clickHeaderSignOut(page: Page): Promise<void> {
  const signOut = page.locator('[data-testid="nav-sign-out"]:visible').first();
  await expect(async () => {
    if (!(await signOut.isVisible())) await page.locator('[data-testid="nav-menu-trigger"]:visible').first().click();
    await expect(signOut).toBeVisible({ timeout: 3000 });
  }).toPass({ timeout: 30000 });
  await signOut.click();
}

/** Profile app sign-in; with a shared sign-in it completes without a form. */
async function signInToProfileSilently(page: Page): Promise<void> {
  await page.goto(target().profile);
  await page.locator('#loggedOutView button:has-text("Sign In")').click();
  await expect(page.locator('#loggedInView')).toBeVisible({ timeout: 30000 });
}

async function expectProfileSignedOut(page: Page): Promise<void> {
  await page.goto(target().profile);
  await expect(page.locator('#loggedOutView')).toBeVisible({ timeout: 20000 });
}

/** The auth server shows its password form and stays there (no silent sign-in). */
async function expectCredentialsAsked(page: Page): Promise<void> {
  await expect(page).toHaveURL(new RegExp(`^${target().auth}/`), { timeout: 30000 });
  await expect(page.locator('input[name="password"]')).toBeVisible({ timeout: 20000 });
  await page.waitForTimeout(3000);
  expect(new URL(page.url()).origin, 'signed back in without a form').toBe(target().auth);
  const authCookies = await page.context().cookies(target().auth);
  expect(authCookies.find((c) => c.name === '__session' && c.value)).toBeUndefined();
}

/** The web app's own Sign In (menu → Sign In), whatever happens next. */
async function clickWebSignIn(page: Page): Promise<void> {
  await page.goto(`${target().web}/en`);
  await page.locator('button[aria-haspopup="menu"]').first().click();
  await page.locator('[role="menu"] form button[type="submit"]').first().click();
}

test.describe('Release: single sign-out', () => {
  // Consent already answered: the banner otherwise covers the account menu's last item
  test.beforeEach(async ({ context }) => {
    await context.addCookies([{ name: 'aun_consent', value: `v1.a0.e0.p0.${Date.now()}`, url: target().web, sameSite: 'Lax' }]);
  });

  test('videos header "Sign out" signs out of every app, and the next sign-in asks for credentials (#291)', async ({ page }) => {
    const user = await signUpOnWeb(page, 'rel-sso-web');
    await createProfile(user);
    await signInToProfileSilently(page);

    // Header → account menu → Sign out of <account>
    await page.goto(`${target().web}/en`);
    expect(await webSignedIn(page)).toBe(true);
    const navigations = recordNavigations(page);
    await clickHeaderSignOut(page);
    await page.waitForURL((u) => u.origin === target().web && u.pathname === '/en', { timeout: 30000 });
    expect(
      navigations.some((u) => u.startsWith(`${target().auth}/logout`)),
      `sign-out never reached the auth server: ${navigations.join(' → ')}`,
    ).toBe(true);
    expectNoErrorHop(navigations);

    // Reload: still signed out
    await page.reload();
    expect(await webSignedIn(page)).toBe(false);

    // The profile app is signed out too
    await expectProfileSignedOut(page);

    // Sign In on the videos site (a fresh /authorize) asks for the password
    await clickWebSignIn(page);
    await expectCredentialsAsked(page);
  });

  test('videos admin "Log out" signs out of every app, and the next sign-in asks for credentials (#295)', async ({ page }) => {
    // A member (no admin role) lands on /access-denied, which has "Log out"
    await page.goto(`${target().adminWeb}/login`);
    await expect(page).toHaveURL(new RegExp(`^${target().auth}`), { timeout: 30000 });
    await completeRegistration(page, sinkEmail('rel-sso-admin'));
    await expect(page).toHaveURL(`${target().adminWeb}/access-denied`, { timeout: 30000 });

    // The shared sign-in also signs the videos site in, without a form
    const callback = page.waitForResponse((r) => r.url().startsWith(`${target().web}/api/callback`), { timeout: 30000 });
    await clickWebSignIn(page);
    await callback;
    expect(await webSignedIn(page)).toBe(true);

    await page.goto(`${target().adminWeb}/access-denied`);
    const navigations = recordNavigations(page);
    await page.locator('form[action="/api/logout"] button[type="submit"]').click();
    await page.waitForURL((u) => u.origin === target().adminWeb && u.pathname === '/', { timeout: 30000 });
    expect(
      navigations.some((u) => u.startsWith(`${target().auth}/logout`)),
      `log out never reached the auth server: ${navigations.join(' → ')}`,
    ).toBe(true);
    expectNoErrorHop(navigations);

    // Videos and profile are signed out
    expect(await webSignedIn(page)).toBe(false);
    await expectProfileSignedOut(page);

    // Admin sign-in asks for the password
    await page.goto(`${target().adminWeb}/login`);
    await expectCredentialsAsked(page);
  });
});
