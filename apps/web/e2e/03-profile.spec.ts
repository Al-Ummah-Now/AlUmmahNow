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

/**
 * Bodies of the create-profile server action (POST to the page with a
 * Next-Action header), answered with a 500 so no profile is created.
 */
function captureCreateProfile(page: Page): string[] {
  const bodies: string[] = [];
  void page.route(/\/profile\/create(\?|$)/, async (route) => {
    const req = route.request();
    if (req.method() === 'POST' && req.headers()['next-action']) {
      bodies.push(req.postData() ?? '');
      await route.fulfill({ status: 500, body: '' });
      return;
    }
    await route.fallback();
  });
  return bodies;
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

  test('profile create asks for a first name in either language when both are empty', async ({ page }) => {
    await page.goto('/en/profile/create');

    const firstName = page.locator('input[name="firstNameEn"]');
    await expect(firstName).toBeVisible();
    // No browser-only "required" on one language: user content needs one language only
    await expect(firstName).not.toHaveAttribute('required', /.*/);
    const posts = captureCreateProfile(page);
    await profileForm(page).locator('button[type="submit"]').click();
    await expect(profileForm(page).getByText(/required/i).first()).toBeVisible();
    expect(posts).toHaveLength(0);
    await expect(page).toHaveURL(/\/en\/profile\/create/);
  });

  // 2026-11-19 prod report: "filled everything in Arabic, pressed Save: this field is required"
  for (const only of ['ar', 'en'] as const) {
    test(`profile create saves with only the ${only === 'ar' ? 'Arabic' : 'English'} tab filled`, async ({ page }) => {
      await page.goto(`/${only}/profile/create`);
      const name = only === 'ar' ? 'محمد' : 'Muhammad';
      if (only === 'ar') await profileForm(page).getByRole('button', { name: /^(Arabic|العربية)$/ }).click();
      const field = page.locator(`input[name="firstName${only === 'ar' ? 'Ar' : 'En'}"]`);
      await expect(field).toBeVisible();
      await field.fill(name);
      // Switch tabs and back: the typed name stays (both tabs stay mounted)
      await profileForm(page).getByRole('button', { name: only === 'ar' ? /^(English|الإنجليزية|الانجليزية)$/ : /^(Arabic|العربية)$/ }).click();
      await profileForm(page).getByRole('button', { name: only === 'ar' ? /^(Arabic|العربية)$/ : /^(English|الإنجليزية|الانجليزية)$/ }).click();
      await expect(field).toHaveValue(name);
      const posts = captureCreateProfile(page);
      await profileForm(page).locator('button[type="submit"]').click();
      // The save goes out (stopped before it reaches the API, so nothing is created)
      await expect.poll(() => posts.length).toBeGreaterThan(0);
      expect(posts[0]).toContain(name);
    });
  }

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
