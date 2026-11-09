/**
 * Review screenshots of each state, attached to the report (and written to PLAYER_SHOTS_DIR when
 * set) so the owner and reviewers can look at every browser side by side.
 */
import { test, type Page, type TestInfo } from '@playwright/test';
import path from 'path';
import { openHarness, pauseAt, startPlayback } from './harness';

async function shot(page: Page, info: TestInfo, name: string, target = page.locator('.video-js.vjs-fanous').first()) {
  const file = `${info.project.name}-${name}.png`;
  const body = await target.screenshot({ animations: 'disabled' });
  await info.attach(name, { body, contentType: 'image/png' });
  if (process.env.PLAYER_SHOTS_DIR) {
    const fs = await import('fs');
    fs.mkdirSync(process.env.PLAYER_SHOTS_DIR, { recursive: true });
    fs.writeFileSync(path.join(process.env.PLAYER_SHOTS_DIR, file), body);
  }
}

test.describe('review screenshots', () => {
  test('bright frame: idle, playing bar, settings root and quality', async ({ page }, info) => {
    const player = await openHarness(page, { src: 'bright' });
    await shot(page, info, 'bright-idle');
    await startPlayback(page, player);
    await pauseAt(page, player, 20);
    await shot(page, info, 'bright-bar');
    await player.locator('.vjs-fanous-settings').click();
    await page.getByTestId('player-settings-menu').waitFor();
    await page.waitForTimeout(300);
    await shot(page, info, 'bright-settings');
    // Safari plays HLS natively and has no Quality row
    if (await page.locator('[data-row="quality"]').count()) {
      await page.locator('[data-row="quality"]').click();
      await page.waitForTimeout(300);
      await shot(page, info, 'bright-quality');
      await page.locator('.vjs-fanous-mi-back').click();
    }
    await page.locator('[data-row="captions"]').click();
    await page.waitForTimeout(300);
    await shot(page, info, 'bright-captions');
  });

  test('dark frame bar and hover', async ({ page }, info) => {
    const player = await openHarness(page, { src: 'dark' });
    await startPlayback(page, player);
    await pauseAt(page, player, 10);
    await player.locator('.vjs-play-control').hover();
    await page.waitForTimeout(200);
    await shot(page, info, 'dark-hover-play');
    await player.locator('.vjs-progress-control').hover();
    await page.waitForTimeout(200);
    await shot(page, info, 'dark-hover-progress');
  });

  test('arabic settings and small player', async ({ page }, info) => {
    const player = await openHarness(page, { src: 'bright', lang: 'ar', width: 360 });
    await startPlayback(page, player);
    await pauseAt(page, player, 5);
    await player.locator('.vjs-fanous-settings').click();
    await page.waitForTimeout(300);
    await shot(page, info, 'ar-small-settings');
    await page.locator('[data-row="speed"]').click();
    await page.waitForTimeout(300);
    await shot(page, info, 'ar-small-speed');
  });

  test('end screen and start over', async ({ page }, info) => {
    const player = await openHarness(page, { src: 'bright', resumeAt: 40 });
    await shot(page, info, 'resume-idle');
    await startPlayback(page, player);
    await shot(page, info, 'resume-playing');
    await page.evaluate(() => { const v = document.querySelector<HTMLVideoElement>('.video-js video')!; v.currentTime = v.duration - 0.3; });
    await page.getByTestId('player-end-screen').waitFor({ timeout: 20_000 });
    await shot(page, info, 'end-screen');
  });
});
