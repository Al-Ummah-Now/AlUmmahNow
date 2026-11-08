import { test, expect } from './fixtures';
import type { Locator, Page } from '@playwright/test';
import { ANONYMOUS_STATE, AUTH_STATE } from './test-utils/auth-state';
import {
  apiAs,
  apiGet,
  channelsOf,
  clickUntil,
  createPlaylist,
  deletePlaylistQuietly,
  deletePlaylistsTitled,
  expectRtl,
  fillStable,
  findQaLecturesChannel,
  listChannelPlaylists,
  listPublicChannelVideos,
  tempName,
} from './test-utils/channel-content';

/**
 * Playlists: the channel playlist manager (/settings/channel/[id]/playlists:
 * create, rename, change visibility, delete) and the playlist page
 * (/playlist/[id]: info, Play all, owner reorder/remove).
 *
 * Writes go to the single user's own channel; every playlist a test creates
 * is titled "E2E Temp …" and deleted afterwards. qa-creator's seeded playlist
 * is only viewed.
 */

const owner = 'single' as const;
const channelId = () => channelsOf(owner).main.id;

async function openManager(page: Page, locale: 'en' | 'ar' = 'en') {
  await page.goto(`/${locale}/settings/channel/${channelId()}/playlists`);
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  // List finished loading (either rows or the empty state)
  await expect(page.getByText(locale === 'ar' ? 'جاري التحميل...' : 'Loading...')).toHaveCount(0);
}

function managedRow(page: Page, title: string): Locator {
  return page.getByRole('listitem').filter({ has: page.getByRole('heading', { level: 3, name: title, exact: true }) });
}

test.describe('Playlist manager', () => {
  test.use({ storageState: AUTH_STATE.single });

  test('PLAY-001 creates, renames, makes private and deletes a playlist (en)', async ({ page }) => {
    const title = tempName('Playlist');
    const renamed = `${title} v2`;
    try {
      await openManager(page);
      await expect(page.getByRole('heading', { level: 1, name: 'Manage Playlists' })).toBeVisible();

      await clickUntil(page.getByRole('button', { name: 'New playlist' }), async () =>
        expect(page.getByRole('heading', { name: 'Create playlist' })).toBeVisible({ timeout: 3000 })
      );
      await fillStable(page.getByLabel('Name'), title);
      await page.getByLabel('Description').fill('Created by an E2E test');
      await expect(page.getByRole('radio', { name: /^Public/ })).toBeChecked();
      await page.getByRole('button', { name: 'Save' }).click();

      const row = managedRow(page, title);
      await expect(row).toBeVisible();
      await expect(row).toContainText('0 videos');
      await expect(row).toContainText('Public');
      await expect(row.getByRole('link', { name: 'View playlist' })).toHaveAttribute('href', /^\/en\/playlist\/[\w-]+$/);
      await expect.poll(async () => (await listChannelPlaylists(channelId())).some((p) => p.title === title)).toBe(true);

      // Rename + make private
      await row.getByRole('button', { name: 'Edit playlist' }).click();
      await expect(page.getByRole('heading', { name: 'Edit playlist' })).toBeVisible();
      await expect(page.getByLabel('Name')).toHaveValue(title);
      await page.getByLabel('Name').fill(renamed);
      await page.getByRole('radio', { name: /^Private/ }).check();
      await page.getByRole('button', { name: 'Save' }).click();
      const renamedRow = managedRow(page, renamed);
      await expect(renamedRow).toBeVisible();
      await expect(renamedRow).toContainText('Private');

      // Delete (confirm dialog)
      page.once('dialog', (dialog) => {
        expect(dialog.message()).toBe(`Delete "${renamed}"? This cannot be undone.`);
        void dialog.accept();
      });
      await renamedRow.getByRole('button', { name: 'Delete playlist' }).click();
      await expect(renamedRow).toHaveCount(0);
      await expect
        .poll(async () => {
          const { body } = await apiAs<{ data?: Array<{ title: string }> }>(owner, 'GET', `/api/playlists?channelId=${channelId()}&limit=100`);
          return (body.data ?? []).some((p) => p.title === renamed);
        })
        .toBe(false);
    } finally {
      await deletePlaylistsTitled(owner, channelId(), title);
    }
  });

  test('PLAY-002 rejects a blank name and keeps the playlist when deletion is dismissed', async ({ page }) => {
    const title = tempName('Keep');
    const { id } = await createPlaylist(owner, channelId(), { title });
    try {
      await openManager(page);
      await clickUntil(page.getByRole('button', { name: 'New playlist' }), async () =>
        expect(page.getByLabel('Name')).toBeVisible({ timeout: 3000 })
      );
      await fillStable(page.getByLabel('Name'), '   ');
      await page.getByRole('button', { name: 'Save' }).click();
      // (Next's route announcer is also role=alert)
      await expect(page.getByRole('alert').filter({ hasText: 'Please enter a playlist name' })).toBeVisible();
      await page.getByRole('button', { name: 'Cancel' }).click();
      await expect(page.getByLabel('Name')).toHaveCount(0);

      const row = managedRow(page, title);
      page.once('dialog', (dialog) => void dialog.dismiss());
      await row.getByRole('button', { name: 'Delete playlist' }).click();
      await expect(row).toBeVisible();
      expect((await listChannelPlaylists(channelId())).some((p) => p.id === id)).toBe(true);
    } finally {
      await deletePlaylistQuietly(owner, channelId(), id);
    }
  });

  test('PLAY-003 Arabic manager is translated and RTL', async ({ page }) => {
    await openManager(page, 'ar');
    await expectRtl(page);
    await expect(page.getByRole('heading', { level: 1, name: 'إدارة قوائم التشغيل' })).toBeVisible();
    await clickUntil(page.getByRole('button', { name: 'قائمة تشغيل جديدة' }), async () =>
      expect(page.getByRole('heading', { name: 'إنشاء قائمة تشغيل' })).toBeVisible({ timeout: 3000 })
    );
    await expect(page.getByLabel('الاسم')).toBeVisible();
    await expect(page.getByRole('radio', { name: /^عامة/ })).toBeChecked();
    await expect(page.locator('div[dir="rtl"]').filter({ has: page.getByRole('heading', { level: 1 }) }).first()).toBeVisible();
  });
});

test.describe('Playlist page - visitor', () => {
  test.use({ storageState: ANONYMOUS_STATE });

  test('PLAY-010 shows the playlist, its ordered videos and Play all (en)', async ({ page }) => {
    const lectures = await findQaLecturesChannel();
    const [playlist] = await listChannelPlaylists(lectures.id);
    const full = await apiGet<{ videoItems?: Array<{ id: string; title: string }> }>(`/api/playlists/${playlist.id}?includeVideos=true`);
    const items = full.videoItems ?? [];
    expect(items.length).toBeGreaterThan(0);

    await page.goto(`/en/playlist/${playlist.id}`);
    await expect(page.getByRole('heading', { level: 1, name: playlist.name })).toBeVisible();
    await expect(page.getByRole('link', { name: lectures.name })).toHaveAttribute('href', `/en/channels/${lectures.id}`);
    await expect(page.getByText(`${items.length} videos`)).toBeVisible();
    await expect(page.getByText('Public', { exact: true })).toBeVisible();

    const list = page.getByRole('list').filter({ has: page.getByRole('heading', { level: 2 }) });
    await expect(list.getByRole('listitem')).toHaveCount(items.length);
    for (const [i, item] of items.entries()) {
      await expect(list.getByRole('listitem').nth(i).getByRole('heading', { level: 2 })).toHaveText(item.title);
    }
    await expect(page.getByRole('link', { name: 'Play all' })).toHaveAttribute('href', `/en/video?vid=${items[0].id}`);
    // Visitors get no owner controls
    await expect(page.getByRole('button', { name: 'Move up' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Remove from playlist' })).toHaveCount(0);
  });

  test('PLAY-011 Arabic playlist page is RTL with Arabic labels', async ({ page }) => {
    const lectures = await findQaLecturesChannel();
    const [playlist] = await listChannelPlaylists(lectures.id);
    await page.goto(`/ar/playlist/${playlist.id}`);
    await expectRtl(page);
    await expect(page.getByRole('heading', { level: 1, name: playlist.name })).toBeVisible();
    await expect(page.getByRole('link', { name: 'تشغيل الكل' })).toHaveAttribute('href', /^\/ar\/video\?vid=/);
    await expect(page.getByText(`${playlist.videos.length} فيديو`)).toBeVisible();
    await expect(page.getByText('عامة', { exact: true })).toBeVisible();
  });

  test('PLAY-012 unknown playlist shows the not-found state', async ({ page }) => {
    await page.goto('/en/playlist/00000000-0000-0000-0000-000000000000');
    await expect(page.getByRole('heading', { level: 1, name: 'Playlist not found' })).toBeVisible();
    await expect(page.getByText('This playlist does not exist or is private.')).toBeVisible();
  });
});

test.describe('Playlist page - owner', () => {
  test.use({ storageState: AUTH_STATE.single });

  test('PLAY-020 owner reorders and removes videos', async ({ page }) => {
    const lectures = await findQaLecturesChannel();
    const videos = (await listPublicChannelVideos(lectures.id)).slice(0, 2);
    expect(videos.length).toBe(2);
    const { id } = await createPlaylist(owner, channelId(), { title: tempName('Order'), videoIds: videos.map((v) => v.id) });
    try {
      await page.goto(`/en/playlist/${id}`);
      const list = page.getByRole('list').filter({ has: page.getByRole('heading', { level: 2 }) });
      const titles = () => list.getByRole('heading', { level: 2 }).allInnerTexts();
      await expect.poll(titles).toEqual([videos[0].title, videos[1].title]);
      await expect(list.getByRole('listitem').first().getByRole('button', { name: 'Move up' })).toBeDisabled();

      await clickUntil(list.getByRole('listitem').first().getByRole('button', { name: 'Move down' }), async () =>
        expect.poll(titles, { timeout: 5000 }).toEqual([videos[1].title, videos[0].title])
      );
      await expect
        .poll(async () => (await apiGet<{ videos: string[] }>(`/api/playlists/${id}`)).videos)
        .toEqual([videos[1].id, videos[0].id]);

      await list.getByRole('listitem').first().getByRole('button', { name: 'Remove from playlist' }).click();
      await expect.poll(titles).toEqual([videos[0].title]);
      await expect(page.getByText('1 videos')).toBeVisible();
      await expect.poll(async () => (await apiGet<{ videos: string[] }>(`/api/playlists/${id}`)).videos).toEqual([videos[0].id]);
    } finally {
      await deletePlaylistQuietly(owner, channelId(), id);
    }
  });

  test('PLAY-021 a private playlist is visible to its owner only', async ({ page, browser }) => {
    const title = tempName('Private');
    const { id } = await createPlaylist(owner, channelId(), { title, isPublic: false });
    try {
      await page.goto(`/en/playlist/${id}`);
      await expect(page.getByRole('heading', { level: 1, name: title })).toBeVisible();
      await expect(page.getByText('Private', { exact: true })).toBeVisible();
      await expect(page.getByText('This playlist has no videos yet')).toBeVisible();

      const anon = await browser.newContext({ storageState: ANONYMOUS_STATE, baseURL: test.info().project.use.baseURL });
      try {
        const anonPage = await anon.newPage();
        await anonPage.goto(`/en/playlist/${id}`);
        await expect(anonPage.getByRole('heading', { level: 1, name: 'Playlist not found' })).toBeVisible();
      } finally {
        await anon.close();
      }
    } finally {
      await deletePlaylistQuietly(owner, channelId(), id);
    }
  });
});
