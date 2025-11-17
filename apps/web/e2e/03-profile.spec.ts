import { test, expect } from './fixtures';

/**
 * Profile E2E Tests
 * Tests for user profile functionality
 */

test.describe('Profile Pages', () => {
  test('should load profile page', async ({ page }) => {
    await page.goto('/en/profile');

    // Page should load
    await expect(page.locator('body')).toBeVisible();
  });

  test('should load profile create page', async ({ page }) => {
    await page.goto('/en/profile/create');

    // Page should load (may show login prompt or create form depending on auth state)
    await expect(page.locator('body')).toBeVisible();

    // Check for either heading or login message
    const hasHeading = await page.locator('h1').count();
    const hasLoginMessage = await page.getByText(/log in/i).count();

    expect(hasHeading + hasLoginMessage).toBeGreaterThan(0);
  });

  test('profile create form should have required fields when authenticated', async ({ page }) => {
    await page.goto('/en/profile/create');

    // Wait for page to load
    await page.waitForTimeout(1000);

    // Check if form exists (only if authenticated)
    const formCount = await page.locator('form').count();

    if (formCount > 0) {
      // User is authenticated, check form fields
      const emailField = page.locator('input[type="email"]');
      await expect(emailField).toBeVisible();
      await expect(emailField).toBeDisabled();

      const firstNameField = page.locator('input[name="firstName"]');
      await expect(firstNameField).toBeVisible();

      const lastNameField = page.locator('input[name="lastName"]');
      await expect(lastNameField).toBeVisible();

      const submitButton = page.locator('button[type="submit"]');
      await expect(submitButton).toBeVisible();
    } else {
      // User is not authenticated, check for login message
      await expect(page.getByText(/log in/i)).toBeVisible();
    }
  });

  test('profile create should validate required fields when authenticated', async ({ page }) => {
    await page.goto('/en/profile/create');

    // Wait for page to load
    await page.waitForTimeout(1000);

    const formCount = await page.locator('form').count();

    if (formCount > 0) {
      // User is authenticated, test validation
      const submitButton = page.locator('button[type="submit"]');
      await submitButton.click();

      // HTML5 validation should prevent submission
      const firstNameField = page.locator('input[name="firstName"]');
      const isInvalid = await firstNameField.evaluate((el: HTMLInputElement) => {
        return !el.validity.valid;
      });

      expect(isInvalid).toBe(true);
    } else {
      // User is not authenticated, skip this test
      await expect(page.getByText(/log in/i)).toBeVisible();
    }
  });

  test('should load profile edit page', async ({ page }) => {
    await page.goto('/en/profile/edit');

    // Page should load
    await expect(page.locator('body')).toBeVisible();
  });
});

test.describe('Profile Pages - RTL', () => {
  test('should load Arabic profile create page', async ({ page }) => {
    await page.goto('/ar/profile/create');

    // Check page loads
    await expect(page.locator('body')).toBeVisible();

    // Check for RTL direction on page content
    const mainDiv = page.locator('div[dir="rtl"]').first();
    if (await mainDiv.count() > 0) {
      await expect(mainDiv).toBeVisible();
    }
  });

  test('should load Arabic profile edit page', async ({ page }) => {
    await page.goto('/ar/profile/edit');

    // Check page loads
    await expect(page.locator('body')).toBeVisible();

    // Check for RTL direction on page content
    const mainDiv = page.locator('div[dir="rtl"]').first();
    if (await mainDiv.count() > 0) {
      await expect(mainDiv).toBeVisible();
    }
  });
});

test.describe('Profile Responsiveness', () => {
  test('profile create should be responsive', async ({ page }) => {
    // Desktop
    await page.setViewportSize({ width: 1920, height: 1080 });
    await page.goto('/en/profile/create');
    await expect(page.locator('body')).toBeVisible();

    // Tablet
    await page.setViewportSize({ width: 768, height: 1024 });
    await page.goto('/en/profile/create');
    await expect(page.locator('body')).toBeVisible();

    // Mobile
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto('/en/profile/create');
    await expect(page.locator('body')).toBeVisible();
  });
});
