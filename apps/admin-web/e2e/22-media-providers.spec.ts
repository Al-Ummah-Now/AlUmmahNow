/**
 * Video providers in the admin (docs/media-delivery/PROVIDERS.md), on the local stack:
 * - Delivery page: an unsafe change (every provider off) lists its problems and cannot be saved;
 *   putting R2 first asks in the in-app dialog, saves through admin-api and survives a reload;
 *   a channel override (uploads to R2 only) is added and saved.
 * - Video page: the run's own video shows its Bunny and R2 copies; pinning it to R2 first is
 *   stored on the video; unpinning asks first and it follows the settings again.
 *
 * Provider settings are global, so the spec runs in the shared-state project and puts the settings
 * back exactly as it found them. Its channel and video are its own and deleted afterwards.
 */
import { test, expect } from './support/fixtures';
import { adminApi, readTokens } from './support/api';
import { ADMIN_WEB_URL, RUN_ID, VIDEOS_API_URL, storageStatePath } from './support/env';

/** Local stack only (placement.ts): on a deployed target this would move every viewer's playback. */
const LOCAL_STACK = /^https?:\/\/(127\.0\.0\.1|localhost)(:|\/|$)/.test(ADMIN_WEB_URL);
const superToken = () => readTokens().superadmin;

type Settings = { providers: Record<string, { enabled: boolean }>; ingest: string[]; playback: { order: string[] }; channels: Record<string, { ingest?: string[]; order?: string[] }> };

let original: Settings | null = null;
let channelId = '';
let videoId = '';

async function videosApi(path: string, init: RequestInit = {}) {
  const res = await fetch(`${VIDEOS_API_URL}${path}`, {
    ...init,
    headers: { authorization: `Bearer ${superToken()}`, 'content-type': 'application/json', ...(init.headers as Record<string, string>) },
  });
  const text = await res.text();
  return { status: res.status, body: (text ? JSON.parse(text) : {}) as { result?: Record<string, unknown> } };
}

async function providerSettings(): Promise<Settings> {
  const { status, body } = await adminApi<{ settings: Settings }>('/api/media/providers', { token: superToken() });
  expect(status, 'GET /api/media/providers').toBe(200);
  return body.result!.settings;
}

test.use({ storageState: storageStatePath('superadmin') });

test.describe('video providers', () => {
  test.describe.configure({ mode: 'serial' });

  test.beforeAll(async () => {
    test.skip(!LOCAL_STACK, 'local stack only: changes the provider settings every viewer plays from');
    original = await providerSettings();
    // Start from Bunny playing first so the R2-first change below is a change
    if (original.playback.order[0] !== 'bunny') {
      const start = { ...original, playback: { ...original.playback, order: ['bunny'] } };
      expect((await adminApi('/api/media/providers', { method: 'PUT', token: superToken(), body: JSON.stringify({ settings: start }) })).status, 'start settings').toBe(200);
    }
    const tag = `${RUN_ID || 'local'}-${Date.now().toString(36)}`;
    const channel = await videosApi('/api/channels', { method: 'POST', body: JSON.stringify({ name: `E2E providers ${tag}`, description: '[e2e-admin] providers', isMain: false }) });
    channelId = String((channel.body.result as { channel?: { id?: string } } | undefined)?.channel?.id ?? '');
    expect(channelId, `channel create -> ${channel.status}`).toBeTruthy();
    const video = await videosApi('/api/videos/upload/initiate', {
      method: 'POST',
      headers: { channelId },
      body: JSON.stringify({ title: `E2E providers video ${tag}`, description: '[e2e-admin] providers', isPublic: false, fileSize: 1024, mimeType: 'video/mp4' }),
    });
    videoId = String((video.body.result as { videoId?: string } | undefined)?.videoId ?? '');
    expect(videoId, `upload initiate -> ${video.status}`).toBeTruthy();
  });

  test.afterAll(async () => {
    if (original) {
      const { status } = await adminApi('/api/media/providers', { method: 'PUT', token: superToken(), body: JSON.stringify({ settings: original }) });
      expect(status, 'provider settings restored').toBe(200);
    }
    if (videoId) await videosApi(`/api/videos/${encodeURIComponent(videoId)}`, { method: 'DELETE', headers: { channelId } }).catch(() => undefined);
    if (channelId) await adminApi(`/api/content/channels/${encodeURIComponent(channelId)}`, { method: 'DELETE', token: superToken() }).catch(() => undefined);
  });

  test('the Delivery page refuses unsafe settings, asks before moving playback, and saves overrides', async ({ page }) => {
    await page.goto('/delivery');
    const form = page.getByTestId('providers-settings');
    await expect(form).toBeVisible();
    const save = page.getByTestId('providers-save');
    await expect(save, 'nothing to save yet').toBeDisabled();

    // Every provider off: the problems are listed and nothing can be saved
    await page.getByTestId('providers-bunny-enabled').uncheck();
    await page.getByTestId('providers-r2-enabled').uncheck();
    const problems = page.getByTestId('providers-problems');
    await expect(problems).toBeVisible();
    await expect(problems.locator('[data-problem="no_provider_enabled"]')).toBeVisible();
    await expect(save).toBeDisabled();
    await page.getByTestId('providers-reset').click();
    await expect(problems).toHaveCount(0);

    // Both providers on and serving, R2 first: a different provider plays first, so it asks
    await page.getByTestId('providers-bunny-enabled').check();
    await page.getByTestId('providers-r2-enabled').check();
    if ((await page.getByTestId('providers-order-r2').getAttribute('data-listed')) !== 'true') await page.getByTestId('providers-order-r2-on').check();
    if ((await page.getByTestId('providers-order-bunny').getAttribute('data-listed')) !== 'true') await page.getByTestId('providers-order-bunny-on').check();
    while (!(await page.getByTestId('providers-order-r2-up').isDisabled())) await page.getByTestId('providers-order-r2-up').click();
    await expect(save).toBeEnabled();
    await save.click();
    const dialog = page.getByTestId('providers-confirm-dialog');
    await expect(dialog).toBeVisible();
    await page.getByTestId('providers-confirm-confirm').click();
    await expect(page.getByTestId('providers-saved')).toHaveText(/saved/i);
    await expect.poll(async () => (await providerSettings()).playback.order[0]).toBe('r2');

    await page.reload();
    await expect(page.getByTestId('providers-order-r2-up'), 'R2 is first after a reload').toBeDisabled();
    await expect(page.getByTestId('providers-updated')).not.toHaveText(/Never changed/);

    // A channel override: this run's channel uploads to R2 only
    await page.getByTestId('providers-channel-id').fill(channelId);
    await page.getByTestId('providers-channel-add').click();
    const editor = page.getByTestId('providers-channel-editor');
    await expect(editor).toBeVisible();
    await page.getByTestId('providers-channel-override-ingest-set').check();
    await page.getByTestId('providers-channel-override-ingest-bunny').uncheck();
    await expect(page.getByTestId('providers-channel-override-ingest-r2')).toBeChecked();
    await page.getByTestId('providers-channel-override-note').fill('[e2e-admin] R2 only');
    await page.getByTestId('providers-channel-done').click();
    await expect(page.getByTestId(`providers-channel-${channelId}`)).toBeVisible();
    await save.click();
    await expect(page.getByTestId('providers-saved')).toHaveText(/saved/i);
    await expect.poll(async () => (await providerSettings()).channels[channelId]?.ingest).toEqual(['r2']);

    // Removing it again saves without a question (no live traffic moves)
    await page.getByTestId(`providers-channel-${channelId}-remove`).click();
    await save.click();
    await expect(page.getByTestId('providers-saved')).toHaveText(/saved/i);
    await expect.poll(async () => (await providerSettings()).channels[channelId]).toBeUndefined();
  });

  test('the video page shows the copies and pins one video to R2 first', async ({ page }) => {
    await page.goto(`/videos/${videoId}`);
    const panel = page.getByTestId('video-providers');
    await expect(panel).toBeVisible();
    await expect(panel).toHaveAttribute('data-pinned', 'false');
    await expect(page.getByTestId('video-providers-copy-bunny')).toBeVisible();
    await expect(page.getByTestId('video-providers-copy-r2')).toBeVisible();

    await page.getByTestId('video-providers-pin').click();
    await expect(page.getByTestId('video-providers-editor')).toBeVisible();
    await expect(page.getByTestId('video-providers-override-order-set')).toBeChecked();
    if ((await page.getByTestId('video-providers-override-order-r2').getAttribute('data-listed')) !== 'true') await page.getByTestId('video-providers-override-order-r2-on').check();
    if ((await page.getByTestId('video-providers-override-order-bunny').getAttribute('data-listed')) !== 'true') await page.getByTestId('video-providers-override-order-bunny-on').check();
    while (!(await page.getByTestId('video-providers-override-order-r2-up').isDisabled())) await page.getByTestId('video-providers-override-order-r2-up').click();
    await page.getByTestId('video-providers-override-note').fill('[e2e-admin] pinned');
    await page.getByTestId('video-providers-save').click();
    await expect(panel).toHaveAttribute('data-pinned', 'true');
    await expect(page.getByTestId('video-providers-notice')).not.toBeEmpty();

    const detail = async () => (await adminApi<{ media?: { override?: { order?: string[] } | null } }>(`/api/content/videos/${encodeURIComponent(videoId)}`, { token: superToken() })).body.result?.media?.override?.order;
    await expect.poll(detail).toEqual(['r2', 'bunny']);

    await page.reload();
    await expect(page.getByTestId('video-providers')).toHaveAttribute('data-pinned', 'true');
    await page.getByTestId('video-providers-clear').click();
    await expect(page.getByTestId('video-providers-clear-confirm-dialog')).toBeVisible();
    await page.getByTestId('video-providers-clear-confirm-confirm').click();
    await expect(page.getByTestId('video-providers')).toHaveAttribute('data-pinned', 'false');
    await expect.poll(detail).toBeUndefined();
  });
});
