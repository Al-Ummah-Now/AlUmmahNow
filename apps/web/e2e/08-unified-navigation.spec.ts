import { test, expect } from './fixtures';
import { AUTH_STATE, ANONYMOUS_STATE, readAccount } from './test-utils/auth-state';
import { menuTrigger, openAccountMenu, openSideDrawer } from './test-utils/navigation';

/**
 * Unified Navigation (header account menu + side drawer)
 *
 * Every describe pins its auth state so the suite behaves the same in each
 * Playwright project. Channel switching and multi-account flows live in
 * 09-channel-switching and 11-account-switching.
 */

test.describe('Unified Navigation - anonymous', () => {
  test.use({ storageState: ANONYMOUS_STATE });

  test('menu offers only Sign In', async ({ page }) => {
    await page.goto('/en');
    const menu = await openAccountMenu(page);

    await expect(menu.getByRole('menuitem', { name: /sign in/i })).toBeVisible();
    await expect(menu.getByTestId('nav-active-context')).toHaveCount(0);
  });

  test('menu closes on Escape and on backdrop click', async ({ page }) => {
    await page.goto('/en');
    const menu = await openAccountMenu(page);

    await page.keyboard.press('Escape');
    await expect(menu).toBeHidden();
    await expect(menuTrigger(page)).toHaveAttribute('aria-expanded', 'false');

    await openAccountMenu(page);
    // The backdrop covers the page; click away from the menu
    await page.mouse.click(5, page.viewportSize()!.height - 5);
    await expect(menu).toBeHidden();
  });

  test('Arabic menu is RTL with Arabic Sign In', async ({ page }) => {
    await page.goto('/ar');
    const menu = await openAccountMenu(page);

    await expect(menu).toHaveAttribute('dir', 'rtl');
    await expect(menu.getByRole('menuitem', { name: 'تسجيل الدخول' })).toBeVisible();
  });
});

test.describe('Unified Navigation - English (LTR)', () => {
  test.use({ storageState: AUTH_STATE.single });

  test.beforeEach(async ({ page }) => {
    await page.goto('/en');
  });

  test('shows the signed-in user in the active context card', async ({ page }) => {
    const { email } = readAccount('single');
    const menu = await openAccountMenu(page);

    const context = menu.getByTestId('nav-active-context');
    await expect(context).toBeVisible();
    await expect(context).toContainText(email);
  });

  test('shows the active channel and links to it', async ({ page }) => {
    const { channels } = readAccount('single');
    const menu = await openAccountMenu(page);

    const active = menu.getByTestId('nav-active-channel');
    await expect(active).toBeVisible();
    await expect(active).toContainText(channels[0].name!);
    await expect(active).toHaveAttribute('href', `/en/channels/${channels[0].id}`);
  });

  test('lists navigation links for a channel owner', async ({ page }) => {
    const menu = await openAccountMenu(page);

    await expect(menu.getByText('NAVIGATION', { exact: true })).toBeVisible();
    for (const href of ['/en/feed', '/en/history', '/en/dashboard/videos', '/en/scheduled-videos']) {
      await expect(menu.locator(`a[role="menuitem"][href="${href}"]`)).toBeVisible();
    }
    await expect(menu.getByRole('menuitem', { name: 'My Videos' })).toBeVisible();
  });

  test('navigates to the profile page from the context card', async ({ page }) => {
    const menu = await openAccountMenu(page);
    await menu.getByTestId('nav-profile-link').click();

    await expect(page).toHaveURL(/\/en\/profile$/);
    await expect(menu).toBeHidden();
  });

  test('navigates to My Videos', async ({ page }) => {
    const menu = await openAccountMenu(page);
    await menu.locator('a[role="menuitem"][href="/en/dashboard/videos"]').click();

    await expect(page).toHaveURL(/\/en\/dashboard\/videos$/);
  });

  test('lists the account with its channel and the main-channel crown', async ({ page }) => {
    const { channels } = readAccount('single');
    const menu = await openAccountMenu(page);

    await expect(menu.getByText(/^ACCOUNTS/)).toBeVisible();
    await expect(menu.getByTestId('nav-account')).toHaveCount(1);
    await expect(menu.getByTestId('nav-account')).toHaveAttribute('data-active', 'true');

    const option = menu.getByTestId('nav-channel-option');
    await expect(option).toHaveCount(1);
    await expect(option).toHaveAttribute('data-channel-id', channels[0].id);
    await expect(option).toHaveAttribute('aria-checked', 'true');
    await expect(option.locator('svg.lucide-crown')).toBeVisible();
    await expect(menu.getByTestId('nav-channel-option-none')).toHaveAttribute('aria-checked', 'false');
  });

  test('opens and cancels the channel creation form', async ({ page }) => {
    const menu = await openAccountMenu(page);
    await menu.getByTestId('nav-create-channel').click();

    const input = menu.getByPlaceholder('Enter channel name');
    await expect(menu.getByText('Channel Name', { exact: true })).toBeVisible();
    await expect(input).toBeFocused();
    await expect(menu.getByRole('button', { name: 'Create', exact: true })).toBeDisabled();

    await input.fill('Typed name');
    await expect(menu.getByRole('button', { name: 'Create', exact: true })).toBeEnabled();

    await menu.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(input).toBeHidden();
    await expect(menu.getByTestId('nav-create-channel')).toBeVisible();
  });

  test('offers Add Account and Sign Out', async ({ page }) => {
    const menu = await openAccountMenu(page);

    await expect(menu.getByTestId('nav-add-account')).toHaveText(/Add another account/);
    await expect(menu.getByTestId('nav-sign-out')).toHaveText(/Sign out of/);
    // Single account: no "sign out of all"
    await expect(menu.getByRole('menuitem', { name: /Sign out of all accounts/ })).toHaveCount(0);
  });

  test('is keyboard accessible', async ({ page }) => {
    const trigger = menuTrigger(page);
    await trigger.focus();
    await page.keyboard.press('Enter');

    const menu = page.getByRole('menu');
    await expect(menu).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(menu).toBeHidden();
  });
});

test.describe('Unified Navigation - no channels', () => {
  test.use({ storageState: AUTH_STATE.none });

  test('shows "No active channel" and hides channel-only links', async ({ page }) => {
    await page.goto('/en');
    const menu = await openAccountMenu(page);

    await expect(menu.getByTestId('nav-no-active-channel')).toBeVisible();
    await expect(menu.getByTestId('nav-channel-option')).toHaveCount(0);
    await expect(menu.getByTestId('nav-channel-option-none')).toHaveAttribute('aria-checked', 'true');
    await expect(menu.locator('a[role="menuitem"][href="/en/feed"]')).toBeVisible();
    await expect(menu.locator('a[role="menuitem"][href="/en/dashboard/videos"]')).toHaveCount(0);
  });
});

test.describe('Unified Navigation - Arabic (RTL)', () => {
  test.use({ storageState: AUTH_STATE.single });

  test.beforeEach(async ({ page }) => {
    await page.goto('/ar');
  });

  test('menu is RTL and shows the context card', async ({ page }) => {
    const { email } = readAccount('single');
    const menu = await openAccountMenu(page);

    await expect(menu).toHaveAttribute('dir', 'rtl');
    await expect(menu.getByTestId('nav-active-context')).toContainText(email);
  });

  test('shows Arabic navigation links', async ({ page }) => {
    const menu = await openAccountMenu(page);

    await expect(menu.getByText('التنقل', { exact: true })).toBeVisible();
    await expect(menu.getByRole('menuitem', { name: 'فيديوهاتي' })).toHaveAttribute('href', '/ar/dashboard/videos');
    await expect(menu.locator('a[role="menuitem"][href="/ar/feed"]')).toBeVisible();
  });

  test('shows Arabic Add Account and Sign Out', async ({ page }) => {
    const menu = await openAccountMenu(page);

    await expect(menu.getByTestId('nav-add-account')).toHaveText(/إضافة حساب آخر/);
    await expect(menu.getByTestId('nav-sign-out')).toHaveText(/تسجيل الخروج من/);
  });

  test('closes on Escape', async ({ page }) => {
    const menu = await openAccountMenu(page);
    await page.keyboard.press('Escape');
    await expect(menu).toBeHidden();
  });

  test('links the active channel to the Arabic channel page', async ({ page }) => {
    const { channels } = readAccount('single');
    const menu = await openAccountMenu(page);

    await expect(menu.getByTestId('nav-active-channel')).toHaveAttribute('href', `/ar/channels/${channels[0].id}`);
  });
});

test.describe('Side drawer - theme and language', () => {
  test.use({ storageState: ANONYMOUS_STATE });

  test('toggles dark mode', async ({ page }) => {
    await page.goto('/en');
    const html = page.locator('html');
    const drawer = await openSideDrawer(page);

    const toggle = drawer.getByTestId('theme-toggle');
    const wasDark = ((await html.getAttribute('class')) || '').includes('dark');
    await toggle.click();
    if (wasDark) {
      await expect(html).not.toHaveClass(/\bdark\b/);
      await expect(toggle).toHaveAccessibleName('Dark Mode');
    } else {
      await expect(html).toHaveClass(/\bdark\b/);
      await expect(toggle).toHaveAccessibleName('Light Mode');
    }
  });

  test('switches English to Arabic', async ({ page }) => {
    await page.goto('/en');
    const drawer = await openSideDrawer(page);

    const toggle = drawer.getByTestId('language-toggle');
    await expect(toggle).toHaveAccessibleName('Switch to العربية');
    await toggle.click();

    await expect(page).toHaveURL(/\/ar\/?$/);
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.locator('html')).toHaveAttribute('lang', 'ar');
  });

  test('switches Arabic to English', async ({ page }) => {
    await page.goto('/ar');
    const drawer = await openSideDrawer(page);

    const toggle = drawer.getByTestId('language-toggle');
    await expect(toggle).toHaveAccessibleName('التبديل إلى English');
    await toggle.click();

    await expect(page).toHaveURL(/\/en\/?$/);
    await expect(page.locator('html')).toHaveAttribute('dir', 'ltr');
  });

  test('drawer lists the main links and closes', async ({ page }) => {
    await page.goto('/en');
    const drawer = await openSideDrawer(page);

    await expect(drawer.getByRole('link', { name: 'Home' })).toHaveAttribute('href', /^\/en\/?$/);
    await expect(drawer.getByRole('link', { name: 'Search' })).toHaveAttribute('href', '/en/search');
    // Anonymous users (no active channel) don't get the Upload link
    await expect(drawer.getByRole('link', { name: 'Upload' })).toHaveCount(0);

    await drawer.getByTestId('nav-drawer-close').click();
    await expect(drawer).toBeHidden();
  });
});

test.describe('Side drawer - channel owner', () => {
  test.use({ storageState: AUTH_STATE.single });

  test('includes the Upload link', async ({ page }) => {
    await page.goto('/en');
    const drawer = await openSideDrawer(page);
    await expect(drawer.getByRole('link', { name: 'Upload' })).toHaveAttribute('href', '/en/upload');
  });
});
