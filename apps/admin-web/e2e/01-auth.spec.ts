import type { Page } from '@playwright/test';
import { test, expect } from './support/fixtures';
import { ADMIN_WEB_URL, OPENAUTH_URL, accounts, storageStatePath } from './support/env';
import { uiLogin } from './support/ui';

const PROTECTED = ['/dashboard', '/moderation', '/translations', '/indices', '/moderation/reports/does-not-exist'];

test.describe('authentication - signed out', () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  for (const path of PROTECTED) {
    test(`AUTH-01 ${path} redirects to the auth server when signed out`, async ({ page }) => {
      const authorize = page.waitForRequest((req) => req.url().startsWith(`${OPENAUTH_URL}/authorize`));
      await page.goto(path);
      // The authorize request must point back at this app's callback
      const url = new URL((await authorize).url());
      expect(url.searchParams.get('redirect_uri')).toBe(`${ADMIN_WEB_URL}/api/callback`);
      expect(url.searchParams.get('response_type')).toBe('code');
      await page.waitForURL((u) => u.href.startsWith(OPENAUTH_URL));
      await expect(page.locator('input[name="email"]')).toBeVisible();
    });
  }

  test('AUTH-02 home page goes straight to sign-in when signed out (no "Please log in" page)', async ({ page }) => {
    const authorize = page.waitForRequest((req) => req.url().startsWith(`${OPENAUTH_URL}/authorize`));
    await page.goto('/');
    // No prompt: the auth server signs an existing browser session in silently
    expect(new URL((await authorize).url()).searchParams.get('prompt')).toBeNull();
    await page.waitForURL((u) => u.href.startsWith(OPENAUTH_URL));
    await expect(page.locator('input[name="email"]')).toBeVisible();
  });

  test('AUTH-03 admin can log in through the auth server', async ({ page }) => {
    await uiLogin(page, accounts.admin);
    await expect(page.getByRole('heading', { name: 'Admin Dashboard' })).toBeVisible();
    const cookies = await page.context().cookies();
    const session = cookies.find((c) => c.name === 'admin_session');
    expect(session?.httpOnly).toBe(true);
    expect(session?.secure).toBe(ADMIN_WEB_URL.startsWith('https'));
  });

  test('AUTH-04 moderator can log in through the auth server', async ({ page }) => {
    await uiLogin(page, accounts.moderator);
    await expect(page.getByRole('heading', { name: 'Admin Dashboard' })).toBeVisible();
  });

  test('AUTH-05 a user without an admin role is sent to access denied', async ({ page }) => {
    await uiLogin(page, accounts.nonadmin, /\/access-denied$/);
    await expect(page.getByRole('heading', { name: 'Access Denied' })).toBeVisible();
    await expect(page.getByText('Admin or moderator role is required.')).toBeVisible();
    const cookies = await page.context().cookies();
    expect(cookies.find((c) => c.name === 'admin_session')).toBeUndefined();
  });

  test('AUTH-06 a forged session cookie is rejected', async ({ page, context }) => {
    const forged = JSON.stringify({
      user: { id: 'x', email: 'forged@example.com', role: 'super_admin' },
      accessToken: 'a.b.c',
      refreshToken: 'r',
    });
    await context.addCookies([
      { name: 'admin_session', value: encodeURIComponent(forged), url: ADMIN_WEB_URL },
    ]);
    await page.goto('/dashboard');
    await page.waitForURL((url) => url.href.startsWith(OPENAUTH_URL));
    expect(await page.content()).not.toContain('forged@example.com');
  });

  test('AUTH-07 login error codes render a localized message with a retry link', async ({ page }) => {
    await page.goto('/login?error=exchange_failed');
    await expect(page.getByTestId('login-error')).toHaveText('Failed to exchange authorization code');
    await expect(page.getByRole('link', { name: 'Try Again' })).toHaveAttribute('href', '/login');

    await page.goto('/login?error=something-unexpected');
    await expect(page.getByTestId('login-error')).toHaveText('An error occurred');
  });

  test('AUTH-08 a callback this browser did not start is refused (state not bound to it)', async ({ page }) => {
    await page.goto('/api/callback');
    await expect(page).toHaveURL(/\/login\?error=auth_failed$/);
    await expect(page.getByTestId('login-error')).toHaveText('Authentication failed');
  });

  test('AUTH-09 a forged callback with a code is refused without a session', async ({ page, context }) => {
    await page.goto('/api/callback?code=not-a-real-code&state=forged.Lw');
    await expect(page).toHaveURL(/\/login\?error=auth_failed$/);
    await expect(page.getByTestId('login-error')).toBeVisible();
    expect((await context.cookies()).find((c) => c.name === 'admin_session')).toBeUndefined();
  });
});

test.describe('authentication - signed in', () => {
  test('AUTH-10 /login while signed in goes straight to the dashboard', async ({ page }) => {
    await page.goto('/login');
    await expect(page).toHaveURL(/\/dashboard$/);
  });

  test('AUTH-11 home page takes the signed-in admin to the dashboard', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveURL(/\/dashboard$/);
  });
});

test.describe('access denied page', () => {
  test.use({ storageState: storageStatePath('nonadmin') });

  test('AUTH-14 a denied user gets no admin session and cannot reach admin pages', async ({ page, context }) => {
    await page.goto('/access-denied');
    await expect(page.getByRole('heading', { name: 'Access Denied' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Log out' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Go to Main Site' })).toBeVisible();
    expect((await context.cookies()).find((c) => c.name === 'admin_session')).toBeUndefined();
    // Since auth #196 the auth server keeps an SSO session: /dashboard → /login →
    // /authorize answers silently with a code, and the callback checks the role
    // again and refuses. The user goes through the auth server and lands back on
    // access-denied; no admin page renders and no admin session is ever issued.
    const hops: string[] = [];
    page.on('request', (r) => {
      if (r.isNavigationRequest() && r.frame() === page.mainFrame()) hops.push(r.url());
    });
    await page.goto('/dashboard');
    await expect(page).toHaveURL(`${ADMIN_WEB_URL}/access-denied`);
    await expect(page.getByRole('heading', { name: 'Access Denied' })).toBeVisible();
    expect(hops.some((u) => u.startsWith(`${OPENAUTH_URL}/authorize`)), `no auth round trip: ${hops.join(' → ')}`).toBe(true);
    expect((await context.cookies()).find((c) => c.name === 'admin_session')).toBeUndefined();
  });
});

/**
 * Log out is single sign-out (#295): admin-web clears its cookies, then the
 * auth server's /logout ends the shared sign-in and walks every app's
 * front-channel logout before returning here. It revokes that auth browser
 * session, so these tests sign in fresh in an empty context: logging out of
 * the shared storage state would sign out every other test that uses it
 * (AUTH-14 depends on the non-admin's silent sign-in, #417).
 */
test.describe('log out (single sign-out)', () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  /**
   * Clicks a log out control and follows the chain back to the home page,
   * which (signed out) goes straight on to the auth server's sign-in form.
   */
  async function logOutThroughAuthServer(page: Page, click: () => Promise<void>) {
    const hops: string[] = [];
    page.on('request', (r) => {
      if (r.isNavigationRequest() && r.frame() === page.mainFrame()) hops.push(r.url());
    });
    await click();
    await page.waitForURL((u) => u.href.startsWith(OPENAUTH_URL) && !u.pathname.startsWith('/logout'), { timeout: 30_000 });
    await expect(page.locator('input[name="password"]')).toBeVisible();
    expect(hops.some((u) => u.startsWith(`${OPENAUTH_URL}/logout`)), `no auth server sign-out: ${hops.join(' → ')}`).toBe(true);
    expect(hops, `never came back to the home page: ${hops.join(' → ')}`).toContain(`${ADMIN_WEB_URL}/`);

    const cookies = await page.context().cookies([ADMIN_WEB_URL, OPENAUTH_URL]);
    expect(cookies.find((c) => c.name === 'admin_session')).toBeUndefined();
    expect(cookies.find((c) => c.name === '__session' && c.value)).toBeUndefined();

    // The shared sign-in is gone: signing in again asks for the password
    await page.goto('/login');
    await page.waitForURL((u) => u.href.startsWith(OPENAUTH_URL), { timeout: 30_000 });
    await expect(page.locator('input[name="password"]')).toBeVisible();
  }

  test('AUTH-12 logout from the nav signs out everywhere', async ({ page }) => {
    await uiLogin(page, accounts.admin);
    await logOutThroughAuthServer(page, () => page.getByTestId('logout-button').click());
  });

  test('AUTH-13 logout endpoint answers 303 to the auth server sign-out (no form re-POST)', async ({ request }) => {
    const response = await request.post('/api/logout', { maxRedirects: 0 });
    expect(response.status()).toBe(303);
    const location = new URL(response.headers()['location']);
    expect(location.origin + location.pathname).toBe(`${OPENAUTH_URL}/logout`);
    expect(location.searchParams.get('return')).toBe(`${ADMIN_WEB_URL}/`);
  });

  test('AUTH-15 log out from access denied signs out everywhere and returns to the public home page', async ({ page }) => {
    await uiLogin(page, accounts.nonadmin, /\/access-denied$/);
    await logOutThroughAuthServer(page, () => page.getByRole('button', { name: 'Log out' }).click());
  });
});
