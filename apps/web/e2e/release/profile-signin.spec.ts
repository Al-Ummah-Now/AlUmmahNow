/**
 * Release regression: the auth server's profile app (profile.auth.*) signs a
 * new user up and back in. It is a separate OAuth client from the web app, so a
 * client registry or redirect_uri mistake there shows up only here.
 */
import { test, expect } from '@playwright/test';
import { sinkEmail, target } from './targets';
import { completeRegistration, expectNoErrorHop, recordNavigations, submitPasswordSignIn } from './web-session';
import { openProfileSignIn } from './profile-app';

// This file signs users in through the auth server: its traces would hold the
// typed password and email code (fillSecret args, form POST bodies). Trace off.
test.use({ trace: 'off' });

test.describe('Release: profile app sign-up and sign-in', () => {
  test('register, then sign in again from a fresh session', async ({ page, context }) => {
    const email = sinkEmail('rel-profile');
    const navigations = recordNavigations(page);
    const loggedIn = page.locator('#loggedInView');

    await openProfileSignIn(page);
    await completeRegistration(page, email);
    await expect(loggedIn).toBeVisible({ timeout: 30000 });
    expect(new URL(page.url()).origin).toBe(target().profile);

    await context.clearCookies();
    await openProfileSignIn(page);
    await submitPasswordSignIn(page, email);
    await expect(loggedIn).toBeVisible({ timeout: 30000 });
    await expect(loggedIn).toContainText(email);

    expectNoErrorHop(navigations);
  });
});
