/**
 * Release regression: "if you are signed in, you are signed in" across every
 * Al Ummah Now app.
 *
 * Owner requirement (2026-11-09): after signing in once, every app opens
 * signed in: no password form, no account chooser, no "Please log in" /
 * "Sign in" page. Apps the user has no role for show their "no access" view,
 * never a sign-in prompt. Every app's account menu lists all the browser's
 * accounts (auth server /session/accounts), and switching in one app makes
 * the next app open as that account. Single sign-out signs every app out and
 * nothing signs back in by itself.
 *
 * Seen on QA before the fix: admin-web showed "Please log in to access the
 * admin panel [Log in]", the auth admin and profile apps showed their sign-in
 * landing pages, www showed "Sign in" in its header. Only the CMS was right.
 *
 * Some apps get their fix from other repositories (www: AlUmmahNowUI; auth
 * admin and profile: AlUmmahNowAuth; the auth server's CORS for *.qa) and
 * this repository's own apps are only deployed to QA after merge. On a pull
 * request, an app whose deployed build still behaves the old way is skipped
 * (detected by behaviour, recorded as an annotation) instead of failing the
 * run. Stage release runs never skip: there every app must pass.
 */
import { test, expect, type APIRequestContext, type BrowserContext, type Page } from '@playwright/test';
import { clickAccountMenuItem } from './account-menu';
import { sinkEmail, target } from './targets';
import { completeRegistration, createProfile, signUpOnWeb, type WebUser } from './web-session';

// This file signs users in through the auth server: its traces would hold the
// typed password and email code (fillSecret args, form POST bodies). Trace off.
test.use({ trace: 'off' });

const ON_PULL_REQUEST = process.env.GITHUB_EVENT_NAME === 'pull_request';

/**
 * `fixed` must hold. On a pull request an app whose deployed build lacks the
 * fix is skipped (returns false, the caller skips that app's checks); on any
 * other run it fails the test.
 */
function requireFixed(app: string, fixed: boolean, problem: string): boolean {
  if (fixed) return true;
  if (ON_PULL_REQUEST) {
    test.info().annotations.push({ type: 'skipped-app', description: `${app}: ${problem} (fix not deployed on the target yet)` });
    return false;
  }
  expect(fixed, `${app}: ${problem}`).toBe(true);
  return false;
}

/** Waits until the main frame stops navigating (silent sign-ins hop through the auth server). */
async function settle(page: Page, quietMs = 2500, timeoutMs = 30000): Promise<void> {
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

/** The auth server's password form or account chooser is on screen. */
async function onAuthPrompt(page: Page): Promise<boolean> {
  const url = new URL(page.url());
  if (url.pathname.includes('select-account')) return true;
  if (url.origin !== target().auth) return false;
  return page.locator('input[name="password"]').isVisible().catch(() => false);
}

/** A visible "Log in" / "Sign in" button or link (an interstitial or a signed-out header). */
async function signInPromptVisible(page: Page): Promise<boolean> {
  const prompt = page
    .locator('a:visible, button:visible')
    .filter({ hasText: /^\s*(log ?in|sign ?in|admin sign in|تسجيل الدخول)\s*$/i });
  return (await prompt.count().catch(() => 0)) > 0;
}

async function expectNoAuthPrompt(page: Page, app: string): Promise<void> {
  expect(await onAuthPrompt(page), `${app}: asked for a password / account choice at ${page.url()}`).toBe(false);
}

interface BrowserAccount {
  userId: string;
  email: string;
  isActive: boolean;
}

/** The browser's accounts on the auth server (same cookies as the pages). */
async function authAccounts(request: APIRequestContext): Promise<BrowserAccount[]> {
  const res = await request.get(`${target().auth}/session/accounts`, { failOnStatusCode: false });
  if (res.status() === 401) return [];
  expect(res.ok(), `GET /session/accounts: ${res.status()}`).toBe(true);
  return ((await res.json()) as { accounts?: BrowserAccount[] }).accounts ?? [];
}

/** The videos site's active account ('' when signed out there). */
async function videosUserId(page: Page): Promise<string> {
  if (new URL(page.url()).origin !== target().web) await open(page, `${target().web}/en`);
  return page
    .evaluate(async () => {
      const res = await fetch('/api/auth/token', { credentials: 'same-origin', cache: 'no-store' }).catch(() => null);
      const body = res?.ok ? ((await res.json().catch(() => ({}))) as { accessToken?: string | null; userId?: string }) : {};
      return body.accessToken ? body.userId ?? '' : '';
    })
    .catch(() => '');
}

async function addConsent(context: BrowserContext): Promise<void> {
  await context.addCookies([{ name: 'aun_consent', value: `v1.a0.e0.p0.${Date.now()}`, url: target().web, sameSite: 'Lax' }]);
}

/** Opens the videos header's account menu (retried until the header has hydrated). */
async function openVideosMenu(page: Page): Promise<void> {
  const rows = page.locator('[data-testid="nav-account"]:visible');
  // Accounts live in a submenu; builds before it list them on the first level
  const submenu = page.locator('[data-testid="nav-switch-account"]:visible');
  await expect(async () => {
    if (!(await rows.first().isVisible())) {
      if (!(await submenu.first().isVisible())) await page.locator('[data-testid="nav-menu-trigger"]:visible').first().click();
      await rows.or(submenu).first().waitFor({ timeout: 3000 });
      if (await submenu.first().isVisible()) await submenu.first().click();
    }
    await expect(rows.first()).toBeVisible({ timeout: 3000 });
  }).toPass({ timeout: 30000 });
}

async function videosMenuAccounts(page: Page): Promise<Array<{ email: string; active: boolean }>> {
  await open(page, `${target().web}/en`);
  await openVideosMenu(page);
  // The list from the auth server arrives after the local one: let it land
  await page.waitForTimeout(1500);
  return page.locator('[data-testid="nav-account"]:visible').evaluateAll((rows) =>
    rows.map((row) => {
      const el = row as HTMLElement;
      // data-email is new; older builds only show it as a line of text
      const fromText = el.innerText.split('\n').map((line) => line.trim()).find((line) => line.includes('@')) ?? '';
      return { email: el.dataset.email || fromText, active: el.dataset.active === 'true' };
    }),
  );
}

/**
 * admin-web's account menu rows, or null when the deployed admin-web has no
 * account menu yet. A fresh sink user has no admin role, so admin-web opens
 * on /access-denied (with the menu there).
 */
async function adminMenuAccounts(page: Page): Promise<Array<{ email: string; active: boolean }> | null> {
  await open(page, `${target().adminWeb}/`);
  const trigger = page.locator('[data-testid="account-menu-trigger"]:visible').first();
  if (!(await trigger.isVisible().catch(() => false))) return null;
  await trigger.click();
  const rows = page.locator('[data-testid="account-menu-account"]');
  await expect(rows.first()).toBeVisible({ timeout: 10000 });
  await page.waitForTimeout(1500);
  return rows.evaluateAll((els) =>
    els.map((el) => ({ email: (el as HTMLElement).dataset.email ?? '', active: (el as HTMLElement).dataset.active === 'true' })),
  );
}

/** Registers user A on videos (with a videos profile) and returns it. */
async function signUpA(page: Page, prefix: string): Promise<WebUser> {
  const a = await signUpOnWeb(page, prefix);
  await createProfile(a);
  return a;
}

/** Videos header → Add another account (prompt=login) → register B. */
async function addAccountB(page: Page, prefix: string): Promise<WebUser> {
  await open(page, `${target().web}/en`);
  await openVideosMenu(page);
  await clickAccountMenuItem(page, 'nav-add-account');
  await expect(page.locator('input[name="password"]')).toBeVisible({ timeout: 20000 });
  const email = sinkEmail(prefix);
  await completeRegistration(page, email);
  await page.waitForURL((u) => u.origin === target().web && !u.pathname.startsWith('/api/'), { timeout: 30000 });
  const userId = await videosUserId(page);
  const b: WebUser = { email, userId, accessToken: '' };
  const token = await page.evaluate(async () => ((await (await fetch('/api/auth/token')).json()) as { accessToken?: string }).accessToken ?? '');
  b.accessToken = token;
  await createProfile(b);
  return b;
}

test.describe('Release: signed in everywhere', () => {
  test.beforeEach(async ({ context }) => {
    await addConsent(context);
  });

  test('one sign-in on videos: every app opens signed in, without a form, a chooser or a sign-in page', async ({ page, context }) => {
    const a = await signUpA(page, 'rel-everywhere');

    // www: the header signs in by itself (client probe), no "Sign in"
    await open(page, `${target().www}/en`);
    await expectNoAuthPrompt(page, 'www');
    const wwwSignedIn = await expect
      .poll(() => signInPromptVisible(page), { timeout: 15000 })
      .toBe(false)
      .then(() => true, () => false);
    requireFixed('www', wwwSignedIn, 'header still shows "Sign in"');

    // admin-web: no "Please log in" page; a user without the role sees Access Denied
    await open(page, `${target().adminWeb}/`);
    await expectNoAuthPrompt(page, 'admin-web');
    if (requireFixed('admin-web', page.url().startsWith(`${target().adminWeb}/access-denied`), `shows ${page.url()} instead of signing in`)) {
      await expect(page.locator('h1')).toBeVisible();
      expect(await signInPromptVisible(page), 'admin-web: sign-in prompt on the access denied page').toBe(false);
    }

    // auth admin: no "Admin Sign In" landing page
    await open(page, target().authAdmin);
    await expectNoAuthPrompt(page, 'auth admin');
    requireFixed('auth admin', !(await signInPromptVisible(page)), 'shows its sign-in landing page');

    // profile: signed in, not the "Sign In" landing page
    await open(page, target().profile);
    await expectNoAuthPrompt(page, 'profile');
    const profileSignedOut =
      (await page.locator('#loggedOutView').isVisible().catch(() => false)) || (await signInPromptVisible(page));
    requireFixed('profile', !profileSignedOut, 'shows its "Sign In" landing page');

    // cms: signs in silently; a user without the role sees "No access"
    await open(page, `${target().cms}/`);
    await expectNoAuthPrompt(page, 'cms');
    if (requireFixed('cms', new URL(page.url()).origin === target().cms && !(await signInPromptVisible(page)), `shows ${page.url()}`)) {
      await expect(page).toHaveURL(/\/sso\/no-access/);
    }

    // videos: still signed in as A
    expect(await videosUserId(page)).toBe(a.userId);

    // videos without its own session (signed in elsewhere only): the client
    // probe signs it in silently as A and stays on the page
    await context.clearCookies({ domain: new URL(target().web).hostname });
    await addConsent(context);
    const probePage = await context.newPage(); // fresh tab: the probe has not run here
    await open(probePage, `${target().web}/en/explore`);
    await expectNoAuthPrompt(probePage, 'videos');
    let probed = '';
    await expect.poll(async () => (probed = await videosUserId(probePage)), { timeout: 20000 }).not.toBe('').catch(() => {});
    if (requireFixed('videos', probed !== '', 'not signed in silently without its own session')) {
      expect(probed).toBe(a.userId);
      expect(new URL(probePage.url()).pathname).toBe('/en/explore');
    }
  });

  test('two accounts: every app opens as the active one, menus list both, a switch in one app carries to the next', async ({ page }) => {
    const a = await signUpA(page, 'rel-everywhere-a');
    const b = await addAccountB(page, 'rel-everywhere-b');
    expect(b.userId).not.toBe(a.userId);

    // The auth server holds both; B (just added) is active
    const both = await authAccounts(page.context().request);
    expect(both.map((x) => x.userId).sort()).toEqual([a.userId, b.userId].sort());
    expect(both.find((x) => x.isActive)?.userId).toBe(b.userId);

    // admin-web opens as B without the account chooser, and its menu lists A and B
    await open(page, `${target().adminWeb}/`);
    await expectNoAuthPrompt(page, 'admin-web');
    const adminRows = await adminMenuAccounts(page);
    if (requireFixed('admin-web', !!adminRows && adminRows.length >= 2, `account menu lists ${JSON.stringify(adminRows)}`)) {
      expect(adminRows).toEqual(expect.arrayContaining([{ email: a.email, active: false }, { email: b.email, active: true }]));
    }

    // cms opens without a form or chooser too
    await open(page, `${target().cms}/`);
    await expectNoAuthPrompt(page, 'cms');

    // videos menu lists both (from the auth server, merged with its own sessions)
    const videoRows = await videosMenuAccounts(page);
    expect(videoRows).toEqual(expect.arrayContaining([{ email: a.email, active: false }, { email: b.email, active: true }]));

    // Switch to A on videos: the auth server's active account follows ...
    // (older builds have no data-email: there A is the only inactive row)
    const rowA = page.locator(`[data-testid="nav-account"][data-email="${a.email}"]:visible`);
    const switchRow = (await rowA.count()) > 0 ? rowA : page.locator('[data-testid="nav-account"][data-active="false"]:visible');
    await switchRow.locator('button').first().click();
    await expect.poll(() => videosUserId(page), { timeout: 20000 }).toBe(a.userId);
    const activeAfterVideosSwitch = (await authAccounts(page.context().request)).find((x) => x.isActive)?.userId;
    if (requireFixed('videos', activeAfterVideosSwitch === a.userId, 'switching account does not switch it on the auth server')) {
      // ... so admin-web opens as A
      const rows = await adminMenuAccounts(page);
      if (rows && rows.length >= 2) expect(rows.find((r) => r.active)?.email).toBe(a.email);
    }

    // Switch to B in admin-web: the next app (videos) opens as B
    const adminNow = await adminMenuAccounts(page);
    if (adminNow && adminNow.length >= 2) {
      await page.locator(`[data-testid="account-menu-account"][data-email="${b.email}"] [data-testid="account-switch"]`).click();
      await page.waitForURL((u) => u.origin === target().adminWeb && u.pathname === '/access-denied', { timeout: 30000 });
      await settle(page);
      expect(await onAuthPrompt(page)).toBe(false);
      expect((await authAccounts(page.context().request)).find((x) => x.isActive)?.userId).toBe(b.userId);
      await open(page, `${target().web}/en`);
      let followed = '';
      await expect.poll(async () => (followed = await videosUserId(page)), { timeout: 20000 }).toBe(b.userId).catch(() => {});
      requireFixed('videos', followed === b.userId, 'does not follow an account switch made in another app');
    }
  });

  test('single sign-out: admin-web asks for the password, www and videos stay signed out', async ({ page, context }) => {
    await signUpA(page, 'rel-everywhere-out');

    // Header → account menu → Sign out (the only account: single sign-out)
    await open(page, `${target().web}/en`);
    const signOut = page.locator('[data-testid="nav-sign-out"]:visible').first();
    await expect(async () => {
      if (!(await signOut.isVisible())) await page.locator('[data-testid="nav-menu-trigger"]:visible').first().click();
      await expect(signOut).toBeVisible({ timeout: 3000 });
    }).toPass({ timeout: 30000 });
    const backHome = page.waitForRequest(
      (r) => r.isNavigationRequest() && r.url().startsWith(target().web) && (r.redirectedFrom()?.url().startsWith(`${target().auth}/logout`) ?? false),
      { timeout: 45000 },
    );
    await signOut.click();
    await backHome;
    await settle(page);
    expect((await authAccounts(context.request)).length, 'the auth server still has accounts').toBe(0);

    // admin-web: the auth server's sign-in form (no interstitial, no silent sign-in)
    await open(page, `${target().adminWeb}/`);
    if (requireFixed('admin-web', new URL(page.url()).origin === target().auth, `shows ${page.url()} instead of the sign-in form`)) {
      await expect(page.locator('input[name="password"]')).toBeVisible();
    }

    // Fresh tabs (the probe runs again): www and videos stay anonymous, nothing
    // goes through the auth server's /authorize by itself
    for (const url of [`${target().web}/en`, `${target().www}/en`]) {
      const tab = await context.newPage();
      const authorizeHops: string[] = [];
      tab.on('request', (r) => {
        if (r.isNavigationRequest() && r.url().startsWith(`${target().auth}/authorize`)) authorizeHops.push(r.url());
      });
      await open(tab, url);
      await tab.waitForTimeout(3000);
      expect(authorizeHops, `${url} signed back in by itself`).toEqual([]);
      expect(new URL(tab.url()).origin).toBe(new URL(url).origin);
      if (url.startsWith(target().web)) expect(await videosUserId(tab)).toBe('');
      await tab.close();
    }
  });
});
