import { test, expect } from './fixtures';
import type { Locator, Page } from '@playwright/test';
import { AUTH_STATE, readAccount } from './test-utils/auth-state';
import { menuTrigger, openAccountMenu } from './test-utils/navigation';

/**
 * Channel switching via the header account menu.
 *
 * Uses the multi-channel E2E user (two channels, "One" is main). Switching
 * only rewrites this test context's session cookie, so tests stay isolated.
 * Channel creation runs as the `scratch` user, never `multi`: other specs count
 * multi's channels and read its active channel. Created channels are deleted
 * through the API afterwards (and leftovers by the auth setup).
 */

const API_URL = process.env.API_URL || 'https://videos.api.qa.alummahnow.net';

function multiChannels() {
  const { channels } = readAccount('multi');
  const main = channels.find((c) => c.isMain) ?? channels[0];
  const other = channels.find((c) => c.id !== main.id)!;
  return { main, other };
}

function option(menu: Locator, channelId: string): Locator {
  return menu.locator(`[data-testid="nav-channel-option"][data-channel-id="${channelId}"]`);
}

async function switchTo(page: Page, channelId: string | null) {
  const menu = await openAccountMenu(page);
  const target = channelId ? option(menu, channelId) : menu.getByTestId('nav-channel-option-none');
  await target.click();
  // Switching refreshes the page data; the menu can close while that happens,
  // so reopen it if needed before checking the selection
  await expect(async () => {
    if (!(await menu.isVisible())) await menuTrigger(page).click();
    await expect(target).toHaveAttribute('aria-checked', 'true', { timeout: 5000 });
  }).toPass();
  return menu;
}

/**
 * Deletes the scratch user's channels with this exact name through the API.
 * Looked up by name so a channel is cleaned up even if the UI assertion that
 * would have revealed its id failed.
 */
async function deleteChannelsNamed(name: string) {
  const { accessToken, userId } = readAccount('scratch');
  const headers = { Authorization: `Bearer ${accessToken}` };
  const res = await fetch(`${API_URL}/api/channels?limit=1000`, { headers });
  const body = (await res.json()) as { data?: Array<{ id: string; name: string; userId: string }> };
  for (const channel of (body.data ?? []).filter((c) => c.userId === userId && c.name === name)) {
    await fetch(`${API_URL}/api/channels/${channel.id}`, { method: 'DELETE', headers });
  }
}

/** Creates a channel through the menu form; the caller deletes it by name. */
async function createChannelViaMenu(page: Page, name: string, placeholder: string, createLabel: string) {
  const menu = await openAccountMenu(page);
  await menu.getByTestId('nav-create-channel').click();
  const input = menu.getByPlaceholder(placeholder);
  const create = menu.getByRole('button', { name: createLabel, exact: true });
  // Retried: a re-render right after opening the form can drop the typed value
  await expect(async () => {
    if ((await input.inputValue()) !== name) await input.fill(name);
    await expect(create).toBeEnabled({ timeout: 2000 });
  }).toPass({ timeout: 20000 });
  await create.click();

  const created = menu.getByTestId('nav-channel-option').filter({ hasText: name });
  await expect(created).toBeVisible();
  await expect(created).toHaveAttribute('data-channel-id', /.+/);
  // The form closes and can be opened again
  await expect(menu.getByTestId('nav-create-channel')).toBeVisible();
}

test.describe('Channel Switching - English', () => {
  test.use({ storageState: AUTH_STATE.multi });

  test.beforeEach(async ({ page }) => {
    await page.goto('/en');
  });

  test('shows the active channel in the menu button on desktop', async ({ page }) => {
    const { main } = multiChannels();
    const trigger = menuTrigger(page);
    await expect(trigger).toBeVisible();
    if ((page.viewportSize()?.width ?? 0) >= 768) {
      await expect(trigger).toContainText(main.name!);
    } else {
      // The name/channel block is hidden on small screens
      await expect(trigger.getByText(main.name!)).toBeHidden();
    }
  });

  test('lists both channels with the main channel active and crowned', async ({ page }) => {
    const { main, other } = multiChannels();
    const menu = await openAccountMenu(page);

    // Exact counts are avoided: the channel-creation tests below briefly add
    // channels to this user while other tests run in parallel
    await expect(option(menu, main.id)).toBeVisible();
    await expect(option(menu, other.id)).toBeVisible();
    await expect(option(menu, main.id)).toHaveAttribute('aria-checked', 'true');
    await expect(option(menu, other.id)).toHaveAttribute('aria-checked', 'false');
    await expect(option(menu, main.id).locator('svg.lucide-crown')).toBeVisible();
    await expect(option(menu, other.id).locator('svg.lucide-crown')).toHaveCount(0);
  });

  test('switches between channels', async ({ page }) => {
    const { main, other } = multiChannels();
    const menu = await switchTo(page, other.id);

    await expect(option(menu, main.id)).toHaveAttribute('aria-checked', 'false');
    await expect(menu.getByTestId('nav-active-channel')).toHaveAttribute('href', `/en/channels/${other.id}`);

    await switchTo(page, main.id);
    await expect(menu.getByTestId('nav-active-channel')).toHaveAttribute('href', `/en/channels/${main.id}`);
  });

  test('persists the channel selection across navigation', async ({ page }) => {
    const { other } = multiChannels();
    await switchTo(page, other.id);

    await page.goto('/en/profile');
    const menu = await openAccountMenu(page);
    await expect(option(menu, other.id)).toHaveAttribute('aria-checked', 'true');
    await expect(menu.getByTestId('nav-active-channel')).toContainText(other.name!);
  });

  test('switches to "No Channel" mode', async ({ page }) => {
    const menu = await switchTo(page, null);

    await expect(menu.getByTestId('nav-no-active-channel')).toHaveText(/No active channel/);
    await expect(menu.getByTestId('nav-active-channel')).toHaveCount(0);
    for (const ch of [multiChannels().main, multiChannels().other]) {
      await expect(option(menu, ch.id)).toHaveAttribute('aria-checked', 'false');
    }
    // The upload shortcut needs an active channel
    await expect(page.getByRole('banner').getByRole('link', { name: /Upload Video/ })).toHaveCount(0);
  });
});

test.describe('Channel Switching - Arabic', () => {
  test.use({ storageState: AUTH_STATE.multi });

  test.beforeEach(async ({ page }) => {
    await page.goto('/ar');
  });

  test('switches to "No Channel" mode (RTL)', async ({ page }) => {
    const menu = await switchTo(page, null);
    await expect(menu).toHaveAttribute('dir', 'rtl');
    await expect(menu.getByTestId('nav-no-active-channel')).toHaveText(/لا توجد قناة نشطة/);
  });

  test('switches channel and links to the Arabic channel page', async ({ page }) => {
    const { other } = multiChannels();
    const menu = await switchTo(page, other.id);
    await expect(menu.getByTestId('nav-active-channel')).toHaveAttribute('href', `/ar/channels/${other.id}`);
  });

  test('marks the main channel with a crown (RTL)', async ({ page }) => {
    const { main } = multiChannels();
    const menu = await openAccountMenu(page);
    await expect(option(menu, main.id).locator('svg.lucide-crown')).toBeVisible();
  });
});

test.describe('Channel Switching - create a channel', () => {
  test.use({ storageState: AUTH_STATE.scratch });

  test('creates a new channel', async ({ page }) => {
    await page.goto('/en');
    const name = `E2E Temp Channel ${Date.now()}`;
    try {
      await createChannelViaMenu(page, name, 'Enter channel name', 'Create');
    } finally {
      await deleteChannelsNamed(name);
    }
  });

  test('creates a channel with an Arabic name', async ({ page }) => {
    await page.goto('/ar');
    const name = `قناة اختبار ${Date.now()}`;
    try {
      await createChannelViaMenu(page, name, 'أدخل اسم القناة', 'إنشاء');
    } finally {
      await deleteChannelsNamed(name);
    }
  });
});
