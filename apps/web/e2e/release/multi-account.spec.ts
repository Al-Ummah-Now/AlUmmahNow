/**
 * Release regression: two accounts signed in at once on the videos site.
 *
 * Owner report (2026-11-08): "the account switcher only shows one user while
 * I am signed in with two". Two causes, both reproduced on QA:
 * - "Add another account" never asked for credentials: the auth server's
 *   shared sign-in (__session) answered /authorize with a code for the account
 *   already signed in. addUserAccount() now sends prompt=login.
 * - Two accounts did not fit in one cookie (~4.4 KB URL-encoded), and the
 *   browser silently dropped it. The session is now split across
 *   al_ummah_session, al_ummah_session.1, ...
 *
 * Signing out of one account keeps the others (#308: only the last account's
 * sign-out ends the shared sign-in; single-sign-out.spec.ts covers that).
 *
 * On a pull request the target is the already-deployed QA build: until the
 * fix is deployed there, PR runs skip (detected by the add-account authorize
 * lacking prompt=login). Stage release runs never skip.
 */
import { test, expect, type Page } from '@playwright/test';
import { sinkEmail, target } from './targets';
import { completeRegistration, createProfile, expectNoErrorHop, recordNavigations, signUpOnWeb, webAccessToken } from './web-session';

// This file signs users in through the auth server: its traces would hold the
// typed password and email code (fillSecret args, form POST bodies). Trace off.
test.use({ trace: 'off' });

const BROWSER_COOKIE_LIMIT = 4096;

/** Opens the header's account menu (retried until the header has hydrated). */
async function openAccountMenu(page: Page): Promise<void> {
  const accounts = page.locator('[data-testid="nav-account"]:visible');
  await expect(async () => {
    if (!(await accounts.first().isVisible())) await page.locator('[data-testid="nav-menu-trigger"]:visible').first().click();
    await expect(accounts.first()).toBeVisible({ timeout: 3000 });
  }).toPass({ timeout: 30000 });
}

/**
 * Creates channels for the active account in the account menu (which also
 * reloads the session's channel list). Channels are what made two accounts
 * overflow one cookie on prod: each is cached in the session.
 */
async function createChannelsInMenu(page: Page, prefix: string, count: number): Promise<void> {
  for (let i = 1; i <= count; i++) {
    await page.goto(`${target().web}/en`, { waitUntil: 'load' });
    await openAccountMenu(page);
    await page.locator('[data-testid="nav-create-channel"]:visible').first().click();
    const nameInput = page.locator('[role="menu"] input[type="text"]:visible').first();
    await nameInput.fill(`Release E2E ${prefix} channel ${i} ${Date.now().toString(36)}`);
    await nameInput.press('Enter');
    // The form closes once the channel exists and the session's channels are reloaded
    await expect(nameInput).toBeHidden({ timeout: 30000 });
  }
}

/** The switcher's accounts: email and whether it is the active one. */
async function switcherAccounts(page: Page): Promise<Array<{ email: string; active: boolean }>> {
  await page.goto(`${target().web}/en`, { waitUntil: 'load' });
  await openAccountMenu(page);
  return page.locator('[data-testid="nav-account"]:visible').evaluateAll((rows) =>
    rows.map((row) => ({
      // innerText keeps the name, email and channel count on separate lines
      email: (row as HTMLElement).innerText.split('\n').map((line) => line.trim()).find((line) => line.includes('@')) ?? '',
      active: (row as HTMLElement).dataset.active === 'true',
    })),
  );
}

/** The active account's user id from the same-origin token endpoint ('' when signed out). */
async function activeUserId(page: Page): Promise<string> {
  if (new URL(page.url()).origin !== target().web) return '';
  return page.evaluate(async () => {
    const res = await fetch('/api/auth/token', { credentials: 'same-origin', cache: 'no-store' }).catch(() => null);
    const body = res?.ok ? ((await res.json().catch(() => ({}))) as { accessToken?: string | null; userId?: string }) : {};
    return body.accessToken ? body.userId ?? '' : '';
  }).catch(() => '');
}

/** Every session cookie the browser kept fits the per-cookie limit. */
async function expectSessionCookiesFit(page: Page): Promise<string[]> {
  const cookies = (await page.context().cookies(target().web)).filter((c) => /^al_ummah_session(\.\d+)?$/.test(c.name));
  for (const c of cookies) expect(`${c.name}=${c.value}`.length, c.name).toBeLessThanOrEqual(BROWSER_COOKIE_LIMIT);
  return cookies.map((c) => c.name).sort();
}

test.describe('Release: several accounts at once', () => {
  // Consent already answered: the banner otherwise covers the account menu's last item
  test.beforeEach(async ({ context }) => {
    await context.addCookies([{ name: 'aun_consent', value: `v1.a0.e0.p0.${Date.now()}`, url: target().web, sameSite: 'Lax' }]);
  });

  test('add a second account: the switcher lists both, switching works, signing out of one keeps the other', async ({ page }) => {
    const a = await signUpOnWeb(page, 'rel-multi-a');
    await createProfile(a);
    await createChannelsInMenu(page, 'A', 3);

    // Header → account menu → Add another account
    await page.goto(`${target().web}/en`, { waitUntil: 'load' });
    await openAccountMenu(page);
    const authorize = page.waitForRequest((r) => r.url().startsWith(`${target().auth}/authorize`), { timeout: 30000 });
    await page.locator('[data-testid="nav-add-account"]:visible').first().click();
    const prompt = new URL((await authorize).url()).searchParams.get('prompt');
    if (process.env.GITHUB_EVENT_NAME === 'pull_request') {
      test.skip(prompt !== 'login', 'the add-account fix is not deployed on the target yet (it lands with the PR that adds it)');
    }
    expect(prompt, 'add-account must ask for credentials').toBe('login');

    // The auth server asks for credentials (no silent sign-in as A): register B
    await expect(page.locator('input[name="password"]')).toBeVisible({ timeout: 20000 });
    const navigations = recordNavigations(page);
    const bEmail = sinkEmail('rel-multi-b');
    await completeRegistration(page, bEmail);
    await page.waitForURL((u) => u.origin === target().web && !u.pathname.startsWith('/api/'), { timeout: 30000 });
    expectNoErrorHop(navigations);
    const b = { email: bEmail, ...(await webAccessToken(page)) };
    expect(b.userId).not.toBe(a.userId);
    await createProfile(b);
    await createChannelsInMenu(page, 'B', 3);

    // Both accounts are stored, in cookies the browser accepts (with their
    // channels they need more than one cookie); B is active
    expect(await expectSessionCookiesFit(page)).toContain('al_ummah_session.1');
    expect(await switcherAccounts(page)).toEqual(
      expect.arrayContaining([
        { email: a.email, active: false },
        { email: b.email, active: true },
      ]),
    );

    // Switch to A
    await page.locator('[data-testid="nav-account"][data-active="false"]:visible button').first().click();
    await expect.poll(() => activeUserId(page), { timeout: 20000 }).toBe(a.userId);
    expect((await switcherAccounts(page)).find((x) => x.active)?.email).toBe(a.email);

    // Sign out of A: B stays signed in, without going through the auth server
    const hops: string[] = [];
    page.on('request', (r) => {
      if (r.isNavigationRequest() && r.frame() === page.mainFrame()) hops.push(r.url());
    });
    await page.locator('[data-testid="nav-sign-out"]:visible').first().click();
    await expect.poll(() => activeUserId(page), { timeout: 20000 }).toBe(b.userId);
    expect(hops.some((u) => u.startsWith(`${target().auth}/logout`)), `signed out everywhere: ${hops.join(' → ')}`).toBe(false);
    expect(await switcherAccounts(page)).toEqual([{ email: b.email, active: true }]);
    // One account fits one cookie again: the extra chunk was removed
    expect(await expectSessionCookiesFit(page)).toEqual(['al_ummah_session']);
  });
});
