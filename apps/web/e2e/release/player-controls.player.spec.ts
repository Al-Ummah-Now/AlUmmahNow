/**
 * Release regression: the production player's basic controls (#472, the
 * Video.js bar with the themed chrome). An anonymous viewer starts the video
 * with the big play button, and the bar's play, mute, seek, speed and theatre
 * controls each change the real <video> element. Runs in the "player" project
 * on branded Chrome against a public video found through the API.
 */
import { test, expect, type Page } from '@playwright/test';
import { NO_PLAYABLE_VIDEO, watchUrl } from './videos';
import { useOwnVideos } from './own-videos';

// This spec's own videos (created in beforeAll, deleted in afterAll): never the seed's or the newest public one
const own = useOwnVideos(test);
// It signs a user up through the auth server: traces and video would hold the password and code
test.use({ trace: 'off', video: 'off' });

const PLAYER = '.video-js.vjs-fanous';
const BAR = `${PLAYER} .vjs-control-bar`;

/** The real media element's state, read straight from the page. */
function media(page: Page): Promise<{ paused: boolean; muted: boolean; time: number; duration: number; rate: number }> {
  return page.evaluate(() => {
    const v = document.querySelector<HTMLVideoElement>('.video-js video')!;
    return { paused: v.paused, muted: v.muted, time: v.currentTime, duration: v.duration, rate: v.playbackRate };
  });
}

/** Keeps the bar up: Video.js hides it after a few seconds without input while playing. */
async function wake(page: Page): Promise<void> {
  await page.locator(PLAYER).hover();
}

const LABELS = {
  en: { play: 'Play video', mute: 'Mute audio', unmute: 'Unmute audio', settings: 'Settings', speed: 'Speed' },
  ar: { play: null, mute: null, unmute: null, settings: 'الإعدادات', speed: 'السرعة' },
} as const;

test.describe('Release: player controls', () => {
  for (const locale of ['en', 'ar'] as const) {
    test(`big play starts the video and the bar's controls drive it (${locale})`, async ({ page }) => {
      const video = await own('landscape');
      test.skip(!video, NO_PLAYABLE_VIDEO);
      const labels = LABELS[locale];

      await page.goto(watchUrl(video!.id, locale));
      const bigPlay = page.locator(`${PLAYER} .vjs-big-play-button`);
      await expect(bigPlay).toBeVisible({ timeout: 45000 });
      // Before the first play only the big play button shows; the bar comes with playback
      await expect(page.locator(BAR)).toBeHidden();

      // Click only once the player has set up and the stream's metadata is in:
      // an earlier click can land before the source is attached and do nothing
      await expect(page.locator('.vjs-volume-bar')).toHaveAttribute('aria-orientation', 'horizontal', { timeout: 15000 });
      await page.waitForFunction(() => (document.querySelector<HTMLVideoElement>('.video-js video')?.readyState ?? 0) >= 1, null, { timeout: 45000 });
      // Muted first so the autoplay policy can never be the reason it stays paused
      await page.evaluate(() => { document.querySelector<HTMLVideoElement>('.video-js video')!.muted = true; });
      await bigPlay.click();
      await expect.poll(async () => (await media(page)).time, { message: 'big play did not start playback', timeout: 30000 }).toBeGreaterThan(1);
      await expect(page.locator(PLAYER)).toHaveClass(/vjs-has-started/);
      await expect(bigPlay).toBeHidden();
      await wake(page);
      await expect(page.locator(BAR)).toBeVisible();
      // Media controls stay left to right in Arabic too
      await expect(page.locator(BAR)).toHaveAttribute('dir', 'ltr');

      // Play/pause
      const playControl = page.locator(`${BAR} .vjs-play-control`);
      await playControl.click();
      await expect.poll(async () => (await media(page)).paused).toBe(true);
      if (labels.play) await expect(playControl).toHaveAttribute('aria-label', labels.play);
      const pausedAt = (await media(page)).time;
      await wake(page);
      await playControl.click();
      await expect.poll(async () => (await media(page)).time).toBeGreaterThan(pausedAt + 0.5);

      // Mute toggles the element, and the button says what it will do next
      const mute = page.locator(`${BAR} .vjs-mute-control`);
      await wake(page);
      await mute.click();
      await expect.poll(async () => (await media(page)).muted).toBe(false);
      if (labels.mute) await expect(mute).toHaveAttribute('aria-label', labels.mute);
      await wake(page);
      await mute.click();
      await expect.poll(async () => (await media(page)).muted).toBe(true);
      if (labels.unmute) await expect(mute).toHaveAttribute('aria-label', labels.unmute);

      // Clicking the middle of the seek bar jumps to about half way
      await wake(page);
      const holder = page.locator(`${BAR} .vjs-progress-holder`);
      const box = (await holder.boundingBox())!;
      await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
      const { duration } = await media(page);
      await expect.poll(async () => (await media(page)).time).toBeGreaterThan(duration * 0.4);
      expect((await media(page)).time).toBeLessThan(duration * 0.6);
      // Paused from here on, so a short video cannot reach its end screen (which
      // replaces the bar) while the menu and theatre steps run
      await wake(page);
      await playControl.click();
      await expect.poll(async () => (await media(page)).paused).toBe(true);

      // Settings → Speed → 1.5× changes the playback rate
      await wake(page);
      const settings = page.locator(`${BAR} .vjs-fanous-settings`);
      await expect(settings).toHaveAttribute('title', labels.settings);
      await settings.click();
      const menu = page.getByTestId('player-settings-menu');
      await expect(menu).toBeVisible();
      await expect(menu).toHaveAttribute('aria-label', labels.settings);
      await expect(settings).toHaveAttribute('aria-expanded', 'true');
      await expect(menu.locator('[data-row="quality"]')).toBeVisible();
      await menu.locator('[data-row="speed"]').click();
      await expect(menu.getByRole('group', { name: labels.speed })).toBeVisible();
      await expect(menu.getByRole('menuitemradio', { checked: true })).toHaveAttribute('data-row', '1');
      await menu.locator('[role="menuitemradio"][data-row="1.5"]').click();
      await expect.poll(async () => (await media(page)).rate).toBe(1.5);
      // A choice goes back to the first panel, which shows the new value
      await expect(menu).toHaveAttribute('data-panel', 'root');
      await expect(menu.locator('[data-row="speed"] .vjs-fanous-mi-value')).toHaveText('1.5×');
      await page.keyboard.press('Escape');
      await expect(menu).toHaveCount(0);
      await expect(settings).toHaveAttribute('aria-expanded', 'false');

      // Theatre mode widens the watch layout and is a pressed toggle. A portrait
      // video (stage's seed is 360x640) has no theatre mode: the button is hidden
      const theatre = page.locator(`${BAR} .vjs-fanous-theatre`);
      const portrait = await page.evaluate(() => {
        const v = document.querySelector<HTMLVideoElement>('.video-js video')!;
        return v.videoHeight > v.videoWidth;
      });
      const frame = page.locator('.custom-video-player');
      if (portrait) await expect(frame).toHaveAttribute('data-portrait', 'true');
      else await expect(frame).not.toHaveAttribute('data-portrait', /.*/);
      if (portrait) {
        await wake(page);
        await expect(theatre).toBeHidden();
        await expect(page.getByTestId('watch-layout')).not.toHaveAttribute('data-theatre', /.*/);
        return;
      }
      await wake(page);
      await theatre.click();
      await expect(theatre).toHaveAttribute('aria-pressed', 'true');
      await expect(page.getByTestId('watch-layout')).toHaveAttribute('data-theatre', 'true');
      await wake(page);
      await theatre.click();
      await expect(theatre).toHaveAttribute('aria-pressed', 'false');
      await expect(page.getByTestId('watch-layout')).not.toHaveAttribute('data-theatre', /.*/);
    });
  }
});
