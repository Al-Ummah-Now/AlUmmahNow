import { request as playwrightRequest } from '@playwright/test';
import { test } from './fixtures';
import { ADMIN_WEB_URL } from './env';

/**
 * PR runs test the deployed QA admin-web, which follows main (AlUmmahNow#486).
 * Specs for behaviour a PR introduces cannot pass there until it is merged and
 * deployed, so they skip on a PR run while QA still has the old build.
 *
 * Only a pull_request run may skip. On main, the nightly schedule or a manual
 * run, QA should already have the change, so the spec runs and fails loudly
 * if it does not.
 */

let browserBoundSignIn: Promise<boolean> | undefined;

/**
 * Browser-bound sign-in (#463): /login hands off to GET /api/auth/start, which
 * sets the state cookie and redirects to /authorize. Builds before it answer 404.
 */
function hasBrowserBoundSignIn(): Promise<boolean> {
  browserBoundSignIn ??= (async () => {
    const ctx = await playwrightRequest.newContext();
    try {
      const res = await ctx.get(`${ADMIN_WEB_URL}/api/auth/start`, { maxRedirects: 0 });
      return res.status() !== 404;
    } finally {
      await ctx.dispose();
    }
  })();
  return browserBoundSignIn;
}

/** Skips the current test on a PR run while QA's admin-web predates browser-bound sign-in. */
export async function skipUntilSignInDeployed(): Promise<void> {
  if (process.env.GITHUB_EVENT_NAME !== 'pull_request') return;
  test.skip(
    !(await hasBrowserBoundSignIn()),
    `${ADMIN_WEB_URL} predates browser-bound sign-in (GET /api/auth/start is 404); runs once this PR is on QA (AlUmmahNow#486)`
  );
}
