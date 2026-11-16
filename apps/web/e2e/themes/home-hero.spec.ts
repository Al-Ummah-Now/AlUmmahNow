import { test, expect } from '@playwright/test';
import { applyTheme, LANGS, MODES, mockApi, THEMES } from './harness';

/**
 * THEME-HERO (#1556): the featured video's artwork on the home page is shown as it is in light mode.
 * The fade over its inner edge (`.home-hero-t::after`) blends the art into a dark panel; on a light
 * panel it washed the bottom ~40% (phone) or the inner edge (desktop) out to milky white, so light
 * mode has none. The title wraps in balanced lines (no single word alone on the last line).
 * Desktop and phone come from the config's projects (the phone fade is a different rule).
 */
for (const lang of LANGS) {
  test(`home hero ${lang}: no fade over the art in light mode, kept in dark; balanced title`, async ({ page }) => {
    test.setTimeout(180_000);
    await mockApi(page);
    await page.goto(`/${lang}`);
    const thumb = page.getByTestId('hero-thumb');
    await expect(thumb).toBeVisible();
    await expect(page.locator('.home-hero-b h2')).toHaveCSS('text-wrap', /balance/);
    const overlay = () => thumb.evaluate((el) => {
      const s = getComputedStyle(el, '::after');
      return { content: s.content, image: s.backgroundImage };
    });
    for (const theme of THEMES) {
      for (const mode of MODES) {
        await applyTheme(page, theme, mode);
        const after = await overlay();
        if (mode === 'light') {
          expect(after.content, `${theme} light`).toBe('none');
        } else {
          expect(after.content, `${theme} dark`).not.toBe('none');
          expect(after.image, `${theme} dark`).toContain('linear-gradient');
        }
      }
    }
  });
}
