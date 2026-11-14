import { test, expect, type Page } from '@playwright/test';
import { applyTheme, mockApi, signIn, THEMES, type Mode } from './harness';

/**
 * THEME-STREET: the Fawanees lantern street (packages/fanous-tokens/street). The street is
 * pre-made art: two tall image tiles of strings and lit lanterns repeated down the sides of the
 * page (repeat-y, seamless, shown at 2x) over the distant lights tile, painted by CSS behind the
 * page. In Fawanees light and dark, English and Arabic, desktop and phone:
 *   - the street's layers are there, with the theme's tiles, repeated vertically and never
 *     stretched, and the tile files load;
 *   - this app keeps the bands at the theme's faint opacity (its content spans the page, so the
 *     bands lie behind text);
 *   - no control or text block on the page is see-through (the street must never show through one);
 * the other themes have no street; the street adds no element, fixed layer or animation (nothing
 * to do on scroll, nothing may wait forever on getAnimations), so the watch page keeps it.
 * Contrast in every theme is the pages spec's job.
 */
const MODES: Mode[] = ['light', 'dark'];
const LANGS = ['en', 'ar'];
const DEPTHS = [0, 900, 1800];
const TILES = /street-band-left(-dark)?\.webp[\s\S]*street-band-right(-dark)?\.webp/;
// Transitions and time-based animations off
const STILL = '*,*::before,*::after{transition:none!important;animation-duration:0s!important;animation-delay:0s!important}';

async function open(page: Page, path: string) {
  await page.goto(path);
  await page.waitForLoadState('networkidle').catch(() => {});
  await expect(page.locator('#page-content')).toBeVisible();
  await page.addStyleTag({ content: STILL });
}

/** Waits until the module has followed the theme (html.fanous-street matches --fanous-street-on). */
async function settle(page: Page) {
  await page.waitForTimeout(400);
  await page.waitForFunction(() => document.documentElement.classList.contains('fanous-street') === (getComputedStyle(document.documentElement).getPropertyValue('--fanous-street-on').trim() === '1'));
  await page.waitForTimeout(300);
}

/**
 * Translucent controls and text blocks whose backdrop is the page itself (so the street would show
 * through them). A translucent badge over a thumbnail is fine: something opaque is behind it.
 */
async function seeThrough(page: Page) {
  return page.evaluate(() => {
    const alpha = (bg: string) => { const slash = bg.match(/\/\s*([\d.]+)\)/), rgba = bg.match(/^rgba\([^,]+,[^,]+,[^,]+,\s*([\d.]+)\)/); return slash ? parseFloat(slash[1]) : rgba ? parseFloat(rgba[1]) : bg === 'transparent' ? 0 : 1; };
    const paints = (e: Element) => { const st = getComputedStyle(e); return alpha(st.backgroundColor) === 1 || st.backgroundImage !== 'none' || /^(IMG|VIDEO|CANVAS|PICTURE)$/.test(e.tagName); };
    return Array.from(document.querySelectorAll('#page-content *')).filter((el) => {
      if (el.tagName === 'IMG') return false;
      const r = el.getBoundingClientRect();
      if (!r.width || !r.height || r.bottom < 0 || r.top > innerHeight) return false;
      const a = alpha(getComputedStyle(el).backgroundColor);
      if (!(a > 0 && a < 1)) return false;
      const stack = document.elementsFromPoint(r.left + r.width / 2, Math.min(innerHeight - 1, Math.max(0, r.top + r.height / 2)));
      const below = stack.slice(stack.indexOf(el) + 1).filter((e) => !el.contains(e) && e !== document.body && e !== document.documentElement);
      return !below.some(paints);
    }).map((el) => `${el.tagName.toLowerCase()}.${String(el.className).split(' ').slice(0, 3).join('.')}`);
  });
}

/** The street's two layers as the browser computes them. */
async function layers(page: Page) {
  return page.evaluate(() => {
    const before = getComputedStyle(document.body, '::before'), after = getComputedStyle(document.body, '::after');
    const css = getComputedStyle(document.documentElement);
    return {
      lights: before.content !== 'none' ? before.backgroundImage : 'none',
      bands: after.content !== 'none' ? after.backgroundImage : 'none',
      repeat: after.backgroundRepeat,
      size: after.backgroundSize,
      opacity: after.opacity,
      faint: css.getPropertyValue('--fanous-street-faint').trim(),
      position: after.position,
    };
  });
}

for (const lang of LANGS) {
  test(`street home ${lang}: the theme's tiles down both sides, repeated not stretched, faint here; no see-through controls`, async ({ page, context, baseURL }) => {
    test.setTimeout(180_000);
    await signIn(context, baseURL!);
    await mockApi(page);
    await open(page, `/${lang}`);
    const problems: string[] = [];
    for (const mode of MODES) {
      await applyTheme(page, 'fawanees', mode);
      await settle(page);
      await expect(page.locator('html')).toHaveClass(/fanous-street/);
      const l = await layers(page);
      expect(l.bands, `${mode}: band tiles`).toMatch(TILES);
      expect(l.bands.includes('-dark.webp'), `${mode}: the ${mode} tiles`).toBe(mode === 'dark');
      expect(l.lights, `${mode}: distant lights`).toMatch(/url\(/);
      expect(l.repeat, `${mode}: repeat-y`).toBe('repeat-y, repeat-y');
      expect(l.size, `${mode}: shown at the tile's own size`).toBe('auto, auto');
      expect(l.position, `${mode}: scrolls with the page`).toBe('absolute');
      expect(Number(l.opacity), `${mode}: faint where it lies behind text`).toBeCloseTo(Number(l.faint), 2);
      // The tile files themselves are served
      for (const url of l.bands.match(/\/fanous\/street\/[\w-]+\.webp/g) ?? []) {
        const res = await page.request.get(url);
        expect(res.status(), url).toBe(200);
        expect(res.headers()['content-type'], url).toContain('image/webp');
      }
      const maxY = await page.evaluate(() => document.documentElement.scrollHeight - innerHeight);
      for (const depth of DEPTHS.filter((d) => d <= maxY)) {
        await page.evaluate((y) => window.scrollTo(0, y), depth);
        await page.waitForTimeout(300);
        for (const s of await seeThrough(page)) problems.push(`${mode} @${depth}px see-through: ${s}`);
      }
      await page.evaluate(() => window.scrollTo(0, 0));
    }
    expect(problems, problems.join('\n')).toEqual([]);
  });
}

test('street: only Fawanees has it', async ({ page, context, baseURL }) => {
  test.setTimeout(180_000);
  await signIn(context, baseURL!);
  await mockApi(page);
  await open(page, '/en');
  for (const theme of THEMES.filter((t) => t !== 'fawanees')) {
    for (const mode of MODES) {
      await applyTheme(page, theme, mode);
      await settle(page);
      await expect(page.locator('html'), `${theme} ${mode}`).not.toHaveClass(/fanous-street/);
      expect((await layers(page)).bands, `${theme} ${mode}`).toBe('none');
    }
  }
});

test('street: no elements, fixed layers or animations of its own; the watch page keeps it', async ({ page, context, baseURL }, info) => {
  test.skip(info.project.name !== 'desktop', 'one viewport is enough');
  await signIn(context, baseURL!);
  await mockApi(page);
  for (const path of ['/en', '/en/video/v1']) {
    await open(page, path);
    for (const mode of MODES) {
      await applyTheme(page, 'fawanees', mode);
      await settle(page);
      await expect(page.locator('html'), `${path} ${mode}`).toHaveClass(/fanous-street/);
      await expect(page.locator('#fanous-street, #fanous-street-lights'), `${path} ${mode}`).toHaveCount(0);
      // Nothing to wait for: tests and pages that wait for every animation to finish must not hang
      const ours = await page.evaluate(() => document.getAnimations().filter((a) => {
        const t = (a.effect as KeyframeEffect | null)?.target as Element | null;
        return t === document.documentElement || t === document.body;
      }).length);
      expect(ours, `${path} ${mode}`).toBe(0);
    }
  }
});
