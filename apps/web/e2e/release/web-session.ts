/**
 * Web app session helpers for the release suite. Every spec registers its own
 * sink user through the real UI and OAuth round trip; nothing is seeded.
 */
import { appendFileSync } from 'node:fs';
import { expect, type Locator, type Page } from '@playwright/test';
import { fillSecret } from './secret-fill';
import { fetchRetry } from './net';
import { readSinkCode } from './sink';
import { sinkEmail, target, TEST_PASSWORD } from './targets';

export type Locale = 'en' | 'ar';

export interface WebUser {
  email: string;
  accessToken: string;
  userId: string;
}

/**
 * page.goto that waits out a navigation the app is still making on its own
 * (after the sign-in callback the web app replaces the URL once more; WebKit
 * reports a goto started meanwhile as "interrupted by another navigation").
 * Only that error is retried, once, after the page has loaded.
 */
export async function gotoSettled(page: Page, url: string): Promise<void> {
  await page.waitForLoadState('load');
  try {
    await page.goto(url);
  } catch (e) {
    if (!/interrupted by another navigation/.test(String(e))) throw e;
    await page.waitForLoadState('load');
    await page.goto(url);
  }
}

/** Records every main-frame navigation so a bounce through an error page is caught. */
export function recordNavigations(page: Page): string[] {
  const urls: string[] = [];
  page.on('framenavigated', (frame) => {
    if (frame === page.mainFrame()) urls.push(frame.url());
  });
  return urls;
}

export function expectNoErrorHop(urls: string[]): void {
  const bad = urls.filter((u) => {
    const url = new URL(u);
    return url.searchParams.has('error') || /\/(auth\/)?error\b/.test(url.pathname);
  });
  expect(bad, `navigation went through an error: ${bad.join(' → ')}`).toEqual([]);
}

/**
 * Waits until React has hydrated `locator`'s element (its event handlers are
 * attached): React keeps the props of every element it hydrated under a
 * `__reactProps$<id>` key. A click on server-rendered markup before that is
 * lost or becomes a full page load. Web-first: no sleeps, no networkidle.
 */
export async function expectHydrated(locator: Locator, timeout = 30000): Promise<void> {
  await expect(locator).toBeVisible({ timeout });
  await expect
    .poll(() => locator.evaluate((el) => Object.keys(el).some((k) => k.startsWith('__reactProps$'))).catch(() => false), {
      message: 'the element was never hydrated by React',
      timeout,
    })
    .toBe(true);
}

/**
 * The header's account menu trigger. It renders once the client has loaded the
 * session (a pulse placeholder before that), so it is also the header's
 * "hydrated and session known" marker.
 */
export function menuTrigger(page: Page) {
  return page.locator('[data-testid="nav-menu-trigger"]:visible').first();
}

/**
 * Opens the header's account menu until `item` shows (a click before the
 * header's handlers are attached is dropped, so it is retried, never slept on).
 */
export async function openMenuUntil(page: Page, item: Locator, timeout = 45000): Promise<void> {
  await expect(async () => {
    if (!(await item.isVisible())) {
      const back = page.locator('[data-testid="nav-menu-back"]:visible').first();
      if (await back.isVisible()) await back.click({ timeout: 5000 });
      else await menuTrigger(page).click({ timeout: 10000 });
    }
    await expect(item).toBeVisible({ timeout: 3000 });
  }).toPass({ timeout });
}

/** Opens the anonymous menu and starts sign-in (the login() server action). */
export async function startSignIn(page: Page, locale: Locale): Promise<void> {
  await page.goto(`${target().web}/${locale}`);
  const signIn = page.locator('[role="menu"] form button[type="submit"]:visible').first();
  await openMenuUntil(page, signIn);
  await signIn.click();
  await expect(page).toHaveURL(new RegExp(`^${target().auth}`), { timeout: 30000 });
}

/**
 * Waits until the web app is done after the OAuth callback: /api/callback redirects (a full page
 * load) to the start page, or for a new user to /<locale>/profile/create, and React has hydrated
 * it (a click before that is lost). A page.goto before the redirect lands is "interrupted by
 * another navigation" (WebKit, Firefox). Builds before 2026-11-14 added ?session_updated=true and
 * removed it once hydrated; that is still waited out. Every sign-in helper ends here, so specs
 * never wait for it.
 */
export async function settleSignIn(page: Page, locale: Locale, timeout = 45000): Promise<void> {
  const web = new URL(target().web).origin;
  await expect
    .poll(
      () => {
        const url = new URL(page.url());
        if (url.origin !== web || !url.pathname.startsWith(`/${locale}`)) return false;
        // Older builds: a new user's /profile/create kept the parameter (nothing there dropped it)
        return url.pathname.startsWith(`/${locale}/profile/create`) || !url.searchParams.has('session_updated');
      },
      { message: `the web app did not settle after sign-in (at ${page.url()})`, timeout },
    )
    .toBe(true);
  await page.waitForLoadState('load');
  await expect
    .poll(
      () =>
        page
          .evaluate(() => [...document.querySelectorAll('button')].some((b) => Object.keys(b).some((k) => k.startsWith('__reactProps$'))))
          // A navigation of the app's own (a redirect) replaced the page while asking: ask again
          .catch((error: unknown) => (/Execution context was destroyed|navigation/i.test(String(error)) ? false : Promise.reject(error))),
      { message: `the web app never hydrated after sign-in (at ${page.url()})`, timeout },
    )
    .toBe(true);
}

/** The web app is back with a session, and done redirecting. */
export async function expectSignedIn(page: Page, locale: Locale): Promise<void> {
  await expect(page).toHaveURL(new RegExp(`^${target().web}/${locale}(/|\\?|$)`), { timeout: 45000 });
  await settleSignIn(page, locale);
  const cookies = await page.context().cookies(target().web);
  expect(
    cookies.map((c) => c.name).some((n) => /session|access_token/i.test(n)),
    `no session cookie: ${cookies.map((c) => c.name).join(', ')}`,
  ).toBe(true);
}

/**
 * Submits the auth server's email-code form and waits until the browser has left
 * it. The forms are plain HTML (openauth ui/password.tsx): Enter in the field
 * submits, with none of a button click's actionability waits. A code page that
 * comes back (the POST was lost) is filled and submitted again, at most twice.
 */
export async function submitEmailCode(page: Page, email: string, sentAfter: number): Promise<void> {
  const code = page.locator('input[name="code"]');
  await expect(code).toBeVisible({ timeout: 30000 });
  const value = await readSinkCode(email, 30000, sentAfter);
  const auth = new URL(target().auth).origin;
  for (let attempt = 1; ; attempt++) {
    await fillSecret(code, value);
    await code.press('Enter');
    try {
      await expect.poll(() => new URL(page.url()).origin, { timeout: 20000 }).not.toBe(auth);
      return;
    } catch (e) {
      if (attempt >= 3 || !(await code.isVisible().catch(() => false))) throw e;
    }
  }
}

/**
 * On the auth server's sign-in form: email + password, submitted with Enter, and
 * waits until the browser has left the auth server. A sign-in form that comes
 * back with nothing filled (the POST was lost while the page was still arriving)
 * is filled and submitted again, at most twice; a wrong password is never retried
 * (the form comes back with an error, and that fails here).
 */
export async function submitPasswordSignIn(page: Page, email: string, password: string = TEST_PASSWORD): Promise<void> {
  const auth = new URL(target().auth).origin;
  const emailField = page.locator('input[name="email"]');
  const passwordField = page.locator('input[name="password"]');
  for (let attempt = 1; ; attempt++) {
    await expect(emailField).toBeEditable({ timeout: 30000 });
    await emailField.fill(email);
    await fillSecret(passwordField, password);
    await passwordField.press('Enter');
    try {
      await expect.poll(() => new URL(page.url()).origin, { timeout: 20000 }).not.toBe(auth);
      return;
    } catch (e) {
      const error = await page.locator('[data-component="form-alert"]').filter({ hasText: /\S/ }).first().isVisible().catch(() => false);
      if (attempt >= 3 || error || !(await passwordField.isVisible().catch(() => false))) throw e;
    }
  }
}

/** On the auth server's sign-in form: opens the register form, email + password → code from the sink. */
export async function completeRegistration(page: Page, email: string): Promise<void> {
  // By href: the link text is Arabic when the auth pages follow the site language (#293).
  // Clicked until the register form is there: a click while the sign-in form is still
  // arriving (the /authorize redirects) is lost, and the old wait then filled the
  // sign-in form's own email/password fields (#753, #798)
  const register = page.locator('a[href*="register"]').first();
  const repeat = page.locator('input[name="repeat"]');
  await expect(async () => {
    if (!(await repeat.isVisible())) await register.click({ timeout: 10000 });
    await expect(repeat).toBeVisible({ timeout: 5000 });
  }).toPass({ timeout: 45000 });
  await page.locator('input[name="email"]').fill(email);
  await fillSecret(page.locator('input[name="password"]'), TEST_PASSWORD);
  await fillSecret(repeat, TEST_PASSWORD);
  const sentAfter = Date.now();
  await repeat.press('Enter');
  await submitEmailCode(page, email, sentAfter);
}

/** The active account's access token, from the web app's same-origin token endpoint. */
export async function webAccessToken(page: Page): Promise<{ accessToken: string; userId: string }> {
  const body = await page.evaluate(async () => {
    const res = await fetch('/api/auth/token', { credentials: 'same-origin' });
    return (await res.json()) as { accessToken?: string | null; userId?: string };
  });
  expect(body.accessToken, 'signed in, but /api/auth/token has no access token').toBeTruthy();
  return { accessToken: body.accessToken as string, userId: body.userId ?? '' };
}

/** Registers a new sink user on the web app and leaves the page signed in. */
export async function signUpOnWeb(page: Page, prefix: string, locale: Locale = 'en'): Promise<WebUser> {
  const email = sinkEmail(prefix);
  await startSignIn(page, locale);
  await completeRegistration(page, email);
  await expectSignedIn(page, locale);
  const session = await webAccessToken(page);
  // The id, for the run's teardown and leftover check (rows keyed only by user id; the account is gone by then)
  if (process.env.E2E_RUN_USER_IDS_FILE && session.userId) appendFileSync(process.env.E2E_RUN_USER_IDS_FILE, `${session.userId}\n`);
  return { email, ...session };
}

/** Drops every cookie and signs the user in again (a fresh web session). */
export async function signInAgain(page: Page, email: string, locale: Locale = 'en'): Promise<WebUser> {
  await page.context().clearCookies();
  await startSignIn(page, locale);
  await submitPasswordSignIn(page, email);
  await expectSignedIn(page, locale);
  return { email, ...(await webAccessToken(page)) };
}

/** api-videos call as the given user. */
export async function apiFetch(user: Pick<WebUser, 'accessToken'>, path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set('Authorization', `Bearer ${user.accessToken}`);
  // Cloudflare's documented Turnstile test token: QA and stage use the always-pass test secret,
  // production and the local stack ignore it (docs/features/bot-protection.md)
  if (!headers.has('X-Turnstile-Token')) headers.set('X-Turnstile-Token', 'XXXX.DUMMY.TOKEN.XXXX');
  // A dropped connection is retried for requests that are safe to repeat (net.ts)
  return fetchRetry(`${target().api}${path}`, { ...init, headers });
}

/** Creates the user's video profile (new users are sent to the create-profile page otherwise). */
export async function createProfile(user: WebUser): Promise<void> {
  const res = await apiFetch(user, '/api/profiles', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: user.email,
      userName: user.email.split('@')[0].replace(/[^A-Za-z0-9_]/g, '_').slice(0, 30),
      displayName: 'Release E2E',
      timezone: 'UTC',
    }),
  });
  expect(res.status, `POST /api/profiles: ${await res.clone().text()}`).toBeLessThan(300);
}
