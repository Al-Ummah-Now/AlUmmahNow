/**
 * The embed's start from the viewer's click on the host page (autoplay=1&gesture=1) in another
 * site's frame. Without user activation in the frame the browser refuses sound, so it plays muted
 * with "Tap to unmute".
 *
 * In WebKit it often did not play at all (stage release runs of 2026-11-24 and 2026-11-25): play()
 * came before Video.js had its source ready, Video.js on a Safari user agent then attached the
 * source a second time, which aborted that play, and the retry waited for a `canplay` WebKit never
 * sends while paused. Nothing here may evaluate in the page before the start: Chromium counts
 * Playwright's evaluate as a user gesture. The start is read from the console.
 */
import { expect, test } from '@playwright/test';
import { routeFixtures } from './harness';

test.beforeEach(async ({ page, baseURL }) => {
  const site = new URL(baseURL!);
  // Last registered, first asked: nothing leaves this machine, and no analytics are sent
  await page.route((url) => url.origin !== site.origin, (route) => route.abort());
  await page.route('**/api/**', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '{"success":true,"features":{}}' }));
  await routeFixtures(page);
  // The harness page refuses framing; the real embed pages do not
  await page.route((url) => url.origin === site.origin && url.searchParams.get('embed') === '1', async (route) => {
    const response = await route.fetch();
    const headers = response.headers();
    delete headers['x-frame-options'];
    delete headers['content-security-policy'];
    await route.fulfill({ response, headers });
  });
  // The host: another site, so the frame is cross-origin as on www
  await page.route('http://embed-host.player.test/frame', (route) => route.fulfill({
    contentType: 'text/html',
    body: `<!doctype html><body style="margin:0"><iframe id="aun" width="800" height="600" style="border:0" allow="autoplay; fullscreen" src="${site.origin}/ar/dev/player?embed=1&autoplay=1&gesture=1"></iframe></body>`,
  }));
  await page.addInitScript(() => {
    navigator.sendBeacon = () => true;
    for (const type of ['loadstart', 'playing']) {
      document.addEventListener(type, (event) => {
        if (event.target instanceof HTMLVideoElement) console.log(`[embed-start] ${type} ${event.target.muted}`);
      }, { capture: true });
    }
  });
});

// Several loads: the abort was a race, lost about every other time
for (const attempt of [1, 2, 3]) {
  test(`no user activation: the source is attached once and it plays (load ${attempt})`, async ({ page }) => {
    const events: string[] = [];
    page.on('console', (message) => {
      const found = /^\[embed-start\] (.*)$/.exec(message.text());
      if (found) events.push(found[1]!);
    });
    await page.goto('http://embed-host.player.test/frame');
    await expect.poll(() => events.find((e) => e.startsWith('playing')), { message: 'the embed did not start', timeout: 60_000 }).toBeTruthy();
    expect(events.filter((e) => e.startsWith('loadstart')), 'the source was attached more than once').toHaveLength(1);
    const frame = page.frameLocator('#aun');
    const video = frame.locator('.video-js video');
    const muted = () => video.evaluate((v: HTMLVideoElement) => v.muted);
    await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.currentTime)).toBeGreaterThan(0.5);
    // Sound refused (a browser's own autoplay rule decides): muted, with the control that ends it
    if (events.includes('playing true')) {
      await expect(frame.getByTestId('embed-unmute')).toHaveText('اضغط لتشغيل الصوت');
      await frame.getByTestId('embed-unmute').click();
      await expect.poll(muted).toBe(false);
    }
    await expect(frame.getByTestId('embed-unmute')).toHaveCount(0);
  });
}

test('the browsers that refuse sound without a click start muted', async ({ page, browserName }) => {
  test.skip(browserName === 'firefox' || browserName === ('_bidiFirefox' as typeof browserName), 'Firefox autoplay rules differ under automation');
  const starts: string[] = [];
  page.on('console', (message) => {
    const found = /^\[embed-start\] (playing .*)$/.exec(message.text());
    if (found) starts.push(found[1]!);
  });
  await page.goto('http://embed-host.player.test/frame');
  await expect.poll(() => starts[0], { message: 'the embed did not start', timeout: 60_000 }).toBe('playing true');
});
