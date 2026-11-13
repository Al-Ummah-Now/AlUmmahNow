/**
 * Release regression: moving between videos is seamless (owner, 2026-11-13: moving between videos
 * in a playlist / up next "flickers"; make it YouTube-style). The watch page lives in the
 * /[locale]/video layout (components/video/WatchShell.tsx), so Next, an ended video's advance and
 * Back keep the SAME player element and swap only its source. Checked on real watch pages over
 * the spec's own uploads (builders.ts), in a playlist:
 *
 *   - the <video> and the Video.js root are the same DOM nodes after Next, the auto-advance at
 *     the end, and Back (a marker set on them before survives), and no player node is removed;
 *   - no blank frame: sampled every animation frame, the player box is on screen with a size the
 *     whole time;
 *   - the URL (history push: Back returns), the document title, the heading and the pane's
 *     highlight follow the video; the next video plays on its own;
 *   - on a phone the player stays pinned to the top across Next (owner: "when I scroll, the
 *     player disappears"), for a 16:9 video and a vertical one.
 */
import { expect, type Page } from '@playwright/test';
import { test } from './builders';
import { target } from './targets';

test.use({ trace: 'off', video: 'off' });

const VIDEO = '.video-js video';
const mediaTime = (page: Page) => page.evaluate((sel) => document.querySelector<HTMLVideoElement>(sel)?.currentTime ?? 0, VIDEO);

async function expectPlaying(page: Page, what: string) {
  const from = await mediaTime(page);
  await expect.poll(() => mediaTime(page), { message: `${what} did not start playing on its own`, timeout: 45_000 }).toBeGreaterThan(Math.min(from, 0.1) + 0.4);
}

/** Marks the player's nodes and watches them: removals and frames with no player box */
async function watchPlayer(page: Page) {
  await page.evaluate(() => {
    const w = window as unknown as { __seamless: { removed: number; blank: number; frames: number; stop: boolean } };
    const root = document.querySelector('.video-js') as HTMLElement & { __mark?: string };
    const video = document.querySelector('.video-js video') as HTMLVideoElement & { __mark?: string };
    root.__mark = 'root';
    video.__mark = 'video';
    w.__seamless = { removed: 0, blank: 0, frames: 0, stop: false };
    new MutationObserver((records) => {
      for (const r of records) for (const n of Array.from(r.removedNodes)) {
        if (n instanceof Element && (n.matches('.video-js, .custom-video-player, video') || n.querySelector('.video-js'))) w.__seamless.removed += 1;
      }
    }).observe(document.body, { childList: true, subtree: true });
    const tick = () => {
      if (w.__seamless.stop) return;
      const box = document.querySelector('.video-js')?.getBoundingClientRect();
      w.__seamless.frames += 1;
      if (!box || box.width < 10 || box.height < 10) w.__seamless.blank += 1;
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
}

async function expectSamePlayer(page: Page, what: string) {
  const state = await page.evaluate(() => {
    const w = window as unknown as { __seamless: { removed: number; blank: number; frames: number } };
    const root = document.querySelector('.video-js') as (HTMLElement & { __mark?: string }) | null;
    const video = document.querySelector('.video-js video') as (HTMLVideoElement & { __mark?: string }) | null;
    return { root: root?.__mark, video: video?.__mark, ...w.__seamless };
  });
  expect(state.root, `${what}: the Video.js root was replaced`).toBe('root');
  expect(state.video, `${what}: the <video> element was replaced`).toBe('video');
  expect(state.removed, `${what}: a player node was removed`).toBe(0);
  expect(state.frames, `${what}: frames were sampled`).toBeGreaterThan(10);
  expect(state.blank, `${what}: frames with no player box`).toBe(0);
}

const current = (page: Page) => page.locator('[data-testid="playlist-pane-item"][aria-current="true"]');
const heading = (page: Page) => page.locator('h1.watch-title').first();

test.describe('Release: seamless next', () => {
  test('Next, the end of a video and Back keep the same player; URL, title and details follow', async ({ page, browser, ownData }) => {
    test.setTimeout(900_000);
    const creator = await ownData.createCreator(browser, 'seamless');
    const user = creator.user;
    const channelId = creator.channelIds[0];
    const stamp = Date.now().toString(36);
    const videos = [
      await ownData.createVideo(user, channelId, { clip: 'landscape40', title: `Seamless A ${stamp}` }),
      await ownData.createVideo(user, channelId, { clip: 'landscape40', title: `Seamless B ${stamp}` }),
      await ownData.createVideo(user, channelId, { clip: 'landscape40', title: `Seamless C ${stamp}` }),
    ];
    const ids = videos.map((v) => v.id);
    const playlistId = await ownData.createPlaylist(user, channelId, { videoIds: ids, isPublic: true });

    await page.goto(`${target().web}/en/video/${ids[0]}?list=${playlistId}&index=0`);
    await expect(current(page)).toHaveAttribute('data-video-id', ids[0], { timeout: 45_000 });
    await expect(heading(page)).toHaveText(videos[0].title, { timeout: 30_000 });
    await expectPlaying(page, 'the first item');
    await watchPlayer(page);

    // Next: same player, the next video's URL, title, heading and highlight; it plays on its own
    await page.getByTestId('playlist-pane-next').click();
    await expect(page).toHaveURL(new RegExp(`/en/video/${ids[1]}\\?list=${playlistId}&index=1`), { timeout: 20_000 });
    await expect(heading(page)).toHaveText(videos[1].title, { timeout: 20_000 });
    await expect(page).toHaveTitle(new RegExp(videos[1].title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), { timeout: 20_000 });
    await expect(current(page)).toHaveAttribute('data-video-id', ids[1]);
    await expectPlaying(page, 'the next item');
    await expectSamePlayer(page, 'Next');

    // The end of the video advances (3 s countdown) on the same player
    await page.mouse.move(1, 1);
    await page.evaluate((sel) => {
      const v = document.querySelector<HTMLVideoElement>(sel)!;
      v.currentTime = Math.max(0, v.duration - 0.6);
      if (v.paused) void v.play().catch(() => undefined);
    }, VIDEO);
    await expect(page).toHaveURL(new RegExp(`/en/video/${ids[2]}\\?list=${playlistId}&index=2`), { timeout: 30_000 });
    await expect(heading(page)).toHaveText(videos[2].title, { timeout: 20_000 });
    await expectPlaying(page, 'the auto-advanced item');
    await expectSamePlayer(page, 'auto-advance');

    // Back: history has each video; the same player shows the previous one again
    await page.goBack();
    await expect(page).toHaveURL(new RegExp(`/en/video/${ids[1]}\\?list=${playlistId}&index=1`), { timeout: 20_000 });
    await expect(heading(page)).toHaveText(videos[1].title, { timeout: 20_000 });
    await expect(current(page)).toHaveAttribute('data-video-id', ids[1]);
    await expectSamePlayer(page, 'Back');
  });

  for (const clip of ['landscape40', 'vertical'] as const) {
    test(`phone: the player stays pinned at the top while scrolling, and across Next (${clip})`, async ({ page, browser, ownData }) => {
      test.setTimeout(600_000);
      const creator = await ownData.createCreator(browser, `seamless-pin-${clip}`);
      const user = creator.user;
      const channelId = creator.channelIds[0];
      const stamp = Date.now().toString(36);
      const first = await ownData.createVideo(user, channelId, { clip, title: `Pin A ${stamp}` });
      const second = await ownData.createVideo(user, channelId, { clip, title: `Pin B ${stamp}` });
      const playlistId = await ownData.createPlaylist(user, channelId, { videoIds: [first.id, second.id], isPublic: true });

      await page.setViewportSize({ width: 390, height: 844 });
      await page.goto(`${target().web}/ar/video/${first.id}?list=${playlistId}&index=0`);
      await expect(current(page)).toHaveAttribute('data-video-id', first.id, { timeout: 45_000 });
      await expectPlaying(page, 'the first item');
      const frame = page.locator('.custom-video-player').first();
      const pinnedOnScreen = async (what: string) => {
        await expect(frame, `${what}: pinned`).toHaveAttribute('data-pinned', 'true', { timeout: 10_000 });
        const box = (await page.locator('.video-js').first().boundingBox())!;
        expect(box.y, `${what}: at the top`).toBeLessThanOrEqual(1);
        expect(box.height, `${what}: with a size`).toBeGreaterThan(100);
        expect(box.y + box.height, `${what}: on screen`).toBeLessThanOrEqual(844);
      };
      // Scroll the comments under it: the player stays at the top
      await page.evaluate(() => window.scrollTo(0, 900));
      await pinnedOnScreen('scrolled');
      await watchPlayer(page);

      // Pressed where it is (a real click would first scroll the pane into view, unpinning)
      await page.getByTestId('playlist-pane-next').dispatchEvent('click');
      await expect(page).toHaveURL(new RegExp(`/ar/video/${second.id}\\?list=${playlistId}&index=1`), { timeout: 20_000 });
      await expect(heading(page)).toHaveText(second.title, { timeout: 20_000 });
      await expectPlaying(page, 'the next item');
      await pinnedOnScreen('after Next');
      await expectSamePlayer(page, 'Next on a phone');

      // Back at the top it docks again
      await page.evaluate(() => window.scrollTo(0, 0));
      await expect(frame).not.toHaveAttribute('data-pinned', 'true');
    });
  }
});
