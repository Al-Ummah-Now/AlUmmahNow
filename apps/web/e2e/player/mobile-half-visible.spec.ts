/**
 * Owner bug: "On mobile when you scroll half way and the player is half shown, clicking play
 * controls is buggy." Cause: the mobile gesture layer (lib/video/mobile-touch.ts) listened on the
 * whole player, so taps on the bar's buttons also counted as double taps (seek 10s back), a slow tap
 * changed the speed, and a vertical drag was taken for the volume; and the progress bar seeked on
 * touchstart with `touch-action: none`, so with half the player scrolled off (most of what shows is
 * the bar) a finger put down to scroll paused the video and jumped it (lib/video/touch-seek-gate.ts).
 *
 * With the player 30%, 50% and 70% visible, in en and ar: each tap on play/pause, mute and
 * fullscreen acts exactly once, a tap on the hidden bar only shows it, a tap on the progress bar
 * seeks there once, the page never jumps and the mini player never flips. Runs in the mobile
 * projects (Pixel 7 Chrome, iPhone 15 Safari).
 */
import { test, expect, type Locator, type Page } from '@playwright/test';
import { openHarness } from './harness';

interface Counts { play: number; pause: number; seeking: number; volumechange: number; ratechange: number; fullscreen: number; mini: number }

async function track(page: Page): Promise<void> {
  await page.evaluate(() => {
    const w = window as unknown as { counts: Record<string, number> };
    w.counts = { play: 0, pause: 0, seeking: 0, volumechange: 0, ratechange: 0, fullscreen: 0, mini: 0 };
    const v = document.querySelector<HTMLVideoElement>('.video-js video')!;
    for (const e of ['play', 'pause', 'seeking', 'volumechange', 'ratechange']) v.addEventListener(e, () => { w.counts[e] += 1; });
    // Fullscreen requests, whichever API the player uses: the element's (Android) or the video's own (iPhone)
    const proto = HTMLVideoElement.prototype as unknown as Record<string, unknown>;
    for (const [owner, name] of [[Element.prototype, 'requestFullscreen'], [Element.prototype, 'webkitRequestFullscreen'], [proto, 'webkitEnterFullscreen'], [proto, 'webkitEnterFullScreen']] as const) {
      const o = owner as unknown as Record<string, unknown>;
      const original = o[name];
      if (typeof original !== 'function') continue;
      o[name] = function (this: unknown, ...args: unknown[]) {
        w.counts.fullscreen += 1;
        return (original as (...a: unknown[]) => unknown).apply(this, args);
      };
    }
    const frame = document.querySelector('.custom-video-player')!;
    new MutationObserver(() => { w.counts.mini += 1; }).observe(frame, { attributes: true, attributeFilter: ['data-mini'] });
  });
}

const counts = (page: Page) => page.evaluate(() => ({ ...(window as unknown as { counts: Counts }).counts }));
const resetCounts = (page: Page) => page.evaluate(() => { const c = (window as unknown as { counts: Record<string, number> }).counts; for (const k of Object.keys(c)) c[k] = 0; });
const media = (page: Page) => page.evaluate(() => { const v = document.querySelector<HTMLVideoElement>('.video-js video')!; return { paused: v.paused, time: v.currentTime, muted: v.muted, rate: v.playbackRate }; });

/** Scrolls so `share` of the player shows at the bottom of what is left on screen */
async function showShare(page: Page, share: number): Promise<number> {
  return page.evaluate((s) => {
    window.scrollTo(0, 0);
    const r = document.querySelector('.video-js')!.getBoundingClientRect();
    window.scrollTo({ top: Math.round(r.top + r.height * (1 - s)), behavior: 'instant' as ScrollBehavior });
    return window.scrollY;
  }, share);
}

async function centre(target: Locator) {
  const r = await target.evaluate((el) => el.getBoundingClientRect().toJSON() as DOMRect);
  return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
}

/** Taps a bar control the way a viewer does: a first tap shows a hidden bar, the next one acts */
async function tapControl(page: Page, player: Locator, selector: string): Promise<void> {
  const control = player.locator(selector).first();
  if (await player.evaluate((el) => el.classList.contains('vjs-user-inactive') && el.classList.contains('vjs-playing'))) {
    const before = await counts(page);
    const p = await centre(control);
    await page.touchscreen.tap(p.x, p.y);
    await expect(player).toHaveClass(/vjs-user-active/);
    expect(await counts(page), 'a tap on the hidden bar only shows it').toEqual(before);
    // A human's second tap: never inside the double-tap window
    await page.waitForTimeout(350);
  }
  const p = await centre(control);
  await page.touchscreen.tap(p.x, p.y);
}

async function start(page: Page, player: Locator): Promise<void> {
  await page.evaluate(() => { document.querySelector<HTMLVideoElement>('.video-js video')!.muted = false; });
  const big = await centre(player.locator('.vjs-big-play-button'));
  await page.touchscreen.tap(big.x, big.y);
  await expect(player).toHaveClass(/vjs-has-started/);
  await page.waitForFunction(() => { const v = document.querySelector<HTMLVideoElement>('.video-js video'); return !!v && !v.paused && v.currentTime > 0.2; });
}

for (const lang of ['en', 'ar'] as const) {
  for (const share of [0.3, 0.5, 0.7]) {
    test(`half-visible player: each tap acts once (${lang}, ${share * 100}% visible)`, async ({ page }) => {
      const player = await openHarness(page, { lang });
      await start(page, player);
      await track(page);
      const scroll = await showShare(page, share);

      // Pause, then play: one event each, nothing else moves
      await tapControl(page, player, '.vjs-play-control');
      await expect.poll(() => media(page).then((m) => m.paused)).toBe(true);
      await page.waitForTimeout(400);
      expect(await counts(page)).toMatchObject({ pause: 1, play: 0, seeking: 0, ratechange: 0, volumechange: 0 });
      await resetCounts(page);
      await tapControl(page, player, '.vjs-play-control');
      await expect.poll(() => media(page).then((m) => m.paused)).toBe(false);
      await page.waitForTimeout(400);
      expect(await counts(page)).toMatchObject({ pause: 0, play: 1, seeking: 0, ratechange: 0, volumechange: 0 });

      // Two quick taps (pause, play) are two taps, never a double-tap seek
      await resetCounts(page);
      await tapControl(page, player, '.vjs-play-control');
      await page.waitForTimeout(150);
      const again = await centre(player.locator('.vjs-play-control'));
      await page.touchscreen.tap(again.x, again.y);
      await page.waitForTimeout(500);
      expect(await counts(page)).toMatchObject({ pause: 1, play: 1, seeking: 0, ratechange: 0 });

      // Mute: one change
      await resetCounts(page);
      const wasMuted = (await media(page)).muted;
      await tapControl(page, player, '.vjs-mute-control');
      await expect.poll(() => media(page).then((m) => m.muted)).toBe(!wasMuted);
      await page.waitForTimeout(300);
      expect((await counts(page)).volumechange).toBe(1);

      // Seek: a tap on the progress bar (when it shows) jumps there once and keeps playing
      const holder = player.locator('.vjs-progress-holder');
      const hb = await holder.evaluate((el) => el.getBoundingClientRect().toJSON() as DOMRect);
      if (hb.top > 4) {
        await resetCounts(page);
        if (await player.evaluate((el) => el.classList.contains('vjs-user-inactive'))) await tapControl(page, player, '.vjs-play-control').catch(() => undefined);
        await resetCounts(page);
        // The bar runs left to right in both languages (player-skin.css): a quarter in is 22.5s
        await page.touchscreen.tap(hb.x + hb.width * 0.25, hb.y + hb.height / 2);
        await expect.poll(() => media(page).then((m) => m.time > 18 && m.time < 30)).toBe(true);
        await expect.poll(() => media(page).then((m) => m.paused)).toBe(false);
        expect((await counts(page)).ratechange).toBe(0);
      }

      // Fullscreen: one request per tap
      await resetCounts(page);
      await tapControl(page, player, '.vjs-fullscreen-control');
      await expect.poll(() => counts(page).then((x) => x.fullscreen)).toBe(1);
      await page.waitForTimeout(300);
      expect((await counts(page)).fullscreen).toBe(1);
      await page.evaluate(() => (document.fullscreenElement ? document.exitFullscreen().catch(() => undefined) : undefined));
      await expect(player).not.toHaveClass(/vjs-fullscreen/);
      await page.evaluate((y) => window.scrollTo({ top: y, behavior: 'instant' as ScrollBehavior }), scroll);

      // Throughout: no mini player flip, no speed change, the page stayed put
      const c = await counts(page);
      expect(c.mini, 'no mini player switch during the taps').toBe(0);
      expect(c.ratechange).toBe(0);
      expect(await page.evaluate(() => window.scrollY)).toBe(scroll);
    });
  }

  test(`a slow press on play never changes the speed (${lang})`, async ({ page, browserName }) => {
    test.skip(browserName === 'webkit', 'WebKit has no Touch constructor to hold a touch; the unit test (mobile-touch.test.ts) covers it');
    const player = await openHarness(page, { lang });
    await start(page, player);
    await track(page);
    await showShare(page, 0.5);
    await tapControl(page, player, '.vjs-play-control');
    await expect.poll(() => media(page).then((m) => m.paused)).toBe(true);
    await resetCounts(page);
    // A long press: Playwright has no touch hold, so the touch events go to the button directly
    await player.locator('.vjs-play-control').evaluate(async (el) => {
      const r = el.getBoundingClientRect();
      const t = new Touch({ identifier: 1, target: el, clientX: r.x + r.width / 2, clientY: r.y + r.height / 2 });
      el.dispatchEvent(new TouchEvent('touchstart', { bubbles: true, cancelable: true, touches: [t], targetTouches: [t], changedTouches: [t] }));
      await new Promise((res) => setTimeout(res, 800));
      el.dispatchEvent(new TouchEvent('touchend', { bubbles: true, cancelable: true, touches: [], targetTouches: [], changedTouches: [t] }));
    });
    await page.waitForTimeout(300);
    expect((await media(page)).rate).toBe(1);
    expect((await counts(page)).ratechange).toBe(0);
  });
}

test('a finger dragged up on the half-visible bar scrolls the page, never seeks', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'touch drags need the Chrome DevTools protocol');
  const player = await openHarness(page, { lang: 'en' });
  await start(page, player);
  await track(page);
  const scroll = await showShare(page, 0.5);
  const hb = await player.locator('.vjs-progress-holder').evaluate((el) => el.getBoundingClientRect().toJSON() as DOMRect);
  const cdp = await page.context().newCDPSession(page);
  const x = hb.x + hb.width / 2;
  const y = hb.y + hb.height / 2;
  // Down the screen: the page scrolls back towards the player
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
  for (let i = 1; i <= 8; i++) {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: y + i * 8 }] });
    await page.waitForTimeout(16);
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeLessThan(scroll - 20);
  const c = await counts(page);
  expect(c).toMatchObject({ pause: 0, seeking: 0, volumechange: 0, ratechange: 0 });
  expect((await media(page)).paused).toBe(false);
});
