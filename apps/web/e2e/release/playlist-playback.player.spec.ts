/**
 * Release regression: playlist playback (docs/specs/PLAYLIST-PLAYBACK.md; the owner's 2026-11-11
 * reports "when you hit play all on playlist, or when you hit play next or it goes there auto,
 * shouldnt it auto play the video?" and "shouldnt it play them as ORDERED IN PLAYLIST").
 *
 * A run creator uploads three videos of its own and makes a playlist of them, then reorders it, so
 * the saved order is neither the upload order nor a date or title order (builders.ts: the spec makes
 * its own data and removes it afterwards). Then: the playlist page's Play all opens the
 * first item with the list in the URL and it plays on its own; the pane lists the saved order with
 * the first item highlighted; when the video ends the next item in that order plays and the
 * highlight moves; after the last item the list stops (loop off); with loop on the first item
 * follows. The Arabic pane is right to left in the same order. Everything is deleted afterwards.
 */
import { expect, type Page } from '@playwright/test';
import { test } from './builders';
import { target } from './targets';
import { apiFetch } from './web-session';

// The spec signs up (a run account): traces and videos would record its session
test.use({ trace: 'off', video: 'off' });

const VIDEO = '.video-js video';

const mediaTime = (page: Page) => page.evaluate((sel) => document.querySelector<HTMLVideoElement>(sel)?.currentTime ?? 0, VIDEO);

/** Playing on its own: the media clock moves with no press on the player */
async function expectPlaying(page: Page, what: string, videoId?: string) {
  // A seamless next keeps the last video playing until the next one's source is swapped in:
  // measure the video asked for, not the one before it
  if (videoId) await expect(page.locator('.custom-video-player').first(), `${what}: the player holds the video`).toHaveAttribute('data-video-id', videoId, { timeout: 30_000 });
  await expect.poll(() => mediaTime(page), { message: `${what} did not start playing on its own`, timeout: 45_000 }).toBeGreaterThan(0.5);
}

async function seekToEnd(page: Page) {
  await page.mouse.move(1, 1);
  // The duration is known once the source has loaded
  await expect.poll(() => page.evaluate((sel) => Number.isFinite(document.querySelector<HTMLVideoElement>(sel)?.duration ?? NaN), VIDEO), { timeout: 30_000 }).toBe(true);
  await page.evaluate((sel) => {
    const v = document.querySelector<HTMLVideoElement>(sel)!;
    v.currentTime = Math.max(0, v.duration - 0.6);
    if (v.paused) void v.play().catch(() => undefined);
  }, VIDEO);
  await expect(page.getByTestId('player-end-screen')).toBeVisible({ timeout: 30_000 });
}

const paneOrder = (page: Page) =>
  page.getByTestId('playlist-pane-item').evaluateAll((els) => els.map((el) => el.getAttribute('data-video-id') ?? ''));
const current = (page: Page) => page.locator('[data-testid="playlist-pane-item"][aria-current="true"]');

test.describe('Release: playlist playback', () => {
  test('Play all plays the saved order on its own; the end advances, stops at the last item, and loops', async ({ page, browser, ownData }) => {
    test.setTimeout(900_000);
    const creator = await ownData.createCreator(browser, 'playlist-play');
    const user = creator.user;
    const channelId = creator.channelIds[0];
    const json = { 'Content-Type': 'application/json', channelId };
    const [first, second, third] = [
      await ownData.createVideo(user, channelId, { clip: 'landscape40', title: `Playlist A ${Date.now().toString(36)}` }),
      await ownData.createVideo(user, channelId, { clip: 'landscape40', title: `Playlist B ${Date.now().toString(36)}` }),
      await ownData.createVideo(user, channelId, { clip: 'landscape40', title: `Playlist C ${Date.now().toString(36)}` }),
    ];
    {
      // Made in one order, then reordered: the saved order is what must play
      const playlistId = await ownData.createPlaylist(user, channelId, { videoIds: [first.id, second.id, third.id], isPublic: true });
      const order = [second.id, first.id, third.id];
      const reordered = await apiFetch(user, `/api/playlists/${playlistId}/videos/order`, { method: 'PUT', headers: json, body: JSON.stringify({ videoIds: order }) });
      expect(reordered.status, `reorder: ${await reordered.text()}`).toBeLessThan(300);

      // The queue API (deployed with this change) answers in the saved order
      const queue = await fetch(`${target().api}/api/playlists/${playlistId}/queue`, { cache: 'no-store' });
      test.skip(queue.status === 404 && !(await queue.clone().text()).includes('Playlist not found'), 'the playback queue API is not deployed to this environment yet');
      expect(queue.status).toBe(200);
      const queued = (await queue.json()) as { result: { items: Array<{ id: string }> } };
      expect(queued.result.items.map((i) => i.id), 'the queue follows the saved order').toEqual(order);

      // Play all on the playlist page
      await page.goto(`${target().web}/en/playlist/${playlistId}`);
      const playAll = page.getByTestId('playlist-play-all');
      await expect(playAll).toBeVisible({ timeout: 30_000 });
      await playAll.click();
      await expect(page).toHaveURL(new RegExp(`/en/video/${order[0]}\\?list=${playlistId}&index=0`), { timeout: 30_000 });
      const pane = page.getByTestId('playlist-pane');
      await expect(pane, 'the playlist pane shows while a playlist plays').toBeVisible({ timeout: 30_000 });
      await expect.poll(() => paneOrder(page), { message: 'the pane lists the saved order' }).toEqual(order);
      await expect(current(page)).toHaveAttribute('data-video-id', order[0]);
      await expect(page.getByTestId('playlist-pane-position')).toHaveText('1 / 3');
      await expectPlaying(page, 'Play all', order[0]);

      // The end plays the next item in the saved order, and the highlight moves
      await seekToEnd(page);
      await expect(page).toHaveURL(new RegExp(`/en/video/${order[1]}\\?list=${playlistId}&index=1`), { timeout: 20_000 });
      await expect(current(page)).toHaveAttribute('data-video-id', order[1]);
      await expect(page.getByTestId('playlist-pane-position')).toHaveText('2 / 3');
      await expectPlaying(page, 'the next item', order[1]);

      // The last item: loop off, the list stops there
      await page.locator(`[data-testid="playlist-pane-item"][data-video-id="${order[2]}"]`).click();
      await expect(page).toHaveURL(new RegExp(`/en/video/${order[2]}\\?list=${playlistId}&index=2`), { timeout: 20_000 });
      await expect(current(page)).toHaveAttribute('data-video-id', order[2]);
      await expectPlaying(page, 'a clicked item', order[2]);
      await seekToEnd(page);
      const end = page.getByTestId('player-end-screen');
      await expect(end.getByTestId('player-replay-playlist')).toBeVisible();
      await expect(end.getByTestId('player-next-thumb')).toHaveCount(0);
      await page.waitForTimeout(5_000);
      await expect(page, 'the list stops after its last item').toHaveURL(new RegExp(`/en/video/${order[2]}`));

      // Loop on: the first item follows the last
      await page.getByTestId('playlist-pane-loop').click();
      await expect(page.getByTestId('playlist-pane-loop')).toHaveAttribute('aria-pressed', 'true');
      await expect(page).toHaveURL(new RegExp(`/en/video/${order[0]}\\?list=${playlistId}&index=0`), { timeout: 20_000 });
      await expect(current(page)).toHaveAttribute('data-video-id', order[0]);
      await expectPlaying(page, 'the first item after looping', order[0]);

      // Arabic: the same order, right to left
      await page.goto(`${target().web}/ar/video/${order[1]}?list=${playlistId}&index=1`);
      await expect(pane).toHaveAttribute('dir', 'rtl', { timeout: 30_000 });
      await expect.poll(() => paneOrder(page)).toEqual(order);
      await expect(current(page)).toHaveAttribute('data-video-id', order[1]);
    }
  });
});
