/**
 * Release regression: the embed player in someone else's frame (owner reports, 2026-11-12, live on
 * www and X):
 *
 * 1. It fills the host's frame on the theme's night colour. Before: the theme's parchment page
 *    background showed as bands, and the watch page's `max-height: 100dvh - 148px` squashed the
 *    player to a strip (345x46 in a 345x194 frame); a 16:9 box in a square or vertical frame added
 *    a second set of bars. Landscape, Short and square, light and dark.
 * 2. A play started by the viewer's click on the host page (autoplay=1&gesture=1, what www's facade
 *    sends) plays WITH SOUND in Chrome. WebKit does not carry a parent click into a cross-origin frame
 *    (measured with a tone: Chrome click → sound, no click → refused; WebKit refuses both), so there,
 *    and without any click, the embed plays muted and shows "Tap to unmute", which restores sound.
 *
 * Own data (scripts/qa/__tests__/own-data.test.ts): a new creator uploads a landscape, a Short and a
 * square clip in beforeAll; useOwnData deletes them (and the creator) after the file, pass or fail.
 * The host page lives on a fake origin (page.route), so the frame is cross-origin as on www and X.
 *
 * On a pull request the target is the deployed QA build: while it predates these fixes the checks
 * skip with an annotation. Stage release runs never skip.
 */
import { test, expect, type Browser, type Frame, type Page } from '@playwright/test';
import { useOwnData, type Clip, type CreatedVideo } from './builders';
import { releaseEnv, target } from './targets';

// The creator signs up through the real issuer (password, sink code): no trace or video of it
test.use({ trace: 'off', video: 'off' });

const HOST_PAGE = `${releaseEnv() === 'local' ? 'http' : 'https'}://embed-host.release.test/frame`;
const ON_PR = process.env.GITHUB_EVENT_NAME === 'pull_request';

test.skip(({ browserName }) => browserName === 'firefox', 'Chromium and WebKit (the owner reports); Firefox autoplay rules differ');

const data = useOwnData(test);
const videos = {} as Record<Clip, CreatedVideo>;

test.beforeAll(async ({ browser }: { browser: Browser }) => {
  test.setTimeout(30 * 60_000);
  const creator = await data.createCreator(browser, 'embed');
  const channelId = creator.channelIds[0]!;
  for (const clip of ['landscape40', 'vertical', 'square'] as const) {
    videos[clip] = await data.createVideo(creator.user, channelId, { clip });
  }
});

/** A host page like www: the iframe is inserted on a real click ('click') or with no user activation ('load'). */
async function host(page: Page, src: string, size: { width: number; height: number }, insert: 'click' | 'load'): Promise<void> {
  await page.route(HOST_PAGE, (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: `<!doctype html><html><body style="margin:0">
        <button id="play" style="font-size:20px">Play</button><div id="slot"></div>
        <script>
          function insert() {
            var f = document.createElement('iframe');
            f.id = 'aun'; f.src = ${JSON.stringify(src)}; f.width = '${size.width}'; f.height = '${size.height}';
            f.allow = 'autoplay; fullscreen; picture-in-picture'; f.style.border = '0'; f.style.display = 'block';
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
    return v ? { muted: v.muted || v.volume === 0, time: v.currentTime } : null;
  });

/** The player's box, and whether html/body/main are the theme's (dark) night colour. */
const look = (frame: Frame) =>
  frame.evaluate(() => {
    const bg = (el: Element | null) => (el ? getComputedStyle(el).backgroundColor : '');
    const probe = document.createElement('i');
    probe.style.color = getComputedStyle(document.documentElement).getPropertyValue('--fanous-c-nav-bg').trim();
    document.body.append(probe);
    const night = getComputedStyle(probe).color;
    probe.remove();
    const [r, g, b] = (night.match(/\d+/g) ?? ['255', '255', '255']).map(Number);
    const dark = 0.2126 * r! + 0.7152 * g! + 0.0722 * b! < 80;
    const box = document.querySelector('.custom-video-player')?.getBoundingClientRect();
    const link = document.querySelector('[data-testid="embed-watch-link"]')?.getBoundingClientRect();
    return {
      backdrop: dark && [bg(document.documentElement), bg(document.body), bg(document.querySelector('main'))].every((c) => c === night),
      w: box ? Math.round(box.width) : 0,
      h: box ? Math.round(box.height) : 0,
      // the player's left edge, and whether the "Watch on" link sits on the player (not the page)
      x: box ? Math.round(box.left) : -1,
      linkOnPlayer: !!box && !!link && link.left >= box.left - 1 && link.right <= box.right + 1 && link.top >= box.top - 1,
      // the control bar: every visible control inside the player, and the buttons on one row (compact
      // when narrow). The progress bar has a row of its own by design, so it is left out of the row
      // check; the buttons' vertical centres agree within 6 px (their tops differ by a few sub-pixels
      // with the buttons' heights, which flipped a top-bucketed check between runs).
      controlsOneRow: (() => {
        const bar = document.querySelector('.vjs-control-bar');
        if (!bar || !box) return false;
        const shown = [...bar.children]
          .map((c) => ({ progress: c.classList.contains('vjs-progress-control'), r: c.getBoundingClientRect() }))
          .filter(({ r }) => r.width > 0 && r.height > 0);
        const centres = shown.filter(({ progress, r }) => !progress && r.height <= 60).map(({ r }) => r.top + r.height / 2);
        const oneRow = centres.length === 0 || Math.max(...centres) - Math.min(...centres) <= 6;
        return shown.every(({ r }) => r.left >= box.left - 1 && r.right <= box.right + 1) && oneRow;
      })(),
    };
  });

function skipOnPr(why: string): void {
  test.info().annotations.push({ type: 'skip', description: `the target predates ${why}` });
  test.skip(true, `the target predates ${why}`);
}

test.describe('Release: the embed fills its frame on the night colour', () => {
  // `player`: the expected player box (the video's ratio fitted in the frame, centred). The clips:
  // landscape 16:9, vertical 240x426, square 1:1. 780x440 is X's player card for a Short.
  for (const { clip, width, height, player } of [
    { clip: 'landscape40', width: 345, height: 194, player: { w: 345, h: 194 } },
    { clip: 'landscape40', width: 800, height: 450, player: { w: 800, h: 450 } },
    { clip: 'vertical', width: 216, height: 384, player: { w: 216, h: 383 } },
    { clip: 'vertical', width: 780, height: 440, player: { w: 248, h: 440 } },
    { clip: 'square', width: 345, height: 345, player: { w: 345, h: 345 } },
  ] as const) {
    for (const scheme of ['dark', 'light'] as const) {
      test(`${clip} in a ${width}x${height} frame (${scheme})`, async ({ page }) => {
        await page.emulateMedia({ colorScheme: scheme });
        await host(page, `${target().web}/embed/v/${videos[clip].id}?lang=ar&autoplay=1`, { width, height }, 'load');
        const frame = await embedFrame(page);
        await expect(frame.locator('.custom-video-player')).toBeVisible({ timeout: 45000 });
        if (ON_PR && !(await look(frame)).backdrop) skipOnPr('the embed frame fill (components/embed/embed-frame.css)');
        // The poll returns the failing parts by name, so a red run says which one
        await expect
          .poll(async () => {
            const l = await look(frame);
            const failing: string[] = [];
            if (!l.backdrop) failing.push('backdrop not the night colour');
            if (Math.abs(l.w - player.w) > 2 || Math.abs(l.h - player.h) > 2) failing.push(`player ${l.w}x${l.h}`);
            if (Math.abs(l.x - (width - l.w) / 2) > 2) failing.push(`not centred (left ${l.x})`);
            if (!l.linkOnPlayer) failing.push('"Watch on" not on the player');
            if (!l.controlsOneRow) failing.push('controls not on one row inside the player');
            return failing;
          }, { message: `player ${player.w}x${player.h}, centred, on the night colour, "Watch on" and the controls on the player`, timeout: 15000 })
          .toEqual([]);
      });
    }
  }
});

test.describe('Release: a click-started play has sound', () => {
  /** On a PR against a build without gesture=1: muted with no unmute control → skip. */
  async function skipIfPredates(frame: Frame): Promise<void> {
    if (!ON_PR) return;
    await expect.poll(async () => (await media(frame)) !== null, { timeout: 45000 }).toBe(true);
    await frame.waitForTimeout(3000); // observation window: an old build shows nothing more
    if ((await media(frame))?.muted && (await frame.getByTestId('embed-unmute').count()) === 0) skipOnPr('gesture=1');
  }

  /** Never muted without the control; the control brings the sound back. */
  async function mutedOnlyWithControl(frame: Frame): Promise<void> {
    await expect
      .poll(async () => {
        const m = await media(frame);
        return m ? (m.muted ? (await frame.getByTestId('embed-unmute').count()) > 0 : true) : false;
      }, { timeout: 45000 })
      .toBe(true);
    if ((await media(frame))?.muted) {
      await frame.getByTestId('embed-unmute').click();
      await expect.poll(async () => (await media(frame))?.muted).toBe(false);
      await expect(frame.getByTestId('embed-unmute')).toHaveCount(0);
    }
  }

  test('a click on the host page plays with sound (Chromium); WebKit: muted with a working unmute control', async ({ page, browserName }) => {
    await host(page, `${target().web}/embed/v/${videos.landscape40.id}?lang=en&autoplay=1&gesture=1`, { width: 640, height: 360 }, 'click');
    const frame = await embedFrame(page);
    await skipIfPredates(frame);
    if (browserName !== 'chromium') return mutedOnlyWithControl(frame);
    await expect.poll(async () => (await media(frame))?.muted, { message: 'muted after a click', timeout: 45000 }).toBe(false);
    await expect.poll(async () => (await media(frame))?.time ?? 0, { message: 'playback with sound did not start', timeout: 45000 }).toBeGreaterThan(1);
    expect((await media(frame))?.muted).toBe(false);
    await expect(frame.getByTestId('embed-unmute')).toHaveCount(0);
  });

  // landscape40 (40 s) in the Short's 216x384 frame: the 4 s vertical clip ended before a slow
  // runner's first look ("watch again", nothing to unmute).
  test('no user activation: muted, "Tap to unmute" (Arabic), which brings the sound back', async ({ page, browserName }) => {
    // quarantined: #1090 @meywd: on the CI runner the embed plays unmuted without activation (QA runs 43328368421, 43331650634)
    test.fixme(true, 'quarantined: #1090 @meywd: the embed plays unmuted without activation on the CI runner');
    if (browserName === 'chromium') {
      // Chrome on the CI runner allows sound without activation, even with
      // --autoplay-policy=user-gesture-required, so the embed rightly plays unmuted there. Refuse an
      // unmuted play() without activation in every frame, as Chrome's default policy does elsewhere,
      // so the muted fallback is the path under test. A click in the frame (the pill) is activation.
      await page.addInitScript(() => {
        const play = HTMLMediaElement.prototype.play;
        HTMLMediaElement.prototype.play = function (this: HTMLMediaElement) {
          if (!this.muted && this.volume > 0 && !navigator.userActivation?.isActive) {
            return Promise.reject(new DOMException('sound needs a user gesture', 'NotAllowedError'));
          }
          return play.call(this);
        };
      });
    }
    await host(page, `${target().web}/embed/v/${videos.landscape40.id}?lang=ar&autoplay=1&gesture=1`, { width: 216, height: 384 }, 'load');
    const frame = await embedFrame(page);
    await skipIfPredates(frame);
    if (browserName === 'chromium') {
      // sound refused: muted, still playing, with the Arabic control
      await expect.poll(async () => (await media(frame))?.muted, { message: 'not muted without activation', timeout: 45000 }).toBe(true);
      await expect.poll(async () => (await media(frame))?.time ?? 0, { message: 'the muted fallback did not play', timeout: 45000 }).toBeGreaterThan(1);
      await expect(frame.getByTestId('embed-unmute')).toHaveText('اضغط لتشغيل الصوت');
    }
    await mutedOnlyWithControl(frame);
  });
});
