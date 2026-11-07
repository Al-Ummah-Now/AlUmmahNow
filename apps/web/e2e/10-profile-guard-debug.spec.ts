import { test, expect } from './fixtures';
import type { Page } from '@playwright/test';
import { AUTH_STATE, ANONYMOUS_STATE } from './test-utils/auth-state';

/**
 * ProfileGuard runtime health
 *
 * Loads guarded pages and checks the guard finishes its profile check
 * (content renders instead of the "checking profile" spinner) without
 * uncaught page errors. Redirect rules are covered in
 * 11-profile-guard-redirect.spec.ts.
 */

function collectPageErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  return errors;
}

const CHECKING_PROFILE = /Checking profile|جاري التحقق من الملف الشخصي/i;

for (const [label, state] of [
  ['signed in', AUTH_STATE.single],
  ['anonymous', ANONYMOUS_STATE],
] as const) {
  test.describe(`ProfileGuard health - ${label}`, () => {
    test.use({ storageState: state });

    test('English home renders after the profile check', async ({ page }) => {
      const errors = collectPageErrors(page);
      await page.goto('/en');

      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      await expect(page.getByText(CHECKING_PROFILE)).toHaveCount(0);
      expect(errors).toEqual([]);
    });

    test('Arabic home renders after the profile check', async ({ page }) => {
      const errors = collectPageErrors(page);
      await page.goto('/ar');

      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      await expect(page.getByText(CHECKING_PROFILE)).toHaveCount(0);
      expect(errors).toEqual([]);
    });
  });
}
