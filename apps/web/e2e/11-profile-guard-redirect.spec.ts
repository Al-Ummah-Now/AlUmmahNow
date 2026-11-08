import { test, expect } from './fixtures';
import { AUTH_STATE, ANONYMOUS_STATE } from './test-utils/auth-state';

/**
 * ProfileGuard redirect behaviour
 *
 * - signed in WITH a profile: /profile/create redirects home, other pages stay
 * - anonymous: no guard redirects; /profile/create shows the sign-in prompt
 *
 * All E2E users have profiles (auth.setup.ts ensures them), so the
 * "no profile -> redirect to create" branch is covered by the ProfileGuard
 * unit tests rather than here.
 */

test.describe('ProfileGuard - user with a profile', () => {
  test.use({ storageState: AUTH_STATE.single });

  test('redirects from /en/profile/create to home', async ({ page }) => {
    await page.goto('/en/profile/create');
    await expect(page).toHaveURL(/\/en\/?$/);
    await expect(page.locator('input[name="firstNameEn"]')).toHaveCount(0);
  });

  test('redirects from /ar/profile/create to the Arabic home', async ({ page }) => {
    await page.goto('/ar/profile/create');
    await expect(page).toHaveURL(/\/ar\/?$/);
  });

  test('does not redirect from home', async ({ page }) => {
    await page.goto('/en');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(page).toHaveURL(/\/en\/?$/);
  });

  test('does not redirect from the profile page', async ({ page }) => {
    await page.goto('/en/profile');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(page).toHaveURL(/\/en\/profile$/);
  });
});

test.describe('ProfileGuard - user with a profile and no channels', () => {
  test.use({ storageState: AUTH_STATE.none });

  test('is not sent to profile creation', async ({ page }) => {
    await page.goto('/en/profile/create');
    await expect(page).toHaveURL(/\/en\/?$/);
  });
});

test.describe('ProfileGuard - anonymous', () => {
  test.use({ storageState: ANONYMOUS_STATE });

  test('leaves /profile/create alone and shows the sign-in prompt', async ({ page }) => {
    await page.goto('/en/profile/create');
    await expect(page.getByRole('heading', { name: /sign in/i })).toBeVisible();
    await expect(page).toHaveURL(/\/en\/profile\/create$/);
  });

  test('does not redirect from home', async ({ page }) => {
    await page.goto('/en');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(page).toHaveURL(/\/en\/?$/);
  });
});
