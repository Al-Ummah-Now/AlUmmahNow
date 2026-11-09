/**
 * The auth server's profile app (profile.auth.*) in either of its builds:
 *
 *   - before AlUmmahNowAuth#254: signed out, it shows a "Sign In" landing page
 *     (#loggedOutView) and signs in only when that button is clicked;
 *   - from AlUmmahNowAuth#254: there is no landing page. Signed out, / goes
 *     straight into sign-in: silent when the browser is signed in to Al Ummah
 *     Now, otherwise the auth server's form.
 *
 * QA runs whichever AlUmmahNowAuth build its CI deployed last (a PR's or
 * main's), so these helpers accept both and check the same outcome.
 */
import { expect, type Page } from '@playwright/test';
import { target } from './targets';

const landingSignIn = (page: Page) => page.locator('#loggedOutView button:has-text("Sign In")');

/** Opens the signed-out profile app and gets to the auth server's sign-in. */
export async function openProfileSignIn(page: Page): Promise<void> {
  await page.goto(target().profile);
  await expect(landingSignIn(page).or(page.locator('input[name="email"]'))).toBeVisible({ timeout: 30000 });
  if (await landingSignIn(page).isVisible()) await landingSignIn(page).click();
  await expect(page).toHaveURL(new RegExp(`^${target().auth}`), { timeout: 30000 });
}

/** Profile app sign-in; with a shared sign-in it completes without a form. */
export async function signInToProfileSilently(page: Page): Promise<void> {
  await page.goto(target().profile);
  const signedIn = page.locator('#loggedInView');
  await expect(signedIn.or(landingSignIn(page))).toBeVisible({ timeout: 30000 });
  if (await landingSignIn(page).isVisible()) await landingSignIn(page).click();
  await expect(signedIn).toBeVisible({ timeout: 30000 });
  expect(new URL(page.url()).origin).toBe(target().profile);
}

/** The profile app is signed out: its landing page, or the auth server's password form. */
export async function expectProfileSignedOut(page: Page): Promise<void> {
  await page.goto(target().profile);
  await expect(page.locator('#loggedOutView').or(page.locator('input[name="password"]'))).toBeVisible({ timeout: 20000 });
  if (new URL(page.url()).origin !== target().profile) {
    await expect(page).toHaveURL(new RegExp(`^${target().auth}/`));
  }
  await expect(page.locator('#loggedInView')).toBeHidden();
}
