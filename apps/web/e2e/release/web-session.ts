/**
 * Web app session helpers for the release suite. Every spec registers its own
 * sink user through the real UI and OAuth round trip; nothing is seeded.
 */
import { expect, type Page } from '@playwright/test';
import { fillSecret } from './secret-fill';
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

/** Opens the anonymous menu and starts sign-in (the login() server action). */
export async function startSignIn(page: Page, locale: Locale): Promise<void> {
  await page.goto(`${target().web}/${locale}`);
  await page.locator('button[aria-haspopup="menu"]').first().click();
  await page.locator('[role="menu"] form button[type="submit"]').first().click();
  await expect(page).toHaveURL(new RegExp(`^${target().auth}`), { timeout: 30000 });
}

/** The web app is back with a session (the callback redirects with session_updated). */
export async function expectSignedIn(page: Page, locale: Locale): Promise<void> {
  await expect(page).toHaveURL(new RegExp(`^${target().web}/${locale}(/|\\?|$)`), { timeout: 30000 });
  const cookies = await page.context().cookies(target().web);
  expect(
    cookies.map((c) => c.name).some((n) => /session|access_token/i.test(n)),
    `no session cookie: ${cookies.map((c) => c.name).join(', ')}`,
  ).toBe(true);
}

/** On the auth server's register form: email + password → code from the sink. */
export async function completeRegistration(page: Page, email: string): Promise<void> {
  // By href: the link text is Arabic when the auth pages follow the site language (#293).
  await page.click('a[href*="register"]');
  await page.fill('input[name="email"]', email);
  await fillSecret(page.locator('input[name="password"]'), TEST_PASSWORD);
  await fillSecret(page.locator('input[name="repeat"]'), TEST_PASSWORD);
  const sentAfter = Date.now();
  await page.click('button[data-component="button"]');
  await expect(page.locator('input[name="code"]')).toBeVisible({ timeout: 20000 });
  await fillSecret(page.locator('input[name="code"]'), await readSinkCode(email, 20000, sentAfter));
  await page.click('button[data-component="button"]');
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
  return { email, ...(await webAccessToken(page)) };
}

/** Drops every cookie and signs the user in again (a fresh web session). */
export async function signInAgain(page: Page, email: string, locale: Locale = 'en'): Promise<WebUser> {
  await page.context().clearCookies();
  await startSignIn(page, locale);
  await page.fill('input[name="email"]', email);
  await fillSecret(page.locator('input[name="password"]'), TEST_PASSWORD);
  await page.click('button[data-component="button"]');
  await expectSignedIn(page, locale);
  return { email, ...(await webAccessToken(page)) };
}

/** api-videos call as the given user. */
export async function apiFetch(user: Pick<WebUser, 'accessToken'>, path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set('Authorization', `Bearer ${user.accessToken}`);
  return fetch(`${target().api}${path}`, { ...init, headers });
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
