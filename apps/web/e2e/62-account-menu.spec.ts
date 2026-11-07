import { test, expect } from './fixtures';
import { AUTH_STATE, combinedSessionState, readAccount } from './test-utils/auth-state';
import { menuTrigger, openAccountMenu } from './test-utils/navigation';

/**
 * Header account menu: links to the signed-in pages (feed, subscriptions,
 * analytics, settings), keyboard use and the multi-account view. Channel
 * switching/creation is covered in 09, account switching in 11.
 */

const SIGNED_IN_LINKS = ['feed', 'history', 'subscriptions', 'analytics', 'settings'];

test.describe('Account menu - links', () => {
  test.use({ storageState: AUTH_STATE.single });

  test('NAV-050 links to subscriptions, analytics and settings', async ({ page }) => {
    await page.goto('/en');
    const menu = await openAccountMenu(page);
    for (const path of SIGNED_IN_LINKS) {
      await expect(menu.locator(`a[role="menuitem"][href="/en/${path}"]`)).toBeVisible();
    }
    await expect(menu.getByRole('menuitem', { name: 'Settings', exact: true })).toHaveAttribute('href', '/en/settings');
    await expect(menu.getByRole('menuitem', { name: 'Analytics', exact: true })).toHaveAttribute('href', '/en/analytics');
    await expect(menu.getByRole('menuitem', { name: 'Subscriptions', exact: true })).toHaveAttribute('href', '/en/subscriptions');
  });

  for (const [path, heading] of [
    ['settings', /^Settings$/],
    ['subscriptions', /^My Subscriptions$/],
    ['feed', /^Subscription Feed$/],
  ] as const) {
    test(`NAV-051 menu link opens /${path} and closes the menu`, async ({ page }) => {
      await page.goto('/en');
      const menu = await openAccountMenu(page);
      await menu.locator(`a[role="menuitem"][href="/en/${path}"]`).click();
      await expect(page).toHaveURL(new RegExp(`/en/${path}$`));
      await expect(menu).toBeHidden();
      await expect(page.getByRole('heading', { level: 1, name: heading })).toBeVisible();
    });
  }

  test('NAV-052 Arabic menu links use the Arabic locale and labels', async ({ page }) => {
    await page.goto('/ar');
    const menu = await openAccountMenu(page);
    await expect(menu.getByRole('menuitem', { name: 'الاشتراكات', exact: true })).toHaveAttribute('href', '/ar/subscriptions');
    await expect(menu.getByRole('menuitem', { name: 'التحليلات', exact: true })).toHaveAttribute('href', '/ar/analytics');
    await expect(menu.getByRole('menuitem', { name: 'الإعدادات', exact: true })).toHaveAttribute('href', '/ar/settings');
  });

  test('NAV-053 menu trigger exposes haspopup, label-in-name and toggles aria-expanded', async ({ page, isMobile }) => {
    await page.goto('/en');
    const trigger = menuTrigger(page);
    await expect(trigger).toHaveAttribute('aria-haspopup', 'menu');
    // Label-in-name (WCAG 2.5.3): the visible account name is part of the accessible
    // name; phones hide the name text, leaving the avatar + "Navigation menu"
    await expect(trigger).toHaveAccessibleName(
      isMobile ? 'Navigation menu' : /^Single Channel User .*Navigation menu$/,
    );
    await expect(trigger).toHaveAttribute('aria-expanded', 'false');
    await openAccountMenu(page);
    await expect(trigger).toHaveAttribute('aria-expanded', 'true');
    await page.keyboard.press('Escape');
    await expect(trigger).toHaveAttribute('aria-expanded', 'false');
  });
});

test.describe('Account menu - no channel', () => {
  test.use({ storageState: AUTH_STATE.none });

  test('NAV-054 signed-in links are offered without a channel', async ({ page }) => {
    await page.goto('/en');
    const menu = await openAccountMenu(page);
    for (const path of SIGNED_IN_LINKS) {
      await expect(menu.locator(`a[role="menuitem"][href="/en/${path}"]`)).toBeVisible();
    }
    await expect(menu.locator('a[role="menuitem"][href="/en/scheduled-videos"]')).toHaveCount(0);
  });
});

test.describe('Account menu - two accounts', () => {
  test.use({
    // Playwright fixture callback, not a React hook
    // eslint-disable-next-line react-hooks/rules-of-hooks
    storageState: async ({}, use) => use(combinedSessionState('none', 'single')),
  });

  test('NAV-055 lists both accounts; the active one has no channels', async ({ page }) => {
    const none = readAccount('none');
    const single = readAccount('single');
    await page.goto('/en');
    const menu = await openAccountMenu(page);

    const accounts = menu.getByTestId('nav-account');
    await expect(accounts).toHaveCount(2);
    await expect(accounts.filter({ hasText: none.email })).toHaveAttribute('data-active', 'true');
    await expect(accounts.filter({ hasText: single.email })).toHaveAttribute('data-active', 'false');
    await expect(menu.getByTestId('nav-no-active-channel')).toBeVisible();
    await expect(menu.getByRole('menuitem', { name: /Sign out of all accounts/ })).toBeVisible();
  });

  test('NAV-056 switching to the channel account shows its channel and upload shortcut', async ({ page, isMobile }) => {
    const single = readAccount('single');
    await page.goto('/en');
    let menu = await openAccountMenu(page);
    await menu.getByTestId('nav-account').filter({ hasText: single.email }).getByRole('menuitem').first().click();

    menu = await openAccountMenu(page);
    await expect(menu.getByTestId('nav-active-channel')).toHaveAttribute('href', `/en/channels/${single.channels[0].id}`);
    await page.keyboard.press('Escape');
    const upload = page.getByRole('banner').getByRole('link', { name: /Upload Video/ });
    await expect(upload).toHaveAttribute('href', '/en/upload');
    if (!isMobile) await expect(upload).toBeVisible();
  });
});
