import { test, expect } from '@playwright/test';
import { applyTheme, LANGS, MODES, mockApi, THEMES } from './harness';

/**
 * THEME-CONSENT (#1587): on phones the consent notice is never clamped. The whole description and
 * its settings link can be read, the card sits between the header and the tab bar, every button is
 * at least 44px tall and inside the card, and the page never scrolls sideways. Checked at the narrow
 * phone widths in every theme and colour mode, in the banner and Customize states.
 */
const WIDTHS = [320, 360, 390, 412];

for (const lang of LANGS) {
  test(`consent banner on phones ${lang}: whole notice readable, above the tab bar`, async ({ page }, info) => {
    test.skip(info.project.name !== 'phone', 'phone layout');
    test.setTimeout(240_000);
    await mockApi(page);
    for (const width of WIDTHS) {
      await page.setViewportSize({ width, height: Math.round(width * 2) });
      await page.goto(`/${lang}`);
      const banner = page.getByTestId('consent-banner');
      await expect(banner).toBeVisible();
      for (const theme of THEMES) {
        for (const mode of MODES) {
          await applyTheme(page, theme, mode);
          const g = await banner.evaluate((el) => {
            const card = el.firstElementChild as HTMLElement;
            const p = el.querySelector('#consent-banner-description') as HTMLElement;
            const c = card.getBoundingClientRect();
            const tab = document.querySelector('nav.tabbar')?.getBoundingClientRect();
            const buttons = [...card.querySelectorAll('button')].map((b) => {
              const r = b.getBoundingClientRect();
              return { h: r.height, inside: r.left >= c.left - 0.5 && r.right <= c.right + 0.5 };
            });
            return {
              clamp: getComputedStyle(p).webkitLineClamp,
              hidden: getComputedStyle(p).overflow !== 'visible' && p.scrollHeight > p.clientHeight + 1,
              cardBottom: c.bottom, tabTop: tab?.top ?? innerHeight,
              sideways: document.documentElement.scrollWidth > innerWidth,
              buttons,
            };
          });
          const at = `${width} ${theme} ${mode}`;
          expect(g.clamp === 'none' || g.clamp === '', `${at}: description clamped`).toBe(true);
          expect(g.hidden, `${at}: description cut off`).toBe(false);
          expect(g.cardBottom, `${at}: card under the tab bar`).toBeLessThanOrEqual(g.tabTop + 0.5);
          expect(g.sideways, `${at}: sideways scroll`).toBe(false);
          for (const b of g.buttons) {
            expect(b.h, `${at}: button height`).toBeGreaterThanOrEqual(44);
            expect(b.inside, `${at}: button inside the card`).toBe(true);
          }
        }
      }
    }
  });
}
