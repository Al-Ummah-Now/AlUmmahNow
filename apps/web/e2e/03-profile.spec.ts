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

    // Check page title or heading
    const heading = page.locator('h1');
    await expect(heading).toContainText(/create/i);
  });

  test('profile create form should have required fields', async ({ page }) => {
    await page.goto('/en/profile/create');

    // Check for email field (disabled)
    const emailField = page.locator('input[type="email"]');
    await expect(emailField).toBeVisible();
    await expect(emailField).toBeDisabled();

    // Check for first name field (required)
    const firstNameField = page.locator('input[name="firstName"]');
    await expect(firstNameField).toBeVisible();

    // Check for last name field
    const lastNameField = page.locator('input[name="lastName"]');
    await expect(lastNameField).toBeVisible();

    // Check for submit button
    const submitButton = page.locator('button[type="submit"]');
    await expect(submitButton).toBeVisible();
  });

  test('profile create should validate required fields', async ({ page }) => {
    await page.goto('/en/profile/create');

    // Try to submit without filling required fields
    const submitButton = page.locator('button[type="submit"]');
    await submitButton.click();

    // HTML5 validation should prevent submission
    const firstNameField = page.locator('input[name="firstName"]');
    const isInvalid = await firstNameField.evaluate((el: HTMLInputElement) => {
      return !el.validity.valid;
    });

    expect(isInvalid).toBe(true);
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

    // Check RTL direction
    const html = page.locator('html');
    await expect(html).toHaveAttribute('dir', 'rtl');

    // Check page loads
    const heading = page.locator('h1');
    await expect(heading).toBeVisible();
  });

  test('should load Arabic profile edit page', async ({ page }) => {
    await page.goto('/ar/profile/edit');

    // Check RTL direction
    const html = page.locator('html');
    await expect(html).toHaveAttribute('dir', 'rtl');

    // Check page loads
    await expect(page.locator('body')).toBeVisible();
  });
});

test.describe('Profile Responsiveness', () => {
  test('profile create should be responsive', async ({ page }) => {
    // Desktop
    await page.setViewportSize({ width: 1920, height: 1080 });
    await page.goto('/en/profile/create');
    await expect(page.locator('form')).toBeVisible();

    // Tablet
    await page.setViewportSize({ width: 768, height: 1024 });
    await page.goto('/en/profile/create');
    await expect(page.locator('form')).toBeVisible();

    // Mobile
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto('/en/profile/create');
    await expect(page.locator('form')).toBeVisible();
  });
});
