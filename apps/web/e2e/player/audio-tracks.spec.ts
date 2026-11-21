/**
 * The player's Audio menu (wiki AUN-MULTI-AUDIO §Player) on the harness's audio fixture: a demuxed
 * package written like apps/media writes one (video-only rung, the original's audio, an English dub;
 * master from container/audio.mjs packageMaster), with the API's track list.
 * - The first track follows the site's language: the dub on /en, the original on /ar.
 * - The menu lists "label • kind" radio items, each with its language, the current one checked.
 * - Picking a track loads its audio rendition while playback goes on, and the choice is kept for
 *   the next video (a reload here).
 * - Keyboard: arrows move, Enter picks, Escape closes.
 * PLAYER_SHOTS_DIR=<dir> saves screenshots of the open menu (desktop and phone, en and ar).
 */
import fs from 'fs';
import path from 'path';
import { expect, test, type Locator, type Page, type TestInfo } from '@playwright/test';
import { openHarness, pauseAt, startPlayback } from './harness';

const SHOTS = process.env.PLAYER_SHOTS_DIR;
const DUB = 'tdub00000001';
/** Players that stream through VHS rather than the browser's own HLS */
const VHS = (info: TestInfo) => !/webkit/.test(info.project.name);

/** The language of the audio track video.js has enabled (the player's own state, in both VHS and native HLS). */
const enabledLanguage = (page: Page) =>
  page.evaluate(() => {
    const el = document.querySelector('.video-js') as (HTMLElement & { player?: { audioTracks(): ArrayLike<{ enabled: boolean; language: string }> } }) | null;
    const tracks = el?.player?.audioTracks();
    return tracks ? Array.from(tracks).find((t) => t.enabled)?.language ?? null : null;
  });

/**
 * Audio rendition files (playlist, init, segments) the page asked for, in order: orig or the dub's
 * id. VHS (Chromium, Firefox) fetches only the rendition it plays; Safari's native HLS reads every
 * rendition's playlist up front, so there only the enabled track says which one plays.
 */
function audioRequests(page: Page): string[] {
  const seen: string[] = [];
  page.on('request', (r) => {
    const m = /\/__player-fixtures\/audio\/a\/(orig|t[a-z0-9]+)\//.exec(r.url());
    if (m) seen.push(m[1]!);
  });
  return seen;
}

async function openAudioMenu(page: Page, player: Locator): Promise<Locator> {
  await player.locator('.vjs-fanous-settings').click();
  const menu = page.getByTestId('player-settings-menu');
  await expect(menu).toBeVisible();
  await menu.locator('[data-row="audio"]').click();
  await expect(menu).toHaveAttribute('data-panel', 'audio');
  return menu;
}

/** The computed direction of each option's label row. */
const labelDirections = (options: Locator) => options.locator('.vjs-fanous-mi-label').evaluateAll((els) => els.map((el) => getComputedStyle(el).direction));

async function shot(page: Page, player: Locator, name: string) {
  if (!SHOTS) return;
  fs.mkdirSync(SHOTS, { recursive: true });
  await page.evaluate(() => window.scrollTo(0, 0));
  const box = (await player.boundingBox())!;
  await page.screenshot({ path: path.join(SHOTS, `${name}.png`), clip: { x: 0, y: 0, width: page.viewportSize()!.width, height: Math.ceil(box.y + box.height + 16) } });
}

test.describe('Audio menu', () => {
  test('en: the dub plays first, the menu names both tracks, and the original can be picked and is kept', async ({ page }, info) => {
    const requested = audioRequests(page);
    const player = await openHarness(page, { lang: 'en', src: 'audio' });
    await startPlayback(page, player);
    await expect.poll(() => enabledLanguage(page), { message: 'the English dub plays first on /en' }).toBe('en');
    if (VHS(info)) await expect.poll(() => requested, { message: 'and its rendition is the one fetched' }).toContain(DUB);

    await pauseAt(page, player, 3);
    const menu = await openAudioMenu(page, player);
    const options = menu.getByRole('menuitemradio');
    await expect(options).toHaveCount(2);
    await expect(options.nth(0)).toHaveText(/العربية • Original/);
    await expect(options.nth(0).locator('.vjs-fanous-mi-label bdi')).toHaveAttribute('lang', 'ar');
    await expect(options.nth(1)).toHaveText(/English • Dubbed/);
    await expect(options.nth(1).locator('.vjs-fanous-mi-label bdi')).toHaveAttribute('lang', 'en');
    // Only the track's name takes its own direction: the row keeps the page's (an Arabic name
    // must not flip "العربية • Original" into a right-aligned "Original • العربية")
    expect(await labelDirections(options)).toEqual(['ltr', 'ltr']);
    await expect(options.nth(1)).toHaveAttribute('aria-checked', 'true');
    await shot(page, player, `${info.project.name}-audio-menu-en`);

    const before = requested.length;
    await options.nth(0).click();
    await expect.poll(() => enabledLanguage(page), { message: 'picking the original switches to it' }).toBe('ar');
    // Playback goes on after the switch, on the original's audio
    await page.evaluate(() => document.querySelector<HTMLVideoElement>('.video-js video')!.play());
    if (VHS(info)) await expect.poll(() => requested.slice(before), { message: 'and fetches its audio' }).toContain('orig');
    const t0 = await page.evaluate(() => document.querySelector<HTMLVideoElement>('.video-js video')!.currentTime);
    await expect.poll(() => page.evaluate(() => document.querySelector<HTMLVideoElement>('.video-js video')!.currentTime)).toBeGreaterThan(t0 + 0.3);

    // The choice is kept: the next load starts on the original although the site is English
    const again = audioRequests(page);
    const reloaded = await openHarness(page, { lang: 'en', src: 'audio' });
    await startPlayback(page, reloaded);
    await expect.poll(() => enabledLanguage(page), { message: 'the saved choice wins over the site language' }).toBe('ar');
    if (VHS(info)) expect(again).not.toContain(DUB);
  });

  test('ar: the original plays first; the menu is right to left and works from the keyboard', async ({ page }, info) => {
    const requested = audioRequests(page);
    const player = await openHarness(page, { lang: 'ar', src: 'audio' });
    await startPlayback(page, player);
    await pauseAt(page, player, 3);
    expect(await enabledLanguage(page), 'the original plays first on /ar').toBe('ar');
    if (VHS(info)) expect(requested, 'the dub never loads on /ar until chosen').not.toContain(DUB);

    // Keyboard: open the menu, move to Audio, open it, pick the dub
    await player.locator('.vjs-fanous-settings').focus();
    await page.keyboard.press('Enter');
    const menu = page.getByTestId('player-settings-menu');
    await expect(menu).toBeVisible();
    await expect(menu).toHaveAttribute('dir', 'rtl');
    const audioRow = menu.locator('[data-row="audio"]');
    for (let i = 0; i < 8 && !(await audioRow.evaluate((el) => el === document.activeElement)); i++) await page.keyboard.press('ArrowDown');
    await expect(audioRow).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(menu).toHaveAttribute('data-panel', 'audio');
    const options = menu.getByRole('menuitemradio');
    await expect(options.nth(0)).toHaveAttribute('aria-checked', 'true');
    // Arabic joins a meta line with «،», never a dot that reads as «٠» (lib/i18n/meta-separator.ts)
    await expect(options.nth(1)).toHaveText(/English، مدبلج/);
    expect(await labelDirections(options)).toEqual(['rtl', 'rtl']);
    await shot(page, player, `${info.project.name}-audio-menu-ar`);
    const dub = options.nth(1);
    for (let i = 0; i < 4 && !(await dub.evaluate((el) => el === document.activeElement)); i++) await page.keyboard.press('ArrowDown');
    await expect(dub).toBeFocused();
    const before = requested.length;
    await page.keyboard.press('Enter');
    await expect.poll(() => enabledLanguage(page), { message: 'Enter on the dub switches to it' }).toBe('en');
    if (VHS(info)) await expect.poll(() => requested.slice(before), { message: 'and fetches its audio' }).toContain(DUB);
    if (await menu.isVisible()) await page.keyboard.press('Escape');
    await expect(menu).toBeHidden();
  });

  test('phone (390px): the open Audio menu fits the small player', async ({ page }, info) => {
    test.skip(!SHOTS, 'screenshots only (the small panel layout is covered by settings-small.spec.ts)');
    await page.setViewportSize({ width: 390, height: 844 });
    for (const lang of ['en', 'ar'] as const) {
      const player = await openHarness(page, { lang, src: 'audio', width: 358 });
      await startPlayback(page, player);
      await pauseAt(page, player, 3);
      await openAudioMenu(page, player);
      await shot(page, player, `${info.project.name}-audio-menu-phone-${lang}`);
    }
  });
});
