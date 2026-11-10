import type { Page } from '@playwright/test';
import { test, expect } from './fixtures';
import { AUTH_STATE, ANONYMOUS_STATE } from './test-utils/auth-state';

/**
 * Profile E2E Tests
 *
 * Every project runs these, some with a stored session and some without, so
 * each describe pins its own auth state instead of branching on what the
 * page happens to render.
 */

test.describe('Profile Pages - anonymous', () => {
  test.use({ storageState: ANONYMOUS_STATE });

  test('should load profile page', async ({ page }) => {
    const response = await page.goto('/en/profile');
    expect(response?.status()).toBeLessThan(500);
    await expect(page.locator('body')).toBeVisible();
  });

  test('profile create shows a sign-in prompt', async ({ page }) => {
    await page.goto('/en/profile/create');

    await expect(page.getByRole('heading', { name: /sign in/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /sign in/i }).last()).toBeVisible();
    await expect(page.locator('form input[name="firstNameEn"]')).toHaveCount(0);
  });

  test('profile create shows an Arabic sign-in prompt in RTL', async ({ page }) => {
    await page.goto('/ar/profile/create');

    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.getByRole('heading', { name: 'تسجيل الدخول' })).toBeVisible();
  });

  test('should load profile edit page', async ({ page }) => {
    const response = await page.goto('/en/profile/edit');
    expect(response?.status()).toBeLessThan(500);
    await expect(page.locator('body')).toBeVisible();
  });
});

/** The profile form (the header's search is a form too) */
function profileForm(page: Page) {
  return page.locator('form').filter({ has: page.locator('input[name="firstNameEn"], input[name="firstNameAr"]') });
}

// ProfileGuard sends a user who has a profile away from /profile/create, so the
// create form is checked as the one user without a profile (a new user)
test.describe('Profile Pages - signed in without a profile', () => {
  test.use({ storageState: AUTH_STATE.fresh });

  test('profile create form has the required fields', async ({ page }) => {
    await page.goto('/en/profile/create');

    const email = profileForm(page).locator('input[type="email"]');
    await expect(email).toBeVisible();
    await expect(email).toBeDisabled();
    await expect(email).toHaveValue(/@/);

    await expect(page.locator('input[name="firstNameEn"]')).toBeVisible();
    await expect(page.locator('input[name="lastNameEn"]')).toBeVisible();
    await expect(profileForm(page).locator('button[type="submit"]')).toBeVisible();
    // Stays on the create page: no profile, so the guard keeps the user here
    await expect(page).toHaveURL(/\/en\/profile\/create$/);
  });

  test('profile create validates the required first name', async ({ page }) => {
    await page.goto('/en/profile/create');

    const firstName = page.locator('input[name="firstNameEn"]');
    await expect(firstName).toBeVisible();
    await profileForm(page).locator('button[type="submit"]').click();

    // HTML5 validation blocks submission while the required field is empty
    expect(await firstName.evaluate((el: HTMLInputElement) => el.validity.valueMissing)).toBe(true);
    await expect(page).toHaveURL(/\/en\/profile\/create/);
  });

  test('Arabic profile create page renders RTL', async ({ page }) => {
    await page.goto('/ar/profile/create');

    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.locator('div[dir="rtl"]').first()).toBeVisible();
    await expect(profileForm(page).locator('input[type="email"]')).toBeVisible();
  });
});

test.describe('Profile Pages - authenticated', () => {
  test.use({ storageState: AUTH_STATE.single });

  test('profile form switches to Arabic fields', async ({ page }) => {
    await page.goto('/en/profile/edit');

    await page.getByRole('button', { name: /^(Arabic|العربية)$/ }).click();
    const firstNameAr = page.locator('input[name="firstNameAr"]');
    await expect(firstNameAr).toBeVisible();
    await expect(firstNameAr).toHaveAttribute('dir', 'rtl');
  });

  test('Arabic profile edit page renders RTL', async ({ page }) => {
    await page.goto('/ar/profile/edit');

    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.locator('div[dir="rtl"]').first()).toBeVisible();
  });
});

test.describe('Profile Responsiveness', () => {
  test.use({ storageState: AUTH_STATE.fresh });

  for (const viewport of [
    { width: 1920, height: 1080 },
    { width: 768, height: 1024 },
    { width: 375, height: 667 },
  ]) {
    test(`profile create form fits a ${viewport.width}px viewport`, async ({ page }) => {
      await page.setViewportSize(viewport);
      await page.goto('/en/profile/create');

      const form = profileForm(page);
      await expect(form).toBeVisible();
      const box = await form.boundingBox();
      expect(box?.width ?? 0).toBeLessThanOrEqual(viewport.width);
    });
  }
});
