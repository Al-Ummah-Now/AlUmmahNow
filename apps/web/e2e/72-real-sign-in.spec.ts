import type { Page } from '@playwright/test';
import { test, expect } from './fixtures';
import { ANONYMOUS_STATE } from './test-utils/auth-state';
import { SINK_DOMAIN } from './test-utils/code-sink';
import { e2eUserPassword } from './test-utils/user-password';
import { fillSecret } from './release/secret-fill';

/**
 * The real sign-in path a visitor takes, in every browser project: account
 * menu → auth server form → /api/callback → signed-in header. Sign-out, then
 * sign-in again. Storage-state fixtures skip all of this, so they cannot see a
 * broken callback or a cookie a browser refuses.
 */
const stamp = process.env.E2E_USERS_TIMESTAMP;
const email = process.env.E2E_SIGNIN_EMAIL ?? (stamp ? `test-single-${stamp}@${SINK_DOMAIN}` : undefined);
// Read when signing in, so collecting this file never needs the secret
const password = () => process.env.E2E_SIGNIN_PASSWORD ?? e2eUserPassword();

async function openMenu(page: Page): Promise<void> {
  const trigger = page.locator('[data-testid="nav-menu-trigger"]:visible').first();
  await expect(async () => {
    if ((await trigger.getAttribute('aria-expanded')) !== 'true') await trigger.click();
    await expect(trigger).toHaveAttribute('aria-expanded', 'true', { timeout: 2000 });
  }).toPass({ timeout: 30000 });
}

async function signIn(page: Page): Promise<void> {
  await openMenu(page);
  await page.getByRole('menuitem', { name: 'Sign In' }).click();
  await page.waitForSelector('input[name="email"]', { timeout: 30000 });
  await page.fill('input[name="email"]', email as string);
  await fillSecret(page.locator('input[name="password"]'), password());
  await page.locator('button[data-component="button"]').click();
  await page.waitForURL((url: URL) => !url.pathname.startsWith('/password') && !url.pathname.startsWith('/api/'), { timeout: 45000 });
  await page.waitForLoadState('load');
}

async function expectToken(page: Page, signedIn: boolean): Promise<void> {
  await expect(async () => {
    const hasToken = await page.evaluate(async () => {
      const res = await fetch('/api/auth/token', { credentials: 'same-origin', cache: 'no-store' });
      if (!res.ok) return false;
      return !!((await res.json().catch(() => ({}))) as { accessToken?: string | null }).accessToken;
    });
    expect(hasToken).toBe(signedIn);
  }).toPass({ timeout: 20000 });
}

// fillSecret's argument would land in a trace
test.use({ trace: 'off' });

test.describe('Real sign-in', () => {
  test.use({ storageState: ANONYMOUS_STATE });
  test.skip(!email, 'Needs E2E_USERS_TIMESTAMP or E2E_SIGNIN_EMAIL');

  test('AUTH-REAL signs in, survives a reload, signs out and signs in again', async ({ page }) => {
    test.setTimeout(180000);
    await page.goto('/en');
    await expectToken(page, false);

    await signIn(page);
    await expectToken(page, true);
    await page.reload();
    await expectToken(page, true);

    await openMenu(page);
    await page.locator('[data-testid="nav-sign-out"]:visible').first().click();
    await page.waitForURL(/\/en\/?$/, { timeout: 45000 });
    await page.waitForLoadState('load');
    await expectToken(page, false);

    await signIn(page);
    await expectToken(page, true);
  });
});
