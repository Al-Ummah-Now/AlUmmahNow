/**
 * Viewer caption download (docs/specs/TRANSCRIPTION-TRANSLATION.md): an admin switch, off by
 * default (owner decision 2026-11-22). Off, the captions panel has no Download row at all; on, it
 * offers the shown track's file from the API.
 */
import { expect, test, type Locator, type Page } from '@playwright/test';
import { animationsDone, openHarness, pauseAt, startPlayback } from './harness';

async function captionsPanelWithEnglishShown(page: Page, player: Locator): Promise<Locator> {
  // The control bar shows once playback has started
  await startPlayback(page, player);
  await pauseAt(page, player, 20);
  await player.locator('.vjs-fanous-settings').click();
  const menu = page.getByTestId('player-settings-menu');
  await expect(menu).toBeVisible();
  await menu.locator('[data-row="captions"]').click();
  await expect(menu).toHaveAttribute('data-panel', 'captions');
  // The first track is English (the harness's subtitles answer); choosing it goes back to the root
  await menu.locator('[data-row="0"]').click();
  await expect(menu).toHaveAttribute('data-panel', 'root');
  await menu.locator('[data-row="captions"]').click();
  await expect(menu).toHaveAttribute('data-panel', 'captions');
  await expect(menu.locator('[data-row="0"]')).toHaveAttribute('aria-checked', 'true');
  await animationsDone(menu);
  return menu;
}

for (const lang of ['en', 'ar'] as const) {
  test.describe(`caption download ${lang}`, () => {
    test('off (the default): the captions panel has no Download row', async ({ page }) => {
      const player = await openHarness(page, { lang });
      const menu = await captionsPanelWithEnglishShown(page, player);
      // The panel is fully drawn (its options are there) and still offers no download
      await expect(menu.locator('[data-row="0"]')).toBeVisible();
      await expect(menu.getByTestId('player-download-captions')).toHaveCount(0);
    });

    test('on: the captions panel offers the shown track\'s file', async ({ page }) => {
      const player = await openHarness(page, { lang, features: { viewerCaptionDownload: true } });
      const menu = await captionsPanelWithEnglishShown(page, player);
      const row = menu.getByTestId('player-download-captions');
      await expect(row).toBeVisible();
      await expect(row).toHaveAttribute('href', /\/api\/videos\/harness-bright\/subtitles\/en\/download$/);
    });
  });
}
