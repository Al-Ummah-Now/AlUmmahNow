import { AxeBuilder } from '@axe-core/playwright';
/**
 * Quran Foundation's short credit in the player (QF 2026-11-23; docs/specs/VIDEO-PLAYER.md
 * "In-player links"; wiki AUN-PLAYER-LINKS phase 0). Served cues with QF text end with the credit
 * line; the web player takes it off the cue and shows it as a link directly under the cue, at the
 * cue's end side, only while such a cue is on screen, and in the captions menu.
 */
import { expect, type Locator, type Page } from '@playwright/test';
import { animationsDone, layoutBox, mediaState, openHarness, pauseAt, startPlayback, test } from './harness';

// What GET /subtitles/:lang serves: a speech cue, a Quran cue with the credit line, a speech cue
const EN = `WEBVTT

1
00:00:00.000 --> 00:00:10.000
Peace be upon you, and welcome.

2
00:00:10.000 --> 00:00:40.000
“Say, He is Allah, [who is] One,” (Saheeh International · Al-Ikhlas 112:1)
Source: Quran Foundation

3
00:00:40.000 --> 00:01:30.000
That is all for today.
`;
const AR = `WEBVTT

1
00:00:00.000 --> 00:00:10.000
‏السلام عليكم ومرحبا بكم.

2
00:00:10.000 --> 00:00:40.000
‏﴿قُلْ هُوَ ٱللَّهُ أَحَدٌ﴾ (الإخلاص ١١٢:١)
‏المصدر: مؤسسة القرآن

3
00:00:40.000 --> 00:01:30.000
‏هذا كل شيء لليوم.
`;

/** Shows caption track `row` (0 English, 1 Arabic) from the captions panel and closes the menu. */
async function showTrack(page: Page, player: Locator, row: '0' | '1'): Promise<void> {
  await player.locator('.vjs-fanous-settings').click();
  const menu = page.getByTestId('player-settings-menu');
  await menu.locator('[data-row="captions"]').click();
  await menu.locator(`[data-row="${row}"]`).click();
  await page.keyboard.press('Escape');
  await expect(menu).toHaveCount(0);
}

const credit = (page: Page) => page.getByTestId('player-quran-credit');
const cueBox = (player: Locator) => player.locator('.vjs-text-track-display .vjs-text-track-cue > div').last();

for (const lang of ['en', 'ar'] as const) {
  for (const [track, row, label, name] of [
    ['en', '0', 'Source: Quran Foundation', 'Source: Quran Foundation (opens in a new tab)'],
    ['ar', '1', 'المصدر: مؤسسة القرآن', 'المصدر: مؤسسة القرآن (يفتح في علامة تبويب جديدة)'],
  ] as const) {
    test(`${lang} page, ${track} track: the linked credit shows under the Quran cue only`, async ({ page }) => {
      const player = await openHarness(page, { lang, captions: { en: EN, ar: AR } });
      await startPlayback(page, player);
      await pauseAt(page, player, 5);
      await showTrack(page, player, row);
      await pauseAt(page, player, 5);
      await expect(cueBox(player)).toBeVisible();
      await expect(credit(page)).toHaveCount(0);

      await pauseAt(page, player, 20);
      const link = credit(page);
      await expect(link).toBeVisible();
      await expect(link).toHaveText(label);
      await expect(link).toHaveAccessibleName(name);
      await expect(link).toHaveAttribute('href', 'https://quran.foundation/');
      await expect(link).toHaveAttribute('target', '_blank');
      await expect(link).toHaveAttribute('rel', 'noopener');
      // The caption itself no longer carries the credit line
      await expect(player.locator('.vjs-text-track-display')).not.toContainText(label);

      // Directly under the cue, at the cue's end side (the cue's direction, not the page's), clear of the bar
      // The caption band's 200 ms move is a transition on the band and the credit (the whole player has
      // never-ending animations on WebKit, e.g. the spinner): wait for those two
      await animationsDone(player.locator('.vjs-text-track-display'));
      await animationsDone(link.locator('..'));
      const cue = await layoutBox(cueBox(player));
      const box = await layoutBox(link);
      const bar = await layoutBox(player.locator('.vjs-progress-holder'));
      expect(box.y).toBeGreaterThanOrEqual(cue.bottom - 1);
      expect(box.y - cue.bottom).toBeLessThan(12);
      if (track === 'ar') expect(Math.abs(box.x - cue.x)).toBeLessThanOrEqual(2);
      else expect(Math.abs(box.right - cue.right)).toBeLessThanOrEqual(2);
      // Above the progress bar (the control bar's box starts higher, under its gradient)
      expect(box.bottom).toBeLessThanOrEqual(bar.y);

      const { violations } = await new AxeBuilder({ page })
        .include('.video-js')
        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
        .analyze();
      expect(violations).toEqual([]);

      await pauseAt(page, player, 45);
      await expect(credit(page)).toHaveCount(0);
    });
  }

  test(`${lang}: the credit opens Quran Foundation in a new tab and the video carries on`, async ({ page, context }) => {
    await context.route('https://quran.foundation/**', (route) => route.fulfill({ status: 200, contentType: 'text/html', body: '<title>Quran Foundation</title>' }));
    const player = await openHarness(page, { lang, captions: { en: EN, ar: AR } });
    await startPlayback(page, player);
    await pauseAt(page, player, 5);
    await showTrack(page, player, '0');
    await pauseAt(page, player, 20);
    const before = await mediaState(page);
    const [popup] = await Promise.all([page.waitForEvent('popup'), credit(page).click()]);
    await expect(popup).toHaveURL('https://quran.foundation/');
    await popup.close();
    const after = await mediaState(page);
    // Never paused, played or sought by the click
    expect(after.paused).toBe(before.paused);
    expect(Math.abs(after.currentTime - before.currentTime)).toBeLessThan(0.5);
  });

  test(`${lang}: reachable by keyboard, and listed in the captions menu while the track has Quran text`, async ({ page, browserName }) => {
    const player = await openHarness(page, { lang, captions: { en: EN, ar: AR } });
    await startPlayback(page, player);
    await pauseAt(page, player, 5);
    await showTrack(page, player, '1');
    await pauseAt(page, player, 20);
    // On macOS, WebKit uses Option+Tab for links when full keyboard navigation is disabled.
    const tab = browserName === 'webkit' && process.platform === 'darwin' ? 'Alt+Tab' : 'Tab';
    // Tab from the video element reaches the credit before leaving the player
    await page.locator('.video-js video').focus();
    let reached = false;
    for (let i = 0; i < 25 && !reached; i++) {
      await page.keyboard.press(tab);
      reached = await credit(page).evaluate((el) => el === document.activeElement).catch(() => false);
    }
    expect(reached).toBe(true);

    await player.locator('.vjs-fanous-settings').click();
    const menu = page.getByTestId('player-settings-menu');
    await menu.locator('[data-row="captions"]').click();
    await animationsDone(menu);
    const row = menu.getByTestId('player-menu-quran-credit');
    await expect(row).toBeVisible();
    await expect(row).toHaveAttribute('href', 'https://quran.foundation/');
    await expect(row).toHaveAttribute('target', '_blank');
  });
}

for (const lang of ['en', 'ar'] as const) {
  test(`${lang}: after the credit and hidden controls, a speech cue still clears the controls when they wake`, async ({ page }) => {
    const player = await openHarness(page, { lang, captions: { en: EN, ar: AR } });
    await startPlayback(page, player);
    await pauseAt(page, player, 5);
    await showTrack(page, player, lang === 'ar' ? '1' : '0');
    // Playing on the Quran cue with the controls hidden (the credit row is up)
    await page.evaluate(() => { const v = document.querySelector('video')!; v.currentTime = 15; void v.play(); });
    await expect(credit(page)).toBeVisible();
    await page.evaluate(() => (document.querySelector('.video-js') as unknown as { player?: { userActive(v: boolean): void } }).player?.userActive(false));
    await expect(player).toHaveClass(/vjs-user-inactive/);
    // The caption box has finished moving down with the controls
    await page.waitForTimeout(300);
    await animationsDone(player.locator('.vjs-text-track-display'));
    // Pause on a speech cue: the controls wake, the credit row goes, the caption box moves up
    await pauseAt(page, player, 5);
    await expect(credit(page)).toHaveCount(0);
    await animationsDone(player.locator('.vjs-text-track-display'));
    await expect.poll(async () => {
      const cue = await layoutBox(cueBox(player));
      const bar = await layoutBox(player.locator('.vjs-progress-holder'));
      return cue.bottom <= bar.y;
    }, { message: 'the speech cue never sits over the progress bar' }).toBe(true);
  });
}

test('a 320px-wide player: the credit stays clear of the control bar and inside the frame', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 740 });
  const player = await openHarness(page, { lang: 'ar', width: 320, captions: { en: EN, ar: AR } });
  await startPlayback(page, player);
  await pauseAt(page, player, 5);
  await showTrack(page, player, '1');
  await pauseAt(page, player, 20);
  await expect(credit(page)).toBeVisible();
  await animationsDone(credit(page).locator('..'));
  const box = await layoutBox(credit(page));
  const bar = await layoutBox(player.locator('.vjs-progress-holder'));
  const frame = await layoutBox(player);
  expect(box.bottom).toBeLessThanOrEqual(bar.y);
  expect(box.x).toBeGreaterThanOrEqual(frame.x);
  expect(box.right).toBeLessThanOrEqual(frame.right);
});
