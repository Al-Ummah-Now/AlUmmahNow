import { expect, type Page } from '@playwright/test';
import { target } from './targets';
import { apiFetch, type WebUser } from './web-session';

/**
 * Clicks a first-level item of the videos header's account menu (Add account,
 * Sign out...). Opens the menu, or steps back out of a submenu (accounts,
 * channels), until the item shows.
 */
export async function clickAccountMenuItem(page: Page, testId: string): Promise<void> {
  const item = page.locator(`[data-testid="${testId}"]:visible`).first();
  await expect(async () => {
    if (!(await item.isVisible())) {
      const back = page.locator('[data-testid="nav-menu-back"]:visible').first();
      if (await back.isVisible()) await back.click();
      else await page.locator('[data-testid="nav-menu-trigger"]:visible').first().click();
    }
    await expect(item).toBeVisible({ timeout: 3000 });
  }).toPass({ timeout: 30000 });
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
  await page.getByTestId('nav-menu-trigger').click();
  // Create sits in the channel switcher once the account has channels
  const switchChannel = page.getByTestId('nav-switch-channel');
  await switchChannel.or(page.getByTestId('nav-create-channel')).first().waitFor();
  if (await switchChannel.isVisible()) await switchChannel.click();
  await page.getByTestId('nav-create-channel').click();
  const nameInput = page.locator('[role="menu"] input[type="text"]').first();
  await nameInput.fill(name);
  await nameInput.press('Enter');
  // The form closes once the channel exists and the session's channels are
  // reloaded; navigating before that loses the reload
  await expect(nameInput).toBeHidden({ timeout: 30000 });
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
