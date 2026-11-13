/**
 * Playlists without a channel (owner request 2026-11-13: "Playlists should be
 * available without a channel"). For each language a new signed-in viewer
 * with no channel, on a creator's two videos:
 *   - Save on the watch page creates a personal playlist with the video
 *     (no "a channel is required"); the card menu's "Save to playlist" adds
 *     the second video from the channel page;
 *   - You › Playlists lists it; its editor makes it Unlisted;
 *   - its page's Play all opens the first video with the playlist pane in
 *     the saved order (the queue a viewer plays; media playback itself is
 *     covered by playlist-playback.player.spec.ts);
 *   - it is deleted from You › Playlists in the in-app dialog.
 * The creator, channel, videos, playlist and viewer are this spec's own and
 * removed by the data scope afterwards, pass or fail.
 */
import { expect, type BrowserContext, type Page } from '@playwright/test';
import { test } from './builders';
import { target } from './targets';
import { watchUrl } from './videos';
import { apiFetch, gotoSettled, type Locale, type WebUser } from './web-session';

// Signs users up through the auth server: traces would hold the password and code
test.use({ trace: 'off' });

const LOCALES: Locale[] = ['en', 'ar'];

async function answerConsent(context: BrowserContext): Promise<void> {
  await context.addCookies([{ name: 'aun_consent', value: `v1.a0.e0.p0.${Date.now()}`, url: target().web, sameSite: 'Lax' }]);
}

interface StoredPlaylist { id: string; title: string; channelId: string; userId: string; videos: string[]; isPublic: boolean; isUnlisted?: boolean; visibility?: string }

async function myPlaylists(user: WebUser): Promise<StoredPlaylist[]> {
  const res = await apiFetch(user, '/api/playlists?mine=true&limit=50');
  expect(res.status, `GET /api/playlists?mine=true: ${await res.clone().text()}`).toBe(200);
  return ((await res.json()) as { data?: StoredPlaylist[] }).data ?? [];
}

const paneOrder = (page: Page) =>
  page.getByTestId('playlist-pane-item').evaluateAll((els) => els.map((el) => el.getAttribute('data-video-id') ?? ''));

test.describe('playlists without a channel', () => {
  for (const locale of LOCALES) {
    test(`a viewer with no channel creates a playlist, saves videos, plays and deletes it (${locale})`, async ({ browser, page, context, ownData }) => {
      test.setTimeout(360000);
      const stamp = Date.now().toString(36);
      const creator = await ownData.createCreator(browser, `plnc-creator-${locale}`);
      const channelId = creator.channelIds[0];
      const first = await ownData.createVideo(creator.user, channelId, { title: `Personal list A ${stamp}` });
      const second = await ownData.createVideo(creator.user, channelId, { title: `Personal list B ${stamp}` });

      await answerConsent(context);
      await page.setViewportSize({ width: 1280, height: 900 });
      const viewer = await ownData.createUser(page, `plnc-viewer-${locale}`, locale);
      const access = (await (await apiFetch(viewer, '/api/channels/access')).json().catch(() => ({}))) as { data?: unknown[] };
      expect(access.data ?? [], 'the viewer must have no channel').toHaveLength(0);
      // Removed with the user anyway; deleted explicitly first so a failure mid-way leaves nothing
      ownData.onCleanup(`personal playlists of ${viewer.userId}`, async () => {
        for (const p of await myPlaylists(viewer).catch(() => [])) await apiFetch(viewer, `/api/playlists/${p.id}`, { method: 'DELETE' });
      });

      // Watch page: Save → create a personal playlist with this video
      const name = `My list ${stamp}`;
      await gotoSettled(page, watchUrl(first.id, locale));
      await page.getByTestId('save-to-playlist-button').click();
      const menu = page.getByTestId('save-to-playlist-menu');
      await expect(menu).toBeVisible();
      const create = menu.getByTestId('save-to-playlist-create');
      await create.getByRole('textbox').fill(name);
      await create.locator('button[type="submit"]').click();
      await expect(menu.locator('label').filter({ hasText: name }).locator('input[type="checkbox"]')).toBeChecked({ timeout: 30000 });
      let mine = await myPlaylists(viewer);
      expect(mine.map((p) => p.title)).toEqual([name]);
      const playlist = mine[0];
      expect(playlist.channelId, 'a personal playlist has no channel').toBe('');
      expect(playlist.userId).toBe(viewer.userId);
      expect(playlist.videos).toEqual([first.id]);
      await page.keyboard.press('Escape');

      // Channel page: the second video's card menu → Save to playlist
      await gotoSettled(page, `${target().web}/${locale}/channels/${channelId}?tab=videos`);
      const card = page.locator('a, article, div').filter({ has: page.getByTestId('video-card-menu') }).filter({ hasText: second.title }).last();
      await card.getByTestId('video-card-menu').click();
      await page.getByTestId('video-card-save-to-playlist').click();
      const cardMenu = page.getByTestId('save-to-playlist-menu');
      const box = cardMenu.locator(`[data-playlist-id="${playlist.id}"] input[type="checkbox"]`);
      await expect(box).not.toBeChecked({ timeout: 30000 });
      await box.click();
      await expect(box).toBeChecked({ timeout: 30000 });
      await expect.poll(async () => (await myPlaylists(viewer))[0]?.videos).toEqual([first.id, second.id]);
      await page.keyboard.press('Escape');

      // You › Playlists lists it; the editor makes it Unlisted
      await gotoSettled(page, `${target().web}/${locale}/library/playlists`);
      const row = page.locator(`[data-testid="playlist-manager-item"][data-playlist-id="${playlist.id}"]`);
      await expect(row).toBeVisible({ timeout: 30000 });
      await gotoSettled(page, `${target().web}/${locale}/library/playlists/${playlist.id}`);
      await page.getByRole('radio', { name: locale === 'en' ? /^Unlisted/ : /^غير مُدرجة/ }).check();
      await page.getByTestId('playlist-details-save').click();
      await expect.poll(async () => (await myPlaylists(viewer))[0]?.visibility).toBe('unlisted');
      // Link-only: a signed-out visitor opens it by its link, but it is in no list
      const byLink = await fetch(`${target().api}/api/playlists/${playlist.id}`, { cache: 'no-store' });
      expect(byLink.status, 'an unlisted playlist opens by link').toBe(200);

      // Its page: Play all opens the first video with the playlist in the saved order
      await gotoSettled(page, `${target().web}/${locale}/playlist/${playlist.id}`);
      const playAll = page.getByTestId('playlist-play-all');
      await expect(playAll).toBeVisible({ timeout: 30000 });
      await playAll.click();
      await expect(page).toHaveURL(new RegExp(`/${locale}/video/${first.id}\\?list=${playlist.id}&index=0`), { timeout: 30000 });
      await expect(page.getByTestId('playlist-pane')).toBeVisible({ timeout: 30000 });
      await expect.poll(() => paneOrder(page)).toEqual([first.id, second.id]);

      // Delete it from You › Playlists (in-app dialog)
      await gotoSettled(page, `${target().web}/${locale}/library/playlists`);
      await row.getByTestId('playlist-delete').click();
      await page.getByTestId('playlist-delete-dialog-confirm').click();
      await expect(row).toHaveCount(0, { timeout: 30000 });
      mine = await myPlaylists(viewer);
      expect(mine).toEqual([]);
    });
  }
});
