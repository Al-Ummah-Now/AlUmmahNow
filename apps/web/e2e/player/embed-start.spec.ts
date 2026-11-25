/**
 * The embed's start from the viewer's click on the host page (autoplay=1&gesture=1) in another
 * site's frame. Without user activation in the frame the browser refuses sound, so it plays muted
 * with "Tap to unmute".
 *
 * In WebKit it often did not play at all (stage release runs of 2026-11-24 and 2026-11-25): play()
 * came before Video.js had its source ready, Video.js on a Safari user agent then attached the
 * source a second time, which aborted that play, and the retry waited for a `canplay` WebKit never
 * sends while paused. The start is read from the console: nothing is evaluated in the page before it.
 */
import { expect } from '@playwright/test';
import { routeFixtures, test } from './harness';

test.skip(({ browserName }) => browserName !== 'webkit', 'Video.js attaches the source twice on a Safari user agent only; the release spec (embed-frame-sound) starts the embed in Chrome too');

const HOST_PAGE = 'http://embed-host.player.test/frame';

test.beforeEach(async ({ page, baseURL }) => {
  const site = new URL(baseURL!);
  // Last registered, first asked: nothing leaves this machine, and no analytics are sent
  await page.route((url) => url.origin !== site.origin, (route) => route.abort());
  await page.route('**/api/**', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '{"success":true,"features":{}}' }));
  await routeFixtures(page);
  // The harness page refuses framing; the real embed pages do not
  await page.route((url) => url.origin === site.origin && url.searchParams.get('embed') === '1', async (route) => {
    // Only the document: the page also opens a web socket and fetches its own payload at this URL
    if (!(route.request().headers().accept ?? '').includes('text/html')) return route.fallback();
    const response = await route.fetch();
    const headers = response.headers();
    // The body is fetched decoded
    for (const name of ['x-frame-options', 'content-security-policy', 'content-encoding', 'content-length', 'transfer-encoding']) delete headers[name];
    await route.fulfill({ response, headers });
  });
  // The host: another site, so the frame is cross-origin as on www
  await page.route(HOST_PAGE, (route) => route.fulfill({
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
    await page.goto(HOST_PAGE);
    await expect.poll(() => events.find((e) => e.startsWith('playing')), { message: 'the embed did not start', timeout: 60_000 }).toBeTruthy();
    expect(events.filter((e) => e.startsWith('loadstart')), 'the source was attached more than once').toHaveLength(1);
    const frame = page.frameLocator('#aun');
    const video = frame.locator('.video-js video');
    const muted = () => video.evaluate((v: HTMLVideoElement) => v.muted);
    await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.currentTime)).toBeGreaterThan(0.5);
    // Sound refused: muted, with the control that ends it
    expect(events).toContain('playing true');
    await expect(frame.getByTestId('embed-unmute')).toHaveText('اضغط لتشغيل الصوت');
    await frame.getByTestId('embed-unmute').click();
    await expect.poll(muted).toBe(false);
    await expect(frame.getByTestId('embed-unmute')).toHaveCount(0);
  });
}
