/**
 * Behaviour of every control, in Chromium, Firefox and WebKit (docs/specs/VIDEO-PLAYER.md section 9).
 * State is read from the media element, so a control that only looks right still fails.
 */
import { expect, test } from '@playwright/test';
import { bar, layoutBox, mediaState, openHarness, pauseAt, rect, startPlayback } from './harness';

test.describe('player controls', () => {
  test('shows only the big play button before playback, then the bar', async ({ page }) => {
    const player = await openHarness(page);
    await expect(player.locator('.vjs-big-play-button')).toBeVisible();
    await expect(bar(player)).toBeHidden();
    await startPlayback(page, player);
    await expect(player.locator('.vjs-big-play-button')).toBeHidden();
    await player.hover();
    await expect(bar(player)).toBeVisible();
  });

  test('play and pause from the button, the frame and the keyboard', async ({ page }) => {
    const player = await openHarness(page);
    await startPlayback(page, player);
    const toggle = player.locator('.vjs-play-control');
    await player.hover();
    await toggle.click();
    await expect.poll(async () => (await mediaState(page)).paused).toBe(true);
    await expect(toggle).toHaveAttribute('title', /play/i);
    await toggle.click();
    await expect.poll(async () => (await mediaState(page)).paused).toBe(false);
    await player.evaluate((el) => (el as HTMLElement).focus());
    await page.keyboard.press('k');
    await expect.poll(async () => (await mediaState(page)).paused).toBe(true);
    // Shortcuts are rate limited to one per 50ms; a viewer never presses two keys that fast
    await page.waitForTimeout(100);
    await page.keyboard.press(' ');
    await expect.poll(async () => (await mediaState(page)).paused).toBe(false);
  });

  test('seeks by clicking the bar and with the arrow keys', async ({ page }) => {
    const player = await openHarness(page);
    await startPlayback(page, player);
    await pauseAt(page, player, 10);
    const holder = player.locator('.vjs-progress-holder');
    const box = await rect(holder);
    await page.mouse.click(box.x + box.width * 0.5, box.y + box.height / 2);
    await expect.poll(async () => (await mediaState(page)).currentTime).toBeGreaterThan(40);
    expect((await mediaState(page)).currentTime).toBeLessThan(50);
    const before = (await mediaState(page)).currentTime;
    await holder.focus();
    await page.keyboard.press('ArrowRight');
    await expect.poll(async () => (await mediaState(page)).currentTime).toBeGreaterThan(before + 2);
    await player.evaluate((el) => (el as HTMLElement).focus());
    const mid = (await mediaState(page)).currentTime;
    await page.keyboard.press('ArrowLeft');
    await expect.poll(async () => (await mediaState(page)).currentTime).toBeLessThan(mid - 3);
  });

  test('a seek made as the player pauses moves the bar to the playhead', async ({ page }) => {
    const player = await openHarness(page);
    await startPlayback(page, player);
    // Pause and seek in one step, as resume, chapter jumps and the seek keys do: Video.js's
    // throttled redraw used to drop the seek, leaving the bar at the pause point
    for (const at of [20, 61, 5, 44, 12, 75]) {
      await pauseAt(page, player, at);
      await expect.poll(async () => {
        const [played, holder] = await Promise.all([rect(player.locator('.vjs-play-progress')), rect(player.locator('.vjs-progress-holder'))]);
        const { currentTime, duration } = await mediaState(page);
        return Math.abs(played.width / holder.width - currentTime / duration);
      }, { message: `bar at ${at}s` }).toBeLessThan(0.01);
    }
  });

  test('sets volume with the slider, mutes with the button and M', async ({ page }) => {
    const player = await openHarness(page);
    await startPlayback(page, player);
    await pauseAt(page, player, 5);
    const slider = player.locator('.vjs-volume-bar');
    await expect(slider).toBeVisible();
    const box = await rect(slider);
    await page.mouse.click(box.x + box.width * 0.25, box.y + box.height / 2);
    await expect.poll(async () => (await mediaState(page)).volume).toBeLessThan(0.4);
    await page.mouse.click(box.x + box.width * 0.9, box.y + box.height / 2);
    await expect.poll(async () => (await mediaState(page)).volume).toBeGreaterThan(0.75);
    const mute = player.locator('.vjs-mute-control');
    await mute.click();
    await expect.poll(async () => (await mediaState(page)).muted).toBe(true);
    await expect(mute.locator('[data-icon="volumeX"]')).toBeVisible();
    await player.evaluate((el) => (el as HTMLElement).focus());
    await page.keyboard.press('m');
    await expect.poll(async () => (await mediaState(page)).muted).toBe(false);
  });

  test('toggles captions from the button and with C', async ({ page }) => {
    const player = await openHarness(page);
    await startPlayback(page, player);
    await pauseAt(page, player, 5);
    const toggle = player.locator('.vjs-fanous-captions');
    await expect(toggle).toBeVisible();
    await expect(toggle).toHaveAttribute('aria-pressed', 'false');
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-pressed', 'true');
    await expect(player.locator('.vjs-text-track-display')).toContainText(/Peace be upon you/);
    await player.evaluate((el) => (el as HTMLElement).focus());
    await page.keyboard.press('c');
    await expect(toggle).toHaveAttribute('aria-pressed', 'false');
  });

  test('enters and leaves fullscreen', async ({ page }) => {
    const player = await openHarness(page);
    await startPlayback(page, player);
    await pauseAt(page, player, 5);
    await player.locator('.vjs-fullscreen-control').click();
    // Real fullscreen where the browser allows it, Video.js full-window otherwise
    await expect(player).toHaveClass(/vjs-fullscreen|vjs-full-window/);
    await expect(player.locator('.vjs-fullscreen-control [data-icon="minimize"]')).toBeVisible();
    const radius = await player.evaluate((el) => getComputedStyle(el).borderTopLeftRadius);
    expect(radius).toBe('0px');
    await player.hover();
    await player.locator('.vjs-fullscreen-control').click();
    await expect(player).not.toHaveClass(/vjs-fullscreen/);
  });

  test('theatre widens the layout, persists, and T toggles it', async ({ page }) => {
    const player = await openHarness(page);
    await startPlayback(page, player);
    await pauseAt(page, player, 5);
    const before = await rect(player);
    const theatre = player.locator('.vjs-fanous-theatre');
    await theatre.click();
    await expect(page.getByTestId('watch-layout')).toHaveAttribute('data-theatre', '');
    await expect(theatre).toHaveAttribute('aria-pressed', 'true');
    await expect.poll(async () => (await rect(player)).width).toBeGreaterThan(before.width + 100);
    // Theatre drops the frame radius: it spans the column edge to edge
    expect(await player.evaluate((el) => getComputedStyle(el).borderTopLeftRadius)).toBe('0px');
    await page.reload();
    const again = page.locator('.video-js.vjs-fanous').first();
    await expect(page.getByTestId('watch-layout')).toHaveAttribute('data-theatre', '');
    await again.evaluate((el) => (el as HTMLElement).focus());
    await page.keyboard.press('t');
    await expect(page.getByTestId('watch-layout')).not.toHaveAttribute('data-theatre', '');
  });

  test('embeds have no theatre, next or mini player', async ({ page }) => {
    const player = await openHarness(page, { watch: false });
    await startPlayback(page, player);
    await player.hover();
    await expect(player.locator('.vjs-fanous-theatre')).toBeHidden();
    await expect(player.locator('.vjs-fanous-next')).toBeHidden();
  });

  test('resumes a saved position and starts over from the pill', async ({ page }) => {
    const player = await openHarness(page, { resumeAt: 40 });
    const pill = page.getByTestId('player-start-over');
    await expect(pill).toBeVisible();
    await expect.poll(async () => (await mediaState(page)).currentTime).toBeGreaterThan(35);
    await pill.click();
    await expect.poll(async () => (await mediaState(page)).currentTime).toBeLessThan(2);
    await expect(pill).toBeHidden();
    await expect(player).toBeVisible();
  });

  test('opens the keyboard shortcuts help with ?', async ({ page }) => {
    const player = await openHarness(page);
    await startPlayback(page, player);
    await pauseAt(page, player, 5);
    await player.evaluate((el) => (el as HTMLElement).focus());
    await page.keyboard.press('Shift+Slash');
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText(/theatre/i);
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
  });

  test('ends on the up-next card, which plays the next video', async ({ page }) => {
    const player = await openHarness(page, { src: 'dark' });
    await startPlayback(page, player);
    await page.evaluate(() => { const v = document.querySelector<HTMLVideoElement>('.video-js video')!; v.currentTime = v.duration - 0.5; });
    const end = page.getByTestId('player-end-screen');
    await expect(end).toBeVisible({ timeout: 20_000 });
    await expect(end).toContainText('Next: the bright fixture');
    await page.getByTestId('player-play-next').click();
    await expect(page).toHaveURL(/src=bright/);
  });

  test('floats a mini player while playing off screen, and returns or closes it', async ({ page }) => {
    const player = await openHarness(page);
    await startPlayback(page, player);
    // Scroll with the pointer on the page: over the video the wheel sets the volume
    const aside = await layoutBox(page.getByTestId('harness-aside'));
    await page.mouse.move(aside.cx, aside.y + 20);
    await page.mouse.wheel(0, 1400);
    const wrapper = page.locator('.custom-video-player').first();
    await expect(wrapper).toHaveAttribute('data-mini');
    const box = await rect(player);
    expect(box.width).toBeLessThanOrEqual(361);
    const viewport = page.viewportSize()!;
    expect(box.right).toBeLessThanOrEqual(viewport.width - 15);
    expect(box.bottom).toBeLessThanOrEqual(viewport.height - 15);
    await page.getByTestId('player-mini-close').click();
    await expect(wrapper).not.toHaveAttribute('data-mini');
    expect((await mediaState(page)).paused).toBe(true);
  });

  test('picture in picture: the button enters and leaves it; Firefox keeps its own toggle off over the player', async ({ page, browserName }) => {
    const player = await openHarness(page);
    await startPlayback(page, player);
    // Playwright's WebKit build refuses Picture-in-Picture (NotSupportedError); Safari has it
    test.skip(browserName === 'webkit', 'Picture-in-Picture is not available in Playwright WebKit');
    const firefox = /Firefox\//.test(await page.evaluate(() => navigator.userAgent));
    // What the browser itself sees, past the page-facing property the guard puts on the video
    const toggleOff = () => page.evaluate(() => {
      const v = document.querySelector('.video-js video') as HTMLVideoElement;
      return !!Object.getOwnPropertyDescriptor(HTMLVideoElement.prototype, 'disablePictureInPicture')?.get?.call(v);
    });
    // Firefox's toggle would take presses on the controls; other browsers are left as they are
    expect(await toggleOff()).toBe(firefox);
    await expect(player.locator('.vjs-picture-in-picture-control')).toBeEnabled();
    await player.hover();
    await player.locator('.vjs-picture-in-picture-control').click();
    await expect.poll(() => page.evaluate(() => !!document.pictureInPictureElement), { message: `${browserName} entered PiP` }).toBe(true);
    await page.evaluate(() => document.exitPictureInPicture());
    await expect.poll(() => page.evaluate(() => !!document.pictureInPictureElement)).toBe(false);
    await expect.poll(toggleOff).toBe(firefox);
  });

  test('live streams show the live badge, no speed, and go back to the edge', async ({ page }) => {
    const player = await openHarness(page, { src: 'live' });
    await startPlayback(page, player);
    await player.hover();
    const badge = player.locator('.vjs-fanous-live');
    await expect(badge).toBeVisible();
    await expect(badge).toContainText(/live/i);
    await expect(player.locator('.vjs-current-time')).toBeHidden();
    await player.locator('.vjs-fanous-settings').click();
    await expect(page.getByTestId('player-settings-menu')).toBeVisible();
    await expect(page.locator('[data-row="speed"]')).toHaveCount(0);
  });
});
