/**
 * Release regression R1: sign-up → email code → sign-in → session, web client.
 *
 * Incident 2026-11-07: login() authorized with /api/callback?locale=en and the
 * callback exchanged with /api/callback; the issuer rejected every code and each
 * sign-in ended on /en/auth/error. This drives the real OAuth round trip through
 * the UI and fails on any error hop.
 */
import { test, expect } from '@playwright/test';
import { sinkEmail, TEST_PASSWORD } from './targets';
import { completeRegistration, expectNoErrorHop, expectSignedIn, recordNavigations, startSignIn } from './web-session';

test.describe('Release R1: web sign-up and sign-in', () => {
  for (const locale of ['en', 'ar'] as const) {
    test(`register, then sign in again from a fresh session (${locale})`, async ({ page, context }) => {
      const email = sinkEmail(`r1-web-${locale}`);
      const navigations = recordNavigations(page);

      // Sign-up: auth server registration form → code from the sink → callback
      await startSignIn(page, locale);
      await completeRegistration(page, email);
      await expectSignedIn(page, locale);

      // Sign-in with no session to fall back on: a full authorize → code → exchange
      await context.clearCookies();
      await startSignIn(page, locale);
      await page.fill('input[name="email"]', email);
      await page.fill('input[name="password"]', TEST_PASSWORD);
      await page.click('button[data-component="button"]');
      await expectSignedIn(page, locale);
      expect(page.url()).not.toContain('/auth/error');

      expectNoErrorHop(navigations);
    });
  }
});
