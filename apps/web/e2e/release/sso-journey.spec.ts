/**
 * Release regression: the SSO journey across every app (SSO audit 2026-11-10), in en and ar.
 *
 * A creator who is also an admin opens a studio deep link while signed out, signs in once on the
 * auth server and lands back on that page. Every other app then opens signed in, with the right
 * role and no password form: admin-web's dashboard, the CMS (admin), www and the profile app.
 * Signing out of the videos header signs out of every app, and the sign-in does not outlive the
 * sign-out anywhere: the refresh tokens the videos and admin sessions held are revoked, and a copy
 * of the CMS session cookie taken before the sign-out is refused.
 *
 * Seen on QA before the fix: the studio deep link went to the home page (and the header's "Sign
 * in" always came back to the home page); after single sign-out both refresh tokens still minted
 * new access tokens (with the Admin role) and a copied CMS cookie still opened the CMS.
 *
 * The parts whose fix lives in another repository or is not deployed to QA yet are skipped on a
 * pull request (recorded as an annotation, detected by behaviour); release runs never skip.
 */
import { test, expect, type BrowserContext, type Cookie, type Page } from '@playwright/test';
import { grantCreatorTier } from './creator-tier';
import { promoteToAdmin } from './sink';
import { target, TEST_PASSWORD } from './targets';
import { fillSecret } from './secret-fill';
import { apiFetch, createProfile, signUpOnWeb, type Locale } from './web-session';

// Types the password on the auth server: traces would hold it
test.use({ trace: 'off' });

const ON_PULL_REQUEST = process.env.GITHUB_EVENT_NAME === 'pull_request';

/** `fixed` must hold; on a pull request a fix that is not on the target yet skips that check. */
function requireFixed(what: string, fixed: boolean, problem: string): boolean {
  if (fixed) return true;
  if (ON_PULL_REQUEST) {
    test.info().annotations.push({ type: 'skipped-check', description: `${what}: ${problem} (fix not deployed on the target yet)` });
    return false;
  }
  expect(fixed, `${what}: ${problem}`).toBe(true);
  return false;
}

/** Waits until the main frame stops navigating (sign-ins hop through the auth server). */
async function settle(page: Page, quietMs = 2500, timeoutMs = 45000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let last = Date.now();
  const onNav = (frame: { parentFrame(): unknown }) => {
    if (!frame.parentFrame()) last = Date.now();
  };
  page.on('framenavigated', onNav);
  try {
    while (Date.now() - last < quietMs && Date.now() < deadline) await page.waitForTimeout(250);
    await page.waitForLoadState('load').catch(() => {});
  } finally {
    page.off('framenavigated', onNav);
  }
}

async function open(page: Page, url: string): Promise<void> {
  await page.goto(url, { waitUntil: 'load' }).catch(() => {});
  await settle(page);
}

/** The auth server's sign-in form is on screen. */
async function onSignInForm(page: Page): Promise<boolean> {
  if (new URL(page.url()).origin !== target().auth) return false;
  return page.locator('input[name="password"]').isVisible().catch(() => false);
}

async function getJson(page: Page, path: string): Promise<{ status: number; body: Record<string, unknown> | null }> {
  return page
    .evaluate(async (p) => {
      const res = await fetch(p, { credentials: 'include', cache: 'no-store' }).catch(() => null);
      if (!res) return { status: 0, body: null };
      return { status: res.status, body: (await res.json().catch(() => null)) as Record<string, unknown> | null };
    }, path)
    // A silent sign-in may navigate the page mid-call (execution context destroyed): no answer yet, polls retry
    .catch(() => ({ status: 0, body: null }));
}

async function videosUserId(page: Page): Promise<string> {
  await open(page, `${target().web}/en`);
  const { body } = await getJson(page, '/api/auth/token');
  return body?.accessToken ? String(body.userId ?? '') : '';
}

async function authAccountCount(context: BrowserContext): Promise<number> {
  const res = await context.request.get(`${target().auth}/session/accounts`, { failOnStatusCode: false });
  if (!res.ok()) return 0;
  return (((await res.json()) as { accounts?: unknown[] }).accounts ?? []).length;
}

interface HeldRefreshToken {
  app: string;
  token: string;
  clientId: string;
}

function audience(accessToken: unknown): string {
  try {
    const payload = JSON.parse(Buffer.from(String(accessToken).split('.')[1], 'base64url').toString()) as { aud?: string };
    return payload.aud ?? '';
  } catch {
    return '';
  }
}

/** The refresh tokens the videos and admin session cookies hold (their client id from the access token's aud). */
function heldRefreshTokens(cookies: Cookie[]): HeldRefreshToken[] {
  const out: HeldRefreshToken[] = [];
  for (const c of cookies) {
    if (c.name !== 'al_ummah_session' && c.name !== 'admin_session') continue;
    try {
      const value = JSON.parse(decodeURIComponent(c.value)) as {
        accessToken?: string;
        refreshToken?: string;
        accounts?: Record<string, { accessToken?: string; refreshToken?: string }>;
      };
      const app = c.name === 'admin_session' ? 'videos admin' : 'videos';
      const sessions = [value, ...Object.values(value.accounts ?? {})];
      for (const s of sessions) if (s.refreshToken) out.push({ app, token: s.refreshToken, clientId: audience(s.accessToken) });
    } catch {
      // a chunked or foreign value: nothing to check
    }
  }
  return out;
}

async function refreshStillWorks(held: HeldRefreshToken): Promise<boolean> {
  const res = await fetch(`${target().auth}/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: held.token, client_id: held.clientId }),
  });
  return res.status === 200;
}

async function signOutInVideosHeader(page: Page, locale: Locale): Promise<void> {
  await open(page, `${target().web}/${locale}`);
  const signOut = page.locator('[data-testid="nav-sign-out"]:visible').first();
  await expect(async () => {
    if (!(await signOut.isVisible())) await page.locator('[data-testid="nav-menu-trigger"]:visible').first().click();
    await expect(signOut).toBeVisible({ timeout: 3000 });
  }).toPass({ timeout: 30000 });
  const back = page.waitForRequest(
    (r) => r.isNavigationRequest() && r.url().startsWith(target().web) && (r.redirectedFrom()?.url().startsWith(`${target().auth}/logout`) ?? false),
    { timeout: 60000 },
  );
  await signOut.click();
  const dialog = page.locator('[role="dialog"] button, [role="alertdialog"] button').filter({ hasText: /sign out|تسجيل الخروج/i }).first();
  if (await dialog.isVisible({ timeout: 1500 }).catch(() => false)) await dialog.click();
  await back;
  await settle(page);
}

test.describe('Release: SSO journey across every app', () => {
  test.setTimeout(240000);

  for (const locale of ['en', 'ar'] as const) {
    test(`sign in once from a studio deep link, every app signed in with its role, sign out everywhere (${locale})`, async ({ page, context }) => {
      test.skip(!process.env.TEST_PROMOTE_SECRET, 'TEST_PROMOTE_SECRET not set: cannot make the admin creator');
      const consent = () => context.addCookies([{ name: 'aun_consent', value: `v1.a0.e0.p0.${Date.now()}`, url: target().web, sameSite: 'Lax' }]);
      await consent();

      // A creator (profile + channel) who is also an admin
      const user = await signUpOnWeb(page, `rel-sso-${locale}`, locale);
      await createProfile(user);
      // Creating channels is by invitation: an admin grants the Creator plan, in effect at once
      await grantCreatorTier(user);
      const channel = await apiFetch(user, '/api/channels', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: `SSO journey ${locale} ${Date.now()}`, description: 'Created by the release E2E suite', isMain: true }),
      });
      expect(channel.status, `POST /api/channels: ${await channel.clone().text()}`).toBeLessThan(300);
      await promoteToAdmin(user.email);

      // A fresh browser: open the studio deep link signed out, sign in once
      await context.clearCookies();
      await consent();
      // Studio deep link (no channel in it; the old /dashboard/videos 301s here)
      const studio = `${target().web}/${locale}/studio/go/content/videos`;
      const inStudio = (u: string) => new RegExp(`^/${locale}/studio/[^/]+/content/videos$`).test(new URL(u).pathname);
      await page.goto(studio);
      await expect(page).toHaveURL(new RegExp(`^${target().auth}`), { timeout: 30000 }).catch(() => {});
      const deepLinkSignIn = await onSignInForm(page);
      if (!requireFixed('videos studio', deepLinkSignIn, `a signed-out studio deep link went to ${page.url()} instead of the sign-in form`)) {
        await page.goto(`${target().web}/${locale}`);
        await page.locator('[data-testid="nav-menu-trigger"]:visible').first().click();
        await page.locator('[role="menu"] form button[type="submit"]').first().click();
        await expect(page).toHaveURL(new RegExp(`^${target().auth}`), { timeout: 30000 });
      }
      // The sign-in page follows the site language
      await expect(page.locator('html')).toHaveAttribute('lang', locale);
      await page.fill('input[name="email"]', user.email);
      await fillSecret(page.locator('input[name="password"]'), TEST_PASSWORD);
      await page.click('button[data-component="button"]');
      await page.waitForURL((u) => u.origin === target().web && !u.pathname.startsWith('/api/'), { timeout: 45000 });
      await settle(page);
      if (deepLinkSignIn) expect(inStudio(page.url()), `sign-in did not come back to the studio deep link (${page.url()})`).toBe(true);
      expect(await videosUserId(page)).toBe(user.userId);

      // admin-web: signed in silently, as an admin
      await open(page, `${target().adminWeb}/dashboard`);
      expect(await onSignInForm(page), 'admin-web asked for the password').toBe(false);
      expect(new URL(page.url()).pathname, 'admin-web did not open the dashboard for an admin').toBe('/dashboard');

      // CMS: signed in silently, mapped to the CMS admin role
      await open(page, `${target().cms}/`);
      expect(await onSignInForm(page), 'the CMS asked for the password').toBe(false);
      const cmsMe = await getJson(page, '/api/auth/me');
      expect((cmsMe.body?.user as { role?: string } | undefined)?.role, `CMS /api/auth/me: ${cmsMe.status}`).toBe('admin');

      // www: signed in (header probe)
      await open(page, `${target().www}/${locale}`);
      await expect.poll(async () => (await getJson(page, '/auth/me')).body?.signedIn, { timeout: 20000 }).toBe(true);

      // profile: signed in, no landing page
      await open(page, `${target().profile}/?lang=${locale}`);
      expect(await onSignInForm(page), 'the profile app asked for the password').toBe(false);
      await expect(page.locator('#loggedOutView')).toBeHidden();

      // Everything this browser holds right before signing out
      const held = heldRefreshTokens(await context.cookies());
      const cmsCookie = (await context.cookies(target().cms)).filter((c) => c.name === 'auth');
      expect(held.length, 'no refresh token in the videos/admin session cookies').toBeGreaterThan(0);

      // Sign out once, in the videos header
      await signOutInVideosHeader(page, locale);
      expect(await authAccountCount(context), 'the auth server still has the account').toBe(0);
      expect(await videosUserId(page), 'videos still signed in').toBe('');
      for (const [app, url] of [
        ['admin-web', `${target().adminWeb}/dashboard`],
        ['CMS', `${target().cms}/`],
        ['profile', `${target().profile}/`],
        ['videos studio', studio],
      ] as const) {
        await open(page, url);
        const signedOut = (await onSignInForm(page)) || (app === 'videos studio' && !inStudio(page.url()));
        expect(signedOut, `${app} is still signed in after single sign-out (${page.url()})`).toBe(true);
      }
      await open(page, `${target().www}/${locale}`);
      expect((await getJson(page, '/auth/me')).body?.signedIn, 'www still signed in').toBe(false);

      // Nothing outlives the sign-out: refresh tokens are revoked ...
      for (const token of held) {
        requireFixed(token.app, !(await refreshStillWorks(token)), 'its refresh token still works after single sign-out');
      }
      // ... and a copy of the CMS session cookie is refused
      if (cmsCookie.length) {
        const copy = await context.browser()!.newContext();
        await copy.addCookies(cmsCookie);
        const res = await copy.request.get(`${target().cms}/api/auth/me`, { failOnStatusCode: false, maxRedirects: 0 });
        const copied = await copy.request.get(`${target().cms}/posts`, { failOnStatusCode: false, maxRedirects: 0 });
        requireFixed('CMS', copied.status() !== 200, `a copy of the session cookie still opens the CMS (me: ${res.status()})`);
        await copy.close();
      }
    });
  }
});
