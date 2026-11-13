/**
 * Registering accounts on the auth server for the suite: the run accounts of
 * run mode (global-setup.ts) and the throwaway subject of 12-auth-requests.
 * Sign-up codes come from the auth server's E2E code sink (addresses at
 * @e2e.alummahnow.net on QA and stage), read with E2E_CODE_SINK_SECRET.
 */
import { expect, type Browser } from '@playwright/test';
import { ADMIN_WEB_URL, OPENAUTH_URL, RUN_ID } from './env';
import { recordRunAccount } from './cleanup';
import { fillSecret } from './secret-fill';

function sinkSecret(): string {
  const secret = process.env.E2E_CODE_SINK_SECRET;
  if (!secret) throw new Error('E2E_CODE_SINK_SECRET is not set: registering a sink user needs the auth server code sink');
  return secret;
}

async function sinkCode(email: string): Promise<string> {
  for (let i = 0; i < 40; i++) {
    const res = await fetch(`${OPENAUTH_URL}/test/email/${encodeURIComponent(email)}?consume=1`, { headers: { 'X-E2E-Secret': sinkSecret() } });
    if (res.ok) {
      const { code } = (await res.json()) as { code?: string };
      if (code) return code;
    } else if (res.status !== 404) {
      throw new Error(`E2E code sink answered ${res.status}`);
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`No sign-up code for ${email}`);
}

/**
 * Registers `email` through the auth server's sign-up form (as a person would,
 * starting from admin-web's login) in its own context; returns its auth user
 * id. The new account has no admin role, so admin-web ends on access denied.
 */
export async function registerSinkUser(browser: Browser, email: string, password: string): Promise<{ id: string; email: string }> {
  const context = await browser.newContext({ baseURL: ADMIN_WEB_URL, storageState: { cookies: [], origins: [] } });
  try {
    const page = await context.newPage();
    await page.goto('/login');
    await page.waitForURL((url) => url.href.startsWith(OPENAUTH_URL));
    await page.click('a:has-text("Register")');
    await page.locator('input[name="email"]').fill(email);
    await fillSecret(page.locator('input[name="password"]'), password);
    await fillSecret(page.locator('input[name="repeat"]'), password);
    await page.locator('button[data-component="button"]:not([type="button"])').click();
    await expect(page.locator('input[name="code"]')).toBeVisible({ timeout: 20_000 });
    await fillSecret(page.locator('input[name="code"]'), await sinkCode(email));
    await page.locator('button[data-component="button"]:not([type="button"])').click();
    await page.waitForURL((url) => url.pathname === '/access-denied', { timeout: 45_000 });
    const res = await page.request.get(`${OPENAUTH_URL}/session/accounts`);
    const { accounts: signedIn } = (await res.json()) as { accounts: Array<{ userId: string; email: string }> };
    const me = signedIn.find((a) => a.email.toLowerCase() === email.toLowerCase());
    if (!me) throw new Error(`${email} has no auth session after registering`);
    // The global teardown erases and deletes every account of the job
    if (RUN_ID) recordRunAccount(email, me.userId);
    return { id: me.userId, email };
  } finally {
    await context.close();
  }
}

/**
 * Gives a registered user the auth server's admin role (role_admin, the same
 * RBAC role the seeded QA admin has). Tokens carry roles from sign-in, so sign
 * in after this, never before.
 */
export async function promoteToAdmin(email: string): Promise<void> {
  const promoteSecret = process.env.TEST_PROMOTE_SECRET;
  if (!promoteSecret) throw new Error('TEST_PROMOTE_SECRET is not set: run mode promotes its own admin account');
  const res = await fetch(`${OPENAUTH_URL}/test/promote/${encodeURIComponent(email)}`, {
    method: 'POST',
    headers: { 'X-Test-Secret': promoteSecret, 'X-E2E-Secret': sinkSecret() },
  });
  if (!res.ok) throw new Error(`Promoting ${email} to admin failed: ${res.status}`);
}
