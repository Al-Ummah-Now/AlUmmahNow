import { test, expect, type Page } from '@playwright/test';
import { applyTheme, mockApi, signIn, THEMES, type Mode } from './harness';

/**
 * THEME-STREET: the Fawanees lantern street (packages/fanous-tokens/street). The street is
 * pre-made art: a wide image tile of strings and lit lanterns across the full width, repeated
 * behind the whole page (it wraps both ways, shown at 2x) over the distant lights tile, painted by
 * CSS. In Fawanees light and dark, English and Arabic, desktop and phone:
 *   - the page picked one of the theme's tile variants before first paint, the street shows that
 *     variant, and no other variant is fetched;
 *   - the street's layers are there, repeated, centred and never stretched, and the tile loads;
 *   - this app keeps the street at the theme's faint opacity (its content spans the page, so the
 *     lanterns lie behind text);
 *   - no control or text block on the page is see-through (the street must never show through one);
 * the other themes have no street; the street adds no element, fixed layer or animation (nothing
 * to do on scroll, nothing may wait forever on getAnimations), so the watch page keeps it.
 * Contrast in every theme is the pages spec's job.
 */
const MODES: Mode[] = ['light', 'dark'];
const LANGS = ['en', 'ar'];
const DEPTHS = [0, 900, 1800];
const TILE = /street-tile(-dark)?-[1-4]\.webp/;
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
    // This app hangs the street on its page wrapper (html/body are height: 100%)
    const host = document.querySelector('.demo-layer') ?? document.body;
    const before = getComputedStyle(host, '::before'), after = getComputedStyle(host, '::after');
    const css = getComputedStyle(document.documentElement);
    return {
      variant: document.documentElement.getAttribute('data-fanous-street-variant'),
      lights: before.content !== 'none' ? before.backgroundImage : 'none',
      street: after.content !== 'none' ? after.backgroundImage : 'none',
      repeat: after.backgroundRepeat,
      at: after.backgroundPosition,
      size: after.backgroundSize,
      opacity: after.opacity,
      faint: css.getPropertyValue('--fanous-street-faint').trim(),
      position: after.position,
      // The street reaches the bottom of the page, not just the first screen
      covers: Math.round(parseFloat(after.height)) >= document.documentElement.scrollHeight - 2,
    };
  });
}

for (const lang of LANGS) {
  test(`street home ${lang}: the theme's tile behind the page, repeated not stretched, faint here; no see-through controls`, async ({ page, context, baseURL }) => {
    test.setTimeout(180_000);
    await signIn(context, baseURL!);
    await mockApi(page);
    const fetched = new Set<string>();
    page.on('request', (req) => { const m = req.url().match(/street-tile(?:-dark)?-(\d)\.webp/); if (m) fetched.add(m[1]); });
    const served = new Map<string, { status: number; type: string }>();
    page.on('response', (res) => {
      const { pathname } = new URL(res.url());
      if (pathname.startsWith('/fanous/street/')) served.set(pathname, { status: res.status(), type: (res.headers()['content-type'] ?? '').split(';')[0] });
    });
    await open(page, `/${lang}`);
    const problems: string[] = [];
    for (const mode of MODES) {
      await applyTheme(page, 'fawanees', mode);
      await settle(page);
      await expect(page.locator('html')).toHaveClass(/fanous-street/);
      const l = await layers(page);
      expect(l.street, `${mode}: street tile`).toMatch(TILE);
      expect(l.street.includes('-dark-'), `${mode}: the ${mode} tile`).toBe(mode === 'dark');
      // The variant picked before first paint is the one shown, and the only one fetched
      expect(l.variant, `${mode}: a variant picked`).toMatch(/^[1-4]$/);
      expect(l.street, `${mode}: the picked variant`).toContain(`-${l.variant}.webp`);
      expect(l.lights, `${mode}: distant lights`).toMatch(/url\(/);
      expect(l.repeat, `${mode}: repeated both ways`).toBe('repeat');
      expect(l.at, `${mode}: centred on the page`).toMatch(/^50% 0(%|px)?$/);
      expect(l.size, `${mode}: shown at the tile's own size`).toBe('auto');
      expect(l.position, `${mode}: scrolls with the page`).toBe('absolute');
      expect(l.covers, `${mode}: down the whole page`).toBe(true);
      expect(Number(l.opacity), `${mode}: faint where it lies behind text`).toBeCloseTo(Number(l.faint), 2);
      // The tile files themselves are served: the answers the page itself got
      for (const url of l.street.match(/\/fanous\/street\/[\w-]+\.webp/g) ?? []) {
        await expect.poll(() => served.get(url), { message: url }).toEqual({ status: 200, type: 'image/webp' });
      }
      const maxY = await page.evaluate(() => document.documentElement.scrollHeight - innerHeight);
      for (const depth of DEPTHS.filter((d) => d <= maxY)) {
        await page.evaluate((y) => window.scrollTo(0, y), depth);
        await page.waitForTimeout(300);
        for (const s of await seeThrough(page)) problems.push(`${mode} @${depth}px see-through: ${s}`);
      }
      await page.evaluate(() => window.scrollTo(0, 0));
    }
    const variant = await page.locator('html').getAttribute('data-fanous-street-variant');
    expect([...fetched], 'only the picked variant downloads').toEqual([variant]);
    expect(problems, problems.join('\n')).toEqual([]);
  });
}

// The history pages and Watch later / Liked: their cards, the day-grouped list, its side column and the
// playlist panel are solid in Fawanees (owner 2026-11-22: "no street showing through")
for (const lang of LANGS) {
  test(`street library pages ${lang}: no see-through cards, lists or panels`, async ({ page, context, baseURL }) => {
    test.setTimeout(240_000);
    await signIn(context, baseURL!);
    await mockApi(page);
    const problems: string[] = [];
    for (const [path, ready] of [
      ['/history?view=continue', 'history-card'],
      ['/history', 'watch-history-search'],
      ['/library/watch-later', 'library-panel'],
      ['/library/liked', 'library-panel'],
    ] as const) {
      await open(page, `/${lang}${path}`);
      await expect(page.getByTestId(ready).first()).toBeVisible({ timeout: 30_000 });
      for (const mode of MODES) {
        await applyTheme(page, 'fawanees', mode);
        await settle(page);
        const maxY = await page.evaluate(() => document.documentElement.scrollHeight - innerHeight);
        for (const depth of DEPTHS.filter((d) => d <= maxY)) {
          await page.evaluate((y) => window.scrollTo(0, y), depth);
          await page.waitForTimeout(300);
          for (const s of await seeThrough(page)) problems.push(`${path} ${mode} @${depth}px see-through: ${s}`);
        }
        await page.evaluate(() => window.scrollTo(0, 0));
      }
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
      expect((await layers(page)).street, `${theme} ${mode}`).toBe('none');
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

test('street plates paint on ::before at z-index -1, never on the host element', async ({ page, context, baseURL }) => {
  test.setTimeout(180_000);
  await signIn(context, baseURL!);
  await mockApi(page);
  for (const path of ['/en', '/en/library', '/en/explore'] as const) {
    await open(page, path);
    await expect(page.locator('.street-plate').first()).toBeVisible({ timeout: 30_000 });
    await applyTheme(page, 'fawanees', 'dark');
    await settle(page);
    const bad = await page.evaluate(() => {
      const plates = Array.from(document.querySelectorAll('.street-plate'));
      const issues: string[] = [];
      const host = document.querySelector('.demo-layer') ?? document.body;
      const streetZ = Number(getComputedStyle(host, '::after').zIndex);
      if (!(streetZ < -1)) issues.push(`street ::after z-index is ${streetZ}, expected < -1 so plates cover lanterns`);
      if (plates.length === 0) issues.push('no .street-plate elements found');
      for (const el of plates) {
        const cs = getComputedStyle(el);
        const before = getComputedStyle(el, '::before');
        const label = `${el.tagName.toLowerCase()}.${String(el.className).split(' ').slice(0, 3).join('.')}`;
        if (cs.boxShadow !== 'none') issues.push(`${label} has host box-shadow: ${cs.boxShadow}`);
        if (cs.zIndex !== 'auto') issues.push(`${label} creates stacking context with z-index: ${cs.zIndex}`);
        if (before.content === 'none') issues.push(`${label} missing ::before street plate`);
        if (before.zIndex !== '-1') issues.push(`${label}::before z-index is ${before.zIndex}, expected -1`);
        if (before.boxShadow === 'none') issues.push(`${label}::before missing plate box-shadow`);
      }
      return issues;
    });
    expect(bad, `${path}: ${bad.join('; ')}`).toEqual([]);
  }
});
