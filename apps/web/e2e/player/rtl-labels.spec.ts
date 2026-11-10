/**
 * Labels fit their boxes in every theme's fonts, left to right and right to left, on a desktop and a
 * phone: the settings rows, the speed and quality options, and the progress bar's hover tooltip.
 *
 * Each theme sets its own Arabic and Latin fonts (theme/fonts.css): Noto Kufi Arabic and Amiri draw
 * a taller line than the system font, so a label in a 20px line box with `overflow: hidden` was cut
 * through the Arabic glyphs. Measured as the rendered text's box (a Range over the label) against the
 * label's own box, plus every row inside the panel and the panel inside the viewport.
 */
import fs from 'fs';
import path from 'path';
import { expect, test, type Page } from '@playwright/test';
import { openHarness, pauseAt, PLAYER_THEMES, startPlayback } from './harness';

const SIZES = [
  { name: 'desktop', width: 1440, height: 900 },
  { name: 'phone', width: 390, height: 844 },
] as const;

/** Sub-pixel rounding between a Range and its element */
const SLACK = 0.5;

interface Overflow { what: string; text: string; detail: string }

/** Every text box in the open settings panel and the tooltip that is drawn outside its own box */
async function overflows(page: Page): Promise<Overflow[]> {
  return page.evaluate((slack) => {
    const out: { what: string; text: string; detail: string }[] = [];
    const vw = document.documentElement.clientWidth;
    const menu = document.querySelector<HTMLElement>('[data-testid="player-settings-menu"]');
    const boxes = Array.from(document.querySelectorAll<HTMLElement>(
      '[data-testid="player-settings-menu"] .vjs-fanous-mi-label, [data-testid="player-settings-menu"] .vjs-fanous-mi-value, .vjs-fanous-tip > *',
    ));
    for (const el of boxes) {
      const box = el.getBoundingClientRect();
      const range = document.createRange();
      range.selectNodeContents(el);
      const text = range.getBoundingClientRect();
      const what = el.className;
      // Truncation by an ellipsis is intended: only a label that clips without one overflows sideways
      const ellipsis = getComputedStyle(el).textOverflow === 'ellipsis';
      if (text.top < box.top - slack || text.bottom > box.bottom + slack) {
        out.push({ what, text: el.textContent ?? '', detail: `text ${text.top.toFixed(1)}..${text.bottom.toFixed(1)} outside box ${box.top.toFixed(1)}..${box.bottom.toFixed(1)}` });
      }
      if (!ellipsis && el.scrollWidth > el.clientWidth + 1) {
        out.push({ what, text: el.textContent ?? '', detail: `scrollWidth ${el.scrollWidth} > ${el.clientWidth}` });
      }
    }
    if (menu) {
      const m = menu.getBoundingClientRect();
      if (m.left < -slack || m.right > vw + slack) out.push({ what: 'menu', text: '', detail: `menu ${m.left}..${m.right} outside viewport 0..${vw}` });
      if (menu.scrollWidth > menu.clientWidth + 1) out.push({ what: 'menu', text: '', detail: `menu scrolls sideways ${menu.scrollWidth} > ${menu.clientWidth}` });
      for (const row of Array.from(menu.querySelectorAll<HTMLElement>('.vjs-fanous-mi'))) {
        const r = row.getBoundingClientRect();
        if (r.left < m.left - slack || r.right > m.right + slack) out.push({ what: 'row', text: row.textContent ?? '', detail: `row ${r.left}..${r.right} outside menu ${m.left}..${m.right}` });
        for (const part of Array.from(row.children) as HTMLElement[]) {
          const p = part.getBoundingClientRect();
          if (p.width === 0) continue;
          if (p.left < r.left - slack || p.right > r.right + slack) out.push({ what: part.className, text: part.textContent ?? '', detail: `${p.left}..${p.right} outside row ${r.left}..${r.right}` });
        }
      }
    }
    return out;
  }, SLACK);
}

async function fontsReady(page: Page) {
  await page.evaluate(async () => {
    // Load the theme's faces for both scripts before anything is measured
    const family = getComputedStyle(document.body).fontFamily;
    await Promise.all([document.fonts.load(`14px ${family}`, 'الجودة Quality'), document.fonts.load(`600 14px ${family}`, 'الجودة Quality')]);
    await document.fonts.ready;
  });
}

for (const theme of PLAYER_THEMES) {
  for (const lang of ['ar', 'en'] as const) {
    for (const size of SIZES) {
      test(`${theme} ${lang} ${size.name}: settings and tooltip labels fit their boxes`, async ({ page }, info) => {
        await page.setViewportSize({ width: size.width, height: size.height });
        const player = await openHarness(page, {
          lang,
          theme,
          siteTheme: true,
          chapterTitles: lang === 'ar' ? ['الافتتاحية', 'في منتصف الطريق إلى الإجابة', 'الخاتمة'] : undefined,
        });
        await startPlayback(page, player);
        await pauseAt(page, player, 20);
        await fontsReady(page);

        // Progress tooltip over the second chapter
        const holder = await player.locator('.vjs-progress-holder').boundingBox();
        if (!holder) throw new Error('no progress bar');
        await page.mouse.move(holder.x + holder.width * 0.5, holder.y + holder.height / 2);
        await expect(page.locator('.vjs-fanous-tip')).toBeVisible();
        const check = async (where: string) => {
          // The panel slides each view in; measure where it comes to rest
          await page.evaluate(() => Promise.all(document.getAnimations()
            .filter((a) => Number.isFinite(Number(a.effect?.getComputedTiming().endTime)))
            .map((a) => a.finished.catch(() => undefined))));
          const found = await overflows(page);
          const body = await page.screenshot();
          await info.attach(`${theme}-${lang}-${size.name}-${where}`, { body, contentType: 'image/png' });
          if (process.env.PLAYER_SHOTS_DIR) {
            const dir = path.join(process.env.PLAYER_SHOTS_DIR, 'labels');
            fs.mkdirSync(dir, { recursive: true });
            fs.writeFileSync(path.join(dir, `${info.project.name}-${theme}-${lang}-${size.name}-${where}.png`), body);
          }
          expect.soft(found, `${where}: ${JSON.stringify(found, null, 1)}`).toEqual([]);
        };
        await check('tooltip');

        await page.mouse.move(2, 2);
        await player.hover({ position: { x: 20, y: 20 } });
        await player.locator('.vjs-fanous-settings').click();
        const menu = page.getByTestId('player-settings-menu');
        await expect(menu).toBeVisible();
        await check('settings');
        // "Auto (720p)": the bracketed Latin run lays out left to right in either page direction. Laid
        // out right to left, its brackets are mirrored, and Amiri and Firefox mirrored only one of
        // them ("(720p( تلقائي")
        const brackets = await menu.locator('[data-row="quality"] .vjs-fanous-mi-value').evaluateAll((els) => els.map((el) => {
          const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
          for (let node = walker.nextNode(); node; node = walker.nextNode()) {
            if (node.textContent?.includes('(')) return { text: el.textContent, direction: getComputedStyle(node.parentElement!).direction };
          }
          return null;
        }));
        for (const b of brackets) if (b) expect(b.direction, `"${b.text}" bracketed run direction`).toBe('ltr');
        for (const row of ['quality', 'speed', 'captions']) {
          const item = menu.locator(`[data-row="${row}"]`);
          if ((await item.count()) === 0) continue;
          await item.click();
          await expect(menu).toHaveAttribute('data-panel', row);
          await check(row);
          await menu.locator('[data-row="back"]').click();
          await expect(menu).toHaveAttribute('data-panel', 'root');
        }
      });
    }
  }
}
