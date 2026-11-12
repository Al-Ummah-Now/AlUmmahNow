/**
 * Release regression: a play started by the viewer's click on the host page plays WITH SOUND
 * (owner, 2026-11-12: "videos start muted, why?"). www's video facade inserts the embed on the
 * click with autoplay=1&gesture=1; the parent's user activation lets an iframe with
 * allow="autoplay" play unmuted. Only when the browser refuses does the embed mute, and then it
 * shows "Tap to unmute" (never muted without a way back).
 *
 * Chromium (branded Chrome: H.264) and WebKit; Firefox's autoplay rules differ and are not the
 * owner's report. Measured 2026-11-12 (Playwright Chrome / WebKit, a tone in a cross-origin iframe
 * with allow="autoplay"): Chrome lets the iframe play with sound after a click in the parent and
 * refuses without one; WebKit refuses both (a parent click does not carry into a cross-origin
 * frame), so there the click case takes the fallback: muted + "Tap to unmute". The host page lives on a fake origin (page.route), so the frame is cross-origin
 * exactly as on www.
 *
 * On a pull request the target is the deployed QA build: while it predates gesture=1 (muted, no
 * unmute control), the spec skips with that annotation. Stage release runs never skip.
 */
import { test, expect, type Frame, type Page } from '@playwright/test';
import { fixtureVideo } from './fixtures';
import { releaseEnv, target } from './targets';

const HOST_PAGE = `${releaseEnv() === 'local' ? 'http' : 'https'}://embed-host.release.test/sound`;

test.skip(({ browserName }) => browserName === 'firefox', 'Chromium and WebKit (the owner report); Firefox autoplay rules differ');

/** A host page like www: the iframe is inserted by `insert` ('click': a real click; 'load': no user activation). */
async function host(page: Page, src: string, insert: 'click' | 'load'): Promise<void> {
  await page.route(HOST_PAGE, (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: `<!doctype html><html><body style="margin:0">
        <button id="play" style="font-size:20px">Play</button><div id="slot" style="width:640px;height:360px"></div>
        <script>
          function insert() {
            var f = document.createElement('iframe');
            f.id = 'aun'; f.src = ${JSON.stringify(src)}; f.width = '640'; f.height = '360';
            f.allow = 'autoplay; fullscreen; picture-in-picture'; f.style.border = '0';
            document.getElementById('slot').replaceChildren(f);
          }
          document.getElementById('play').addEventListener('click', insert);
          ${insert === 'load' ? 'insert();' : ''}
        </script></body></html>`,
    }),
  );
  await page.goto(HOST_PAGE);
  if (insert === 'click') await page.getByRole('button', { name: 'Play' }).click();
}

async function embedFrame(page: Page): Promise<Frame> {
  await expect.poll(() => !!page.frame({ url: /\/embed\/v\// }), { timeout: 30000 }).toBe(true);
  return page.frame({ url: /\/embed\/v\// })!;
}

const media = (frame: Frame) =>
  frame.evaluate(() => {
    const v = document.querySelector<HTMLVideoElement>('.video-js video');
    return v ? { muted: v.muted || v.volume === 0, time: v.currentTime, paused: v.paused } : null;
  });

/** On a PR against a QA build without gesture=1: muted, and no unmute control → skip. */
async function skipIfPredates(frame: Frame): Promise<void> {
  if (process.env.GITHUB_EVENT_NAME !== 'pull_request') return;
  await expect.poll(async () => (await media(frame)) !== null, { timeout: 45000 }).toBe(true);
  await frame.waitForTimeout(3000); // observation window: the old build shows nothing more
  const m = await media(frame);
  const pill = await frame.getByTestId('embed-unmute').count();
  if (m?.muted && pill === 0) {
    test.info().annotations.push({ type: 'skip', description: 'the target predates gesture=1 (embed plays muted with no unmute control)' });
    test.skip(true, 'the target predates gesture=1');
  }
}

test.describe('Release: embed sound', () => {
  test('a click on the host page plays with sound (Chromium), or muted with a working unmute control (WebKit)', async ({ page, browserName }) => {
    const video = await fixtureVideo('landscape');
    await host(page, `${target().web}/embed/v/${video.id}?lang=en&autoplay=1&gesture=1`, 'click');
    const frame = await embedFrame(page);
    await skipIfPredates(frame);
    if (browserName === 'chromium') {
      await expect.poll(async () => (await media(frame))?.muted, { message: 'the video should not be muted after a click', timeout: 45000 }).toBe(false);
      await expect.poll(async () => (await media(frame))?.time ?? 0, { message: 'playback with sound did not start', timeout: 45000 }).toBeGreaterThan(1);
      expect((await media(frame))?.muted).toBe(false);
      await expect(frame.getByTestId('embed-unmute')).toHaveCount(0);
      return;
    }
    // WebKit: the refusal path; never muted without the control, and the control unmutes
    await expect.poll(async () => (await media(frame)) !== null, { timeout: 45000 }).toBe(true);
    await expect
      .poll(async () => {
        const m = await media(frame);
        return m ? (m.muted ? (await frame.getByTestId('embed-unmute').count()) > 0 : true) : false;
      }, { timeout: 30000 })
      .toBe(true);
    if ((await media(frame))?.muted) {
      await frame.getByTestId('embed-unmute').click();
      await expect.poll(async () => (await media(frame))?.muted).toBe(false);
    }
  });

  test.describe('no user activation: the browser refuses sound', () => {
    test('plays muted and shows "Tap to unmute", which brings the sound back', async ({ page, browserName }) => {
      const video = await fixtureVideo('landscape');
      await host(page, `${target().web}/embed/v/${video.id}?lang=ar&autoplay=1&gesture=1`, 'load');
      const frame = await embedFrame(page);
      await skipIfPredates(frame);
      await expect.poll(async () => (await media(frame)) !== null, { timeout: 45000 }).toBe(true);
      // The invariant everywhere: never muted without the unmute control
      await expect
        .poll(async () => {
          const m = await media(frame);
          const pill = await frame.getByTestId('embed-unmute').count();
          return m ? (m.muted ? pill > 0 : true) : false;
        }, { timeout: 30000 })
        .toBe(true);
      if (browserName === 'chromium') {
        // Chromium's default policy refuses without activation: muted, still playing, and the control unmutes
        await expect.poll(async () => (await media(frame))?.muted, { timeout: 30000 }).toBe(true);
        await expect.poll(async () => (await media(frame))?.time ?? 0, { message: 'muted fallback did not play', timeout: 45000 }).toBeGreaterThan(1);
        const unmute = frame.getByTestId('embed-unmute');
        await expect(unmute).toHaveText('اضغط لتشغيل الصوت');
        await unmute.click();
        await expect.poll(async () => (await media(frame))?.muted).toBe(false);
        await expect(unmute).toHaveCount(0);
      } else if ((await media(frame))?.muted) {
        await frame.getByTestId('embed-unmute').click();
        await expect.poll(async () => (await media(frame))?.muted).toBe(false);
      }
    });
  });
});
