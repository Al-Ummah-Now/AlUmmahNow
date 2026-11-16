/**
 * Release regression (Epic 6.3): the community guidelines page exists in
 * English and Arabic (RTL) and is linked from the side navigation.
 *
 * Each section is one frosted-glass box with the golden glow (the page builder's shared panel,
 * @al-ummah/shared-types/page-blocks.css; owner 2026-11-15), and its text stays AA over whatever shows
 * through, in every theme, light and dark (e2e/release/glass-contrast.ts).
 */
import { test, expect, type Page } from '@playwright/test';
import { target } from './targets';
import { glassContrast, glassStyle } from './glass-contrast';

const TITLES = { en: 'Community guidelines', ar: 'إرشادات المجتمع' } as const;
const THEMES = ['fawanees', 'nahas', 'lantern', 'zujaj'] as const;

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

test.describe('Release: community guidelines', () => {
  for (const locale of ['en', 'ar'] as const) {
    test(`guidelines page renders (${locale})`, async ({ page }) => {
      const res = await page.goto(`${target().web}/${locale}/community-guidelines`);
      expect(res?.status(), 'page status').toBeLessThan(400);
      const main = page.getByTestId('community-guidelines');
      await expect(main).toBeVisible({ timeout: 30000 });
      await expect(main).toHaveAttribute('dir', locale === 'ar' ? 'rtl' : 'ltr');
      await expect(page.getByRole('heading', { level: 1 })).toHaveText(TITLES[locale]);
      await expect(main.getByRole('heading', { level: 2 })).toHaveCount(7);
      await expect(page.locator(`a[href="/${locale}/community-guidelines"]`).first()).toBeAttached();
    });

    test(`each section is a frosted-glass box with a golden glow, text AA in every theme (${locale})`, async ({ page }) => {
      test.setTimeout(240_000);
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await page.goto(`${target().web}/${locale}/community-guidelines`);
      const boxes = page.locator('[data-testid^=guidelines-] > .pb-in');
      await expect(boxes).toHaveCount(7, { timeout: 30000 });
      // One box per section, apart from each other
      const tops = await boxes.evaluateAll((els) => els.map((e) => e.getBoundingClientRect()).map((r) => [r.top, r.bottom]));
      for (let i = 1; i < tops.length; i++) expect(tops[i]![0] - tops[i - 1]![1], `gap above section ${i}`).toBeGreaterThanOrEqual(16);

      const problems: string[] = [];
      for (const theme of THEMES) {
        for (const dark of [true, false]) {
          await applyTheme(page, theme, dark);
          const style = await glassStyle(boxes.first());
          expect(style.blur, `${theme} blur`).toMatch(/blur\(16px\)/);
          expect(style.shadow, `${theme} glow`).toMatch(/\) 0px 0px 32px/);
          let measured = 0;
          for (let i = 0; i < 7; i++) {
            const r = await glassContrast(page, boxes.nth(i), `${theme} ${dark ? 'dark' : 'light'} section ${i}`);
            problems.push(...r.problems);
            measured += r.measured;
          }
          expect(measured, `${theme} text measured`).toBeGreaterThan(20);
        }
      }
      expect(problems).toEqual([]);
    });
  }
});
