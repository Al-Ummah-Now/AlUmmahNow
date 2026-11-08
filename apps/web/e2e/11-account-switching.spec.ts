import { test, expect } from './fixtures';
import type { Locator } from '@playwright/test';
import { combinedSessionState, readAccount } from './test-utils/auth-state';
import { openAccountMenu } from './test-utils/navigation';

/**
 * Account switching with two signed-in accounts.
 *
 * The context starts with a multi-account session (single-channel user active,
 * multi-channel user as the second account) built from the stored E2E
 * sessions. Switching only rewrites this context's cookie; the tests never
 * sign out, so the stored sessions stay valid for other specs.
 */

test.use({
  // Playwright fixture callback, not a React hook
  // eslint-disable-next-line react-hooks/rules-of-hooks
  storageState: async ({}, use) => use(combinedSessionState('single', 'multi')),
});

function account(menu: Locator, displayName: string): Locator {
  return menu.getByTestId('nav-account').filter({ hasText: displayName });
}

test.describe('Account Switching', () => {
  test('lists both accounts with the first one active', async ({ page }) => {
    const single = readAccount('single');
    const multi = readAccount('multi');
    await page.goto('/en');
    const menu = await openAccountMenu(page);

    await expect(menu.getByText(/^ACCOUNTS \(2\)/)).toBeVisible();
    await expect(menu.getByTestId('nav-account')).toHaveCount(2);
    await expect(account(menu, single.email)).toHaveAttribute('data-active', 'true');
    await expect(account(menu, multi.email)).toHaveAttribute('data-active', 'false');
    // Not an exact count: 09-channel-switching briefly adds channels to this user
    await expect(account(menu, multi.email)).toContainText(/\d+ channels/);
    // Two accounts: "sign out of all" is offered
    await expect(menu.getByRole('menuitem', { name: /Sign out of all accounts/ })).toBeVisible();
  });

  test('switches to the other account and back', async ({ page, baseURL }) => {
    const single = readAccount('single');
    const multi = readAccount('multi');
    const errors: string[] = [];
    page.on('response', (r) => {
      if (r.status() >= 500 && baseURL && r.url().startsWith(baseURL)) errors.push(`${r.status()} ${r.url()}`);
    });
    await page.goto('/en');

    let menu = await openAccountMenu(page);
    await account(menu, multi.email).getByRole('menuitem').click();

    menu = await openAccountMenu(page);
    await expect(account(menu, multi.email)).toHaveAttribute('data-active', 'true');
    await expect(menu.getByTestId('nav-active-context')).toContainText(multi.email);
    // The active account's channels are listed
    for (const ch of multi.channels) {
      await expect(menu.locator(`[data-testid="nav-channel-option"][data-channel-id="${ch.id}"]`)).toBeVisible();
    }

    await account(menu, single.email).getByRole('menuitem').click();
    menu = await openAccountMenu(page);
    await expect(account(menu, single.email)).toHaveAttribute('data-active', 'true');
    await expect(menu.getByTestId('nav-channel-option')).toHaveCount(1);

    expect(errors).toEqual([]);
  });

  test('switching accounts away from profile/create returns home', async ({ page }) => {
    const multi = readAccount('multi');
    // Users with a profile are sent home from /profile/create by ProfileGuard
    await page.goto('/en/profile/create');
    await expect(page).toHaveURL(/\/en\/?$/);

    const menu = await openAccountMenu(page);
    await account(menu, multi.email).getByRole('menuitem').click();

    await expect(page).toHaveURL(/\/en\/?$/);
    const reopened = await openAccountMenu(page);
    await expect(account(reopened, multi.email)).toHaveAttribute('data-active', 'true');
  });

  test('keeps the active channel per account', async ({ page }) => {
    const single = readAccount('single');
    const multi = readAccount('multi');
    await page.goto('/en');

    let menu = await openAccountMenu(page);
    await account(menu, multi.email).getByRole('menuitem').click();
    const second = multi.channels.find((c) => !c.isMain)!;
    const optionSelector = `[data-testid="nav-channel-option"][data-channel-id="${second.id}"]`;
    // The menu re-renders (and may close) while the account switch settles:
    // reopen it and click until the second channel is the checked one
    await expect(async () => {
      menu = await openAccountMenu(page);
      const option = menu.locator(optionSelector);
      if ((await option.getAttribute('aria-checked')) !== 'true') await option.click();
      menu = await openAccountMenu(page);
      await expect(menu.locator(optionSelector)).toHaveAttribute('aria-checked', 'true', { timeout: 3000 });
    }).toPass({ timeout: 30000 });

    // Back to the single account: its own channel is active
    await account(menu, single.email).getByRole('menuitem').click();
    menu = await openAccountMenu(page);
    await expect(menu.getByTestId('nav-active-channel')).toHaveAttribute('href', `/en/channels/${single.channels[0].id}`);

    // And the multi account remembers its second channel
    await account(menu, multi.email).getByRole('menuitem').click();
    menu = await openAccountMenu(page);
    await expect(menu.getByTestId('nav-active-channel')).toHaveAttribute('href', `/en/channels/${second.id}`);
  });

  test('works in Arabic (RTL)', async ({ page }) => {
    const multi = readAccount('multi');
    await page.goto('/ar');

    let menu = await openAccountMenu(page);
    await expect(menu).toHaveAttribute('dir', 'rtl');
    await expect(menu.getByText(/^الحسابات \(2\)/)).toBeVisible();
    await account(menu, multi.email).getByRole('menuitem').click();

    menu = await openAccountMenu(page);
    await expect(account(menu, multi.email)).toHaveAttribute('data-active', 'true');
    await expect(menu.getByTestId('nav-active-channel')).toHaveAttribute('href', /^\/ar\/channels\//);
  });
});
