import { test, expect } from './fixtures';
import { AUTH_STATE, ANONYMOUS_STATE, readSession } from './test-utils/auth-state';
import { userApi, API_URL } from './test-utils/e2e-videos';

/**
 * Story 29.1: @handle channel URLs, About tab, owner actions and the channel
 * delete flow (incl. the profile notice afterwards).
 *
 * Each describe pins its auth. Flows that change data use a throwaway channel
 * created through the API for this test and removed again in afterEach, so
 * the E2E users keep their fixed channels.
 */

interface ApiChannel {
  id: string;
  name: string;
  handle?: string;
  isMain?: boolean;
}

function uniqueSuffix(): string {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

async function createThrowawayChannel(label: string): Promise<ApiChannel> {
  const u = userApi('single');
  const res = await u.api.post<{ result: { channel: ApiChannel } }>(
    '/api/channels',
    { name: `E2E Temp Channel ${label} ${uniqueSuffix()}` },
    { token: u.token, channelId: u.channelIds[0] },
  );
  return res.data.result.channel;
}

async function deleteChannelQuietly(channel: ApiChannel | null): Promise<void> {
  if (!channel) return;
  try {
    const u = userApi('single');
    await u.api.request(`/api/channels/${channel.id}`, { method: 'DELETE', token: u.token, channelId: channel.id, allowStatus: [403, 404] });
  } catch {
    // cleanup must never fail a test
  }
}

async function fetchChannel(id: string): Promise<ApiChannel> {
  const res = await fetch(`${API_URL}/api/channels/${id}`);
  return (await res.json()) as ApiChannel;
}

test.describe('Channel @handle URLs - anonymous viewer', () => {
  test.use({ storageState: ANONYMOUS_STATE });

  // New channels get a default handle; a throwaway one keeps this independent of the backfill
  let created: ApiChannel | null = null;
  test.beforeAll(async () => {
    created = await createThrowawayChannel('anon');
  });
  test.afterAll(async () => {
    await deleteChannelQuietly(created);
  });

  test('the id URL keeps working, shows no owner actions and points canonical at the @handle URL', async ({ page }) => {
    const channel = await fetchChannel(created!.id);
    expect(channel.handle).toBeTruthy();

    await page.goto(`/en/channels/${channel.id}`);
    await expect(page.getByTestId('channel-handle')).toHaveText(`@${channel.handle}`);
    await expect(page.getByTestId('channel-owner-actions')).toHaveCount(0);
    await expect(page.getByRole('button', { name: /^Subscribe$/ })).toBeVisible();
    const canonical = await page.locator('link[rel="canonical"]').getAttribute('href');
    expect(canonical).toMatch(new RegExp(`/en/@${channel.handle}$`));
  });

  test('/@handle, /c/handle and a differently-cased handle resolve to the channel (LTR + RTL)', async ({ page }) => {
    const channel = await fetchChannel(created!.id);

    await page.goto(`/en/@${channel.handle}`);
    await expect(page.getByTestId('channel-handle')).toHaveText(`@${channel.handle}`);
    await expect(page).toHaveURL(new RegExp(`/en/@${channel.handle}$`));

    await page.goto(`/ar/c/${channel.handle!.toUpperCase()}`);
    await expect(page.getByTestId('channel-handle')).toHaveText(`@${channel.handle}`);
    await expect(page.locator('[dir="rtl"]').first()).toBeVisible();
  });

  test('an unknown handle shows the not-found page', async ({ page }) => {
    await page.goto(`/en/@no-such-handle-${uniqueSuffix()}`);
    // Shared localized 404 page (components/NotFoundPage; its h1 is the localized message)
    await expect(page.getByTestId('not-found-page').getByRole('heading', { level: 1 })).toBeVisible();
    await expect(page.getByTestId('channel-handle')).toHaveCount(0);
  });
});

test.describe('Channel owner actions - non-owner', () => {
  test.use({ storageState: AUTH_STATE.multi });

  test('another signed-in user sees subscribe but no owner actions', async ({ page }) => {
    const { activeChannelId } = readSession('single');
    test.skip(!activeChannelId, 'single user has no channel');
    await page.goto(`/en/channels/${activeChannelId}`);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(page.getByTestId('channel-owner-actions')).toHaveCount(0);
    await expect(page.getByRole('button', { name: /^(Subscribe|Subscribed)$/ })).toBeVisible();
  });
});

test.describe('Channel owner - handle, About and delete', () => {
  test.use({ storageState: AUTH_STATE.single });
  test.describe.configure({ mode: 'serial' });

  let channel: ApiChannel | null = null;

  test.beforeEach(async () => {
    channel = await createThrowawayChannel('owner');
  });

  test.afterEach(async () => {
    await deleteChannelQuietly(channel);
    channel = null;
  });

  test('owner sees Customize / Manage videos / overflow menu and no subscribe button', async ({ page }) => {
    await page.goto(`/en/channels/${channel!.id}`);
    const actions = page.getByTestId('channel-owner-actions');
    await expect(actions).toBeVisible();
    await expect(actions.getByRole('link', { name: 'Customize channel' })).toHaveAttribute('href', `/en/settings/channel/${channel!.id}/edit`);
    await expect(actions.getByRole('link', { name: 'Manage videos' })).toHaveAttribute('href', `/en/settings/channel/${channel!.id}/videos`);
    await expect(page.getByRole('button', { name: /^Subscribe$/ })).toHaveCount(0);

    await actions.getByRole('button', { name: 'More actions' }).click();
    await expect(page.getByRole('menuitem', { name: 'Channel settings' })).toBeVisible();
    await expect(page.getByRole('menuitem', { name: 'Delete channel' })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('menuitem', { name: 'Delete channel' })).toBeHidden();
  });

  test('Arabic owner actions are RTL and translated', async ({ page }) => {
    await page.goto(`/ar/channels/${channel!.id}`);
    const actions = page.getByTestId('channel-owner-actions');
    await expect(actions).toHaveAttribute('dir', 'rtl');
    await expect(actions.getByRole('link', { name: 'تخصيص القناة' })).toBeVisible();
    await expect(actions.getByRole('link', { name: 'إدارة الفيديوهات' })).toBeVisible();
  });

  test('claims a new handle with an availability check and fills the About tab', async ({ page }) => {
    const handle = `e2e-${uniqueSuffix()}`;
    await page.goto(`/en/settings/channel/${channel!.id}/edit`);

    const input = page.getByTestId('channel-handle-input');
    await expect(input).toHaveValue(channel!.handle || '');
    await input.fill('admin');
    await expect(page.getByTestId('channel-handle-status')).toHaveText('This handle is reserved');
    await expect(page.getByTestId('channel-edit-save')).toBeDisabled();

    await input.fill(handle);
    await expect(page.getByTestId('channel-handle-status')).toHaveText(`@${handle} is available`);

    await page.getByTestId('channel-add-link').click();
    const row = page.getByTestId('channel-link-row').first();
    await row.getByRole('textbox', { name: /Link title 1/ }).fill('Website');
    await row.getByRole('textbox', { name: /URL .* 1/ }).fill('javascript:alert(1)');
    await expect(page.getByTestId('channel-edit-save')).toBeDisabled();
    await row.getByRole('textbox', { name: /URL .* 1/ }).fill('https://example.org/');
    await page.getByTestId('channel-location-input').fill('Cairo');
    await page.getByTestId('channel-contact-input').fill('e2e@example.org');

    await page.getByTestId('channel-edit-save').click();
    await expect(page).toHaveURL(new RegExp(`/en/@${handle}$`), { timeout: 60000 });
    await expect(page.getByTestId('channel-handle')).toHaveText(`@${handle}`);

    await page.goto(`/en/@${handle}?tab=about`);
    const about = page.getByTestId('tabpanel-about');
    await expect(about.getByTestId('about-location')).toContainText('Cairo');
    await expect(about.getByTestId('about-contact')).toHaveText('e2e@example.org');
    const link = about.getByRole('link', { name: 'Website' });
    await expect(link).toHaveAttribute('href', 'https://example.org/');
    await expect(link).toHaveAttribute('rel', 'nofollow noopener noreferrer ugc');
    await expect(about.getByTestId('about-joined')).toContainText('Joined');
    await expect(about.getByTestId('about-videos')).toHaveText('0');

    // Arabic About tab
    await page.goto(`/ar/@${handle}?tab=about`);
    await expect(page.getByTestId('tabpanel-about')).toHaveAttribute('dir', 'rtl');
    await expect(page.getByTestId('about-joined')).toContainText('انضم في');
  });

  test('deletes the channel from its page after typing the name, then shows the profile notice', async ({ page }) => {
    await page.goto(`/en/channels/${channel!.id}`);
    await page.getByTestId('channel-owner-actions').getByRole('button', { name: 'More actions' }).click();
    await page.getByRole('menuitem', { name: 'Delete channel' }).click();

    const dialog = page.getByTestId('delete-channel-dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText('videos, playlists and community posts are removed');
    const confirm = dialog.getByTestId('delete-channel-confirm');
    await expect(confirm).toBeDisabled();
    await dialog.getByTestId('delete-channel-confirm-input').fill('not the name');
    await expect(confirm).toBeDisabled();
    await dialog.getByTestId('delete-channel-confirm-input').fill(channel!.name);
    await expect(confirm).toBeEnabled();
    await confirm.click();

    await expect(page).toHaveURL(/\/en\/profile\?channelDeleted=1/);
    await expect(page.getByTestId('channel-toast')).toHaveText('Channel deleted');

    const res = await fetch(`${API_URL}/api/channels/${channel!.id}`);
    expect(res.status).toBe(404);
    channel = null;
  });

  test('cancelling the delete dialog keeps the channel', async ({ page }) => {
    await page.goto(`/en/channels/${channel!.id}`);
    await page.getByTestId('channel-owner-actions').getByRole('button', { name: 'More actions' }).click();
    await page.getByRole('menuitem', { name: 'Delete channel' }).click();
    const dialog = page.getByTestId('delete-channel-dialog');
    // Focus moves into the dialog (keyboard users start at the confirmation field)
    await expect(dialog.getByTestId('delete-channel-confirm-input')).toBeFocused();
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(dialog).toBeHidden();
    // Escape closes it as well
    await page.getByTestId('channel-owner-actions').getByRole('button', { name: 'More actions' }).click();
    await page.getByRole('menuitem', { name: 'Delete channel' }).click();
    await expect(dialog).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    const res = await fetch(`${API_URL}/api/channels/${channel!.id}`);
    expect(res.status).toBe(200);
  });
});
