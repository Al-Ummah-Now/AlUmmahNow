/**
 * Release regression: playlist playback (docs/specs/PLAYLIST-PLAYBACK.md; the owner's 2026-11-11
 * reports "when you hit play all on playlist, or when you hit play next or it goes there auto,
 * shouldnt it auto play the video?" and "shouldnt it play them as ORDERED IN PLAYLIST").
 *
 * A run account makes a playlist of the seed's three videos and reorders it, so the saved order
 * is neither the add order nor a date or title order. Then: the playlist page's Play all opens the
 * first item with the list in the URL and it plays on its own; the pane lists the saved order with
 * the first item highlighted; when the video ends the next item in that order plays and the
 * highlight moves; after the last item the list stops (loop off); with loop on the first item
 * follows. The Arabic pane is right to left in the same order. The playlist is deleted afterwards.
 */
import { expect, test, type Page } from '@playwright/test';
import { seeded } from './fixtures';
import { studioOwner } from './studio';
import { target } from './targets';
import { apiFetch } from './web-session';

// The spec signs up (a run account): traces and videos would record its session
test.use({ trace: 'off', video: 'off' });

const VIDEO = '.video-js video';

const mediaTime = (page: Page) => page.evaluate((sel) => document.querySelector<HTMLVideoElement>(sel)?.currentTime ?? 0, VIDEO);

/** Playing on its own: the media clock moves with no press on the player */
async function expectPlaying(page: Page, what: string) {
  await expect.poll(() => mediaTime(page), { message: `${what} did not start playing on its own`, timeout: 45_000 }).toBeGreaterThan(0.5);
}

async function seekToEnd(page: Page) {
  await page.mouse.move(1, 1);
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
  test('Play all plays the saved order on its own; the end advances, stops at the last item, and loops', async ({ page }) => {
    test.setTimeout(300_000);
    const { videos } = await seeded();
    const { user, channelId } = await studioOwner(page, 'playlist-play');
    const json = { 'Content-Type': 'application/json', channelId };
    let playlistId = '';
    try {
      const created = await apiFetch(user, '/api/playlists', {
        method: 'POST',
        headers: json,
        body: JSON.stringify({ title: `Release playlist ${Date.now().toString(36)}`, isPublic: true, channelId }),
      });
      const createdText = await created.text();
      expect(created.status, `POST /api/playlists: ${createdText}`).toBeLessThan(300);
      playlistId = (JSON.parse(createdText) as { result?: { playlist?: { id?: string } } }).result?.playlist?.id ?? '';
      expect(playlistId, 'playlist created').not.toBe('');

      // Added in one order, then reordered: the saved order is what must play
      for (const v of [videos.landscape, videos.landscape2, videos.vertical]) {
        const added = await apiFetch(user, `/api/playlists/${playlistId}/videos`, { method: 'POST', headers: json, body: JSON.stringify({ videoId: v.id }) });
        expect(added.status, `add ${v.title}: ${await added.text()}`).toBeLessThan(300);
      }
      const order = [videos.landscape2.id, videos.landscape.id, videos.vertical.id];
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
      await expectPlaying(page, 'Play all');

      // The end plays the next item in the saved order, and the highlight moves
      await seekToEnd(page);
      await expect(page).toHaveURL(new RegExp(`/en/video/${order[1]}\\?list=${playlistId}&index=1`), { timeout: 20_000 });
      await expect(current(page)).toHaveAttribute('data-video-id', order[1]);
      await expect(page.getByTestId('playlist-pane-position')).toHaveText('2 / 3');
      await expectPlaying(page, 'the next item');

      // The last item: loop off, the list stops there
      await page.locator(`[data-testid="playlist-pane-item"][data-video-id="${order[2]}"]`).click();
      await expect(page).toHaveURL(new RegExp(`/en/video/${order[2]}\\?list=${playlistId}&index=2`), { timeout: 20_000 });
      await expect(current(page)).toHaveAttribute('data-video-id', order[2]);
      await expectPlaying(page, 'a clicked item');
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
      await expectPlaying(page, 'the first item after looping');

      // Arabic: the same order, right to left
      await page.goto(`${target().web}/ar/video/${order[1]}?list=${playlistId}&index=1`);
      await expect(pane).toHaveAttribute('dir', 'rtl', { timeout: 30_000 });
      await expect.poll(() => paneOrder(page)).toEqual(order);
      await expect(current(page)).toHaveAttribute('data-video-id', order[1]);
    } finally {
      if (playlistId) await apiFetch(user, `/api/playlists/${playlistId}`, { method: 'DELETE', headers: { channelId } });
    }
  });
});
