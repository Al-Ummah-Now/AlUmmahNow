/**
 * Release regression R4: the OAuth callbacks never answer with raw JSON.
 *
 * Incident: a failed password reset came back as ?error=server_error and the
 * callback returned NextResponse.json(error), which an Error serializes to {}:
 * users saw an empty JSON viewer (#188). The add-account callback did the same.
 */
import { test, expect } from '@playwright/test';
import { target } from './targets';

const CASES = [
  { name: 'sign-in, auth server error', path: '/api/callback?locale=en&error=server_error&error_description=Incorrect+email+or+password', locale: 'en' },
  { name: 'sign-in, invalid code', path: '/api/callback?locale=ar&code=not-a-real-code', locale: 'ar' },
  { name: 'sign-in, no code', path: '/api/callback?locale=en', locale: 'en' },
  { name: 'add account, auth server error', path: '/api/callback/multi-account?locale=en&error=access_denied', locale: 'en' },
  { name: 'add account, invalid code', path: '/api/callback/multi-account?locale=ar&code=not-a-real-code', locale: 'ar' },
];

test.describe('Release R4: callback errors land on the error page', () => {
  for (const c of CASES) {
    test(c.name, async ({ page }) => {
      const res = await page.goto(`${target().web}${c.path}`);
      await expect(page).toHaveURL(`${target().web}/${c.locale}/auth/error`);
      expect(res?.headers()['content-type'] ?? '').toContain('text/html');
      await expect(page.locator('body')).not.toHaveText(/^\s*\{\s*\}\s*$/);
    });
  }
});
