/**
 * Static text and info pages show their sections in frosted-glass boxes with the golden glow (owner,
 * 2026-11-15): the shared `pb-glass` card (@al-ummah/shared-types/page-blocks.css), never a copy of it.
 * For each page, en and ar: the expected boxes are there, apart from each other, each blurs what is
 * behind it and glows in the theme's primary, and every line of text on the glass is AA against the
 * darkest and lightest pixel behind it (e2e/release/glass-contrast.ts), in every theme, light and dark.
 * About is in about.spec.ts's deployed placement (its text comes from the CMS).
 */
import { test, expect, type Page } from '@playwright/test';
import { target } from './targets';
import { glassContrast, glassStyle } from './glass-contrast';

const THEMES = ['fawanees', 'nahas', 'lantern', 'zujaj'] as const;
const PAGES = [
  { path: 'community-guidelines', boxes: 7 },
  { path: 'settings/privacy', boxes: 3 },
  { path: 'help', boxes: 1 },
  { path: 'help/privacy', boxes: 2 },
  { path: 'contact', boxes: 2 },
] as const;

/** Theme and mode as the site sets them (html[data-theme], html.dark). */
async function applyTheme(page: Page, theme: string, dark: boolean): Promise<void> {
  await page.evaluate(
    ([t, d]) => {
      document.documentElement.dataset.theme = t as string;
      document.documentElement.classList.toggle('dark', d as boolean);
    },
    [theme, dark] as const,
  );
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
}

test.describe('Release: static pages in frosted-glass boxes', () => {
  for (const p of PAGES) {
    for (const locale of ['en', 'ar'] as const) {
      test(`${p.path} (${locale})`, async ({ page }) => {
        test.setTimeout(240_000);
        await page.emulateMedia({ reducedMotion: 'reduce' });
        await page.goto(`${target().web}/${locale}/${p.path}`);
        const boxes = page.locator('main .pb-glass');
        await expect(boxes.first()).toBeVisible({ timeout: 30000 });
        const count = await boxes.count();
        expect(count, 'glass boxes').toBeGreaterThanOrEqual(p.boxes);
        // Boxes in one column are apart from each other
        const rects = await boxes.evaluateAll((els) => els.map((e) => e.getBoundingClientRect()).map((r) => ({ top: r.top, bottom: r.bottom, left: r.left, right: r.right })));
        for (let i = 1; i < rects.length; i++) {
          const a = rects[i - 1]!, b = rects[i]!;
          const sameColumn = Math.min(a.right, b.right) - Math.max(a.left, b.left) > 0;
          if (sameColumn && b.top >= a.top) expect(b.top - a.bottom, `gap above box ${i}`).toBeGreaterThanOrEqual(16);
        }

        const problems: string[] = [];
        for (const theme of THEMES) {
          for (const dark of [true, false]) {
            await applyTheme(page, theme, dark);
            const style = await glassStyle(boxes.first());
            expect(style.blur, `${theme} blur`).toMatch(/blur\(\d+px\)/);
            expect(style.shadow, `${theme} glow`).toMatch(/\) 0px 0px \d+px/);
            let measured = 0;
            for (let i = 0; i < count; i++) {
              const r = await glassContrast(page, boxes.nth(i), `${theme} ${dark ? 'dark' : 'light'} box ${i}`);
              problems.push(...r.problems);
              measured += r.measured;
            }
            expect(measured, `${theme} text measured`).toBeGreaterThan(2);
          }
        }
        expect(problems).toEqual([]);
      });
    }
  }
});
