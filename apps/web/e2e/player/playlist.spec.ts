/**
 * Playlist playback in the player harness (docs/specs/PLAYLIST-PLAYBACK.md): with `?list=` the
 * page autoplays, the pane lists the queue in its saved order with the playing item highlighted,
 * the end of a video plays the next item in that order after the 3 s countdown and the highlight
 * moves, the pane's Next plays, the list stops at its end unless loop is on, shuffle never reorders
 * the pane, and a refused unmuted play falls back to muted playback with "Tap to unmute".
 *
 * The queue (GET /api/playlists/fixtures/queue) is served here: the saved order is deliberately not
 * alphabetical, so following it is not an accident of sorting.
 */
import { expect, test, type Page } from '@playwright/test';
import { openHarness } from './harness';

const ORDER = ['dark', 'short', 'bright'] as const;
type Fixture = (typeof ORDER)[number];
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'GET, OPTIONS' };

async function serveQueue(page: Page): Promise<void> {
  await page.route(/\/api\/playlists\/fixtures\/queue/, (route) => {
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS });
    const url = new URL(route.request().url());
    const video = url.searchParams.get('video');
    const at = video ? ORDER.indexOf(video as Fixture) : -1;
    return route.fulfill({
      status: 200,
      headers: { ...CORS, 'content-type': 'application/json' },
      body: JSON.stringify({
        success: true,
        result: {
          playlist: { id: 'fixtures', kind: 'playlist', title: 'Harness lessons', channelId: 'ch', channelName: 'Player harness', channelHandle: null, isPublic: true, sortMode: 'manual' },
          total: ORDER.length,
          exact: true,
          position: at === -1 ? null : at,
          nextPosition: null,
          offset: 0,
          items: ORDER.map((id, i) => ({ id, index: i, position: i, title: `Lesson: ${id}`, duration: 90, channelName: 'Player harness', isShort: id === 'short' })),
          prevOffset: null,
          nextOffset: null,
        },
      }),
    });
  });
}

const mediaTime = (page: Page) => page.evaluate(() => document.querySelector<HTMLVideoElement>('.video-js video')?.currentTime ?? 0);
const muted = (page: Page) => page.evaluate(() => document.querySelector<HTMLVideoElement>('.video-js video')?.muted ?? false);

/** Plays on its own: the media time moves without any press on the player */
async function expectPlaying(page: Page) {
  await expect.poll(() => mediaTime(page), { timeout: 30_000 }).toBeGreaterThan(0.5);
}

async function seekToEnd(page: Page) {
  await page.mouse.move(1, 1);
  await page.evaluate(() => {
    const v = document.querySelector<HTMLVideoElement>('.video-js video')!;
    v.currentTime = v.duration - 0.4;
    if (v.paused) void v.play().catch(() => undefined);
  });
  await expect(page.getByTestId('player-end-screen')).toBeVisible({ timeout: 20_000 });
}

async function paneOrder(page: Page): Promise<string[]> {
  return page.getByTestId('playlist-pane-item').evaluateAll((els) => els.map((el) => el.getAttribute('data-video-id') ?? ''));
}

const current = (page: Page) => page.locator('[data-testid="playlist-pane-item"][aria-current="true"]');

test.describe('playlist playback', () => {
  test.beforeEach(async ({ page }) => {
    await serveQueue(page);
  });

  test('Play all: the pane in saved order, the first item highlighted and playing on its own', async ({ page }) => {
    await openHarness(page, { src: 'dark', list: 'fixtures', index: 0 });
    const pane = page.getByTestId('playlist-pane');
    await expect(pane).toBeVisible();
    await expect(pane.getByRole('heading', { name: 'Harness lessons' })).toBeVisible();
    await expect.poll(() => paneOrder(page)).toEqual([...ORDER]);
    await expect(current(page)).toHaveAttribute('data-video-id', 'dark');
    await expect(page.getByTestId('playlist-pane-position')).toHaveText('1 / 3');
    await expectPlaying(page);
  });

  test('the end plays the next item in saved order after the countdown, and the highlight moves', async ({ page }) => {
    await openHarness(page, { src: 'dark', list: 'fixtures', index: 0 });
    await expectPlaying(page);
    await seekToEnd(page);
    await expect(page.getByTestId('player-next-badge')).toContainText('2 / 3');
    await expect(page.getByTestId('player-end-screen').locator('.vjs-fanous-next-title')).toHaveText('Lesson: short');
    await expect(page).toHaveURL(/src=short&list=fixtures&index=1/, { timeout: 8_000 });
    await expect(current(page)).toHaveAttribute('data-video-id', 'short');
    await expect(page.getByTestId('playlist-pane-position')).toHaveText('2 / 3');
    await expectPlaying(page);
  });

  test("the pane's Next and a click on an item play that item", async ({ page }) => {
    await openHarness(page, { src: 'dark', list: 'fixtures', index: 0 });
    // As a viewer would: the list has started playing before Next is pressed
    await expectPlaying(page);
    await page.getByTestId('playlist-pane-next').click();
    await expect(page).toHaveURL(/src=short/);
    await expect(current(page)).toHaveAttribute('data-video-id', 'short');
    await expectPlaying(page);
    await page.locator('[data-testid="playlist-pane-item"][data-video-id="bright"]').click();
    await expect(page).toHaveURL(/src=bright&list=fixtures&index=2/);
    await expect(current(page)).toHaveAttribute('data-video-id', 'bright');
    await expectPlaying(page);
  });

  test('loop off: the list stops after its last item', async ({ page }) => {
    await openHarness(page, { src: 'bright', list: 'fixtures', index: 2 });
    await expectPlaying(page);
    await seekToEnd(page);
    const end = page.getByTestId('player-end-screen');
    await expect(end.getByTestId('player-replay')).toBeVisible();
    await expect(end.getByTestId('player-replay-playlist')).toBeVisible();
    await expect(end.getByTestId('player-next-thumb')).toHaveCount(0);
    await page.waitForTimeout(4_000);
    await expect(page).toHaveURL(/src=bright/);
    // Replay playlist starts again from the first item
    await end.getByTestId('player-replay-playlist').click();
    await expect(page).toHaveURL(/src=dark&list=fixtures&index=0/);
    await expectPlaying(page);
  });

  test('loop on: the first item follows the last', async ({ page }) => {
    await openHarness(page, { src: 'bright', list: 'fixtures', index: 2 });
    await page.getByTestId('playlist-pane-loop').click();
    await expect(page.getByTestId('playlist-pane-loop')).toHaveAttribute('aria-pressed', 'true');
    await expectPlaying(page);
    await seekToEnd(page);
    await expect(page.getByTestId('player-next-badge')).toContainText('1 / 3');
    await expect(page).toHaveURL(/src=dark&list=fixtures&index=0/, { timeout: 8_000 });
    await expect(current(page)).toHaveAttribute('data-video-id', 'dark');
    await expectPlaying(page);
  });

  test('shuffle changes what plays next, never the order in the pane', async ({ page }) => {
    await openHarness(page, { src: 'dark', list: 'fixtures', index: 0 });
    await page.getByTestId('playlist-pane-shuffle').click();
    await expect(page.getByTestId('playlist-pane-shuffle')).toHaveAttribute('aria-pressed', 'true');
    await expect.poll(() => paneOrder(page)).toEqual([...ORDER]);
    await page.getByTestId('playlist-pane-next').click();
    await expect(page).toHaveURL(/src=(short|bright)&list=fixtures/);
    await expect.poll(() => paneOrder(page)).toEqual([...ORDER]);
  });

  test('a refused unmuted play falls back to muted playback with "Tap to unmute"', async ({ page }) => {
    // The browser's autoplay policy, made strict: unmuted play() without a gesture is refused
    await page.addInitScript(() => {
      // Refused until the viewer presses something in the page (the policy's "gesture")
      let gesture = false;
      window.addEventListener('pointerdown', () => { gesture = true; }, true);
      const play = HTMLMediaElement.prototype.play;
      HTMLMediaElement.prototype.play = function patched(this: HTMLMediaElement) {
        if (!this.muted && !gesture) {
          return Promise.reject(new DOMException('play() needs a gesture', 'NotAllowedError'));
        }
        return play.call(this);
      };
      window.localStorage.setItem('videoPlayerVolume', JSON.stringify({ volume: 0.6, muted: false }));
    });
    await openHarness(page, { src: 'dark', list: 'fixtures', index: 0 });
    const unmute = page.getByTestId('player-tap-unmute');
    await expect(unmute).toBeVisible();
    await expect(unmute).toHaveAccessibleName('Tap to unmute');
    expect(await muted(page)).toBe(true);
    await expectPlaying(page);
    // The page's mute is never remembered as the viewer's
    const saved = await page.evaluate(() => JSON.parse(window.localStorage.getItem('videoPlayerVolume') ?? '{}'));
    expect(saved.muted).toBe(false);
    await unmute.click();
    await expect(unmute).toBeHidden();
    expect(await muted(page)).toBe(false);
  });

  test('Arabic: the pane is right to left with the same order', async ({ page }) => {
    await openHarness(page, { lang: 'ar', src: 'dark', list: 'fixtures', index: 0 });
    const pane = page.getByTestId('playlist-pane');
    await expect(pane).toHaveAttribute('dir', 'rtl');
    await expect.poll(() => paneOrder(page)).toEqual([...ORDER]);
    await expect(page.getByTestId('playlist-pane-loop')).toHaveAccessibleName('تكرار قائمة التشغيل');
    await expectPlaying(page);
  });

  test('without a list nothing autoplays', async ({ page }) => {
    await openHarness(page, { src: 'dark' });
    await page.waitForTimeout(2_000);
    expect(await mediaTime(page)).toBe(0);
    await expect(page.getByTestId('playlist-pane')).toHaveCount(0);
  });
});
