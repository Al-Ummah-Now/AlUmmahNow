/**
 * The end screen ("Up next") against the theme-demo design agent's spec (docs/specs/VIDEO-PLAYER.md
 * section 5, End screen): one blurred tinted scrim and no control bar; a centred block at most 640px
 * wide; a muted 13px "Up next" 8px above the card, on the text column's start edge; the thumbnail
 * (16:9) beside a text column of the same height, title on the thumbnail's top and buttons on its
 * bottom; 16px semibold title, 13px muted channel 4px below it; 36px one-line [icon] label buttons
 * with one radius, symmetric padding and 18px icons that never overflow; Play now with the countdown
 * ring, a bordered Watch again, a ghost Cancel. Behaviour: focus on Play now, hover pauses, a key
 * stops it, Escape cancels, auto-advance at zero, reduced motion, no next video. Every layout at
 * device scale 1 and 2, left to right and right to left; 1px tolerance.
 */
import { expect, test, type Locator, type Page } from '@playwright/test';
import { inkBox, layoutBox, luminance, openHarness, pixels, startPlayback, type Box } from './harness';

const TOLERANCE = 1;
const near = (actual: number, expected: number, what: string) =>
  expect(Math.abs(actual - expected), `${what}: ${actual.toFixed(2)} vs ${expected.toFixed(2)}`).toBeLessThanOrEqual(TOLERANCE);
const inside = (inner: Box, outer: Box, what: string) => {
  expect(inner.x, `${what} start`).toBeGreaterThanOrEqual(outer.x - TOLERANCE);
  expect(inner.right, `${what} end`).toBeLessThanOrEqual(outer.right + TOLERANCE);
  expect(inner.y, `${what} top`).toBeGreaterThanOrEqual(outer.y - TOLERANCE);
  expect(inner.bottom, `${what} bottom`).toBeLessThanOrEqual(outer.bottom + TOLERANCE);
};
const startEdge = (b: Box, dir: 'ltr' | 'rtl') => (dir === 'ltr' ? b.x : b.right);
const count = (end: Locator) => end.locator('.vjs-fanous-next-count');
const seconds = async (end: Locator) => Number(await count(end).textContent());

/**
 * Seeks to the end and waits for the end screen. The countdown is 3 s (docs/specs/PLAYLIST-PLAYBACK.md
 * D7), so `hold` (the default, for measurements) rests the pointer on the card at once, which pauses it.
 */
async function reachEnd(page: Page, player: Locator, { hold = true }: { hold?: boolean } = {}) {
  if (!/vjs-has-started/.test((await player.getAttribute('class')) ?? '')) await startPlayback(page, player);
  await page.mouse.move(1, 1);
  await page.evaluate(() => {
    const v = document.querySelector<HTMLVideoElement>('.video-js video')!;
    v.currentTime = v.duration - 0.4;
  });
  const end = page.getByTestId('player-end-screen');
  await expect(end).toBeVisible({ timeout: 20_000 });
  const thumb = page.getByTestId('player-next-thumb');
  if (hold && (await thumb.count()) > 0) await thumb.hover();
  return end;
}

/** Hold the countdown (pointer on the card) so ink measurements compare two identical frames */
async function freeze(page: Page) {
  await page.addStyleTag({ content: '.vjs-fanous-next-ring-fill { transition: none !important; }' });
  await page.getByTestId('player-next-thumb').hover();
  await page.waitForTimeout(250);
}

type Layout = 'wide' | 'row' | 'stacked';

async function checkLayout(page: Page, end: Locator, dir: 'ltr' | 'rtl', layout: Layout) {
  // Hold the countdown so the screen stays while it is measured
  await freeze(page);
  const endBox = await layoutBox(end);
  const card = await layoutBox(end.locator('.vjs-fanous-next-card'));
  const kicker = await layoutBox(end.locator('.vjs-fanous-next-kicker'));
  const thumb = await layoutBox(end.locator('.vjs-fanous-next-thumb'));
  const title = await layoutBox(end.locator('.vjs-fanous-next-title'));
  const channel = await layoutBox(end.locator('.vjs-fanous-next-channel'));
  const actions = await layoutBox(end.locator('.vjs-fanous-next-actions'));

  // Centred block, at most 640px; the control bar is hidden
  expect(card.width).toBeLessThanOrEqual(640 + TOLERANCE);
  near(card.cx, endBox.cx, 'block centred horizontally');
  near(card.cy, endBox.cy, 'block centred vertically');
  await expect(page.locator('.video-js.vjs-fanous .vjs-control-bar')).toBeHidden();
  inside(card, endBox, 'block inside the end screen');

  // Thumbnail is 16:9
  near(thumb.height, (thumb.width * 9) / 16, 'thumbnail 16:9');

  // Type: muted 13px regular label; 16px (15px narrow) semibold title, two lines at most; muted 13px channel
  const style = (sel: string) => end.locator(sel).evaluate((el) => {
    const s = getComputedStyle(el);
    return { color: s.color, size: parseFloat(s.fontSize), weight: Number(s.fontWeight), line: parseFloat(s.lineHeight) };
  });
  const [k, ti, ch] = await Promise.all(['.vjs-fanous-next-kicker', '.vjs-fanous-next-title', '.vjs-fanous-next-channel'].map(style));
  const lum = (c: string) => { const m = c.match(/[\d.]+/g)!.map(Number); return luminance([m[0], m[1], m[2]]); };
  expect(k.size).toBe(13);
  expect(k.weight).toBe(400);
  expect(lum(k.color), '"Up next" is muted').toBeLessThan(lum(ti.color));
  expect(ti.size).toBe(layout === 'wide' ? 16 : 15);
  expect(ti.weight).toBe(600);
  expect(title.height).toBeLessThanOrEqual(ti.line * 2 + TOLERANCE);
  expect(ch.size).toBe(13);
  expect(lum(ch.color), 'channel is muted').toBeLessThan(lum(ti.color));
  near(channel.y - title.bottom, 4, 'channel 4px below the title');

  // "Up next" 8px above the card, on the title column's start edge
  near(kicker.bottom + 8, Math.min(thumb.y, title.y), '"Up next" 8px above the card');
  near(startEdge(kicker, dir), startEdge(title, dir), '"Up next" on the title column');

  if (layout === 'stacked') {
    // Thumbnail above the text, starting on the same edge
    expect(title.y).toBeGreaterThanOrEqual(thumb.bottom);
    near(startEdge(title, dir), startEdge(thumb, dir), 'text starts at the thumbnail edge');
  } else {
    // Thumbnail on the start side, text column beside it, title on the thumbnail's top
    if (dir === 'ltr') expect(thumb.right).toBeLessThan(title.x);
    else expect(thumb.x).toBeGreaterThan(title.right);
    near(title.y, thumb.y, 'title on the thumbnail top');
  }
  if (layout === 'wide') {
    // Text column the thumbnail's height: buttons on its bottom, inside the text column
    near(actions.bottom, thumb.bottom, 'buttons on the thumbnail bottom');
    near(startEdge(actions, dir), startEdge(title, dir), 'buttons in the text column');
  } else {
    // A full-width row under everything, edge to edge of the block
    expect(actions.y).toBeGreaterThanOrEqual(Math.max(thumb.bottom, channel.bottom));
    near(actions.width, card.width, 'buttons span the block');
  }

  // Buttons: one row, order mirrored in RTL, one height and radius, symmetric padding, nothing spilling out
  const buttons = end.locator('.vjs-fanous-btn');
  const n = await buttons.count();
  expect(n).toBeGreaterThanOrEqual(2);
  const radius = await buttons.first().evaluate((el) => getComputedStyle(el).borderTopLeftRadius);
  const boxes: Box[] = [];
  for (let i = 0; i < n; i++) {
    const b = buttons.nth(i);
    const id = (await b.getAttribute('data-testid')) ?? String(i);
    const box = await layoutBox(b);
    boxes.push(box);
    near(box.height, 36, `${id} is 36px tall`);
    inside(box, actions, `${id} inside its row`);
    const css = await b.evaluate((el) => {
      const s = getComputedStyle(el);
      return { radius: s.borderTopLeftRadius, pl: parseFloat(s.paddingLeft), pr: parseFloat(s.paddingRight), overflow: el.scrollWidth - el.clientWidth };
    });
    expect(css.overflow, `${id} overflow`).toBeLessThanOrEqual(0);
    expect(css.pl, `${id} symmetric padding`).toBe(css.pr);
    expect(css.radius, `${id} radius`).toBe(radius);
    const label = b.locator('.vjs-fanous-btn-label');
    const labelBox = await layoutBox(label);
    const slot = b.locator('.vjs-fanous-next-ring, svg').first();
    const icon = await layoutBox(slot);
    near(icon.cy, box.cy, `${id} icon centred`);
    if (!(await slot.evaluate((el) => el.classList.contains('vjs-fanous-next-ring')))) near(icon.width, 18, `${id} icon is 18px`);
    if (labelBox.width > 2) {
      near(labelBox.cy, box.cy, `${id} label centred`);
      expect(labelBox.height, `${id} label is one line`).toBeLessThanOrEqual(18 + TOLERANCE);
      const clipped = await label.evaluate((el) => el.scrollWidth - el.clientWidth);
      expect(clipped, `${id} label clipped`).toBeLessThanOrEqual(0);
      const gap = dir === 'ltr' ? labelBox.x - icon.right : icon.x - labelBox.right;
      expect(gap, `${id} icon before label, 6-8px gap`).toBeGreaterThanOrEqual(6 - TOLERANCE);
      expect(gap, `${id} icon gap`).toBeLessThanOrEqual(8 + TOLERANCE);
    }
  }
  for (const b of boxes) near(b.cy, boxes[0].cy, 'buttons on one row');
  for (let i = 1; i < boxes.length; i++) {
    if (dir === 'ltr') expect(boxes[i].x, 'button order').toBeGreaterThan(boxes[i - 1].right - TOLERANCE);
    else expect(boxes[i].right, 'button order (RTL)').toBeLessThan(boxes[i - 1].x + TOLERANCE);
  }

  // Watch again is a real button: a border or a tint, not bare text
  const surface = await end.getByTestId('player-watch-again').evaluate((el) => {
    const s = getComputedStyle(el);
    return { bg: s.backgroundColor, border: s.borderTopColor, width: parseFloat(s.borderTopWidth) };
  });
  const visible = (c: string) => !/rgba\(0, 0, 0, 0\)|transparent/.test(c);
  expect(visible(surface.bg) || (surface.width > 0 && visible(surface.border)), 'Watch again has a button surface').toBe(true);
}

for (const dpr of [1, 2]) {
  for (const lang of ['en', 'ar'] as const) {
    const dir = lang === 'ar' ? 'rtl' : 'ltr';

    test.describe(`end screen at DPR ${dpr}, ${dir}`, () => {
      test.use({ deviceScaleFactor: dpr });

      test('default: scrim, countdown ring, layout and buttons', async ({ page }) => {
        const player = await openHarness(page, { lang });
        const end = await reachEnd(page, player);
        // One blurred, tinted scrim over the (bright) last frame
        const scrim = await end.evaluate((el) => {
          const s = getComputedStyle(el) as CSSStyleDeclaration & { webkitBackdropFilter?: string };
          return { filter: s.backdropFilter || s.webkitBackdropFilter || '', bg: s.backgroundColor };
        });
        expect(scrim.filter).toMatch(/blur\(16px\)/);
        const alpha = Number(scrim.bg.match(/[\d.]+(?=\))/)?.[0] ?? 1);
        expect(alpha).toBeGreaterThanOrEqual(0.72);
        expect(alpha).toBeLessThanOrEqual(0.8);
        const e = await layoutBox(end);
        const shot = await pixels(page, { x: e.x + 4, y: e.y + 4, width: 12, height: 12 });
        expect(luminance(shot.at(4, 4)), 'scrim darkens the bright last frame').toBeLessThan(0.2);
        // Play now carries the ring with the seconds left, centred in it
        await expect(end.getByTestId('player-next-ring')).toBeVisible();
        await expect(count(end)).toHaveText(/^[1-3]$/);
        await expect(end.getByTestId('player-cancel-next')).toBeVisible();
        await freeze(page);
        const ring = await layoutBox(end.getByTestId('player-next-ring'));
        const digits = await inkBox(page, count(end), 'self', 2);
        // Across: the figure's box on the ring's centre; its ink may sit up to half a pixel more
        // to one side, by the font's own side bearings (DejaVu Sans's figures are not symmetric)
        near((await layoutBox(count(end))).cx, ring.cx, 'seconds box centred in the ring');
        expect(Math.abs(digits.cx - ring.cx), `seconds ink across the ring: ${digits.cx.toFixed(2)} vs ${ring.cx.toFixed(2)}`).toBeLessThanOrEqual(1.5);
        near(digits.cy, ring.cy, 'seconds centred in the ring (vertical)');
        await checkLayout(page, end, dir, 'wide');
      });

      test('phone width (360px): buttons in a full-width row, nothing overlaps', async ({ page }) => {
        await page.setViewportSize({ width: 390, height: 844 });
        const player = await openHarness(page, { lang, width: 360 });
        const end = await reachEnd(page, player);
        await checkLayout(page, end, dir, 'row');
        await expect(end.getByTestId('player-cancel-next')).toHaveAccessibleName(lang === 'ar' ? 'إلغاء' : 'Cancel');
      });

      test('portrait phone: the thumbnail stacks above the text', async ({ page }) => {
        await page.setViewportSize({ width: 390, height: 844 });
        const player = await openHarness(page, { lang, src: 'short', width: 360 });
        const end = await reachEnd(page, player);
        await checkLayout(page, end, dir, 'stacked');
      });
    });
  }
}

test.describe('end screen behaviour', () => {
  test('moves focus to Play now and announces the countdown once', async ({ page }) => {
    const player = await openHarness(page, { src: 'dark' });
    const end = await reachEnd(page, player, { hold: false });
    await expect(end.getByTestId('player-play-next')).toBeFocused();
    const status = end.getByRole('status');
    await expect(status).toHaveText('Next video in 3 seconds');
    const first = await seconds(end);
    await expect.poll(() => seconds(end), { timeout: 3_000 }).toBeLessThan(first);
    await expect(status).toHaveText('Next video in 3 seconds');
  });

  test('counts down, then the next video loads and plays on its own', async ({ page }) => {
    const player = await openHarness(page, { src: 'dark' });
    await reachEnd(page, player, { hold: false });
    await expect(page).toHaveURL(/src=bright/, { timeout: 8_000 });
    // The advance asked the next page to play: its media time moves without a press
    await expect.poll(() => page.evaluate(() => document.querySelector<HTMLVideoElement>('.video-js video')?.currentTime ?? 0), { timeout: 30_000 }).toBeGreaterThan(0.5);
  });

  test('Autoplay next off: no countdown, the screen waits for Play now', async ({ page }) => {
    await page.addInitScript(() => window.localStorage.setItem('aun.player.autoplayNext', '0'));
    const player = await openHarness(page, { src: 'dark' });
    const end = await reachEnd(page, player, { hold: false });
    await expect(count(end)).toHaveCount(0);
    await page.waitForTimeout(4_000);
    await expect(page).toHaveURL(/src=dark/);
    await expect(end.getByTestId('player-play-next')).toBeVisible();
  });

  test('pauses while the pointer is on the card and resumes when it leaves', async ({ page }) => {
    const player = await openHarness(page, { src: 'dark' });
    const end = await reachEnd(page, player, { hold: false });
    await page.getByTestId('player-next-thumb').hover();
    const held = await seconds(end);
    await page.waitForTimeout(2_000);
    expect(await seconds(end)).toBe(held);
    await page.mouse.move(2, 2);
    await expect.poll(() => seconds(end), { timeout: 4_000 }).toBeLessThan(held);
  });

  for (const how of ['Tab', 'Escape', 'Cancel'] as const) {
    test(`${how} stops the countdown and leaves the screen in place`, async ({ page }) => {
      const player = await openHarness(page, { src: 'dark' });
      const end = await reachEnd(page, player, { hold: false });
      if (how === 'Cancel') await end.getByTestId('player-cancel-next').click();
      else await page.keyboard.press(how);
      await expect(count(end)).toHaveCount(0);
      await expect(end.getByTestId('player-cancel-next')).toHaveCount(0);
      await page.waitForTimeout(4_000);
      await expect(page).toHaveURL(/src=dark/);
      await expect(end).toBeVisible();
      await expect(end.getByTestId('player-play-next')).toBeVisible();
      await expect(end.getByTestId('player-watch-again')).toBeVisible();
    });
  }

  test('reduced motion: the seconds without a moving ring', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const player = await openHarness(page, { src: 'dark' });
    const end = await reachEnd(page, player);
    await expect(count(end)).toHaveText(/^[1-3]$/);
    await expect(end.locator('.vjs-fanous-next-ring-fill')).toBeHidden();
  });

  test('Watch again replays from the start', async ({ page }) => {
    const player = await openHarness(page, { src: 'dark' });
    const end = await reachEnd(page, player);
    await end.getByTestId('player-watch-again').click();
    await expect(end).toBeHidden();
    await expect.poll(() => page.evaluate(() => document.querySelector<HTMLVideoElement>('.video-js video')!.currentTime)).toBeLessThan(3);
  });

  test('without a next video: only Watch again, centred', async ({ page }) => {
    const player = await openHarness(page, { src: 'dark', watch: false });
    const end = await reachEnd(page, player);
    await expect(end.locator('button')).toHaveCount(1);
    const replay = await layoutBox(end.getByTestId('player-replay'));
    const e = await layoutBox(end);
    near(replay.cx, e.cx, 'Watch again centred');
    near(replay.cy, e.cy, 'Watch again centred (vertical)');
    near(replay.height, 36, 'Watch again is 36px tall');
  });

  for (const lang of ['en', 'ar'] as const) {
    const dir = lang === 'ar' ? 'rtl' : 'ltr';
    test(`theatre (${dir}): the layout holds in the wide frame`, async ({ page }) => {
      const player = await openHarness(page, { lang });
      await startPlayback(page, player);
      await player.hover();
      await player.locator('.vjs-fanous-theatre').click();
      await expect(page.getByTestId('watch-layout')).toHaveAttribute('data-theatre', '');
      const end = await reachEnd(page, player);
      await checkLayout(page, end, dir, 'wide');
    });

    test(`fullscreen (${dir}): the layout holds`, async ({ page }) => {
      const player = await openHarness(page, { lang });
      await startPlayback(page, player);
      await player.hover();
      await player.locator('.vjs-fullscreen-control').click();
      await expect(player).toHaveClass(/vjs-fullscreen|vjs-full-window/);
      const end = await reachEnd(page, player);
      await checkLayout(page, end, dir, 'wide');
    });
  }
});
