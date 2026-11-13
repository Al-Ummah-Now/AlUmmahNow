/**
 * Autoplay like YouTube (the owner's 2026-11-11 request; docs/specs/PLAYLIST-PLAYBACK.md phase 1b):
 * the control bar's autoplay switch (on by default, a real switch for assistive tech, a play/pause
 * glyph in its thumb and "Autoplay" beside it where the bar has room, a themed tip "Autoplay is
 * on/off" on hover and keyboard focus, en/ar), saved on the device and synced with the account when
 * signed in; the end of a video → 3 s countdown → the next video plays on its own; Cancel keeps the
 * end screen with Watch again and more videos; autoplay off shows that screen with no countdown.
 * The account endpoints are served here: no backend, no paid service.
 */
import { expect, test, type Page } from '@playwright/test';
import { openHarness, pauseAt, startPlayback } from './harness';

const toggle = (page: Page) => page.getByTestId('player-autoplay-toggle');
const tip = (page: Page) => page.getByTestId('player-autoplay-tip');

/** The bar shows once playback has started; paused, it stays up */
async function showControls(page: Page) {
  const player = page.locator('.video-js.vjs-fanous').first();
  await startPlayback(page, player);
  await pauseAt(page, player, 5);
}
const mediaTime = (page: Page) => page.evaluate(() => document.querySelector<HTMLVideoElement>('.video-js video')?.currentTime ?? 0);

async function reachEnd(page: Page) {
  const player = page.locator('.video-js.vjs-fanous').first();
  if (!/vjs-has-started/.test((await player.getAttribute('class')) ?? '')) await startPlayback(page, player);
  await page.mouse.move(1, 1);
  await page.evaluate(() => {
    const v = document.querySelector<HTMLVideoElement>('.video-js video')!;
    v.currentTime = v.duration - 0.4;
    // Paused (showControls), seeking alone never reaches the end
    if (v.paused) void v.play().catch(() => undefined);
  });
  const end = page.getByTestId('player-end-screen');
  await expect(end).toBeVisible({ timeout: 20_000 });
  return end;
}

/** A signed-in viewer whose account says `autoplayNext`; returns the bodies the page saves. */
async function serveAccount(page: Page, autoplayNext: boolean): Promise<Array<{ autoplayNext: boolean } | null>> {
  // One entry per PUT: its body, or null where the browser does not expose it to the route
  // (the installed Firefox over WebDriver BiDi)
  const saved: Array<{ autoplayNext: boolean } | null> = [];
  await page.route('**/api/auth/token', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ accessToken: 'harness-token', channelId: null }) }));
  await page.route(/\/api\/profile\/playback$/, async (route) => {
    const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'GET, PUT, OPTIONS' };
    const method = route.request().method();
    if (method === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
    if (method === 'PUT') {
      let body: { autoplayNext: boolean } | null = null;
      try {
        body = route.request().postDataJSON() as { autoplayNext: boolean } | null;
      } catch {
        body = null;
      }
      saved.push(body);
      if (body) autoplayNext = body.autoplayNext;
    }
    return route.fulfill({ status: 200, headers: { ...cors, 'content-type': 'application/json' }, body: JSON.stringify({ autoplayNext }) });
  });
  return saved;
}

test.describe('autoplay switch', () => {
  test('on by default, a named switch with its tooltip; turning it off is kept on this device', async ({ page }) => {
    await openHarness(page, { src: 'dark' });
    await showControls(page);
    const sw = toggle(page);
    await expect(sw).toBeVisible();
    await expect(sw).toHaveAttribute('role', 'switch');
    await expect(sw).toHaveAttribute('aria-checked', 'true');
    await expect(sw).toHaveAccessibleName('Autoplay');
    // Hover shows the themed tip with the state; it follows a click
    await sw.hover();
    await expect(tip(page)).toHaveText('Autoplay is on');
    await sw.click();
    await expect(sw).toHaveAttribute('aria-checked', 'false');
    await expect(tip(page)).toHaveText('Autoplay is off');
    await page.mouse.move(1, 1);
    await expect(tip(page)).toHaveCount(0);
    await page.reload();
    await expect(toggle(page)).toHaveAttribute('aria-checked', 'false');
  });

  test('works from the keyboard', async ({ page }) => {
    await openHarness(page, { src: 'dark' });
    await showControls(page);
    const sw = toggle(page);
    await sw.focus();
    await expect(sw).toBeFocused();
    await page.keyboard.press('Space');
    await expect(sw).toHaveAttribute('aria-checked', 'false');
    await page.keyboard.press('Enter');
    await expect(sw).toHaveAttribute('aria-checked', 'true');
    // Keyboard users get the tip too
    await expect(tip(page)).toHaveText('Autoplay is on');
  });

  test('says what it is: a play/pause glyph in the thumb, and "Autoplay" beside it where the bar has room', async ({ page }) => {
    await openHarness(page, { src: 'dark' });
    await showControls(page);
    const sw = toggle(page);
    const play = sw.locator('.vjs-fanous-glyph-play');
    const pause = sw.locator('.vjs-fanous-glyph-pause');
    await expect(play).toBeVisible();
    await expect(pause).toBeHidden();
    // The word is for the eye: the name stays "Autoplay", not "Autoplay Autoplay"
    await expect(sw.locator('.vjs-fanous-autoplay-label')).toBeVisible();
    await expect(sw.locator('.vjs-fanous-autoplay-label')).toHaveText('Autoplay');
    await expect(sw).toHaveAccessibleName('Autoplay');
    await sw.click();
    await expect(pause).toBeVisible();
    await expect(play).toBeHidden();
  });

  test('narrow players keep the glyph and drop the word', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openHarness(page, { src: 'dark' });
    await showControls(page);
    const sw = toggle(page);
    await expect(sw.locator('.vjs-fanous-glyph-play')).toBeVisible();
    await expect(sw.locator('.vjs-fanous-autoplay-label')).toBeHidden();
  });

  test('Arabic: named and described in Arabic', async ({ page }) => {
    await openHarness(page, { lang: 'ar', src: 'dark' });
    await showControls(page);
    await expect(toggle(page)).toHaveAccessibleName('التشغيل التلقائي');
    await expect(toggle(page).locator('.vjs-fanous-autoplay-label')).toHaveText('التشغيل التلقائي');
    await toggle(page).hover();
    await expect(tip(page)).toHaveText('التشغيل التلقائي مفعّل');
  });

  test('not on embed-like surfaces (no up next)', async ({ page }) => {
    await openHarness(page, { src: 'dark', watch: false });
    await expect(toggle(page)).toBeHidden();
  });

  test('signed in: the account\'s choice applies on another device, and a change is saved to the account', async ({ page }) => {
    const saved = await serveAccount(page, false);
    await page.addInitScript(() => window.localStorage.setItem('aun.player.autoplayNext', '1'));
    await openHarness(page, { src: 'dark', account: true });
    await showControls(page);
    // This device said on; the account says off: the account wins
    await expect(toggle(page)).toHaveAttribute('aria-checked', 'false');
    await toggle(page).click();
    await expect(toggle(page)).toHaveAttribute('aria-checked', 'true');
    // The change was saved on the account (its value checked wherever the browser shows the body)
    await expect.poll(() => saved.length).toBe(1);
    if (saved[0]) expect(saved[0]).toEqual({ autoplayNext: true });
  });
});

test.describe('autoplay at the end of a video', () => {
  test('on: the 3 s countdown, then the next video plays on its own', async ({ page }) => {
    await openHarness(page, { src: 'dark' });
    const end = await reachEnd(page);
    await expect(end.getByTestId('player-next-ring')).toBeVisible();
    await expect(page).toHaveURL(/src=bright/, { timeout: 8_000 });
    await expect.poll(() => mediaTime(page), { timeout: 30_000 }).toBeGreaterThan(0.5);
  });

  test('on: when the move to the next video does not commit, the page loads and it still plays', async ({ page }) => {
    // The next page's client-side request never answers (seen in Firefox): navigateOrLoad loads the
    // page instead, and the in-app request must survive that load (#1137)
    await page.route(/\/dev\/player\?src=bright/, async (route) => {
      if (route.request().headers()['rsc'] === '1') return; // left pending: the client move never commits
      await route.continue();
    });
    await openHarness(page, { src: 'dark' });
    const end = await reachEnd(page);
    await expect(end.getByTestId('player-next-ring')).toBeVisible();
    await expect(page).toHaveURL(/src=bright/, { timeout: 20_000 });
    // Muted when the browser refuses sound on the loaded page, but playing
    await expect.poll(() => mediaTime(page), { timeout: 30_000 }).toBeGreaterThan(0.5);
  });

  test('Cancel keeps the end screen: Play now, Watch again and more videos', async ({ page }) => {
    await openHarness(page, { src: 'dark' });
    const end = await reachEnd(page);
    await end.getByTestId('player-cancel-next').click();
    await expect(end.getByTestId('player-end-suggestions')).toBeVisible();
    await expect(end.getByTestId('player-watch-again')).toBeVisible();
    await expect(end.getByTestId('player-play-next')).toBeVisible();
    await page.waitForTimeout(4_000);
    await expect(page).toHaveURL(/src=dark/);
    // A suggestion plays that video
    await end.getByTestId('player-end-suggestion').first().click();
    await expect(page).toHaveURL(/src=short/);
  });

  test('off: no countdown, the end screen waits with the next video, more videos and Watch again', async ({ page }) => {
    await openHarness(page, { src: 'dark' });
    await showControls(page);
    await toggle(page).click();
    await expect(toggle(page)).toHaveAttribute('aria-checked', 'false');
    const end = await reachEnd(page);
    await expect(end.getByTestId('player-next-ring')).toHaveCount(0);
    await expect(end.getByTestId('player-end-suggestions')).toBeVisible();
    await expect(end.getByTestId('player-watch-again')).toBeVisible();
    await page.waitForTimeout(4_000);
    await expect(page).toHaveURL(/src=dark/);
  });
});
