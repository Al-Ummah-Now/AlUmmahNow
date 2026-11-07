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

  test('AUTH-02 home page offers a login link when signed out', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Al Ummah Now');
    await expect(page.getByRole('link', { name: 'Log in' })).toHaveAttribute('href', '/login');
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

  test('AUTH-08 callback without a code reports no_code', async ({ page }) => {
    await page.goto('/api/callback');
    await expect(page).toHaveURL(/\/login\?error=no_code$/);
    await expect(page.getByTestId('login-error')).toHaveText('Authorization code not received');
  });

  test('AUTH-09 callback with an invalid code reports exchange_failed', async ({ page }) => {
    await page.goto('/api/callback?code=not-a-real-code');
    await expect(page).toHaveURL(/\/login\?error=(exchange_failed|auth_failed)$/);
    await expect(page.getByTestId('login-error')).toBeVisible();
  });
});

test.describe('authentication - signed in', () => {
  test('AUTH-10 /login while signed in goes straight to the dashboard', async ({ page }) => {
    await page.goto('/login');
    await expect(page).toHaveURL(/\/dashboard$/);
  });

  test('AUTH-11 home page greets the signed-in admin', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByTestId('welcome')).toContainText(accounts.admin.email);
    await expect(page.getByRole('link', { name: 'Go to Dashboard' })).toBeVisible();
  });

  test('AUTH-12 logout from the nav clears the session', async ({ browser }) => {
    // Own context so the shared admin storage state is not affected
    const context = await browser.newContext({ storageState: storageStatePath('admin') });
    const page = await context.newPage();
    await page.goto('/dashboard');
    await page.getByTestId('logout-button').click();
    await expect(page).toHaveURL(`${ADMIN_WEB_URL}/`);
    await expect(page.getByRole('link', { name: 'Log in' })).toBeVisible();
    const cookies = await context.cookies();
    expect(cookies.find((c) => c.name === 'admin_session')).toBeUndefined();
    await context.close();
  });

  test('AUTH-13 logout endpoint answers with 303 (no form re-POST)', async ({ request }) => {
    const response = await request.post('/api/logout', { maxRedirects: 0 });
    expect(response.status()).toBe(303);
    expect(response.headers()['location']).toMatch(/\/$/);
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
    // The auth server keeps no SSO session, so this asks for credentials again
    await page.goto('/dashboard');
    await page.waitForURL((url) => url.href.startsWith(OPENAUTH_URL));
  });

  test('AUTH-15 log out from access denied returns to the public home page', async ({ page }) => {
    await page.goto('/access-denied');
    await page.getByRole('button', { name: 'Log out' }).click();
    await expect(page).toHaveURL(`${ADMIN_WEB_URL}/`);
    await expect(page.getByRole('link', { name: 'Log in' })).toBeVisible();
  });
});
