/**
 * Release regression: the embed player in someone else's frame (owner reports, 2026-11-12, live on
 * www and X):
 *
 * 1. It fills the host's frame on the theme's night colour, the picture fitted inside it, with the
 *    controls across the frame: one row, the progress bar at the bottom, "Watch on" beside the
 *    picture when there is room (else icon-only). Before: the theme's parchment page
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
import { runVideosReady, sharedRunVideosOn } from './run-videos';
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
  // QA/stage encode part: the run's shared clips (run-videos.ts), so the browser projects and
  // retries of this spec upload nothing; locally, its own
  if (sharedRunVideosOn()) {
    const set = await runVideosReady();
    for (const clip of ['landscape40', 'vertical', 'square'] as const) videos[clip] = set.videos[clip];
    return;
  }
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

/** Lowest the progress track may sit above the frame's bottom edge: the control row (48px) and the bar's padding */
const PROGRESS_BOTTOM_PX = 80;

/**
 * The player's box, the picture inside it, the controls and the "Watch on" link, and whether
 * html/body/main are the theme's (dark) night colour.
 */
const look = (frame: Frame) =>
  frame.evaluate((progressBottomPx) => {
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
    // The picture: the video element is the whole player, its frames fitted inside (object-fit: contain)
    const v = document.querySelector<HTMLVideoElement>('.video-js video');
    const vr = v?.getBoundingClientRect();
    const pic = (() => {
      if (!v || !vr || !v.videoWidth || !v.videoHeight) return null;
      const scale = Math.min(vr.width / v.videoWidth, vr.height / v.videoHeight);
      const w = v.videoWidth * scale;
      const h = v.videoHeight * scale;
      return { left: vr.left + (vr.width - w) / 2, top: vr.top + (vr.height - h) / 2, w, h };
    })();
    const bar = document.querySelector('.vjs-control-bar');
    const shown = bar
      ? [...bar.children]
        .map((c) => ({ progress: c.classList.contains('vjs-progress-control'), r: c.getBoundingClientRect() }))
        .filter(({ r: cr }) => cr.width > 0 && cr.height > 0)
      : [];
    const holder = document.querySelector('.vjs-progress-holder')?.getBoundingClientRect();
    const sideRoom = pic ? (innerWidth - pic.w) / 2 : 0;
    return {
      backdrop: dark && [bg(document.documentElement), bg(document.body), bg(document.querySelector('main'))].every((c) => c === night),
      w: box ? Math.round(box.width) : 0,
      h: box ? Math.round(box.height) : 0,
      // the picture's size and position (as large as the frame allows, at the video's ratio, centred)
      pic: pic ? { w: Math.round(pic.w), h: Math.round(pic.h), x: Math.round(pic.left), y: Math.round(pic.top) } : null,
      // the control bar: every visible control inside the frame, and the buttons on ONE row (their
      // vertical centres agree within 6 px; tops differ by sub-pixels with the buttons' heights)
      controlsOneRow: (() => {
        if (!bar || !box) return false;
        const centres = shown.filter(({ progress, r: cr }) => !progress && cr.height <= 60).map(({ r: cr }) => cr.top + cr.height / 2);
        const oneRow = centres.length === 0 || Math.max(...centres) - Math.min(...centres) <= 6;
        return shown.every(({ r: cr }) => cr.left >= -1 && cr.right <= innerWidth + 1) && oneRow;
      })(),
      // the progress track: at the bottom of the frame (not lifted into the picture by a wrapped
      // bar), above the buttons, thin
      progress: holder
        ? { fromBottom: Math.round(innerHeight - holder.bottom), height: Math.round(holder.height), aboveButtons: shown.filter(({ progress }) => !progress).every(({ r: cr }) => cr.top >= holder.bottom - 1) }
        : null,
      // "Watch on": in the frame; covering none of the picture (a Short's title and a channel logo
      // burned into its corner stay visible) unless it is icon-only, or the picture fills a wide frame
      link: link ? { w: Math.round(link.width), inFrame: link.left >= -1 && link.right <= innerWidth + 1 && link.top >= -1 } : null,
      linkClear: (() => {
        if (!link || !pic) return false;
        const overlaps = link.right > pic.left + 1 && link.left < pic.left + pic.w - 1 && link.bottom > pic.top + 1 && link.top < pic.top + pic.h - 1;
        if (!overlaps || link.width <= 40) return true;
        // only a landscape picture filling a wide frame may carry the full label
        return sideRoom <= 4 && innerWidth >= 480;
      })(),
      progressBottomPx,
    };
  }, PROGRESS_BOTTOM_PX);

function skipOnPr(why: string): void {
  test.info().annotations.push({ type: 'skip', description: `the target predates ${why}` });
  test.skip(true, `the target predates ${why}`);
}

test.describe('Release: the embed fills its frame on the night colour', () => {
  // The player fills the frame; `pic` is the expected picture (the video's ratio fitted in the frame,
  // centred). The clips: landscape 16:9, vertical 240x426, square 1:1. 780x440 and 504x283 are X's
  // card on desktop and on a phone, whatever the video's ratio (owner's screenshot, 2026-11-12: the
  // Short's controls wrapped onto two rows inside its ~245px picture, the progress bar sat mid-video
  // and "Watch on" covered its title).
  for (const { clip, width, height, pic } of [
    { clip: 'landscape40', width: 345, height: 194, pic: { w: 345, h: 194 } },
    { clip: 'landscape40', width: 800, height: 450, pic: { w: 800, h: 450 } },
    { clip: 'landscape40', width: 300, height: 533, pic: { w: 300, h: 169 } },
    { clip: 'vertical', width: 216, height: 384, pic: { w: 216, h: 383 } },
    { clip: 'vertical', width: 780, height: 440, pic: { w: 248, h: 440 } },
    { clip: 'vertical', width: 504, height: 283, pic: { w: 159, h: 283 } },
    { clip: 'square', width: 345, height: 345, pic: { w: 345, h: 345 } },
  ] as const) {
    for (const scheme of ['dark', 'light'] as const) {
      test(`${clip} in a ${width}x${height} frame (${scheme})`, async ({ page }) => {
        await page.emulateMedia({ colorScheme: scheme });
        await host(page, `${target().web}/embed/v/${videos[clip].id}?lang=ar&autoplay=1`, { width, height }, 'load');
        const frame = await embedFrame(page);
        await expect(frame.locator('.custom-video-player')).toBeVisible({ timeout: 45000 });
        if (ON_PR && !(await look(frame)).backdrop) skipOnPr('the embed frame fill (components/embed/embed-frame.css)');
        // A target that still sizes the player to the picture predates the frame-wide controls
        if (ON_PR && (await look(frame)).w < width - 2) skipOnPr('the frame-wide embed controls (components/embed/embed-frame.css)');
        // Wake the controls (they fade while playing)
        await page.locator('#aun').hover({ position: { x: width / 2, y: height / 2 } });
        await page.locator('#aun').hover({ position: { x: width / 2 + 5, y: height / 2 + 5 } });
        // The poll returns the failing parts by name, so a red run says which one
        await expect
          .poll(async () => {
            const l = await look(frame);
            const failing: string[] = [];
            if (!l.backdrop) failing.push('backdrop not the night colour');
            if (Math.abs(l.w - width) > 2 || Math.abs(l.h - height) > 2) failing.push(`player ${l.w}x${l.h}, not the frame`);
            if (!l.pic) failing.push('no picture');
            else {
              if (Math.abs(l.pic.w - pic.w) > 2 || Math.abs(l.pic.h - pic.h) > 2) failing.push(`picture ${l.pic.w}x${l.pic.h}`);
              if (Math.abs(l.pic.x - (width - l.pic.w) / 2) > 2) failing.push(`picture not centred (left ${l.pic.x})`);
            }
            if (!l.controlsOneRow) failing.push('controls not on one row inside the frame');
            if (!l.progress) failing.push('no progress bar');
            else {
              if (l.progress.fromBottom > l.progressBottomPx) failing.push(`progress bar ${l.progress.fromBottom}px above the frame's bottom`);
              if (!l.progress.aboveButtons) failing.push('progress bar not above the buttons');
              if (l.progress.height > 10) failing.push(`progress track ${l.progress.height}px tall`);
            }
            if (!l.link?.inFrame) failing.push('"Watch on" not in the frame');
            if (!l.linkClear) failing.push(`"Watch on" (${l.link?.w}px) covers the picture and is not icon-only`);
            return failing;
          }, { message: 'player fills the frame; picture fitted; one-row controls and the progress bar at the bottom; "Watch on" clear of the picture', timeout: 15000 })
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
  //
  // Nothing may evaluate in the page or the frame before the player starts: Playwright runs every
  // Chromium evaluate (page/frame.evaluate, locator reads, expect.poll over them) as a user gesture
  // (Runtime.callFunctionOn userGesture: true), and that transient activation lets the embed play
  // with sound, as a real click would. On the CI runner the first media read landed before the
  // player's play() and the clip played unmuted to the end (#1090: the frame's
  // navigator.userActivation.isActive was false at load and true at play()). So the first start is
  // read from the frame's console, and the frame is only inspected once the player has started.
  test('no user activation: muted, "Tap to unmute" (Arabic), which brings the sound back', async ({ page, browserName }) => {
    await page.addInitScript(() => {
      if (!location.pathname.startsWith('/embed/v/')) return;
      document.addEventListener('playing', (event) => {
        const v = event.target as HTMLMediaElement;
        console.log(`[embed-first-playing] ${JSON.stringify({ muted: v.muted || v.volume === 0 })}`);
      }, { capture: true, once: true });
    });
    const first: { start: { muted: boolean } | null } = { start: null };
    page.on('console', (message) => {
      const found = /^\[embed-first-playing\] (.*)$/.exec(message.text());
      if (found && !first.start) first.start = JSON.parse(found[1]!) as { muted: boolean };
    });
    await host(page, `${target().web}/embed/v/${videos.landscape40.id}?lang=ar&autoplay=1&gesture=1`, { width: 216, height: 384 }, 'load');
    await expect.poll(() => first.start, { message: 'the player did not start', timeout: 60000 }).not.toBeNull();
    const frame = await embedFrame(page);
    await skipIfPredates(frame);
    if (browserName === 'chromium') {
      // sound refused without activation: muted, still playing, with the Arabic control
      expect(first.start?.muted, 'not muted without activation').toBe(true);
      await expect.poll(async () => (await media(frame))?.time ?? 0, { message: 'the muted fallback did not play', timeout: 45000 }).toBeGreaterThan(1);
      await expect(frame.getByTestId('embed-unmute')).toHaveText('اضغط لتشغيل الصوت');
    }
    await mutedOnlyWithControl(frame);
  });
});
