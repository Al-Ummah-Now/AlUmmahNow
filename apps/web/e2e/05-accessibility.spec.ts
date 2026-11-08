import { test, expect } from './fixtures';
import type { Locator } from '@playwright/test';
import { ANONYMOUS_STATE, AUTH_STATE } from './test-utils/auth-state';
import { menuTrigger } from './test-utils/navigation';

/**
 * Accessibility E2E Tests (WCAG basics)
 */

/** True if the form control has a programmatic label (not just a placeholder) */
async function hasLabel(control: Locator): Promise<boolean> {
  return control.evaluate((el: HTMLInputElement) =>
    (el.labels?.length ?? 0) > 0 || el.hasAttribute('aria-label') || el.hasAttribute('aria-labelledby'),
  );
}

test.describe('Accessibility - Semantic HTML', () => {
  test.use({ storageState: ANONYMOUS_STATE });

  test('homepage has a single h1 and landmarks', async ({ page }) => {
    await page.goto('/en/');

    await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1);
    await expect(page.getByRole('banner')).toBeVisible();
    await expect(page.getByRole('main')).toBeVisible();
  });

  test('html has lang and dir for the locale', async ({ page }) => {
    await page.goto('/en/');
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    await expect(page.locator('html')).toHaveAttribute('dir', 'ltr');

    await page.goto('/ar/');
    await expect(page.locator('html')).toHaveAttribute('lang', 'ar');
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  });

  test('images have alt text', async ({ page }) => {
    await page.goto('/en/');
    await expect(page.getByTestId('video-card').first()).toBeVisible();

    for (const img of await page.locator('img').all()) {
      expect(await img.getAttribute('alt'), await img.evaluate((el) => el.outerHTML)).not.toBeNull();
    }
  });

  test('icon-only header buttons have accessible names', async ({ page }) => {
    await page.goto('/en/');
    const header = page.getByRole('banner');
    await expect(header.getByRole('button').first()).toBeVisible();

    for (const button of await header.getByRole('button').all()) {
      const name = await button.evaluate((el) => (el.getAttribute('aria-label') || el.textContent || '').trim());
      expect(name, await button.evaluate((el) => el.outerHTML.slice(0, 200))).not.toBe('');
    }
  });
});

test.describe('Accessibility - Keyboard Navigation', () => {
  test.use({ storageState: ANONYMOUS_STATE });

  test('Tab moves focus to an interactive element', async ({ page, browserName }) => {
    // WebKit only tabs to form controls unless "Tab highlights each item" is on
    test.skip(browserName === 'webkit', 'Safari skips links/buttons on Tab by default');
    await page.goto('/en/');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();

    await page.keyboard.press('Tab');
    const tag = await page.evaluate(() => document.activeElement?.tagName);
    expect(['A', 'BUTTON', 'INPUT', 'SELECT', 'TEXTAREA']).toContain(tag);
  });

  test('video cards are keyboard-focusable links', async ({ page }) => {
    await page.goto('/en/');
    const card = page.getByTestId('video-card').first();
    await expect(card).toBeVisible();

    // Retried: the grid can re-render (client data load, other runs adding
    // videos) between focus and Enter, so the href is re-read on every attempt
    await expect(async () => {
      if (!/\/en\/video\?vid=/.test(page.url())) {
        const href = await card.getAttribute('href');
        await card.focus();
        await expect(card).toBeFocused({ timeout: 3000 });
        await page.keyboard.press('Enter');
        await expect(page).toHaveURL(new RegExp(`${href!.replace(/[?]/g, '\\?')}$`), { timeout: 5000 });
      }
    }).toPass({ timeout: 60000 });
  });

  test('header menu button is keyboard operable', async ({ page, isMobile }) => {
    test.skip(isMobile, 'Mobile uses the navigation drawer (covered in 08-unified-navigation)');
    await page.goto('/en/');
    const trigger = menuTrigger(page);

    await trigger.focus();
    await expect(trigger).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('menu')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('menu')).toBeHidden();
  });
});

test.describe('Accessibility - Color Contrast', () => {
  test.use({ storageState: ANONYMOUS_STATE });

  test('body text is not transparent or same-colored as the background', async ({ page }) => {
    await page.goto('/en/');
    const heading = page.getByRole('heading', { level: 1 });
    await expect(heading).toBeVisible();

    const { color, background } = await heading.evaluate((el) => {
      let node: HTMLElement | null = el as HTMLElement;
      let bg = 'rgba(0, 0, 0, 0)';
      while (node && (bg === 'rgba(0, 0, 0, 0)' || bg === 'transparent')) {
        bg = getComputedStyle(node).backgroundColor;
        node = node.parentElement;
      }
      return { color: getComputedStyle(el).color, background: bg };
    });
    expect(color).not.toBe('rgba(0, 0, 0, 0)');
    expect(color).not.toBe(background);
  });
});

test.describe('Accessibility - Forms', () => {
  test.use({ storageState: AUTH_STATE.single });

  test('profile edit form controls have labels', async ({ page }) => {
    await page.goto('/en/profile/edit');
    const controls = page.locator('form').locator('input:visible, textarea:visible, select:visible');
    await expect(controls.first()).toBeVisible();

    for (const control of await controls.all()) {
      expect(await hasLabel(control), await control.evaluate((el) => el.outerHTML.slice(0, 200))).toBe(true);
    }
  });

  test('labels focus their field when clicked', async ({ page }) => {
    await page.goto('/en/profile/edit');
    await page.locator('label[for="profile-firstName"]').click();
    await expect(page.locator('#profile-firstName')).toBeFocused();
  });
});

test.describe('Accessibility - RTL Support', () => {
  test.use({ storageState: ANONYMOUS_STATE });

  test('Arabic pages have the correct direction', async ({ page }) => {
    await page.goto('/ar/');

    await expect(page.getByRole('heading', { level: 1 })).toContainText('الفيديوهات');
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.getByRole('main')).toHaveCSS('direction', 'rtl');
  });

  test('RTL header menu is keyboard operable', async ({ page, isMobile }) => {
    test.skip(isMobile, 'Mobile uses the navigation drawer (covered in 08-unified-navigation)');
    await page.goto('/ar/');
    const trigger = menuTrigger(page);

    await trigger.focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('menu')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('menu')).toBeHidden();
  });
});
