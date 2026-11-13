import { test as fixturesTest, expect } from './fixtures';
import { useOwnData, type Creator, type CreatedVideo } from './release/builders';
import { apiFetch } from './release/web-session';
import { target } from './release/targets';

/**
 * Watch later belongs to the user, never to a channel (owner bug: "why is
 * watch later a channel list not a user list?", PR #847).
 *
 * Own data (release/builders.ts): a creator with two channels and one private
 * video it uploads, made for this spec and deleted afterwards (the user's
 * privacy erase takes its Watch later with it).
 */

const data = useOwnData(fixturesTest);
let owner: Creator;

// One worker runs this file's tests in order: its afterAll deletes the creators' channels, so a
// worker must not come back to this file afterwards with the (worker-scoped) creators still set
fixturesTest.describe.configure({ mode: 'default' });

/**
 * The file's creators, made in a worker fixture rather than beforeAll: Playwright resolves a context
 * option such as storageState before beforeAll runs, so a creator made there was undefined in
 * test.use (every signed-in test failed with "reading 'state'"). Deleted by the file's DataScope.
 */
const test = fixturesTest.extend<object, { creators: { owner: Creator } }>({
  creators: [
    async ({ browser }, use) => {
      owner = await data.createCreator(browser, 'watch-later', { channels: 2 });
      await use({ owner });
    },
    { scope: 'worker', timeout: 300_000 },
  ],
});
let video: CreatedVideo;

/**
 * Whether the target's api-videos has the per-user Watch later: its OpenAPI
 * document describes the ignored channelId header. Runs against a deployed
 * target before the PR's code reaches it skip.
 */
async function perUserWatchLaterDeployed(): Promise<boolean> {
  const res = await fetch(`${target().api}/openapi.json`).catch(() => null);
  return !!res?.ok && (await res.text()).includes('Watch later is per user');
}

async function watchLater(channelId?: string) {
  const res = await apiFetch(owner.user, '/api/library/watch-later?limit=50', { headers: channelId ? { channelId } : {} });
  expect(res.status, 'GET /api/library/watch-later').toBe(200);
  return ((await res.json()) as { result: { playlistId: string; videoIds: string[]; total: number } }).result;
}

async function playlistIds(path: string, channelId: string): Promise<string[]> {
  const res = await apiFetch(owner.user, path, { headers: { channelId } });
  expect(res.status, `GET ${path}`).toBe(200);
  return (((await res.json()) as { data?: Array<{ id: string }> }).data ?? []).map((p) => p.id);
}

test.beforeAll(async ({ browser, creators }) => {
    void browser;
    void creators;
  test.setTimeout(300000);
  video = await data.createVideo(owner.user, owner.channelIds[0], { isPublic: false, waitReady: false });
});

test.describe('Watch later is per user', () => {
  test.use({ storageState: async ({ creators }, use) => use(creators.owner.state) });

  // quarantined: #1098 @meywd (red on the local stack)
  test.fixme('same list whichever channel is active, and never among a channel’s playlists', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name.startsWith('Mobile'), 'API + desktop page check; covered by the desktop projects');
    test.skip(!(await perUserWatchLaterDeployed()), 'Per-user Watch later is not deployed on the target yet (it lands with the PR that adds it, #847)');
    const [one, two] = owner.channelIds;

    const add = await apiFetch(owner.user, '/api/library/watch-later', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', channelId: one },
      body: JSON.stringify({ videoId: video.id }),
    });
    expect(add.status, 'POST /api/library/watch-later').toBe(200);

    // Identical across active-channel switches
    const asOne = await watchLater(one);
    expect(asOne.playlistId).toBe(`watch-later-${owner.user.userId}`);
    expect(asOne.videoIds).toEqual([video.id]);
    expect(await watchLater(two)).toEqual(asOne);
    expect(await watchLater()).toEqual(asOne);

    // Opening it names no channel
    const opened = await apiFetch(owner.user, `/api/playlists/${encodeURIComponent(asOne.playlistId)}`, { headers: { channelId: one } });
    expect(opened.status, 'GET /api/playlists/:id').toBe(200);
    const body = (await opened.json()) as Record<string, unknown> & { result?: Record<string, unknown> };
    const record = (body.result ?? body) as { channelId?: string; channelName?: string };
    expect(record.channelId || '').toBe('');
    expect(record.channelName).toBeUndefined();

    // No channel listing has it, as the owner of both channels
    for (const channelId of [one, two]) {
      expect(await playlistIds(`/api/channels/${channelId}/playlists?limit=100`, channelId)).not.toContain(asOne.playlistId);
      expect(await playlistIds(`/api/playlists?channelId=${channelId}&limit=100`, channelId)).not.toContain(asOne.playlistId);
    }

    // The channel page's Playlists tab (owner view) does not show it
    const listed = page.waitForResponse((r) => r.url().includes(`/api/channels/${one}/playlists`) && r.request().method() === 'GET');
    await page.goto(`/en/channels/${one}?tab=playlists`);
    await listed;
    const panel = page.getByTestId('tabpanel-playlists');
    await expect(panel).toBeVisible();
    await expect(panel.locator('a[href*="watch-later-"]')).toHaveCount(0);
    await expect(panel.getByText('Watch later', { exact: true })).toHaveCount(0);

    // It is the user's: the Library has its Watch later section
    await page.goto('/en/library');
    await expect(page.getByTestId('library-section-watch-later')).toBeVisible();
  });
});
