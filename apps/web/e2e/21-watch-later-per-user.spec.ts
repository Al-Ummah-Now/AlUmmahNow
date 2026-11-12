import { test, expect } from './fixtures';
import type { APIRequestContext } from '@playwright/test';
import { AUTH_STATE } from './test-utils/auth-state';
import { API_URL, userApi } from './test-utils/e2e-videos';
import { findSeedVideo } from './test-utils/qa-content';

/**
 * Watch later belongs to the user, never to a channel (owner bug: "why is
 * watch later a channel list not a user list?"). Runs as the two-channel
 * user, a per-run account in CI (auth.setup.ts, E2E_RUN_ID), so no other job
 * shares its Watch later. The saved video is removed again afterwards.
 */
/**
 * Whether the target's api-videos has the per-user Watch later (PR #847): its
 * OpenAPI document describes the ignored channelId header. PR runs test the
 * deployed QA, which gets the fix only once the PR merges.
 */
async function perUserWatchLaterDeployed(request: APIRequestContext): Promise<boolean> {
  const res = await request.get(`${API_URL}/openapi.json`).catch(() => null);
  return !!res?.ok() && (await res.text()).includes('Watch later is per user');
}

test.describe('Watch later is per user', () => {
  test.use({ storageState: AUTH_STATE.multi });
  test.describe.configure({ mode: 'serial' });

  let saved: string | null = null;

  const headers = (channelId?: string) => {
    const u = userApi('multi');
    return { Authorization: `Bearer ${u.token}`, ...(channelId ? { channelId } : {}) };
  };

  async function watchLater(request: APIRequestContext, channelId?: string) {
    const res = await request.get(`${API_URL}/api/library/watch-later?limit=50`, { headers: headers(channelId) });
    expect(res.ok()).toBe(true);
    return ((await res.json()) as { result: { playlistId: string; videoIds: string[]; total: number } }).result;
  }

  test.afterEach(async ({ request }) => {
    if (!saved) return;
    await request.delete(`${API_URL}/api/library/watch-later/${encodeURIComponent(saved)}`, { headers: headers() });
    saved = null;
  });

  test('same list whichever channel is active, and never among a channel’s playlists', async ({ page, request }, testInfo) => {
    test.skip(testInfo.project.name.startsWith('Mobile'), 'API + desktop page check; covered by the desktop projects');
    test.skip(!(await perUserWatchLaterDeployed(request)), 'Per-user Watch later is not deployed on the target yet (it lands with the PR that adds it, #847)');
    const { channelIds, userId } = userApi('multi');
    expect(channelIds.length).toBeGreaterThanOrEqual(2);
    const [one, two] = channelIds;

    const video = await findSeedVideo(request);
    const add = await request.post(`${API_URL}/api/library/watch-later`, { headers: headers(one), data: { videoId: video.id } });
    expect(add.ok()).toBe(true);
    saved = video.id;

    // Identical across active-channel switches
    const asOne = await watchLater(request, one);
    const asTwo = await watchLater(request, two);
    const asNone = await watchLater(request);
    expect(asOne.playlistId).toBe(`watch-later-${userId}`);
    expect(asOne.videoIds).toContain(video.id);
    expect(asTwo).toEqual(asOne);
    expect(asNone).toEqual(asOne);

    // Opening it names no channel
    const opened = await request.get(`${API_URL}/api/playlists/${encodeURIComponent(asOne.playlistId)}`, { headers: headers(one) });
    expect(opened.ok()).toBe(true);
    const openedBody = (await opened.json()) as Record<string, unknown> & { result?: Record<string, unknown> };
    const record = (openedBody.result ?? openedBody) as { channelId?: string; channelName?: string };
    expect(record.channelId || '').toBe('');
    expect(record.channelName).toBeUndefined();

    // No channel listing has it, as the owner of both channels
    for (const channelId of [one, two]) {
      const channelTab = await request.get(`${API_URL}/api/channels/${channelId}/playlists?limit=100`, { headers: headers(channelId) });
      expect(channelTab.ok()).toBe(true);
      const tabIds = (((await channelTab.json()) as { data?: Array<{ id: string }> }).data ?? []).map((p) => p.id);
      expect(tabIds).not.toContain(asOne.playlistId);
      const studio = await request.get(`${API_URL}/api/playlists?channelId=${channelId}&limit=100`, { headers: headers(channelId) });
      expect(studio.ok()).toBe(true);
      const studioIds = (((await studio.json()) as { data?: Array<{ id: string }> }).data ?? []).map((p) => p.id);
      expect(studioIds).not.toContain(asOne.playlistId);
    }

    // The channel page's Playlists tab (owner view) does not show it
    const listed = page.waitForResponse((r) => r.url().includes(`/api/channels/${one}/playlists`) && r.request().method() === 'GET');
    await page.goto(`/en/channels/${one}?tab=playlists`);
    await listed;
    const panel = page.getByTestId('tabpanel-playlists');
    await expect(panel).toBeVisible();
    await expect(panel.locator(`a[href*="watch-later-"]`)).toHaveCount(0);
    await expect(panel.getByText('Watch later', { exact: true })).toHaveCount(0);

    // It is in the user's Library
    await page.goto('/en/library');
    await expect(page.getByTestId('library-section-watch-later')).toBeVisible();
    await expect(page.getByTestId('library-section-watch-later').getByText(video.title).first()).toBeVisible();
  });
});
