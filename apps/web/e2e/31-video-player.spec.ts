import { test, expect } from './fixtures';
import type { APIRequestContext, Page, TestInfo } from '@playwright/test';
import { AxeBuilder } from '@axe-core/playwright';
import { ANONYMOUS_STATE } from './test-utils/auth-state';
import {
  API_URL,
  canDecodeHls,
  keepControlsVisible,
  mediaState,
  qaLecture,
  qaLectures,
  startThenPause,
  waitForPlayer,
  watchUrl,
  type QaVideo,
} from './test-utils/watch-page';

/**
 * Video player on the watch page (Video.js + app controls).
 *
 * Every project asserts something real:
 * - Bundled Chromium (chromium, Mobile Chrome) cannot decode the QA H.264
 *   HLS streams, so there the player must show the app's localized,
 *   accessible format-error screen (PLAYER-002).
 * - WebKit (webkit, Mobile Safari) and branded Chrome play the stream, so
 *   the control tests (PLAYER-010+) run there; on bundled Chromium they are
 *   skipped with that environmental reason.
 * - PLAYER-001 forces an unplayable stream in every browser by routing the
 *   HLS playlist to a 404.
 */

test.use({ storageState: ANONYMOUS_STATE });

if (process.env.A11Y_CHROME_CHANNEL) {
  test.use({ channel: process.env.A11Y_CHROME_CHANNEL });
}

const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];
const NO_CODEC = 'bundled Chromium has no H.264 decoder for the HLS stream (covered by PLAYER-002); run with webkit or A11Y_CHROME_CHANNEL=chrome';

/**
 * Opens the watch page once the player is ready (media metadata loaded) and shows its bar:
 * the redesigned bar stays hidden until playback has started once, so this plays and pauses.
 */
async function openPlayable(page: Page, video: QaVideo, locale: 'en' | 'ar' = 'en') {
  await page.goto(watchUrl(video.id, locale));
  expect(await waitForPlayer(page)).toBe('playable');
  await startThenPause(page);
}

/** A seed lecture that has no subtitle tracks / chapters right now (QA data changes) */
async function lectureWithout(request: APIRequestContext, what: 'subtitles' | 'chapters'): Promise<QaVideo> {
  for (const video of await qaLectures(request)) {
    const res = await request.get(`${API_URL}/api/videos/${video.id}/${what}`);
    const body = (await res.json().catch(() => ({}))) as { data?: { tracks?: unknown[] }; success?: boolean; chapters?: { chapters?: unknown[] } };
    const count = what === 'subtitles'
      ? (body.data?.tracks ?? []).length
      : (body.success ? body.chapters?.chapters?.length ?? 0 : 0);
    if (res.ok() && count === 0) return video;
  }
  throw new Error(`every QA lecture has ${what}; cannot test the "none" state`);
}

function skipWithoutCodec(browserName: string, testInfo: TestInfo) {
  test.skip(!canDecodeHls(browserName, testInfo), NO_CODEC);
}

test.describe('player error screen', () => {
  for (const [locale, title] of [
    ['en', /error/i],
    ['ar', /خطأ/],
  ] as const) {
    test(`PLAYER-001 an unplayable stream shows the localized error screen (${locale}, all browsers)`, async ({ page, request }) => {
      const video = await qaLecture(request, 1);
      // Break the stream for this page only: the HLS playlist answers 404
      await page.route(/\.m3u8(\?.*)?$/, (route) => route.fulfill({ status: 404, body: 'gone' }));
      await page.goto(watchUrl(video.id, locale));

      const error = page.getByTestId('video-error');
      await expect(error).toBeVisible({ timeout: 45000 });
      await expect(error).toHaveAttribute('role', 'alert');
      await expect(error).toHaveAttribute('dir', locale === 'ar' ? 'rtl' : 'ltr');
      await expect(error.getByRole('heading', { level: 2 })).toHaveText(title);
      // The title / metrics stay usable below the error screen
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      const axe = await new AxeBuilder({ page }).include('[data-testid="video-error"]').withTags(WCAG_TAGS).analyze();
      expect(axe.violations.map((v) => v.id)).toEqual([]);
    });
  }

  test('PLAYER-002 without an H.264 decoder the format-error screen is shown and accessible (bundled Chromium)', async ({ page, request, browserName }, testInfo) => {
    test.skip(canDecodeHls(browserName, testInfo), 'this browser decodes the stream; the error path is covered by PLAYER-001');
    const video = await qaLecture(request, 1);
    await page.goto(watchUrl(video.id, 'en'));
    expect(await waitForPlayer(page)).toBe('error');

    const error = page.getByTestId('video-error');
    await expect(error).toBeVisible();
    await expect(error.getByRole('heading', { level: 2 })).toHaveText('Format Error');
    await expect(error).toContainText(/not supported by your browser/);
    // Nothing to fall back to: no dead "try another format" button, and a format error is not retryable
    await expect(error.getByRole('button', { name: /retry|try|browser|format/i })).toHaveCount(0);
    await expect(error).toBeVisible();
    const axe = await new AxeBuilder({ page }).include('#video-player').withTags(WCAG_TAGS).analyze();
    expect(axe.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)).toEqual([]);
  });
});

test.describe('player controls', () => {
  test('PLAYER-010 play/pause button toggles playback and its label', async ({ page, request, browserName }, testInfo) => {
    skipWithoutCodec(browserName, testInfo);
    await openPlayable(page, await qaLecture(request, 1));

    await page.evaluate(() => { (document.querySelector('.video-js video') as HTMLVideoElement).muted = true; });
    const play = page.locator('.video-js .vjs-play-control');
    await expect(play).toHaveAccessibleName(/^play video$/i);
    await play.click();
    await expect.poll(async () => (await mediaState(page)).paused).toBe(false);
    await keepControlsVisible(page);
    await expect(play).toHaveAccessibleName(/^pause video$/i);

    await play.click();
    await expect.poll(async () => (await mediaState(page)).paused).toBe(true);
    await expect(play).toHaveAccessibleName(/^play video$/i);
  });

  test('PLAYER-011 mute button and volume keys change the audio state', async ({ page, request, browserName, isMobile }, testInfo) => {
    skipWithoutCodec(browserName, testInfo);
    await openPlayable(page, await qaLecture(request, 1));

    const mute = page.locator('.video-js .vjs-mute-control');
    const startMuted = (await mediaState(page)).muted;
    await mute.click();
    await expect.poll(async () => (await mediaState(page)).muted).toBe(!startMuted);
    await keepControlsVisible(page);
    await expect(mute).toHaveAccessibleName(startMuted ? /^mute audio$/i : /^unmute audio$/i);
    await mute.click();
    await expect.poll(async () => (await mediaState(page)).muted).toBe(startMuted);

    // iOS ignores programmatic volume changes; the slider only exists on desktop
    test.skip(!!isMobile, 'mobile Safari/Chrome fix the media volume at 1');
    await page.locator('#video-player .video-js').focus();
    const before = (await mediaState(page)).volume;
    await page.keyboard.press('ArrowDown');
    await expect.poll(async () => (await mediaState(page)).volume).toBeLessThan(before);
    await expect(page.locator('.video-js .vjs-volume-bar')).toHaveAttribute('aria-valuenow', /\d+/);
  });

  test('PLAYER-012 progress bar and number keys seek within the video', async ({ page, request, browserName }, testInfo) => {
    skipWithoutCodec(browserName, testInfo);
    await openPlayable(page, await qaLecture(request, 1));

    const progress = page.locator('.video-js .vjs-progress-holder');
    await expect(progress).toHaveAttribute('role', 'slider');
    await expect.poll(async () => (await mediaState(page)).duration).toBeGreaterThan(10);

    await page.locator('#video-player .video-js').focus();
    await page.keyboard.press('5');
    await expect.poll(async () => {
      const s = await mediaState(page);
      return Math.round((s.currentTime / s.duration) * 100);
    }).toBeGreaterThanOrEqual(45);

    // Clicking near the start of the bar seeks back
    const box = (await progress.boundingBox())!;
    await keepControlsVisible(page);
    await page.mouse.click(box.x + box.width * 0.1, box.y + box.height / 2);
    await expect.poll(async () => {
      const s = await mediaState(page);
      return (s.currentTime / s.duration) * 100;
    }).toBeLessThan(30);
  });

  test('PLAYER-013 settings menu opens on click only, lists the renditions and selects one (no Quality row when the browser exposes none)', async ({ page, request, browserName }, testInfo) => {
    skipWithoutCodec(browserName, testInfo);
    await openPlayable(page, await qaLecture(request, 1));

    const gear = page.locator('.video-js .vjs-fanous-settings');
    const menu = page.getByTestId('player-settings-menu');
    const tech = page.locator('.video-js .vjs-tech');
    await expect(gear).toBeVisible();
    await expect(gear).toHaveAttribute('aria-haspopup', 'menu');

    // Hover never opens the menu
    await gear.hover();
    await expect(menu).toHaveCount(0);
    await expect(gear).toHaveAttribute('aria-expanded', 'false');

    // A click opens it with focus on the first row, and it stays open while the pointer moves over the video
    await gear.click();
    await expect(menu).toBeVisible();
    await expect(gear).toHaveAttribute('aria-expanded', 'true');
    await expect(menu.locator('[role="menuitem"]').first()).toBeFocused();
    const box = (await tech.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 3, { steps: 5 });
    await page.mouse.move(box.x + 20, box.y + 20, { steps: 5 });
    // The open menu holds the bar up: Video.js's inactivity timer never hides it
    await expect(page.locator('.video-js')).not.toHaveClass(/vjs-user-inactive/, { timeout: 3000 });
    await expect(menu).toBeVisible();
    await expect(page.locator('.video-js .vjs-control-bar')).toHaveCSS('opacity', '1');

    // A second click on the gear closes it; Escape closes it and returns focus to the gear
    await gear.click();
    await expect(menu).toHaveCount(0);
    await gear.click();
    await expect(menu).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(menu).toHaveCount(0);
    await expect(gear).toBeFocused();

    // A click on the video only dismisses the menu (playback state is unchanged)
    await gear.click();
    await expect(menu).toBeVisible();
    const pausedBefore = (await mediaState(page)).paused;
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 3);
    await expect(menu).toHaveCount(0);
    expect((await mediaState(page)).paused).toBe(pausedBefore);

    await keepControlsVisible(page);
    await gear.click();
    const qualityRow = menu.locator('[data-row="quality"]');
    if (browserName === 'webkit') {
      // Native HLS exposes no renditions: no empty Quality submenu is offered
      await expect(menu.locator('[data-row="speed"]')).toBeVisible();
      await expect(qualityRow).toHaveCount(0);
      return;
    }
    await qualityRow.click();
    const items = menu.locator('[role="menuitemradio"]');
    await expect(items.filter({ hasText: /auto/i })).toHaveCount(1);
    await expect.poll(() => items.count(), { message: 'Auto + at least one rendition' }).toBeGreaterThan(1);

    // The lowest rendition (240p on the QA/prod ladders), painted and receiving clicks
    const rendition = items.filter({ hasText: /\d+p/ }).last();
    await expect.poll(() => rendition.evaluate((el) => {
      const r = el.getBoundingClientRect();
      const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
      return r.height > 0 && !!hit && el.contains(hit);
    }), { message: 'quality option is painted and receives clicks' }).toBe(true);

    const label = (await rendition.innerText()).trim();
    const height = Number(label.match(/(\d+)p/)![1]);
    await rendition.click();
    // Choosing a rendition goes back to the root list, which shows it on the Quality row
    await expect(qualityRow).toBeVisible();
    await expect(qualityRow).toContainText(`${height}p`);
    await qualityRow.click();
    await expect(menu.locator(`[role="menuitemradio"][data-row="${height}"]`)).toHaveAttribute('aria-checked', 'true');
    await page.keyboard.press('Escape');
    // Switching really restricts playback to that rendition
    await expect.poll(() => page.evaluate((h) => {
      type Levels = { length: number; [i: number]: { height: number; enabled: boolean } };
      const player = (document.querySelector('.video-js') as HTMLElement & { player?: { qualityLevels: () => Levels } }).player;
      const levels = player?.qualityLevels();
      if (!levels) return false;
      return Array.from({ length: levels.length }, (_, i) => levels[i]).every((l) => l.enabled === (l.height === h));
    }, height)).toBe(true);
  });

  test('PLAYER-014 captions button is hidden without tracks; with a track it toggles captions and the settings menu lists it', async ({ page, request, browserName }, testInfo) => {
    skipWithoutCodec(browserName, testInfo);
    const video = await lectureWithout(request, 'subtitles');

    // No subtitle tracks: the button is hidden and the settings menu has no Captions row
    await openPlayable(page, video);
    const caps = page.locator('.video-js .vjs-control-bar > .vjs-fanous-captions');
    await expect(caps).toHaveClass(/vjs-hidden/);
    const menu = page.getByTestId('player-settings-menu');
    await page.locator('.video-js .vjs-fanous-settings').click();
    await expect(menu).toBeVisible();
    await expect(menu.locator('[data-row="captions"]')).toHaveCount(0);

    // With a track (served by the browser-side subtitles fetch) the menu offers it
    await page.route(`${API_URL}/api/videos/${video.id}/subtitles`, (route) =>
      route.fulfill({ json: { success: true, data: { tracks: [{ language: 'en', label: 'English', status: 'ready' }] } } }));
    await page.route(`${API_URL}/api/videos/${video.id}/subtitles/en`, (route) =>
      route.fulfill({ contentType: 'text/vtt', body: 'WEBVTT\n\n00:00.000 --> 00:30.000\nE2E caption line\n' }));
    await openPlayable(page, video);

    await expect(caps).not.toHaveClass(/vjs-hidden/);
    await expect(caps).toHaveAttribute('aria-pressed', /true|false/);
    const before = await caps.getAttribute('aria-pressed');
    await caps.click();
    await expect(caps).toHaveAttribute('aria-pressed', before === 'true' ? 'false' : 'true');

    await keepControlsVisible(page);
    await page.locator('.video-js .vjs-fanous-settings').click();
    const row = menu.locator('[data-row="captions"]');
    await expect(row).toBeVisible();
    await row.click();
    await expect(menu.locator('[role="menuitemradio"]').filter({ hasText: 'English' })).toHaveCount(1);
  });

  for (const [locale, title, close] of [
    ['en', 'Keyboard Shortcuts', 'Close'],
    ['ar', 'اختصارات لوحة المفاتيح', 'إغلاق'],
  ] as const) {
    test(`PLAYER-015 keyboard help dialog opens from the settings menu and closes with Escape (${locale})`, async ({ page, request, browserName }, testInfo) => {
      skipWithoutCodec(browserName, testInfo);
      // openPlayable has started and paused playback, so the bar and its settings button show
      await openPlayable(page, await qaLecture(request, 1), locale);

      // The redesigned bar has no shortcuts button: the help is the last row of the settings menu
      await page.locator('.video-js .vjs-fanous-settings').click();
      const menu = page.getByTestId('player-settings-menu');
      await expect(menu).toBeVisible();
      await menu.locator('[data-row="shortcuts"]').click();
      const dialog = page.getByRole('dialog', { name: title });
      await expect(dialog).toBeVisible();
      await expect(dialog.getByRole('button', { name: close }).first()).toBeVisible();
      await expect(dialog).toHaveAttribute('dir', locale === 'ar' ? 'rtl' : 'ltr');
      await page.keyboard.press('Escape');
      await expect(dialog).toBeHidden();
    });
  }

  test('PLAYER-016 fullscreen button is present, labelled and toggles fullscreen (desktop)', async ({ page, request, browserName, isMobile }, testInfo) => {
    skipWithoutCodec(browserName, testInfo);
    await openPlayable(page, await qaLecture(request, 1));

    const fullscreen = page.locator('.video-js .vjs-fullscreen-control');
    await expect(fullscreen).toBeVisible();
    await expect(fullscreen).toHaveAccessibleName(/^(enter )?full ?screen$/i);
    test.skip(!!isMobile, 'mobile Safari only allows native video fullscreen from a real user gesture');
    await fullscreen.click();
    await expect(page.locator('.video-js')).toHaveClass(/vjs-fullscreen/);
    await keepControlsVisible(page);
    await expect(fullscreen).toHaveAccessibleName(/exit/i);
    await fullscreen.click();
    await expect(page.locator('.video-js')).not.toHaveClass(/vjs-fullscreen/);
  });

  test('PLAYER-017 Arabic player translates the control labels', async ({ page, request, browserName }, testInfo) => {
    skipWithoutCodec(browserName, testInfo);
    await openPlayable(page, await qaLecture(request, 1), 'ar');

    await expect(page.locator('.video-js .vjs-play-control')).toHaveAccessibleName('تشغيل الفيديو');
    await expect(page.locator('.video-js .vjs-fullscreen-control')).toHaveAccessibleName(/ملء الشاشة/);
    await expect(page.locator('.video-js .vjs-mute-control')).toHaveAccessibleName(/كتم الصوت/);
    await expect(page.locator('.video-js .vjs-fanous-settings')).toHaveAccessibleName('الإعدادات');
  });
});

test.describe('player chapters', () => {
  const CHAPTERS = [
    { id: 'c1', startTime: 0, endTime: 0, title: 'E2E Intro', titleLocalized: { en: 'E2E Intro', ar: 'مقدمة' } },
    { id: 'c2', startTime: 20, endTime: 0, title: 'E2E Middle', titleLocalized: { en: 'E2E Middle', ar: 'المنتصف' } },
    { id: 'c3', startTime: 40, endTime: 0, title: 'E2E End', titleLocalized: { en: 'E2E End', ar: 'النهاية' } },
  ];

  async function mockChapters(page: Page, video: QaVideo) {
    // Chapters are fetched by the browser (GET /api/videos/:id/chapters, public)
    await page.route(`${API_URL}/api/videos/${video.id}/chapters`, (route) =>
      route.fulfill({
        json: { success: true, chapters: { chapters: CHAPTERS, source: 'manual', parsedAt: new Date().toISOString(), version: 1 } },
      }));
  }

  for (const [locale, show, middle] of [
    ['en', 'Show Chapters', 'E2E Middle'],
    ['ar', 'إظهار الفصول', 'المنتصف'],
  ] as const) {
    test(`PLAYER-020 chapter list and progress-bar markers seek to a chapter (${locale})`, async ({ page, request, browserName }, testInfo) => {
      skipWithoutCodec(browserName, testInfo);
      const video = await qaLecture(request, 1);
      await mockChapters(page, video);
      await openPlayable(page, video, locale);

      // One marker per chapter after 0:00, inside the real seek bar
      await expect(page.locator('.video-js .vjs-progress-holder .vjs-fanous-chapter-mark')).toHaveCount(2);

      const toggle = page.locator('button[aria-controls="video-chapter-list"]');
      await expect(toggle).toHaveAccessibleName(`${show} 3`);
      await toggle.click();
      await expect(toggle).toHaveAttribute('aria-expanded', 'true');
      const list = page.getByRole('navigation', { name: locale === 'en' ? 'Chapter List' : 'قائمة الفصول', exact: true });
      await expect(list).toBeVisible();
      await expect(list.locator('[data-chapter-item]')).toHaveCount(3);

      await list.locator('[data-chapter-item]').filter({ hasText: middle }).click();
      await expect(toggle).toHaveAccessibleName(locale === 'en' ? 'Hide Chapters' : /إخفاء/);
      await expect.poll(async () => Math.round((await mediaState(page)).currentTime)).toBeGreaterThanOrEqual(20);
    });
  }

  test('PLAYER-021 no chapter controls when the video has no chapters', async ({ page, request, browserName }, testInfo) => {
    skipWithoutCodec(browserName, testInfo);
    await openPlayable(page, await lectureWithout(request, 'chapters'));
    await expect(page.locator('button[aria-controls="video-chapter-list"]')).toHaveCount(0);
    await expect(page.locator('.video-js .vjs-progress-holder .vjs-fanous-chapter-mark')).toHaveCount(0);
  });
});
