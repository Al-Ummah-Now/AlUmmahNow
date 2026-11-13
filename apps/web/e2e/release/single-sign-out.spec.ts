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
import { completeRegistration, createProfile, expectNoErrorHop, openMenuUntil, signUpOnWeb } from './web-session';
import { expectProfileSignedOut, signInToProfileSilently } from './profile-app';

// This file signs users in through the auth server: its traces would hold the
// typed password and email code (fillSecret args, form POST bodies). Trace off.
test.use({ trace: 'off' });

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

/**
 * Starts a sign-out and waits for the whole front-channel chain: the browser
 * leaves through the auth server's /logout and the chain's last redirect lands
 * on `home`. Redirect hops never commit a page (no framenavigated), so they are
 * recorded as navigation requests.
 */
async function signOutThroughAuthServer(page: Page, home: string, start: () => Promise<void>): Promise<string[]> {
  const hops: string[] = [];
  page.on('request', (r) => {
    if (r.isNavigationRequest() && r.frame() === page.mainFrame()) hops.push(r.url());
  });
  const back = page.waitForRequest(
    (r) => r.isNavigationRequest() && r.url() === home && (r.redirectedFrom()?.url().startsWith(`${target().auth}/logout`) ?? false),
    { timeout: 45000 },
  );
  await start();
  await back;
  await page.waitForLoadState('load');
  expect(hops.some((u) => u.startsWith(`${target().auth}/logout`)), `sign-out never reached the auth server: ${hops.join(' → ')}`).toBe(true);
  expectNoErrorHop(hops);
  return hops;
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

/**
 * With a shared sign-in, opening the videos site signs it in by itself (#463:
 * a silent /api/auth/login?prompt=none on load). It must reach its callback
 * straight from /authorize, never through the auth server's sign-in form.
 */
async function expectWebSignsInSilently(page: Page): Promise<void> {
  const forms: string[] = [];
  const onNav = (frame: { url(): string }) => {
    const u = new URL(frame.url());
    if (u.origin === target().auth && u.pathname.startsWith('/password/')) forms.push(frame.url());
  };
  page.on('framenavigated', onNav);
  const callback = page.waitForResponse((r) => r.url().startsWith(`${target().web}/api/callback`), { timeout: 30000 });
  await page.goto(`${target().web}/en`);
  await callback;
  expect(await webSignedIn(page)).toBe(true);
  page.off('framenavigated', onNav);
  expect(forms, 'videos asked for credentials despite the shared sign-in').toEqual([]);
}

/** The web app's own Sign In (menu → Sign In), whatever happens next. */
async function clickWebSignIn(page: Page): Promise<void> {
  await page.goto(`${target().web}/en`);
  // The header's account menu, not just the first menu button: a video card's "more" menu
  // (aria-haspopup="menu") now comes first on the home page and opened "Copy link" (v2026.11.13.7)
  const signIn = page.locator('[role="menu"] form button[type="submit"]').first();
  await openMenuUntil(page, signIn);
  await signIn.click();
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
    await signOutThroughAuthServer(page, `${target().web}/en`, () => clickHeaderSignOut(page));

    // Load the page again: still signed out (retried: the landing page may
    // still be finishing a navigation of its own)
    await expect(async () => {
      await page.goto(`${target().web}/en`, { waitUntil: 'load' });
    }).toPass({ timeout: 30000 });
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
    await expectWebSignsInSilently(page);

    await page.goto(`${target().adminWeb}/access-denied`);
    await signOutThroughAuthServer(page, `${target().adminWeb}/`, () =>
      page.locator('form[action="/api/logout"] button[type="submit"]').click(),
    );

    // Videos and profile are signed out
    expect(await webSignedIn(page)).toBe(false);
    await expectProfileSignedOut(page);

    // Admin sign-in asks for the password
    await page.goto(`${target().adminWeb}/login`);
    await expectCredentialsAsked(page);
  });
});
