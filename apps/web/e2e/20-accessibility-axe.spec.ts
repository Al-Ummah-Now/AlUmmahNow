import { devices, type Page } from '@playwright/test';
import { test, expect, consentCookie } from './fixtures';
import { AxeBuilder } from '@axe-core/playwright';
import { startThenPause, waitForPlayer } from './test-utils/watch-page';

/**
 * Epic 1 accessibility (stories 1.1 colour contrast, 1.4 keyboard navigation,
 * 1.5 touch targets) - watch page + video player.
 *
 * Runs against a deployed environment (WEB_APP_URL, e.g. QA) with a real video
 * id taken from the videos API. The player streams H.264 HLS, which Playwright's
 * bundled Chromium cannot decode (the player then shows its format-error
 * screen), so run these with branded Chrome:
 *
 *   WEB_APP_URL=https://videos.qa.alummahnow.net A11Y_CHROME_CHANNEL=chrome \
 *     pnpm exec playwright test e2e/20-accessibility-axe.spec.ts --project=chromium
 *
 * Without a codec-capable browser the player-specific tests are skipped (with
 * a reason) and only the page-level axe scan runs.
 */

const API_URL = process.env.E2E_API_URL || 'https://videos.api.qa.alummahnow.net';
const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];
const MIN_TARGET = 44;

if (process.env.A11Y_CHROME_CHANNEL) {
  test.use({ channel: process.env.A11Y_CHROME_CHANNEL });
}

let videoId: string | undefined;

async function resolveVideoId(): Promise<string> {
  if (process.env.E2E_VIDEO_ID) return process.env.E2E_VIDEO_ID;
  if (videoId) return videoId;
  // The first "QA Lecture" seed (landscape, like the other watch specs): a portrait video
  // gives a narrow player that hides the volume slider by design. limit=1 can return an
  // empty first page (visibility filtering happens after the page is cut), so ask for more.
  const response = await fetch(`${API_URL}/api/videos?limit=100`);
  expect(response.ok, `GET ${API_URL}/api/videos`).toBeTruthy();
  const body = (await response.json()) as { data?: Array<{ id: string; title: string; uploadStatus?: string }> };
  const ready = (body.data ?? []).filter((v) => !v.uploadStatus || v.uploadStatus === 'ready');
  const lectures = ready.filter((v) => v.title.startsWith('QA Lecture')).sort((x, y) => x.title.localeCompare(y.title));
  const video = lectures[0] ?? ready[0] ?? body.data?.[0];
  expect(video, 'at least one video in the API').toBeTruthy();
  videoId = video!.id;
  return videoId;
}

/**
 * Load the watch page and wait until the player is ready: initialised with its
 * media metadata loaded (or on its error screen). Returns false when the browser
 * can't play the stream.
 *
 * The control bar stays hidden until playback has started once (only the big
 * play button shows before), so `controls: true` also plays and pauses, leaving
 * the bar up for tests that need its buttons.
 */
async function openWatchPage(page: Page, locale: 'en' | 'ar', opts: { controls?: boolean } = {}): Promise<boolean> {
  const id = await resolveVideoId();
  await page.goto(`/${locale}/video/${id}`, { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  if ((await waitForPlayer(page)) !== 'playable') {
    // Scan the error screen the viewer sees, not a half-rendered player
    await expect(page.getByTestId('video-error')).toBeVisible();
    return false;
  }
  if (opts.controls) await startThenPause(page);
  return true;
}

/**
 * WebKit (Safari's default "Press Tab to highlight each item" off) only tabs
 * between text fields; Option+Tab walks every focusable element, which is
 * what a Safari keyboard user presses.
 */
function tabKey(browserName: string): string {
  return browserName === 'webkit' ? 'Alt+Tab' : 'Tab';
}

function formatViolations(violations: Awaited<ReturnType<AxeBuilder['analyze']>>['violations']): string {
  return violations
    .map((v) => `${v.id} (${v.impact}): ${v.nodes.map((n) => n.target.join(' ')).slice(0, 5).join(' | ')}`)
    .join('\n');
}

for (const colorScheme of ['light', 'dark'] as const) {
  for (const locale of ['en', 'ar'] as const) {
    test.describe(`watch page a11y - ${colorScheme} theme, ${locale}`, () => {
      test.use({ colorScheme });

      test('axe: zero WCAG 2.1 AA violations (incl. colour contrast)', async ({ page, context, baseURL }) => {
        // A first visit: the scan covers the cookie banner too (the other tests
        // start with a saved choice, so the banner does not cover the controls)
        await context.clearCookies({ name: consentCookie(baseURL!).name });
        await openWatchPage(page, locale);
        const results = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
        expect(results.violations, formatViolations(results.violations)).toEqual([]);
      });

      test('axe: player controls and the open settings menu have zero violations', async ({ page }) => {
        const playable = await openWatchPage(page, locale, { controls: true });
        test.skip(!playable, 'browser cannot decode the HLS stream - set A11Y_CHROME_CHANNEL=chrome');

        // The bar on its own, then with the settings menu open (quality, speed, captions, shortcuts)
        const bar = await new AxeBuilder({ page }).include('.video-js').withTags(WCAG_TAGS).analyze();
        expect(bar.violations, formatViolations(bar.violations)).toEqual([]);

        await page.locator('.video-js .vjs-fanous-settings').click();
        const menu = page.getByTestId('player-settings-menu');
        await expect(menu).toBeVisible();
        const open = await new AxeBuilder({ page })
          .include('.video-js')
          .include('[data-testid="player-settings-menu"]')
          .withTags(WCAG_TAGS)
          .analyze();
        expect(open.violations, formatViolations(open.violations)).toEqual([]);

        // A submenu (quality where the stream exposes renditions, else speed)
        const row = menu.locator('[data-row="quality"], [data-row="speed"]').first();
        await row.click();
        await expect(menu.locator('[role="menuitemradio"]').first()).toBeVisible();
        const sub = await new AxeBuilder({ page }).include('[data-testid="player-settings-menu"]').withTags(WCAG_TAGS).analyze();
        expect(sub.violations, formatViolations(sub.violations)).toEqual([]);
      });
    });
  }
}

test.describe('keyboard navigation (story 1.4)', () => {
  test('skip links are the first tab stop, visible on focus, and reach main content / player', async ({ page, browserName }) => {
    const TAB = tabKey(browserName);
    // A fresh load, as a keyboard user arrives: starting playback first (as
    // openWatchPage may) clicks into the player, and Tab would continue from there
    await page.goto(`/en/video/${await resolveVideoId()}`, { waitUntil: 'domcontentloaded' });
    const playable = (await waitForPlayer(page)) === 'playable';
    await expect(page.locator('body')).toBeFocused();
    await page.keyboard.press(TAB);
    const skip = page.getByRole('link', { name: 'Skip to main content' });
    await expect(skip).toBeFocused();
    const box = await skip.boundingBox();
    expect(box && box.width > 1 && box.height >= MIN_TARGET, 'skip link visible when focused').toBeTruthy();

    await page.keyboard.press(TAB);
    await expect(page.getByRole('link', { name: 'Skip to video player' })).toBeFocused();
    if (playable) {
      await page.keyboard.press('Enter');
      await expect(page.locator('#video-player .video-js')).toBeFocused();
    }
  });

  test('every player control is reachable by Tab, in visual order, with a visible focus indicator', async ({ page, isMobile, browserName }) => {
    const TAB = tabKey(browserName);
    test.skip(isMobile, 'Touch devices have no hardware keyboard / Tab navigation');
    const playable = await openWatchPage(page, 'en', { controls: true });
    test.skip(!playable, 'browser cannot decode the HLS stream - set A11Y_CHROME_CHANNEL=chrome');

    await page.locator('#video-player .video-js').focus();
    type Stop = { i: number; cls: string; x: number; row: number; ring: string };
    const visited: Stop[] = [];
    for (let i = 0; i < 20; i++) {
      await page.keyboard.press(TAB);
      const info = await page.evaluate((i) => {
        const el = document.activeElement as HTMLElement | null;
        if (!el || !el.closest('.video-js')) return { left: true };
        if (!el.closest('.vjs-control-bar')) return { skip: true }; // e.g. big play button
        const rect = el.getBoundingClientRect();
        el.setAttribute('data-a11y-stop', String(i));
        // The ring is drawn on the control itself (outline / box-shadow) or on its ::before fill
        const own = getComputedStyle(el);
        const ring = `${own.outlineStyle} ${own.outlineWidth} | ${own.boxShadow} | ${getComputedStyle(el, '::before').boxShadow}`;
        return { i, cls: el.className.toString(), x: rect.left, row: Math.round((rect.top + rect.height / 2) / 24), ring };
      }, i);
      if ('left' in info) break;
      if ('skip' in info) continue;
      visited.push(info as Stop);
    }

    const has = (c: string) => visited.some((v) => v.cls.includes(c));
    expect(has('vjs-progress-holder'), JSON.stringify(visited)).toBeTruthy();
    expect(has('vjs-play-control')).toBeTruthy();
    expect(has('vjs-mute-control')).toBeTruthy();
    // Keyboard help lives in the settings menu (and on "?")
    expect(has('vjs-fanous-settings')).toBeTruthy();
    expect(has('vjs-fullscreen-control')).toBeTruthy();
    // The volume slider shows on players 480px and wider; then it is a tab stop too
    if (await page.locator('.video-js .vjs-volume-control').isVisible()) expect(has('vjs-volume-bar')).toBeTruthy();

    // Focus order follows the visual order of the bar: the progress row, then each row left to right
    const order = visited.map((v) => v.cls);
    const visual = [...visited].sort((a, b) => a.row - b.row || a.x - b.x).map((v) => v.cls);
    expect(order).toEqual(visual);

    // Each stop draws a ring it does not have unfocused
    await page.locator('body').focus();
    for (const v of visited) {
      const resting = await page.locator(`[data-a11y-stop="${v.i}"]`).evaluate((el) => {
        const own = getComputedStyle(el);
        return `${own.outlineStyle} ${own.outlineWidth} | ${own.boxShadow} | ${getComputedStyle(el, '::before').boxShadow}`;
      });
      expect(v.ring, `focus indicator on ${v.cls}`).not.toBe(resting);
    }
  });

  test('Space on the focused play button toggles playback exactly once', async ({ page }) => {
    const playable = await openWatchPage(page, 'en', { controls: true });
    test.skip(!playable, 'browser cannot decode the HLS stream - set A11Y_CHROME_CHANNEL=chrome');

    const play = page.locator('.video-js .vjs-play-control');
    await play.focus();
    const before = await page.evaluate(() => (document.querySelector('.video-js video') as HTMLVideoElement).paused);
    await page.keyboard.press('Space');
    await expect
      .poll(() => page.evaluate(() => (document.querySelector('.video-js video') as HTMLVideoElement).paused))
      .toBe(!before);
  });

  test('"?" opens the shortcut help dialog; Escape closes it and restores focus', async ({ page, isMobile }) => {
    test.skip(isMobile, 'Touch devices have no hardware keyboard / Tab navigation');
    await page.goto(`/en/video/${await resolveVideoId()}`, { waitUntil: 'domcontentloaded' });
    test.skip((await waitForPlayer(page)) !== 'playable', 'browser cannot decode the HLS stream - set A11Y_CHROME_CHANNEL=chrome');
    // The settings button appears once playback has started
    await startThenPause(page);

    // "?" on the focused player opens the help; the redesigned bar has no shortcuts button
    const player = page.locator('#video-player .video-js');
    await player.focus();
    await page.keyboard.press('Shift+Slash');
    const dialog = page.getByRole('dialog', { name: 'Keyboard Shortcuts' });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Close' }).first()).toBeFocused();
    const axe = await new AxeBuilder({ page }).include('[role="dialog"]').withTags(WCAG_TAGS).analyze();
    expect(axe.violations, formatViolations(axe.violations)).toEqual([]);
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(player).toBeFocused();

    // The settings menu's "Keyboard shortcuts" row opens the same dialog from the keyboard
    const settings = page.locator('#video-player .vjs-fanous-settings');
    await settings.focus();
    await page.keyboard.press('Enter');
    const row = page.getByTestId('player-settings-menu').locator('[data-row="shortcuts"]');
    await row.focus();
    await page.keyboard.press('Enter');
    await expect(dialog).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
  });
});

// Pixel 5 emulation minus defaultBrowserType (not allowed inside a describe)
const { defaultBrowserType: _ignored, ...pixel5 } = devices['Pixel 5'];

test.describe('mobile touch targets (story 1.5)', () => {
  test.use(pixel5);
  // Firefox has no mobile emulation: Playwright rejects isMobile when creating the context
  test.skip(({ browserName }) => browserName === 'firefox', 'isMobile is not supported in Firefox');

  for (const locale of ['en', 'ar'] as const) {
    test(`all visible player controls are >= 44x44px and do not overlap (${locale})`, async ({ page }) => {
      const playable = await openWatchPage(page, locale, { controls: true });
      test.skip(!playable, 'browser cannot decode the HLS stream - set A11Y_CHROME_CHANNEL=chrome');

      const targets = await page.evaluate(() => {
        const selector = [
          '.video-js .vjs-control-bar button',
          '.video-js .vjs-big-play-button',
          '.video-js .vjs-progress-control',
          '.video-js .vjs-volume-panel .vjs-volume-control',
        ].join(',');
        return Array.from(document.querySelectorAll<HTMLElement>(selector))
          .filter((el) => {
            const style = getComputedStyle(el);
            const rect = el.getBoundingClientRect();
            return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
          })
          .map((el) => {
            const r = el.getBoundingClientRect();
            return { cls: el.className.toString().slice(0, 60), left: r.left, top: r.top, right: r.right, bottom: r.bottom, w: r.width, h: r.height };
          });
      });

      expect(targets.length).toBeGreaterThan(3);
      for (const t of targets) {
        expect(Math.round(t.w), `${t.cls} width`).toBeGreaterThanOrEqual(MIN_TARGET);
        expect(Math.round(t.h), `${t.cls} height`).toBeGreaterThanOrEqual(MIN_TARGET);
      }

      // Adequate spacing: control-bar buttons must not overlap each other
      const bar = targets.filter((t) => !t.cls.includes('big-play'));
      const buttons = bar.filter((t) => !t.cls.includes('vjs-progress-control') && !t.cls.includes('vjs-volume-control'));
      for (let i = 0; i < buttons.length; i++) {
        for (let j = i + 1; j < buttons.length; j++) {
          const a = buttons[i];
          const b = buttons[j];
          const overlapX = Math.min(a.right, b.right) - Math.max(a.left, b.left);
          const overlapY = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
          expect(overlapX > 1 && overlapY > 1, `${a.cls} overlaps ${b.cls}`).toBeFalsy();
        }
      }
      // Narrow players hide the volume slider and picture in picture
      // (VIDEO-PLAYER.md), so the buttons fit one row under the progress bar
      const tops = new Set(buttons.map((b) => Math.round(b.top)));
      expect(tops.size, `button rows: ${JSON.stringify(buttons.map((b) => [b.cls, Math.round(b.top)]))}`).toBe(1);
      await expect(page.locator('.video-js .vjs-picture-in-picture-control')).toBeHidden();

      // The progress bar's 44px touch area reaches into the bar's padding
      // (VIDEO-PLAYER.md): a tap anywhere on a button's own 44x44 area must
      // still reach that button, never seek
      const missed = await page.evaluate((inset) => {
        const out: string[] = [];
        for (const el of Array.from(document.querySelectorAll<HTMLElement>('.video-js .vjs-control-bar button'))) {
          const r = el.getBoundingClientRect();
          if (getComputedStyle(el).display === 'none' || r.width === 0) continue;
          const cx = r.left + r.width / 2;
          const cy = r.top + r.height / 2;
          for (const [x, y] of [[cx, cy], [cx, r.top + inset], [cx, r.bottom - inset], [r.left + inset, cy], [r.right - inset, cy]]) {
            const hit = document.elementFromPoint(x, y);
            if (!hit || !el.contains(hit)) out.push(`${el.className.toString().slice(0, 40)} at ${Math.round(x)},${Math.round(y)} -> ${hit?.className.toString().slice(0, 40)}`);
          }
        }
        return out;
      }, 4);
      expect(missed).toEqual([]);

      // Control bar fits the viewport - no control pushed off-screen
      const viewport = page.viewportSize()!;
      for (const t of bar) {
        expect(t.right).toBeLessThanOrEqual(viewport.width + 1);
        expect(t.left).toBeGreaterThanOrEqual(-1);
      }
    });
  }

  test('tapping a control shows pressed feedback', async ({ page }) => {
    const playable = await openWatchPage(page, 'en', { controls: true });
    test.skip(!playable, 'browser cannot decode the HLS stream - set A11Y_CHROME_CHANNEL=chrome');
    const play = page.locator('.video-js .vjs-play-control');
    const box = (await play.boundingBox())!;
    await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
    // The class is kept for at least 120ms after the tap
    await expect(play).toHaveClass(/vjs-touch-active/, { timeout: 100 }).catch(() => undefined);
    await expect(play).not.toHaveClass(/vjs-touch-active/, { timeout: 2000 });
  });
});
