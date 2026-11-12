/**
 * Live streaming page (D3), end to end on QA:
 *
 * - LIVE-01 the mode changes at once (no dialog) with an Undo toast, and Undo
 *   puts the previous mode back in admin-api.
 * - LIVE-02 a channel override is set through the shared channel picker (it
 *   opens with content; no raw id field), listed, and its Undo removes it.
 * - LIVE-03 turning Bunny off asks in the in-app dialog (Cancel keeps it on),
 *   Confirm turns it off, and turning it on again needs no dialog.
 *
 * Shared state: the routing settings are one document per environment, so
 * this spec runs once per run in the shared-state project (under the qa-global
 * lock) and puts every setting it touched back afterwards. Bunny is the
 * provider it toggles: on QA it is not available yet (closed preview), so no
 * real stream is affected. Data: one throwaway channel made by the seeded
 * super admin and deleted afterwards. PR runs skip while QA predates the page.
 */
import type { Page } from '@playwright/test';
import { test, expect } from './support/fixtures';
import { adminApi, readTokens } from './support/api';
import { RUN_ID, VIDEOS_API_URL, ADMIN_WEB_URL, accounts } from './support/env';
import { createVideosProfile } from './support/profiles';

interface LiveSettings {
  /** null while the environment runs on the shipped defaults (no settings saved yet) */
  updatedAt: string | null;
  mode: string;
  bunnyPercent: number;
  providers: Record<'bunny' | 'selfhosted', { enabled: boolean; draining: boolean; note: string | null }>;
}
interface LiveView {
  settings: LiveSettings;
  overrides: { channelId: string; provider: string; note: string | null }[];
}

const superToken = () => readTokens().superadmin;
let channelId = '';
let channelName = '';
let original: LiveView | null = null;

async function liveView(): Promise<LiveView> {
  const { status, body } = await adminApi<LiveView>('/api/content/live/settings');
  expect(status, 'admin-api live settings').toBe(200);
  return body.result!;
}

async function openPage(page: Page) {
  page.on('dialog', (d) => {
    throw new Error(`A browser dialog opened: ${d.type()} ${d.message()}`);
  });
  await page.goto('/live-streaming');
  await expect(page.getByTestId('live-streaming')).toBeVisible();
  await expect(page.getByTestId('live-applies-note')).toContainText('within 15 s');
}

test.describe('live streaming', () => {
  test.describe.configure({ mode: 'serial' });

  test.beforeAll(async () => {
    const api = await adminApi('/api/content/live/settings');
    const web = await fetch(`${ADMIN_WEB_URL}/api/content/live/settings`, { redirect: 'manual' });
    if (process.env.GITHUB_EVENT_NAME === 'pull_request') {
      test.skip(api.status === 404 || web.status === 404, 'QA predates the live streaming page; runs once it is on QA');
    }
    original = await liveView();

    const tag = `${RUN_ID || 'local'}-${Date.now().toString(36)}`;
    channelName = `E2E live ${tag}`;
    const createChannel = () =>
      fetch(`${VIDEOS_API_URL}/api/channels`, {
        method: 'POST',
        headers: { authorization: `Bearer ${superToken()}`, 'content-type': 'application/json' },
        body: JSON.stringify({ name: channelName, description: '[e2e-admin] live streaming override', isMain: false }),
      });
    let res = await createChannel();
    // The shared-state job starts on a fresh stack: the super admin has no videos profile there yet
    if (res.status === 404) {
      await createVideosProfile(superToken(), accounts.superadmin.email, 'E2E super admin');
      res = await createChannel();
    }
    const created = (await res.json().catch(() => ({}))) as { result?: { channel?: { id?: string } } };
    channelId = created.result?.channel?.id ?? '';
    expect(channelId, `channel create -> ${res.status}`).toBeTruthy();
    // The picker searches the admin index, which the processor fills a moment after the create
    await expect
      .poll(async () => {
        const { body } = await adminApi<{ items: { id: string }[] }>(`/api/suggest/channel?q=${encodeURIComponent(channelName)}`);
        return body.result?.items.some((i) => i.id === channelId) ?? false;
      }, { message: 'channel in the picker\'s index', timeout: 90_000, intervals: [2_000, 5_000] })
      .toBe(true);
  });

  test.afterAll(async () => {
    if (original && original.settings.updatedAt === null) {
      // Nothing was saved before this spec: back to the defaults, leaving no settings row behind
      await adminApi('/api/content/live/settings', { method: 'DELETE', body: '{}' }).catch(() => undefined);
    } else if (original) {
      const { settings } = original;
      await adminApi('/api/content/live/settings', {
        method: 'PUT',
        body: JSON.stringify({
          mode: settings.mode,
          bunnyPercent: settings.bunnyPercent,
          providers: { bunny: { enabled: settings.providers.bunny.enabled, draining: settings.providers.bunny.draining, note: settings.providers.bunny.note } },
        }),
      }).catch(() => undefined);
    }
    if (channelId) {
      await adminApi(`/api/content/live/overrides/${encodeURIComponent(channelId)}`, { method: 'DELETE', body: '{}' }).catch(() => undefined);
      await adminApi(`/api/content/channels/${encodeURIComponent(channelId)}`, { method: 'DELETE', token: superToken() }).catch(() => undefined);
    }
  });

  test('LIVE-01 the mode changes at once with Undo', async ({ page }) => {
    await openPage(page);
    const from = (await liveView()).settings.mode;
    const to = from === 'only_selfhosted' ? 'round_robin' : 'only_selfhosted';

    await page.getByTestId(`live-mode-${to}`).check();
    const toast = page.getByTestId('undo-toast').filter({ hasText: 'Routing set to' });
    await expect(toast).toHaveAttribute('data-status', 'done');
    await expect(page.getByTestId('live-streaming')).toHaveAttribute('data-mode', to);
    await expect.poll(async () => (await liveView()).settings.mode, { message: 'saved in admin-api' }).toBe(to);

    await toast.getByTestId('undo-toast-undo').click();
    await expect(page.getByTestId('undo-toast').filter({ hasText: 'Undone' })).toBeVisible();
    await expect(page.getByTestId('live-streaming')).toHaveAttribute('data-mode', from);
    await expect.poll(async () => (await liveView()).settings.mode, { message: 'undone in admin-api' }).toBe(from);
  });

  test('LIVE-02 a channel override is set through the picker and undone', async ({ page }) => {
    await openPage(page);
    const input = page.getByTestId('live-override-channel-input');
    await input.click();
    // The picker opens with content before anything is typed (where the build has it), then narrows as the admin types
    await input.fill(channelName);
    await page.getByTestId('live-override-channel-option').filter({ hasText: channelName }).first().click();
    await expect(page.getByTestId('live-override-channel-chip')).toHaveAttribute('data-id', channelId);
    await page.getByTestId('live-override-provider').selectOption('selfhosted');
    await page.getByTestId('live-override-add').click();

    const row = page.locator(`[data-testid="live-override-row"][data-channel-id="${channelId}"]`);
    await expect(row).toHaveAttribute('data-provider', 'selfhosted');
    await expect.poll(async () => (await liveView()).overrides.find((o) => o.channelId === channelId)?.provider ?? null).toBe('selfhosted');

    const toast = page.getByTestId('undo-toast').filter({ hasText: channelName });
    await toast.getByTestId('undo-toast-undo').click();
    await expect(row).toHaveCount(0);
    await expect.poll(async () => (await liveView()).overrides.some((o) => o.channelId === channelId)).toBe(false);
  });

  test('LIVE-03 turning a provider off asks in the in-app dialog; turning it on does not', async ({ page }) => {
    await openPage(page);
    const card = page.getByTestId('live-provider-bunny');
    const toggle = page.getByTestId('live-enabled-bunny');
    if ((await card.getAttribute('data-enabled')) === 'false') {
      await toggle.click();
      await expect(card).toHaveAttribute('data-enabled', 'true');
    }
    // Not available on QA is shown as a status, never as an error
    await expect(page.getByTestId('live-available-bunny')).toBeVisible();

    const dialog = page.getByTestId('live-disable-dialog');
    await toggle.click();
    await expect(dialog).toBeVisible();
    await page.getByTestId('live-disable-cancel').click();
    await expect(dialog).toBeHidden();
    await expect(card).toHaveAttribute('data-enabled', 'true');

    await toggle.click();
    await expect(dialog).toBeVisible();
    await page.getByTestId('live-disable-confirm').click();
    await expect(card).toHaveAttribute('data-enabled', 'false');
    await expect.poll(async () => (await liveView()).settings.providers.bunny.enabled).toBe(false);

    await toggle.click();
    await expect(dialog).toBeHidden();
    await expect(card).toHaveAttribute('data-enabled', 'true');
    await expect.poll(async () => (await liveView()).settings.providers.bunny.enabled).toBe(true);
  });
});
