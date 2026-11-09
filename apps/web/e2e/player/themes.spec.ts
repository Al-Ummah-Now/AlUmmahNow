/**
 * The player in each of the four themes (docs/specs/VIDEO-PLAYER.md section 6).
 *
 * A build ships one theme; the harness lays each theme's generated player CSS over the built one,
 * so one server covers all four. For each theme: the player computes that theme's tokens, the bar
 * keeps its time readable and its icons visible over the bright fixture (the hardest frame for a
 * dark bar), and every state is captured for review. The geometry suites run per theme too, with
 * PLAYER_THEME set.
 */
import fs from 'fs';
import path from 'path';
import { expect, test, type Locator, type Page, type TestInfo } from '@playwright/test';
import { contrast, openHarness, pauseAt, pixels, PLAYER_THEMES, rect, startPlayback } from './harness';

const THEMES_DIR = path.resolve(__dirname, '../../../../packages/fanous-tokens/themes');
const tokensOf = (theme: string): Record<string, string> => JSON.parse(fs.readFileSync(path.join(THEMES_DIR, theme, 'player.json'), 'utf8')).player;

/** Same value however the browser spaces or quotes it */
const norm = (v: string) => v.replace(/\s+/g, '').replace(/"/g, "'").toLowerCase();

async function shot(page: Page, info: TestInfo, theme: string, name: string, target?: Locator) {
  const body = target ? await target.screenshot({ animations: 'disabled' }) : await page.screenshot({ animations: 'disabled' });
  await info.attach(`${theme}-${name}`, { body, contentType: 'image/png' });
  if (process.env.PLAYER_SHOTS_DIR) {
    const dir = path.join(process.env.PLAYER_SHOTS_DIR, 'themes');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, `${info.project.name}-${theme}-${name}.png`), body);
  }
}

const rgb = (css: string): [number, number, number] => {
  const m = css.match(/[\d.]+/g);
  if (!m || m.length < 3) throw new Error(`not a colour: ${css}`);
  return [Number(m[0]), Number(m[1]), Number(m[2])];
};

/**
 * The contrast of a target's colour against what is painted behind it: the target is hidden, its box
 * captured, and the worst 5% of those pixels decide (a pixel or two of the grid's lines does not).
 */
async function contrastBehind(page: Page, target: Locator): Promise<number> {
  const colour = rgb(await target.evaluate((el) => getComputedStyle(el).color));
  const r = await rect(target);
  const el = await target.elementHandle();
  if (!el) throw new Error('contrastBehind: target not found');
  await el.evaluate((node) => { (node as HTMLElement).style.setProperty('visibility', 'hidden', 'important'); });
  await page.evaluate(() => new Promise((res) => requestAnimationFrame(() => requestAnimationFrame(res))));
  const behind = await pixels(page, { x: r.x, y: r.y, width: r.width, height: r.height });
  await el.evaluate((node) => { (node as HTMLElement).style.removeProperty('visibility'); });
  await el.dispose();
  const ratios: number[] = [];
  for (let i = 0; i < behind.rgba.length; i += 4) ratios.push(contrast(colour, [behind.rgba[i], behind.rgba[i + 1], behind.rgba[i + 2]]));
  ratios.sort((a, b) => a - b);
  return ratios[Math.floor(ratios.length * 0.05)];
}

for (const theme of PLAYER_THEMES) {
  test.describe(`${theme} theme`, () => {
    const tokens = tokensOf(theme);

    test('the player computes the theme\'s tokens', async ({ page }) => {
      const player = await openHarness(page, { theme });
      const computed = await player.evaluate((el, names) => {
        const cs = getComputedStyle(el);
        return Object.fromEntries(names.map((n) => [n, cs.getPropertyValue(`--fanous-player-${n}`).trim()]));
      }, Object.keys(tokens));
      for (const [name, value] of Object.entries(tokens)) expect(norm(computed[name]), name).toBe(norm(value));
    });

    test('over a bright frame the time reads and the icons show', async ({ page }) => {
      const player = await openHarness(page, { theme, src: 'bright' });
      await startPlayback(page, player);
      await pauseAt(page, player, 20);
      await page.mouse.move(2, 2);
      await player.evaluate((el) => el.classList.add('vjs-user-active'));
      for (const sel of ['.vjs-current-time-display', '.vjs-duration-display']) {
        expect(await contrastBehind(page, player.locator(sel)), `${sel} text`).toBeGreaterThanOrEqual(4.5);
      }
      for (const sel of ['.vjs-play-control', '.vjs-fanous-settings', '.vjs-fullscreen-control']) {
        const icon = player.locator(`${sel} svg`).first();
        expect(await contrastBehind(page, icon), `${sel} icon`).toBeGreaterThanOrEqual(3);
      }
    });

    test('review screenshots: bar, menus, tooltip, shortcuts, end screen, small Arabic player', async ({ page }, info) => {
      test.setTimeout(120_000);
      const player = await openHarness(page, { theme, src: 'bright' });
      await shot(page, info, theme, 'idle', player);
      await startPlayback(page, player);
      await pauseAt(page, player, 20);
      await page.mouse.move(2, 2);
      await player.evaluate((el) => el.classList.add('vjs-user-active'));
      await shot(page, info, theme, 'bar', player);

      await player.locator('.vjs-fanous-settings').click();
      const menu = page.getByTestId('player-settings-menu');
      await expect(menu).toBeVisible();
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.waitForTimeout(350);
      await shot(page, info, theme, 'settings', player);
      await menu.locator('[data-row="speed"]').click();
      await page.waitForTimeout(350);
      await shot(page, info, theme, 'speed', player);
      // Escape steps back from a submenu, then closes
      await page.keyboard.press('Escape');
      await page.keyboard.press('Escape');
      await expect(menu).toBeHidden();

      const holder = await rect(player.locator('.vjs-progress-holder'));
      await page.mouse.move(holder.x + holder.width * 0.45, holder.y + holder.height / 2);
      await expect(page.getByTestId('player-progress-tooltip')).toBeVisible();
      await shot(page, info, theme, 'tooltip');

      await page.mouse.move(2, 2);
      await player.locator('.vjs-tech').focus().catch(() => undefined);
      await page.keyboard.press('Shift+Slash');
      await expect(page.getByTestId('player-shortcuts-dialog')).toBeVisible();
      await shot(page, info, theme, 'shortcuts');
      await page.keyboard.press('Escape');

      await page.evaluate(() => {
        const v = document.querySelector<HTMLVideoElement>('.video-js video')!;
        v.currentTime = v.duration - 0.4;
        return v.play().catch(() => undefined);
      });
      await expect(page.getByTestId('player-end-screen')).toBeVisible({ timeout: 20_000 });
      await page.getByTestId('player-next-thumb').hover();
      await page.waitForTimeout(300);
      await shot(page, info, theme, 'end-screen', player);

      const small = await openHarness(page, { theme, src: 'dark', lang: 'ar', width: 360 });
      await startPlayback(page, small);
      await pauseAt(page, small, 10);
      await small.locator('.vjs-fanous-settings').click();
      await expect(page.getByTestId('player-settings-menu')).toBeVisible();
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.waitForTimeout(350);
      await shot(page, info, theme, 'small-ar-settings', small);
    });
  });
}
