import { test, expect, type Page } from '@playwright/test';
import { applyTheme, mockApi, signIn, THEMES, type Mode } from './harness';

/**
 * THEME-STREET: the Fawanees lantern street (packages/fanous-tokens/street, owner-approved
 * 2026-11-13). In Fawanees light and dark, English and Arabic, desktop and phone:
 *   - no control or text block on the page is see-through (the street must never show through one);
 *   - every lantern on screen is drawn whole: the screen is compared with and without the street,
 *     and a lantern drawn less than 85% of its height is cut by something in front of it
 *     (lanterns under fixed or sticky things, the header, bottom bar or a sticky player, count as off
 *     screen, like the window edge);
 *   - scrolled pages still show the street (garlands in the gaps);
 * the other themes draw no street; Studio's work area stays plain; and with reduced motion the
 * distant lights stand still. Contrast in every theme is the pages spec's job.
 */
const MODES: Mode[] = ['light', 'dark'];
const LANGS = ['en', 'ar'];
const PAGES = [{ id: 'home', path: '' }, { id: 'watch', path: '/video/v1' }];
const DEPTHS = [0, 900, 1800];
// Transitions and time-based animations off; the root's scroll-driven animation stays
const STILL = '*:not(html),*::before,*::after{transition:none!important;animation-duration:0s!important;animation-delay:0s!important}';

async function open(page: Page, path: string) {
  await page.goto(path);
  await page.waitForLoadState('networkidle').catch(() => {});
  await expect(page.locator('#page-content')).toBeVisible();
  await page.addStyleTag({ content: STILL });
}

/** Re-draws now (the module also follows the theme by itself, after a short debounce). */
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

async function lanterns(page: Page) {
  // The module re-measures after layout changes: wait until the drawing stops changing
  let last = '';
  for (let i = 0; i < 20; i++) {
    const now = await page.evaluate(() => document.getElementById('fanous-street')?.innerHTML.length + ':' + document.documentElement.scrollHeight);
    if (now === last) break;
    last = now;
    await page.waitForTimeout(350);
  }
  const boxes = await page.evaluate(() => {
    // Fixed and sticky things (header, bottom bar, a sticky player) slide over the page like the window edge
    const chrome = Array.from(document.querySelectorAll('body *')).filter((e) => !e.closest('#fanous-street') && ['fixed', 'sticky'].includes(getComputedStyle(e).position))
      .map((e) => e.getBoundingClientRect()).filter((r) => r.width && r.height && r.right > 0 && r.left < innerWidth && r.bottom > 0 && r.top < innerHeight);
    const hit = (b: { x: number; y: number; w: number; h: number }) => chrome.some((r) => b.x < r.right && b.x + b.w > r.left && b.y < r.bottom && b.y + b.h > r.top);
    return Array.from(document.querySelectorAll('#fanous-street .fs-l use')).map((u) => { const r = u.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; })
      .filter((b) => b.y >= 0 && b.y + b.h <= innerHeight && b.x >= 0 && b.x + b.w <= innerWidth && !hit(b));
  });
  if (!boxes.length) return { inView: 0, cut: [] as string[] };
  const on = (await page.screenshot()).toString('base64');
  await page.evaluate(() => { document.getElementById('fanous-street')!.style.visibility = 'hidden'; });
  const off = (await page.screenshot()).toString('base64');
  await page.evaluate(() => { document.getElementById('fanous-street')!.style.visibility = ''; });
  const cut = await page.evaluate(async ({ on, off, boxes }) => {
    const load = (b: string) => new Promise<HTMLImageElement>((res) => { const i = new Image(); i.onload = () => res(i); i.src = `data:image/png;base64,${b}`; });
    const [a, b] = await Promise.all([load(on), load(off)]);
    const px = (img: HTMLImageElement) => { const c = document.createElement('canvas'); c.width = img.width; c.height = img.height; const g = c.getContext('2d')!; g.drawImage(img, 0, 0); return g.getImageData(0, 0, c.width, c.height).data; };
    const A = px(a), B = px(b), W = a.width, k = a.width / innerWidth;
    const out: string[] = [];
    for (const bx of boxes) {
      const x0 = Math.round(bx.x * k), x1 = Math.round((bx.x + bx.w) * k), y0 = Math.round(bx.y * k), y1 = Math.round((bx.y + bx.h) * k);
      let rows = 0;
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) { const i = (y * W + x) * 4; if (Math.abs(A[i] - B[i]) + Math.abs(A[i + 1] - B[i + 1]) + Math.abs(A[i + 2] - B[i + 2]) > 18) { rows++; break; } }
      }
      if (rows / (y1 - y0) < 0.85) out.push(`lantern at ${Math.round(bx.x)},${Math.round(bx.y)}: ${Math.round((100 * rows) / (y1 - y0))}% drawn`);
    }
    return out;
  }, { on, off, boxes });
  return { inView: boxes.length, cut };
}

for (const pg of PAGES) {
  for (const lang of LANGS) {
    test(`street ${pg.id} ${lang}: no see-through controls, whole lanterns, street when scrolled`, async ({ page, context, baseURL }) => {
      test.setTimeout(240_000);
      await signIn(context, baseURL!);
      await mockApi(page);
      await open(page, `/${lang}${pg.path}`);
      const problems: string[] = [];
      for (const mode of MODES) {
        await applyTheme(page, 'fawanees', mode);
        await settle(page);
        await expect(page.locator('html')).toHaveClass(/fanous-street/);
        const maxY = await page.evaluate(() => document.documentElement.scrollHeight - innerHeight);
        for (const depth of DEPTHS.filter((d) => d <= maxY)) {
          await page.evaluate((y) => window.scrollTo(0, y), depth);
          await page.waitForTimeout(300);
          for (const s of await seeThrough(page)) problems.push(`${mode} @${depth}px see-through: ${s}`);
          const l = await lanterns(page);
          for (const c of l.cut) problems.push(`${mode} @${depth}px ${c}`);
        }
        await page.evaluate(() => window.scrollTo(0, 0));
        // Garlands hang in the page's gaps (somewhere on the page, not necessarily at these depths)
        expect(await page.locator('#fanous-street .fs-l').count(), `${mode}: lanterns on the page`).toBeGreaterThan(0);
      }
      expect(problems, problems.join('\n')).toEqual([]);
    });
  }
}

test('street: only Fawanees draws it', async ({ page, context, baseURL }) => {
  test.setTimeout(180_000);
  await signIn(context, baseURL!);
  await mockApi(page);
  await open(page, '/en');
  for (const theme of THEMES.filter((t) => t !== 'fawanees')) {
    for (const mode of MODES) {
      await applyTheme(page, theme, mode);
      await settle(page);
      await expect(page.locator('html'), `${theme} ${mode}`).not.toHaveClass(/fanous-street/);
      await expect(page.locator('#fanous-street'), `${theme} ${mode}`).toHaveCount(0);
    }
  }
});

test("street: Studio's work area stays plain", async ({ page, context, baseURL }) => {
  await signIn(context, baseURL!, { channel: true });
  await mockApi(page);
  await open(page, '/en/studio/go/content/videos');
  await expect(page.getByRole('table')).toBeVisible();
  for (const mode of MODES) {
    await applyTheme(page, 'fawanees', mode);
    await settle(page);
    await expect(page.locator('#fanous-street .fs-l'), `Studio ${mode}`).toHaveCount(0);
  }
});

for (const motion of ['reduce', 'no-preference'] as const) {
  test(`street: distant lights ${motion === 'reduce' ? 'stand still with reduced motion' : 'move at 0.2x the scroll'}`, async ({ browser, baseURL }, info) => {
    test.skip(info.project.name !== 'desktop', 'one viewport is enough');
    const context = await browser.newContext({ reducedMotion: motion, viewport: { width: 1280, height: 800 } });
    const page = await context.newPage();
    await signIn(context, baseURL!);
    await mockApi(page);
    await page.goto('/en');
    await page.waitForLoadState('networkidle').catch(() => {});
    await applyTheme(page, 'fawanees', 'light');
    await settle(page);
    const pos = () => page.evaluate(() => getComputedStyle(document.documentElement).backgroundPositionY.split(',')[0].trim());
    const sway = () => page.evaluate(() => { const g = document.querySelector('#fanous-street .fs-l'); return g ? getComputedStyle(g).animationName : 'none'; });
    expect(await pos()).toBe('0px');
    await page.evaluate(() => window.scrollTo(0, 700));
    await page.waitForTimeout(300);
    if (motion === 'reduce') {
      expect(await pos()).toBe('0px');
      expect(await sway()).toBe('none');
    } else {
      expect(await pos()).toBe('-140px');
    }
    await context.close();
  });
}
