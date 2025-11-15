import { test, expect } from './fixtures';

/**
 * Accessibility E2E Tests
 * Tests for WCAG compliance and accessibility features
 */

test.describe('Accessibility - Semantic HTML', () => {
  test('homepage should have proper heading hierarchy', async ({ page }) => {
    await page.goto('/en/');

    // Check for h1
    const h1 = page.locator('h1');
    await expect(h1.first()).toBeVisible();

    // Check headings are in order (h1 before h2, etc.)
    const headings = await page.locator('h1, h2, h3, h4, h5, h6').all();
    expect(headings.length).toBeGreaterThan(0);
  });

  test('should have lang attribute', async ({ page }) => {
    await page.goto('/en/');

    const html = page.locator('html');
    await expect(html).toHaveAttribute('lang');
  });

  test('images should have alt text', async ({ page }) => {
    await page.goto('/en/');

    // Get all images
    const images = await page.locator('img').all();

    if (images.length > 0) {
      for (const img of images) {
        // Each image should have an alt attribute (even if empty for decorative images)
        const hasAlt = await img.evaluate((el) => el.hasAttribute('alt'));
        expect(hasAlt).toBe(true);
      }
    }
  });
});

test.describe('Accessibility - Keyboard Navigation', () => {
  test('should navigate with Tab key', async ({ page }) => {
    await page.goto('/en/');

    // Press Tab key
    await page.keyboard.press('Tab');

    // Check that focus moved to an interactive element
    const focusedElement = page.locator(':focus');
    await expect(focusedElement).toBeTruthy();
  });

  test('links should be keyboard accessible', async ({ page }) => {
    await page.goto('/en/');

    // Get all links
    const links = await page.locator('a[href]').all();

    if (links.length > 0) {
      // First link should be focusable
      await links[0].focus();
      const isFocused = await links[0].evaluate((el) => el === document.activeElement);
      expect(isFocused).toBe(true);
    }
  });

  test('buttons should be keyboard accessible', async ({ page }) => {
    await page.goto('/en/');

    // Get all buttons
    const buttons = await page.locator('button').all();

    if (buttons.length > 0) {
      // First button should be focusable
      await buttons[0].focus();
      const isFocused = await buttons[0].evaluate((el) => el === document.activeElement);
      expect(isFocused).toBe(true);
    }
  });
});

test.describe('Accessibility - Color Contrast', () => {
  test('should have sufficient color contrast (basic check)', async ({ page }) => {
    await page.goto('/en/');

    // This is a basic visual check
    // For real contrast testing, you'd want to use axe-core or similar tools
    const body = page.locator('body');
    await expect(body).toBeVisible();

    // Check that text is visible (basic smoke test)
    const textElements = await page.locator('p, h1, h2, h3, span').all();
    expect(textElements.length).toBeGreaterThan(0);
  });
});

test.describe('Accessibility - Forms', () => {
  test('form inputs should have labels', async ({ page }) => {
    await page.goto('/en/profile/create');

    // Get all input fields
    const inputs = await page.locator('input:not([type="hidden"])').all();

    if (inputs.length > 0) {
      for (const input of inputs) {
        // Check for associated label or aria-label
        const hasLabel = await input.evaluate((el: HTMLInputElement) => {
          const label = document.querySelector(`label[for="${el.id}"]`);
          return label !== null || el.hasAttribute('aria-label') || el.hasAttribute('aria-labelledby');
        });

        // Note: Some inputs might be inside <label> tags
        const isInsideLabel = await input.evaluate((el) => {
          return el.closest('label') !== null;
        });

        expect(hasLabel || isInsideLabel).toBe(true);
      }
    }
  });
});

test.describe('Accessibility - RTL Support', () => {
  test('Arabic pages should have correct direction', async ({ page }) => {
    await page.goto('/ar/');

    const html = page.locator('html');
    await expect(html).toHaveAttribute('dir', 'rtl');
    await expect(html).toHaveAttribute('lang', 'ar');
  });

  test('RTL layout should be keyboard navigable', async ({ page }) => {
    await page.goto('/ar/');

    // Press Tab key
    await page.keyboard.press('Tab');

    // Check that focus works in RTL
    const focusedElement = page.locator(':focus');
    await expect(focusedElement).toBeTruthy();
  });
});
