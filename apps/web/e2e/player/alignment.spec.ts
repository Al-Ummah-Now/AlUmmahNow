/**
 * Alignment of every icon in its container, the handles on their tracks, the time display against
 * the buttons, and the settings rows (owner review: "TEST ALIGNMENTS"). Measured from rendered
 * pixels (harness.ts inkBox), in every browser, at device scale 1 and 2, left to right and right to
 * left. Anything more than 1px off fails.
 */
import { expect, test, type Locator, type Page } from '@playwright/test';
import { animationsDone, inkBox, layoutBox, openHarness, pauseAt, startPlayback, type Box } from './harness';

const TOLERANCE = 1;
/** Optical nudge of play triangles: 7% of the icon width, rounded to whole pixels (player-skin.css) */
const playNudge = (iconWidth: number) => Math.round(iconWidth * 0.07);

const near = (actual: number, expected: number, what: string) =>
  expect(Math.abs(actual - expected), `${what}: ${actual.toFixed(2)} vs ${expected.toFixed(2)}`).toBeLessThanOrEqual(TOLERANCE);

/** Keep the pointer off every control so no hover state is in the frame */
const parkPointer = (page: Page) => page.mouse.move(1, 1);

async function openPaused(page: Page, lang: 'en' | 'ar', opts: { width?: number; at?: number } = {}) {
  const player = await openHarness(page, { lang, width: opts.width });
  await startPlayback(page, player);
  await pauseAt(page, player, opts.at ?? 20);
  await parkPointer(page);
  return player;
}

/**
 * Paint a handle in a flat probe colour without its ring or glow while it is measured: the ink box
 * then shows the handle's own geometry, not however much of the ring contrasts with what is behind.
 */
/** Whether the stream exposes renditions (VHS); Safari plays HLS natively and has none */
async function hasQualityLevels(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const p = (document.querySelector('.video-js') as (Element & { player?: { qualityLevels?: () => { length: number } } }) | null)?.player;
    return (p?.qualityLevels?.().length ?? 0) > 0;
  });
}

async function flatHandle(page: Page, selector: string) {
  await page.addStyleTag({ content: `${selector} { background: #f0f !important; box-shadow: none !important; border-color: transparent !important; }` });
}

async function openMenu(page: Page, player: Locator) {
  await player.locator('.vjs-fanous-settings').click();
  const menu = page.getByTestId('player-settings-menu');
  await expect(menu).toBeVisible();
  // Playwright's Firefox driver scrolls the page while bringing the (already visible) gear into
  // view; a viewer's click does not. Measure the page as the viewer sees it.
  await page.evaluate(() => window.scrollTo(0, 0));
  await parkPointer(page);
  // Let the slide-in finish before measuring: a fixed wait was too short for WebKit on a loaded
  // runner, which measured rows mid-slide (17px past the panel's edge)
  await animationsDone(menu);
  return menu;
}

for (const dpr of [1, 2]) {
  for (const lang of ['en', 'ar'] as const) {
    const dir = lang === 'ar' ? 'rtl' : 'ltr';

    test.describe(`alignment at DPR ${dpr}, ${dir}`, () => {
      test.use({ deviceScaleFactor: dpr });

      test('big play: triangle centred in its viewBox, optically nudged right, vertically centred', async ({ page }) => {
        const player = await openHarness(page, { lang });
        await parkPointer(page);
        const button = player.locator('.vjs-big-play-button');
        const svg = button.locator('svg[data-icon="play"]');
        // The path itself is centred in the 24-unit viewBox
        // Copied field by field: WebKit's SVGRect keeps them on the prototype, which serialises to {}
        const bbox = await svg.evaluate((el) => { const b = (el as SVGSVGElement).getBBox(); return { x: b.x, y: b.y, width: b.width, height: b.height }; });
        expect(Math.abs(bbox.x + bbox.width / 2 - 12)).toBeLessThanOrEqual(0.05);
        expect(Math.abs(bbox.y + bbox.height / 2 - 12)).toBeLessThanOrEqual(0.05);
        const circle = await layoutBox(button);
        const glyph = await inkBox(page, svg);
        const iconWidth = (await layoutBox(svg)).width;
        // Play points right in Arabic too (media convention), so the nudge is always rightward
        near(glyph.cx - circle.cx, playNudge(iconWidth), 'big play horizontal nudge');
        near(glyph.cy, circle.cy, 'big play vertical centre');
      });

      test('every control button: icon centred on its target and hover fill', async ({ page }) => {
        const player = await openPaused(page, lang);
        const buttons = player.locator('.vjs-control-bar .vjs-control.vjs-button:not(.vjs-fanous-live):visible');
        const count = await buttons.count();
        expect(count).toBeGreaterThanOrEqual(6);
        for (let i = 0; i < count; i++) {
          const button = buttons.nth(i);
          const name = (await button.getAttribute('class'))?.split(' ').find((c) => c.startsWith('vjs-') && c.endsWith('-control') || c.startsWith('vjs-fanous-')) ?? `button ${i}`;
          const svg = button.locator('svg.vjs-svg-icon-fanous:visible').first();
          const icon = await inkBox(page, svg);
          const target = await layoutBox(button);
          const play = (await svg.getAttribute('data-icon')) === 'play';
          const expectedX = target.cx + (play ? playNudge((await layoutBox(svg)).width) : 0);
          // Lucide's volume and fullscreen glyphs are drawn centred in the viewBox; their ink must sit centred too
          near(icon.cx, expectedX, `${name} horizontal`);
          near(icon.cy, target.cy, `${name} vertical`);
        }
        // The hover fill is centred on the icon box (checked on two buttons with different glyphs).
        // It is a soft tint that barely differs from the bar's gradient at its top, so its geometry
        // is measured with it painted in a probe colour
        await flatHandle(page, '.video-js.vjs-fanous .vjs-control-bar .vjs-control.vjs-button::before');
        for (const sel of ['.vjs-fanous-settings', '.vjs-fullscreen-control']) {
          const button = player.locator(sel);
          await button.hover();
          await page.waitForTimeout(200);
          const fill = await inkBox(page, button, 'before');
          const target = await layoutBox(button);
          near(fill.cx, target.cx, `${sel} hover fill horizontal`);
          near(fill.cy, target.cy, `${sel} hover fill vertical`);
          near(fill.width, 38, `${sel} hover fill size`);
          await parkPointer(page);
        }
      });

      test('time display sits on the buttons\' centre line, with one baseline', async ({ page }) => {
        const player = await openPaused(page, lang, { at: 5 });
        const playIcon = await inkBox(page, player.locator('.vjs-play-control svg:visible').first());
        const current = await inkBox(page, player.locator('.vjs-current-time-display'));
        const duration = await inkBox(page, player.locator('.vjs-duration-display'));
        const divider = await inkBox(page, player.locator('.vjs-time-divider > div, .vjs-time-divider span').first());
        // Digits have no descenders: their ink centre is the text's optical centre
        near(current.cy, playIcon.cy, 'current time vs play icon');
        near(duration.cy, playIcon.cy, 'duration vs play icon');
        near(divider.cy, playIcon.cy, 'divider vs play icon');
        // The two are drawn in different colours (icon and dim), and the dimmer one's faint
        // antialiased edge falls under the ink threshold; compare baselines in one probe colour
        await page.addStyleTag({ content: '.video-js.vjs-fanous .vjs-current-time-display, .video-js.vjs-fanous .vjs-duration-display { color: #f0f !important; }' });
        const currentInk = await inkBox(page, player.locator('.vjs-current-time-display'));
        const durationInk = await inkBox(page, player.locator('.vjs-duration-display'));
        near(currentInk.bottom, durationInk.bottom, 'current time and duration baseline');
        near(currentInk.y, durationInk.y, 'current time and duration cap line');
      });

      test('progress handle: centred on the track and on the playhead, fully visible at 0 and at the end', async ({ page }) => {
        const player = await openPaused(page, lang, { at: 30 });
        const holder = player.locator('.vjs-progress-holder');
        const played = player.locator('.vjs-play-progress');
        const control = await layoutBox(player.locator('.vjs-progress-control'));
        const frame = await layoutBox(player);
        await flatHandle(page, '.video-js.vjs-fanous .vjs-play-progress::before');
        for (const at of [0, 30, 'end'] as const) {
          await page.evaluate((t) => {
            const v = document.querySelector<HTMLVideoElement>('.video-js video')!;
            v.currentTime = t === 'end' ? v.duration - 0.05 : t;
          }, at);
          await page.waitForFunction(() => !document.querySelector<HTMLVideoElement>('.video-js video')!.seeking);
          await page.waitForTimeout(250);
          // Video.js can still move the fill after the seek settles, and a capture can show a frame
          // painted before its last layout (WebKit and stock Firefox drew the handle 2.7px from
          // the playhead both layout reads agreed on). Measure until the layout and the drawn
          // handle both hold still: the same fill before and after, and two captures that agree
          let track = await layoutBox(holder);
          let head = await layoutBox(played);
          let handle = await inkBox(page, played, 'before', 14);
          for (let attempt = 0; attempt < 6; attempt++) {
            const [t2, h2] = [await layoutBox(holder), await layoutBox(played)];
            const again = await inkBox(page, played, 'before', 14);
            const settled = t2.cy === track.cy && h2.right === head.right
              && Math.abs(again.cx - handle.cx) < 0.5 && Math.abs(again.cy - handle.cy) < 0.5;
            [track, head, handle] = [t2, h2, again];
            if (settled) break;
          }
          near(handle.cy, track.cy, `handle on the track at ${at}`);
          // The bar runs left to right in both directions, so the playhead is the fill's right edge
          near(handle.cx, head.right, `handle on the playhead at ${at}`);
          near(handle.width, 18, `handle not clipped at ${at}`);
          near(handle.height, 18, `handle height at ${at}`);
          expect(handle.x).toBeGreaterThanOrEqual(control.x - TOLERANCE);
          expect(handle.right).toBeLessThanOrEqual(control.right + TOLERANCE);
          expect(handle.x).toBeGreaterThan(frame.x);
          expect(handle.right).toBeLessThan(frame.right);
        }
      });

      test('volume handle: centred on its track at 0, half and full', async ({ page }) => {
        const player = await openPaused(page, lang);
        const bar = player.locator('.vjs-volume-bar');
        const level = player.locator('.vjs-volume-level');
        const controlBox = await layoutBox(player.locator('.vjs-volume-control'));
        await flatHandle(page, '.video-js.vjs-fanous .vjs-volume-level::after');
        for (const volume of [0, 0.5, 1]) {
          await page.evaluate((v) => {
            const el = document.querySelector<HTMLVideoElement>('.video-js video')!;
            el.muted = false;
            el.volume = v;
          }, volume);
          await page.waitForTimeout(250);
          // The bar can shift between reads (adaptive quality relabels a control beside it):
          // take the layout again after the pixels and measure again until both agree
          let track = await layoutBox(bar);
          let fill = await layoutBox(level);
          let handle = await inkBox(page, level, 'after', 10);
          for (let attempt = 0; attempt < 4; attempt++) {
            const [t2, f2] = [await layoutBox(bar), await layoutBox(level)];
            if (t2.x === track.x && t2.cy === track.cy && f2.right === fill.right) break;
            [track, fill] = [t2, f2];
            handle = await inkBox(page, level, 'after', 10);
          }
          near(handle.cy, track.cy, `volume handle on the track at ${volume}`);
          near(handle.cx, fill.right, `volume handle on the level at ${volume}`);
          near(handle.width, 12, `volume handle not clipped at ${volume}`);
          expect(handle.x).toBeGreaterThanOrEqual(controlBox.x - TOLERANCE);
          expect(handle.right).toBeLessThanOrEqual(controlBox.right + TOLERANCE);
        }
      });

      test('settings rows: one height, one line, [icon] label ... value >, centred and mirrored', async ({ page }) => {
        const player = await openPaused(page, lang);
        const menu = await openMenu(page, player);
        const rows = menu.locator('.vjs-fanous-mi');
        const count = await rows.count();
        // Quality, speed, captions and shortcuts; Safari plays HLS natively with no renditions to
        // choose, so it has no Quality row
        const quality = await hasQualityLevels(page);
        expect(count).toBeGreaterThanOrEqual(quality ? 4 : 3);
        await expect(menu.locator('[data-row="quality"]')).toHaveCount(quality ? 1 : 0);
        const panel = await layoutBox(menu);
        const startInsets: number[] = [];
        for (let i = 0; i < count; i++) {
          const row = rows.nth(i);
          const id = (await row.getAttribute('data-row')) ?? String(i);
          const r = await layoutBox(row);
          near(r.height, 44, `${id} row height`);
          const label = await layoutBox(row.locator('.vjs-fanous-mi-label'));
          // One line: the label box is exactly one 20px line, never wrapped under its icon
          near(label.height, 20, `${id} label is one line`);
          near(label.cy, r.cy, `${id} label centred`);
          const icon = await inkBox(page, row.locator('.vjs-fanous-mi-icon svg'));
          near(icon.cy, r.cy, `${id} icon centred`);
          near(icon.cy, label.cy, `${id} icon level with label`);
          // Icons differ in how much of their 24px box they ink, so the column is the slot's, and
          // each icon's ink is centred in its slot
          const slot = await layoutBox(row.locator('.vjs-fanous-mi-icon'));
          near(icon.cx, slot.cx, `${id} icon centred in its slot`);
          if (dir === 'ltr') {
            expect(icon.right, `${id} icon before label`).toBeLessThan(label.x);
            startInsets.push(slot.x - r.x);
          } else {
            expect(icon.x, `${id} icon before label (RTL)`).toBeGreaterThan(label.right);
            startInsets.push(r.right - slot.right);
          }
          const value = row.locator('.vjs-fanous-mi-value');
          if (await value.count()) {
            const v = await layoutBox(value);
            near(v.cy, r.cy, `${id} value centred`);
            // Both from one layout: adaptive quality can widen the value ("Auto (720p)" to
            // "Auto (1080p)") between two separate measurements, and the label yields to it
            const gap = await row.evaluate((el, rtl) => {
              const l = el.querySelector('.vjs-fanous-mi-label')!.getBoundingClientRect();
              const val = el.querySelector('.vjs-fanous-mi-value')!.getBoundingClientRect();
              return rtl ? l.left - val.right : val.left - l.right;
            }, dir === 'rtl');
            // "QualityAuto" in the prototype: label and value must never touch
            expect(gap, `${id} label and value apart`).toBeGreaterThanOrEqual(8);
          }
          const end = row.locator('.vjs-fanous-mi-end svg');
          if (await end.count()) {
            const chevron = await inkBox(page, end);
            near(chevron.cy, r.cy, `${id} chevron centred`);
            near(chevron.cy, label.cy, `${id} chevron level with label`);
            if (dir === 'ltr') expect(chevron.x).toBeGreaterThan(label.right);
            else expect(chevron.right).toBeLessThan(label.x);
            const endInset = dir === 'ltr' ? r.right - chevron.right : chevron.x - r.x;
            expect(endInset).toBeGreaterThanOrEqual(8);
          }
          // Rows stay inside the panel
          expect(r.x).toBeGreaterThanOrEqual(panel.x - TOLERANCE);
          expect(r.right).toBeLessThanOrEqual(panel.right + TOLERANCE);
        }
        // Same padding on every row: the icons form one column
        for (const [i, inset] of startInsets.entries()) near(inset, startInsets[0], `row ${i} start padding`);
        // The panel never covers the progress bar, and stays inside the frame
        const progress = await layoutBox(player.locator('.vjs-progress-control'));
        const frame = await layoutBox(player);
        expect(panel.bottom, 'panel above the progress bar').toBeLessThanOrEqual(progress.y);
        expect(panel.y).toBeGreaterThanOrEqual(frame.y);
        expect(panel.x).toBeGreaterThanOrEqual(frame.x);
        expect(panel.right).toBeLessThanOrEqual(frame.right);
      });

      for (const sub of ['quality', 'speed'] as const) {
        test(`${sub} submenu: back row, items and check marks centred`, async ({ page }) => {
          const player = await openPaused(page, lang);
          test.skip(sub === 'quality' && !(await hasQualityLevels(page)), 'native HLS (Safari) has no renditions to choose');
          const menu = await openMenu(page, player);
          await menu.locator(`[data-row="${sub}"]`).click();
          await parkPointer(page);
          await animationsDone(menu);
          const rows = menu.locator('.vjs-fanous-mi');
          const count = await rows.count();
          expect(count).toBeGreaterThanOrEqual(3);
          const checkColumn: number[] = [];
          for (let i = 0; i < count; i++) {
            const row = rows.nth(i);
            const id = (await row.getAttribute('data-row')) ?? String(i);
            // The list scrolls when the frame is short; measure each row in view
            await row.scrollIntoViewIfNeeded();
            const r = await layoutBox(row);
            near(r.height, 44, `${sub} ${id} row height`);
            const label = await layoutBox(row.locator('.vjs-fanous-mi-label'));
            near(label.height, 20, `${sub} ${id} one line`);
            near(label.cy, r.cy, `${sub} ${id} label centred`);
            const slot = await layoutBox(row.locator('.vjs-fanous-mi-icon'));
            checkColumn.push(dir === 'ltr' ? slot.x - r.x : r.right - slot.right);
            const svg = row.locator('.vjs-fanous-mi-icon svg');
            if (await svg.count()) {
              const mark = await inkBox(page, svg);
              near(mark.cx, slot.cx, `${sub} ${id} mark centred in its slot`);
              near(mark.cy, r.cy, `${sub} ${id} mark centred in the row`);
            }
          }
          for (const c of checkColumn) near(c, checkColumn[0], `${sub} check column`);
          // Exactly one checked option, and it shows its mark
          await expect(menu.locator('[aria-checked="true"] .vjs-fanous-mi-check svg')).toHaveCount(1);
        });
      }

      test('small player (360px): the panel fits, rows keep their height', async ({ page }) => {
        const player = await openPaused(page, lang, { width: 360 });
        const menu = await openMenu(page, player);
        const panel = await layoutBox(menu);
        const frame = await layoutBox(player);
        expect(panel.x).toBeGreaterThanOrEqual(frame.x);
        expect(panel.right).toBeLessThanOrEqual(frame.right);
        // Never out of the player: too short for the panel above the bar, it fills the frame over it
        expect(panel.y).toBeGreaterThanOrEqual(frame.y + 8 - TOLERANCE);
        // A 360px frame (202px, the bar on two rows) leaves under three rows above the bar
        await expect(menu).toHaveAttribute('data-over-bar', '');
        expect(panel.bottom).toBeLessThanOrEqual(frame.bottom - 8 + TOLERANCE);
        // Every row can be scrolled into full view inside the panel
        await menu.evaluate((el) => { el.scrollTop = el.scrollHeight; });
        const last = await layoutBox(menu.locator('.vjs-fanous-mi').last());
        expect(last.bottom).toBeLessThanOrEqual(panel.bottom + TOLERANCE);
        expect(last.y).toBeGreaterThanOrEqual(panel.y - TOLERANCE);
        await menu.evaluate((el) => { el.scrollTop = 0; });
        const rows = menu.locator('.vjs-fanous-mi');
        for (let i = 0; i < (await rows.count()); i++) {
          const r: Box = await layoutBox(rows.nth(i));
          if (r.bottom <= panel.bottom) near(r.height, 44, `small row ${i} height`);
        }
      });
    });
  }
}
