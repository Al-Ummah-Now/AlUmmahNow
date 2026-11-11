import { test, expect } from './fixtures';
import type { Locator, Page } from '@playwright/test';
import { AUTH_STATE } from './test-utils/auth-state';
import {
  apiAs,
  channelsOf,
  createPlaylist,
  deletePlaylistQuietly,
  deletePlaylistsTitled,
  expectRtl,
  fillStable,
  keyboardMoveDown,
  playlistToolsDeployed,
  tempName,
} from './test-utils/channel-content';
import { ensureSeedVideos, SEED_TITLES, type E2EVideo } from './test-utils/e2e-videos';

/**
 * Adding videos to playlists (owner, 2026-11-10: "how do you add videos to a
 * playlist?"), from every place it can happen:
 *
 * - Manage Playlists › New playlist: name, order, and videos picked from the
 *   channel, created in one go
 * - Manage Playlists › a playlist: add with the picker, reorder (keyboard
 *   drag and Move buttons), automatic order, remove
 * - Video Management: the selection's "Add to playlist", and a video's menu
 *   with an inline new playlist
 *
 * Writes go to the single user's own channel and its private seed videos;
 * every playlist is titled "E2E Temp …" and deleted afterwards.
 */

const owner = 'single' as const;
const channelId = () => channelsOf(owner).main.id;
let seeds: E2EVideo[] = [];

interface PlaylistRecord { id: string; title: string; videos: string[]; sortMode?: string; sortField?: string; sortDirection?: string; isPublic?: boolean }

async function stored(id: string): Promise<PlaylistRecord> {
  const { body } = await apiAs<{ id: string; title: string; videos: string[] } & PlaylistRecord>(owner, 'GET', `/api/playlists/${id}`, { channelId: channelId() });
  return body;
}

async function playlistTitled(title: string): Promise<PlaylistRecord | undefined> {
  const { body } = await apiAs<{ data?: PlaylistRecord[] }>(owner, 'GET', `/api/playlists?channelId=${channelId()}&limit=100`);
  return (body.data ?? []).find((p) => p.title === title);
}

/** The picker row of a seed video (searched by its title) */
async function pick(scope: Locator, video: E2EVideo) {
  await fillStable(scope.getByTestId('picker-search'), video.title);
  const row = scope.locator(`[data-testid="picker-video"][data-video-id="${video.id}"]`);
  await expect(row).toBeVisible({ timeout: 15000 });
  await row.getByRole('checkbox').check();
  await expect(row).toHaveAttribute('data-selected', 'true');
}

const itemOrder = (page: Page) => page.getByTestId('playlist-item').evaluateAll((rows) => rows.map((r) => r.getAttribute('data-video-id')));

test.describe('Playlist tools', () => {
  test.use({ storageState: AUTH_STATE.single });
  test.describe.configure({ mode: 'serial' });

  test.beforeAll(async () => {
    test.skip(!(await playlistToolsDeployed()), 'The playlist tools are not deployed on the target yet (they land with the PR that adds them)');
    const byTitle = await ensureSeedVideos(owner);
    seeds = [byTitle[SEED_TITLES.singleVideo], byTitle[SEED_TITLES.singlePrivate], byTitle[SEED_TITLES.singleScheduled]].filter(Boolean);
    expect(seeds.length).toBe(3);
  });

  test.afterAll(async () => {
    await deletePlaylistsTitled(owner, channelId(), 'E2E Temp Tools');
  });

  test('PLT-001 creates a playlist with picked videos in pick order (en)', async ({ page }) => {
    const title = tempName('Tools Create');
    await page.goto(`/en/settings/channel/${channelId()}/playlists`);
    await page.getByTestId('new-playlist-link').click();
    await expect(page.getByRole('heading', { level: 1, name: 'New playlist' })).toBeVisible();
    await fillStable(page.getByLabel('Name'), title);
    await expect(page.getByRole('radio', { name: /Manual/ })).toBeChecked();

    const form = page.getByTestId('create-playlist-form');
    await pick(form, seeds[1]);
    await pick(form, seeds[0]);
    await expect(form.getByTestId('picker-tray-item')).toHaveCount(2);
    await expect(page.getByTestId('create-playlist-submit')).toHaveText('Create with 2 videos');
    await page.getByTestId('create-playlist-submit').click();

    // Lands on the new playlist's editor with the videos in pick order
    await expect(page.getByTestId('playlist-editor')).toBeVisible({ timeout: 20000 });
    await expect(page).toHaveURL(new RegExp(`/en/settings/channel/${channelId()}/playlists/[\\w-]+$`));
    await expect.poll(() => itemOrder(page)).toEqual([seeds[1].id, seeds[0].id]);
    await expect(page.getByTestId('playlist-item-count')).toHaveText('2 videos');
    const record = await playlistTitled(title);
    expect(record?.videos).toEqual([seeds[1].id, seeds[0].id]);
    expect(record?.sortMode ?? 'manual').toBe('manual');
  });

  test('PLT-002 editor: add with the picker, reorder by keyboard and buttons, automatic order, remove', async ({ page }) => {
    const { id } = await createPlaylist(owner, channelId(), { title: tempName('Tools Edit') });
    try {
      await page.goto(`/en/settings/channel/${channelId()}/playlists/${id}`);
      await expect(page.getByTestId('playlist-editor')).toBeVisible();
      await expect(page.getByText('This playlist has no videos yet.')).toBeVisible();

      // Add all three with the picker, in this order
      await page.getByTestId('playlist-add-videos').click();
      const panel = page.getByTestId('playlist-add-panel');
      for (const video of [seeds[0], seeds[1], seeds[2]]) await pick(panel, video);
      await page.getByTestId('playlist-add-submit').click();
      await expect(page.getByTestId('bulk-add-notice')).toContainText('Added 3 videos to');
      await expect.poll(() => itemOrder(page)).toEqual([seeds[0].id, seeds[1].id, seeds[2].id]);
      await expect.poll(async () => (await stored(id)).videos).toEqual([seeds[0].id, seeds[1].id, seeds[2].id]);

      // Adding again is idempotent: the picker marks them as in the playlist
      await page.getByTestId('playlist-add-videos').click();
      await fillStable(panel.getByTestId('picker-search'), seeds[0].title);
      await expect(panel.locator(`[data-testid="picker-video"][data-video-id="${seeds[0].id}"]`).getByRole('checkbox')).toBeDisabled();
      await panel.getByRole('button', { name: 'Cancel' }).first().click();

      // Keyboard drag: first video one step down
      await keyboardMoveDown(page, page.getByTestId('playlist-item-handle').first());
      await expect.poll(() => itemOrder(page)).toEqual([seeds[1].id, seeds[0].id, seeds[2].id]);
      await expect.poll(async () => (await stored(id)).videos).toEqual([seeds[1].id, seeds[0].id, seeds[2].id]);

      // Move up button: last video up one
      await page.getByTestId('playlist-item').last().getByTestId('playlist-item-up').click();
      await expect.poll(() => itemOrder(page)).toEqual([seeds[1].id, seeds[2].id, seeds[0].id]);
      await expect(page.getByText('Order saved')).toBeVisible();

      // Automatic: title A to Z (no handles), then back to manual keeps that order
      await page.getByRole('radio', { name: /Automatic/ }).check();
      await expect(page.getByText('Order updated')).toBeVisible();
      await page.getByTestId('sort-field').selectOption('title');
      await page.getByTestId('sort-direction-asc').click();
      const byTitle = [...seeds].sort((a, b) => a.title.localeCompare(b.title)).map((v) => v.id);
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
    } finally {
      await deletePlaylistQuietly(owner, channelId(), id);
    }
  });

  test('PLT-003 Video Management: add the selection to a playlist, and create one from a video menu', async ({ page }) => {
    const existingTitle = tempName('Tools Existing');
    const newTitle = tempName('Tools Inline');
    const { id } = await createPlaylist(owner, channelId(), { title: existingTitle });
    try {
      await page.goto(`/en/settings/channel/${channelId()}/videos`);
      const card = (video: E2EVideo) => page.locator(`[data-testid="managed-video"][data-video-id="${video.id}"]`);
      await expect(card(seeds[0])).toBeVisible({ timeout: 20000 });

      // Selection → bulk "Add to playlist" → the existing playlist
      await card(seeds[0]).getByTestId('managed-video-select').check();
      await card(seeds[1]).getByTestId('managed-video-select').check();
      await expect(page.getByTestId('video-bulk-bar')).toContainText('2 video(s) selected');
      await page.getByTestId('bulk-add-to-playlist').click();
      const dialog = page.getByTestId('add-to-playlist-dialog');
      await expect(dialog.getByRole('heading', { name: 'Add 2 videos to playlists' })).toBeVisible();
      await dialog.locator(`[data-testid="add-to-playlist-option"][data-playlist-id="${id}"]`).check();
      await dialog.getByTestId('add-to-playlist-submit').click();
      await expect(dialog.getByTestId('bulk-add-notice')).toContainText(`Added 2 videos to ${existingTitle}.`);
      await expect.poll(async () => [...(await stored(id)).videos].sort()).toEqual([seeds[0].id, seeds[1].id].sort());
      await dialog.getByTestId('add-to-playlist-done').click();
      await expect(dialog).toHaveCount(0);

      // A video's menu → Add to playlist → new playlist inline (picker starts with that video)
      await card(seeds[2]).getByTestId('managed-video-menu').click();
      await page.getByTestId('managed-video-add-to-playlist').click();
      await expect(dialog.getByRole('heading', { name: 'Add 1 video to playlists' })).toBeVisible();
      await dialog.getByTestId('add-to-playlist-new').click();
      await expect(dialog.getByTestId('picker-tray-item')).toHaveCount(1);
      await fillStable(dialog.getByLabel('Name'), newTitle);
      await dialog.getByRole('radio', { name: /^Private/ }).check();
      await dialog.getByTestId('create-playlist-submit').click();
      await expect(dialog.getByTestId('bulk-add-notice')).toContainText(`Added 1 video to ${newTitle}.`);
      await expect.poll(async () => (await playlistTitled(newTitle))?.videos).toEqual([seeds[2].id]);
      expect((await playlistTitled(newTitle))?.isPublic).toBe(false);
    } finally {
      await deletePlaylistQuietly(owner, channelId(), id);
      await deletePlaylistsTitled(owner, channelId(), newTitle);
    }
  });

  test('PLT-005 Studio videos: add the selection to a playlist', async ({ page }) => {
    const title = tempName('Tools Studio');
    const { id } = await createPlaylist(owner, channelId(), { title, videoIds: [seeds[0].id] });
    try {
      await page.goto(`/en/studio/${channelId()}/content/videos`);
      await expect(page.getByTestId('studio-videos-loading')).toHaveCount(0, { timeout: 20000 });
      const select = (video: E2EVideo) => page.locator(`[data-testid="studio-video-select"][data-video-id="${video.id}"]`);
      // One already in the playlist is skipped, not added twice
      await select(seeds[0]).check();
      await select(seeds[1]).check();
      await page.getByTestId('studio-bulk-playlist').click();
      const dialog = page.getByTestId('add-to-playlist-dialog');
      await dialog.locator(`[data-testid="add-to-playlist-option"][data-playlist-id="${id}"]`).check();
      await dialog.getByTestId('add-to-playlist-submit').click();
      await expect(dialog.getByTestId('bulk-add-notice')).toContainText(`Added 1 video to ${title}.`);
      await expect(dialog.getByTestId('bulk-add-notice')).toContainText('1 already in the playlist.');
      await expect.poll(async () => (await stored(id)).videos).toEqual([seeds[0].id, seeds[1].id]);
    } finally {
      await deletePlaylistQuietly(owner, channelId(), id);
    }
  });

  test('PLT-004 Arabic editor is translated and RTL', async ({ page }) => {
    const { id } = await createPlaylist(owner, channelId(), { title: tempName('Tools Ar'), videoIds: [] });
    try {
      await page.goto(`/ar/settings/channel/${channelId()}/playlists/${id}`);
      await expectRtl(page);
      await expect(page.getByTestId('playlist-editor')).toBeVisible();
      await expect(page.getByRole('heading', { name: 'الفيديوهات في هذه القائمة' })).toBeVisible();
      await expect(page.getByRole('radio', { name: /يدوي/ })).toBeChecked();
      await expect(page.getByTestId('playlist-add-videos')).toHaveText('إضافة فيديوهات');
    } finally {
      await deletePlaylistQuietly(owner, channelId(), id);
    }
  });
});
