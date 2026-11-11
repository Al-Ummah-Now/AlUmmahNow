import { expect, type Page } from '@playwright/test';
import { target } from './targets';
import { apiFetch, menuTrigger, openMenuUntil, type WebUser } from './web-session';

/**
 * Clicks a first-level item of the videos header's account menu (Add account,
 * Sign out...). Opens the menu, or steps back out of a submenu (accounts,
 * channels), until the item shows.
 */
export async function clickAccountMenuItem(page: Page, testId: string): Promise<void> {
  const item = page.locator(`[data-testid="${testId}"]:visible`).first();
  await openMenuUntil(page, item);
  await item.click();
}

/**
 * Creates a channel the way users do (account menu), which also refreshes the
 * web session's channels: a channel created only through the API is not in
 * the session until its channel list is reloaded, so /upload would still say
 * "Channel required". The user needs a creator tier first. Returns its id.
 */
export async function createChannelInMenu(page: Page, user: WebUser, name: string): Promise<string> {
  // Consent already answered, so the banner does not cover the account menu
  await page.context().addCookies([{ name: 'aun_consent', value: `v1.a0.e0.p0.${Date.now()}`, url: target().web, sameSite: 'Lax' }]);
  await page.goto(`${target().web}/en`);
  await submitNewChannelInMenu(page, name);
  let channelId = '';
  await expect
    .poll(async () => {
      const res = await apiFetch(user, '/api/channels?limit=100');
      const body = (await res.json().catch(() => ({}))) as { data?: Array<{ id: string; name: string }> };
      channelId = body.data?.find((c) => c.name === name)?.id ?? '';
      return channelId;
    }, { message: 'the channel created in the account menu is not in GET /api/channels', timeout: 30000 })
    .not.toBe('');
  return channelId;
}

/**
 * Account menu → (Switch channel →) Create channel → name → Enter, on the page
 * already open, and waits until the form closes: the channel exists and the
 * session's channels are reloaded (navigating before that loses the reload).
 * Opening is retried until Create shows: right after a page load the header's
 * click handlers may not be attached yet, and a dropped click used to leave the
 * spec waiting 15 s for a menu that never opened.
 */
export async function submitNewChannelInMenu(page: Page, name: string): Promise<void> {
  const create = page.locator('[data-testid="nav-create-channel"]:visible').first();
  // Create sits in the channel switcher once the account has channels
  const switchChannel = page.locator('[data-testid="nav-switch-channel"]:visible').first();
  await expect(async () => {
    if (!(await create.isVisible())) {
      if (await switchChannel.isVisible()) await switchChannel.click({ timeout: 5000 });
      else await menuTrigger(page).click({ timeout: 10000 });
    }
    await expect(create).toBeVisible({ timeout: 3000 });
  }).toPass({ timeout: 45000 });
  await create.click();
  const nameInput = page.locator('[role="menu"] input[type="text"]:visible').first();
  await expect(nameInput).toBeEditable({ timeout: 15000 });
  await nameInput.fill(name);
  await expect(nameInput).toHaveValue(name);
  await nameInput.press('Enter');
  await expect(nameInput).toBeHidden({ timeout: 30000 });
}
