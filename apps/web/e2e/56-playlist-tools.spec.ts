import { test, expect } from './fixtures';
import type { Locator, Page } from '@playwright/test';
import { expectRtl, fillStable, keyboardMoveDown, playlistToolsDeployed } from './test-utils/channel-content';
import { ns, useOwnData, type CreatedVideo, type Creator } from './release/builders';
import { apiFetch, expectHydrated } from './release/web-session';

/**
 * Adding videos to playlists (owner, 2026-11-10: "how do you add videos to a
 * playlist?"), from every place it can happen:
 *
 * - Manage Playlists › New playlist: name, order, and videos picked from the
 *   channel, created in one go
 * - Manage Playlists › a playlist: add with the picker, reorder (keyboard
 *   drag and Move buttons), automatic order, remove
 * - Studio Content › Videos (Video Management moved there, 3883fa94): the
 *   selection's "Add to playlist", to an existing playlist or a new one
 *
 * Own data (release/builders.ts): a creator with one channel and three
 * private videos (not waited on: the tools list videos still processing too),
 * made for this spec and deleted afterwards. Playlists made through the UI are
 * registered with the scope as soon as their id is known, and a sweep of the
 * channel's playlists runs at cleanup in case a test failed before that.
 *
 * Listing a channel's playlists scans the whole bucket on QA (#909, about 13 s),
 * so the waits on those lists are longer than the default.
 */

const data = useOwnData(test);
let owner: Creator;
let channelId: string;
let videos: CreatedVideo[] = [];
/** A unique title prefix (the three videos end in A, B and C, their order by title) */
const tag = () => `E2E PLT ${ns()} ${Date.now().toString(36)}`;
/** #909: GET /api/playlists?channelId= scans every playlist on QA */
const PLAYLIST_LIST_MS = 60000;

interface PlaylistRecord { id: string; title: string; videos: string[]; sortMode?: string; sortField?: string; sortDirection?: string; isPublic?: boolean }

async function api<T>(method: string, path: string, body?: unknown): Promise<{ status: number; body: T }> {
  const res = await apiFetch(owner.user, path, {
    method,
    headers: { 'Content-Type': 'application/json', channelId },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await res.text();
  return { status: res.status, body: (text ? JSON.parse(text) : {}) as T };
}

async function stored(id: string): Promise<PlaylistRecord> {
  const { status, body } = await api<PlaylistRecord & { result?: PlaylistRecord }>('GET', `/api/playlists/${id}`);
  expect(status, `GET /api/playlists/${id}`).toBe(200);
  return body.result ?? body;
}

/** A playlist made through the UI: deleted with the rest of the spec's data */
function adopt(id: string) {
  data.onCleanup(`playlist ${id}`, () => api('DELETE', `/api/playlists/${id}`));
}

/** The picker row of a video (searched by its title) */
async function pick(scope: Locator, video: CreatedVideo) {
  await fillStable(scope.getByTestId('picker-search'), video.title);
  const row = scope.locator(`[data-testid="picker-video"][data-video-id="${video.id}"]`);
  await expect(row).toBeVisible({ timeout: 30000 });
  await row.getByRole('checkbox').check();
  await expect(row).toHaveAttribute('data-selected', 'true');
}

/**
 * Opens Studio's video list on the tab the videos are in now (Processing until
 * they are encoded, then Published) and waits for their select boxes
 */
async function openStudioWith(page: Page, wanted: CreatedVideo[]) {
  const select = (video: CreatedVideo) => page.locator(`[data-testid="studio-video-select"][data-video-id="${video.id}"]`);
  await expect(async () => {
    const { body } = await api<{ uploadStatus?: string }>('GET', `/api/videos/${wanted[0].id}`);
    const status = body.uploadStatus && body.uploadStatus !== 'ready' ? 'processing' : 'published';
    await page.goto(`/en/studio/${channelId}/content/videos?status=${status}`);
    await expect(page.getByTestId('studio-videos-loading')).toHaveCount(0, { timeout: 20000 });
    for (const video of wanted) await expect(select(video)).toBeVisible({ timeout: 5000 });
  }).toPass({ timeout: 90000 });
  for (const video of wanted) await expectHydrated(select(video));
  return select;
}

const itemOrder = (page: Page) => page.getByTestId('playlist-item').evaluateAll((rows) => rows.map((r) => r.getAttribute('data-video-id')));

test.describe('Playlist tools', () => {
  test.use({ storageState: async ({}, use) => use(owner.state) });
  test.describe.configure({ mode: 'serial' });

  test.beforeAll(async ({ browser }) => {
    test.skip(!(await playlistToolsDeployed()), 'The playlist tools are not deployed on the target yet (they land with the PR that adds them)');
    test.setTimeout(300000);
    owner = await data.createCreator(browser, 'plt');
    channelId = owner.channelIds[0];
    // Every playlist of this channel is the spec's: swept at cleanup, before the channel goes
    data.onCleanup(`playlists of channel ${channelId}`, async () => {
      const { body } = await api<{ data?: Array<{ id: string }> }>('GET', `/api/playlists?channelId=${channelId}&limit=100`);
      for (const playlist of body.data ?? []) await api('DELETE', `/api/playlists/${playlist.id}`);
    });
    const base = tag();
    videos = [];
    for (const letter of ['A', 'B', 'C']) {
      videos.push(await data.createVideo(owner.user, channelId, { clip: 'landscape40', title: `${base} ${letter}`, isPublic: false, waitReady: false }));
    }
  });

  test('PLT-001 creates a playlist with picked videos in pick order (en)', async ({ page }) => {
    const title = `${tag()} Create`;
    await page.goto(`/en/settings/channel/${channelId}/playlists`);
    const newLink = page.getByTestId('new-playlist-link');
    await expectHydrated(newLink);
    await newLink.click();
    await expect(page.getByRole('heading', { level: 1, name: 'New playlist' })).toBeVisible();
    const form = page.getByTestId('create-playlist-form');
    await expectHydrated(form.getByTestId('picker-search'));
    await fillStable(page.getByLabel('Name'), title);
    await expect(page.getByRole('radio', { name: /Manual/ })).toBeChecked();

    await pick(form, videos[1]);
    await pick(form, videos[0]);
    await expect(form.getByTestId('picker-tray-item')).toHaveCount(2);
    await expect(page.getByTestId('create-playlist-submit')).toHaveText('Create with 2 videos');
    await page.getByTestId('create-playlist-submit').click();

    // Lands on the new playlist's editor with the videos in pick order
    const editorUrl = new RegExp(`/en/settings/channel/${channelId}/playlists/([\\w-]+)$`);
    await expect(page).toHaveURL(editorUrl, { timeout: 30000 });
    const id = editorUrl.exec(page.url())![1];
    adopt(id);
    await expect(page.getByTestId('playlist-editor')).toBeVisible({ timeout: 30000 });
    await expect.poll(() => itemOrder(page)).toEqual([videos[1].id, videos[0].id]);
    await expect(page.getByTestId('playlist-item-count')).toHaveText('2 videos');
    // Still there: the page stays on the editor (it snapped back to an empty New playlist form, #995)
    await expect(page).toHaveURL(editorUrl);
    const record = await stored(id);
    expect(record.title).toBe(title);
    expect(record.videos).toEqual([videos[1].id, videos[0].id]);
    expect(record.sortMode ?? 'manual').toBe('manual');
  });

  test('PLT-002 editor: add with the picker, reorder by keyboard and buttons, automatic order, remove', async ({ page }) => {
    const id = await data.createPlaylist(owner.user, channelId, { title: `${tag()} Edit` });
    await page.goto(`/en/settings/channel/${channelId}/playlists/${id}`);
    await expect(page.getByTestId('playlist-editor')).toBeVisible();
    await expect(page.getByText('This playlist has no videos yet.')).toBeVisible();

    // Add all three with the picker, in this order
    await expectHydrated(page.getByTestId('playlist-add-videos'));
    await page.getByTestId('playlist-add-videos').click();
    const panel = page.getByTestId('playlist-add-panel');
    for (const video of [videos[0], videos[1], videos[2]]) await pick(panel, video);
    await page.getByTestId('playlist-add-submit').click();
    await expect(page.getByTestId('bulk-add-notice')).toContainText('Added 3 videos to');
    await expect.poll(() => itemOrder(page)).toEqual([videos[0].id, videos[1].id, videos[2].id]);
    await expect.poll(async () => (await stored(id)).videos).toEqual([videos[0].id, videos[1].id, videos[2].id]);

    // Adding again is idempotent: the picker marks them as in the playlist
    await page.getByTestId('playlist-add-videos').click();
    await fillStable(panel.getByTestId('picker-search'), videos[0].title);
    await expect(panel.locator(`[data-testid="picker-video"][data-video-id="${videos[0].id}"]`).getByRole('checkbox')).toBeDisabled({ timeout: 30000 });
    await panel.getByRole('button', { name: 'Cancel' }).first().click();

    // Keyboard drag: first video one step down
    await keyboardMoveDown(page, page.getByTestId('playlist-item-handle').first());
    await expect.poll(() => itemOrder(page)).toEqual([videos[1].id, videos[0].id, videos[2].id]);
    await expect.poll(async () => (await stored(id)).videos).toEqual([videos[1].id, videos[0].id, videos[2].id]);

    // Move up button: last video up one
    await page.getByTestId('playlist-item').last().getByTestId('playlist-item-up').click();
    await expect.poll(() => itemOrder(page)).toEqual([videos[1].id, videos[2].id, videos[0].id]);
    await expect(page.getByText('Order saved')).toBeVisible();

    // Automatic: title A to Z (no handles), then back to manual keeps that order
    await page.getByRole('radio', { name: /Automatic/ }).check();
    await expect(page.getByText('Order updated')).toBeVisible();
    await page.getByTestId('sort-field').selectOption('title');
    await page.getByTestId('sort-direction-asc').click();
    const byTitle = [...videos].sort((a, b) => a.title.localeCompare(b.title)).map((v) => v.id);
    await expect.poll(async () => (await stored(id)).videos).toEqual(byTitle);
    await expect.poll(() => itemOrder(page)).toEqual(byTitle);
    await expect(page.getByTestId('playlist-item-handle')).toHaveCount(0);
    await expect.poll(async () => (await stored(id)).sortField).toBe('title');

    await page.getByRole('radio', { name: /Manual/ }).check();
    await expect(page.getByTestId('playlist-item-handle')).toHaveCount(3);
    await expect.poll(async () => (await stored(id)).sortMode).toBe('manual');
    expect((await stored(id)).videos).toEqual(byTitle);

    // Remove one
    await page.getByTestId('playlist-item').first().getByTestId('playlist-item-remove').click();
    await page.getByTestId('playlist-editor-remove-dialog-confirm').click();
    await expect(page.getByTestId('playlist-item')).toHaveCount(2);
    await expect.poll(async () => (await stored(id)).videos).toEqual(byTitle.slice(1));
  });

  test('PLT-003 Studio videos: create a playlist inline from the selection', async ({ page }) => {
    const newTitle = `${tag()} Inline`;
    const select = await openStudioWith(page, [videos[0]]);
    await select(videos[0]).check();
    await page.getByTestId('studio-bulk-playlist').click();
    const dialog = page.getByTestId('add-to-playlist-dialog');
    await expect(dialog.getByRole('heading', { name: 'Add 1 video to playlists' })).toBeVisible();
    // New playlist inline: its picker starts with the selected video
    await dialog.getByTestId('add-to-playlist-new').click();
    await expect(dialog.getByTestId('picker-tray-item')).toHaveCount(1);
    await fillStable(dialog.getByLabel('Name'), newTitle);
    await dialog.getByRole('radio', { name: /^Private/ }).check();
    await dialog.getByTestId('create-playlist-submit').click();
    await expect(dialog.getByTestId('bulk-add-notice')).toContainText(`Added 1 video to ${newTitle}.`);
    // The new playlist heads the dialog's list, ticked
    const created = dialog.locator('label').filter({ hasText: newTitle }).getByTestId('add-to-playlist-option');
    await expect(created).toBeChecked({ timeout: PLAYLIST_LIST_MS });
    const id = (await created.getAttribute('data-playlist-id'))!;
    adopt(id);
    await expect.poll(async () => (await stored(id)).videos).toEqual([videos[0].id]);
    expect((await stored(id)).title).toBe(newTitle);
    expect((await stored(id)).isPublic).toBe(false);
  });

  test('PLT-005 Studio videos: add the selection to a playlist', async ({ page }) => {
    const title = `${tag()} Studio`;
    const id = await data.createPlaylist(owner.user, channelId, { title, videoIds: [videos[0].id] });
    const select = await openStudioWith(page, [videos[0], videos[1]]);
    // One already in the playlist is skipped, not added twice
    await select(videos[0]).check();
    await select(videos[1]).check();
    await page.getByTestId('studio-bulk-playlist').click();
    const dialog = page.getByTestId('add-to-playlist-dialog');
    await expect(dialog.getByRole('heading', { name: 'Add 2 videos to playlists' })).toBeVisible();
    // The dialog lists the channel's playlists once they have loaded (#909: slow on QA)
    const option = dialog.locator(`[data-testid="add-to-playlist-option"][data-playlist-id="${id}"]`);
    await expect(option).toBeEnabled({ timeout: PLAYLIST_LIST_MS });
    await option.check();
    await dialog.getByTestId('add-to-playlist-submit').click();
    await expect(dialog.getByTestId('bulk-add-notice')).toContainText(`Added 1 video to ${title}.`);
    await expect(dialog.getByTestId('bulk-add-notice')).toContainText('1 already in the playlist.');
    await expect.poll(async () => (await stored(id)).videos).toEqual([videos[0].id, videos[1].id]);
  });

  test('PLT-004 Arabic editor is translated and RTL', async ({ page }) => {
    const id = await data.createPlaylist(owner.user, channelId, { title: `${tag()} Ar`, videoIds: [] });
    await page.goto(`/ar/settings/channel/${channelId}/playlists/${id}`);
    await expectRtl(page);
    await expect(page.getByTestId('playlist-editor')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'الفيديوهات في هذه القائمة' })).toBeVisible();
    await expect(page.getByRole('radio', { name: /يدوي/ })).toBeChecked();
    await expect(page.getByTestId('playlist-add-videos')).toHaveText('إضافة فيديوهات');
  });
});
