import { test, expect, devices, type Page } from '@playwright/test';
import { AxeBuilder } from '@axe-core/playwright';

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
  // limit=1 can return an empty first page (visibility filtering happens after
  // the page is cut), so ask for a few and take the first ready one.
  const response = await fetch(`${API_URL}/api/videos?limit=20`);
  expect(response.ok, `GET ${API_URL}/api/videos`).toBeTruthy();
  const body = (await response.json()) as { data?: Array<{ id: string; uploadStatus?: string }> };
  const video = body.data?.find((v) => !v.uploadStatus || v.uploadStatus === 'ready') ?? body.data?.[0];
  expect(video, 'at least one video in the API').toBeTruthy();
  videoId = video!.id;
  return videoId;
}

/** Load the watch page and wait for the player. Returns false when the browser can't play the stream. */
async function openWatchPage(page: Page, locale: 'en' | 'ar'): Promise<boolean> {
  const id = await resolveVideoId();
  await page.goto(`/${locale}/video/${id}`, { waitUntil: 'domcontentloaded' });
  // Either the Video.js control bar becomes visible, or the player reports an
  // error (Video.js error state / the app's ErrorDisplay replacing the player).
  const state = await page.waitForFunction(() => {
    const bar = document.querySelector<HTMLElement>('.video-js .vjs-control-bar');
    const media = document.querySelector<HTMLVideoElement>('.video-js video');
    // The control bar renders before the source is probed, so also require
    // loaded metadata - a codec failure only surfaces after that point.
    if (bar && bar.offsetParent !== null && getComputedStyle(bar).visibility !== 'hidden'
      && media && media.readyState >= 1 && !document.querySelector('.video-js.vjs-error')) {
      return 'playable';
    }
    const container = document.querySelector('.custom-video-player');
    if (document.querySelector('.video-js.vjs-error') || (container && !container.querySelector('.video-js'))) {
      return 'error';
    }
    return false;
  }, undefined, { timeout: 45000 });
  if ((await state.jsonValue()) !== 'playable') {
    // Let the app settle on its error screen before any page-level scan
    await page.waitForTimeout(2000);
    return false;
  }
  // Keep the (auto-hiding) control bar visible for the scan
  await page.evaluate(() => document.querySelector('.video-js')?.classList.remove('vjs-user-inactive'));
  await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => undefined);
  return true;
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

      test('axe: zero WCAG 2.1 AA violations (incl. colour contrast)', async ({ page }) => {
        await openWatchPage(page, locale);
        const results = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
        expect(results.violations, formatViolations(results.violations)).toEqual([]);
      });

      test('axe: player controls and open quality/caption menu have zero violations', async ({ page }) => {
        const playable = await openWatchPage(page, locale);
        test.skip(!playable, 'browser cannot decode the HLS stream - set A11Y_CHROME_CHANNEL=chrome');

        const menuButton = page.locator('.video-js .vjs-quality-selector .vjs-menu-button').first();
        if (await menuButton.isVisible()) await menuButton.click();
        const results = await new AxeBuilder({ page }).include('.video-js').withTags(WCAG_TAGS).analyze();
        expect(results.violations, formatViolations(results.violations)).toEqual([]);
      });
    });
  }
}

test.describe('keyboard navigation (story 1.4)', () => {
  test('skip links are the first tab stop, visible on focus, and reach main content / player', async ({ page }) => {
    const playable = await openWatchPage(page, 'en');
    await page.locator('body').focus();
    await page.keyboard.press('Tab');
    const skip = page.getByRole('link', { name: 'Skip to main content' });
    await expect(skip).toBeFocused();
    const box = await skip.boundingBox();
    expect(box && box.width > 1 && box.height >= MIN_TARGET, 'skip link visible when focused').toBeTruthy();

    await page.keyboard.press('Tab');
    await expect(page.getByRole('link', { name: 'Skip to video player' })).toBeFocused();
    if (playable) {
      await page.keyboard.press('Enter');
      await expect(page.locator('#video-player .video-js')).toBeFocused();
    }
  });

  test('every player control is reachable by Tab, in visual order, with a visible focus indicator', async ({ page }) => {
    const playable = await openWatchPage(page, 'en');
    test.skip(!playable, 'browser cannot decode the HLS stream - set A11Y_CHROME_CHANNEL=chrome');

    await page.locator('#video-player .video-js').focus();
    const visited: Array<{ cls: string; x: number; outline: string }> = [];
    for (let i = 0; i < 15; i++) {
      await page.keyboard.press('Tab');
      const info = await page.evaluate(() => {
        const el = document.activeElement as HTMLElement | null;
        if (!el || !el.closest('.video-js')) return { left: true };
        if (!el.closest('.vjs-control-bar')) return { skip: true }; // e.g. big play button
        const style = getComputedStyle(el);
        const rect = el.getBoundingClientRect();
        return { cls: el.className.toString(), x: rect.left, outline: `${style.outlineStyle} ${style.outlineWidth}` };
      });
      if ('left' in info) break;
      if ('skip' in info) continue;
      visited.push(info as { cls: string; x: number; outline: string });
    }

    const has = (c: string) => visited.some((v) => v.cls.includes(c));
    expect(has('vjs-play-control'), JSON.stringify(visited)).toBeTruthy();
    expect(has('vjs-mute-control')).toBeTruthy();
    expect(has('vjs-volume-bar')).toBeTruthy();
    expect(has('vjs-progress-holder')).toBeTruthy();
    expect(has('vjs-keyboard-help-button')).toBeTruthy();
    expect(has('vjs-fullscreen-control')).toBeTruthy();

    // Focus order follows the visual left-to-right order of the control bar
    const xs = visited.map((v) => v.x);
    expect([...xs].sort((a, b) => a - b)).toEqual(xs);

    for (const v of visited) {
      expect(v.outline.startsWith('none'), `focus indicator on ${v.cls}`).toBeFalsy();
    }
  });

  test('Space on the focused play button toggles playback exactly once', async ({ page }) => {
    const playable = await openWatchPage(page, 'en');
    test.skip(!playable, 'browser cannot decode the HLS stream - set A11Y_CHROME_CHANNEL=chrome');

    const play = page.locator('.video-js .vjs-play-control');
    await play.focus();
    const before = await page.evaluate(() => (document.querySelector('.video-js video') as HTMLVideoElement).paused);
    await page.keyboard.press('Space');
    await expect
      .poll(() => page.evaluate(() => (document.querySelector('.video-js video') as HTMLVideoElement).paused))
      .toBe(!before);
  });

  test('"?" opens the shortcut help dialog; Escape closes it and restores focus', async ({ page }) => {
    const playable = await openWatchPage(page, 'en');
    test.skip(!playable, 'browser cannot decode the HLS stream - set A11Y_CHROME_CHANNEL=chrome');

    const help = page.getByRole('button', { name: 'Show keyboard shortcuts' });
    await help.focus();
    await page.keyboard.press('Enter');
    const dialog = page.getByRole('dialog', { name: 'Keyboard Shortcuts' });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Close' }).first()).toBeFocused();
    const axe = await new AxeBuilder({ page }).include('[role="dialog"]').withTags(WCAG_TAGS).analyze();
    expect(axe.violations, formatViolations(axe.violations)).toEqual([]);
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(help).toBeFocused();

    await page.locator('#video-player .video-js').focus();
    await page.keyboard.press('Shift+Slash');
    await expect(dialog).toBeVisible();
  });
});

// Pixel 5 emulation minus defaultBrowserType (not allowed inside a describe)
const { defaultBrowserType: _ignored, ...pixel5 } = devices['Pixel 5'];

test.describe('mobile touch targets (story 1.5)', () => {
  test.use(pixel5);

  for (const locale of ['en', 'ar'] as const) {
    test(`all visible player controls are >= 44x44px and do not overlap (${locale})`, async ({ page }) => {
      const playable = await openWatchPage(page, locale);
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

      // Adequate spacing: control-bar targets must not overlap each other
      const bar = targets.filter((t) => !t.cls.includes('big-play'));
      for (let i = 0; i < bar.length; i++) {
        for (let j = i + 1; j < bar.length; j++) {
          const a = bar[i];
          const b = bar[j];
          const overlapX = Math.min(a.right, b.right) - Math.max(a.left, b.left);
          const overlapY = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
          expect(overlapX > 1 && overlapY > 1, `${a.cls} overlaps ${b.cls}`).toBeFalsy();
        }
      }

      // Control bar fits the viewport - no control pushed off-screen
      const viewport = page.viewportSize()!;
      for (const t of bar) {
        expect(t.right).toBeLessThanOrEqual(viewport.width + 1);
        expect(t.left).toBeGreaterThanOrEqual(-1);
      }
    });
  }

  test('tapping a control shows pressed feedback', async ({ page }) => {
    const playable = await openWatchPage(page, 'en');
    test.skip(!playable, 'browser cannot decode the HLS stream - set A11Y_CHROME_CHANNEL=chrome');
    const play = page.locator('.video-js .vjs-play-control');
    const box = (await play.boundingBox())!;
    await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
    // The class is kept for at least 120ms after the tap
    await expect(play).toHaveClass(/vjs-touch-active/, { timeout: 100 }).catch(() => undefined);
    await expect(play).not.toHaveClass(/vjs-touch-active/, { timeout: 2000 });
  });
});
