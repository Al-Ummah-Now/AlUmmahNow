import { test, expect } from '@playwright/test';
import { AxeBuilder } from '@axe-core/playwright';
import { applyTheme, LANGS, measureText, MODES, mockApi, signIn, THEMES } from './harness';

/**
 * THEME-NOTIF: the header notifications dropdown is readable in every built-in theme, light and
 * dark, English and Arabic: every text at least 4.5:1 measured from the rendered pixels, axe
 * colour-contrast clean, and no row fainter than the first (no fade over the list).
 */
for (const lang of LANGS) {
  for (const theme of THEMES) {
    for (const mode of MODES) {
      test(`notifications ${theme} ${mode} ${lang}`, async ({ page, context, baseURL }, info) => {
        await signIn(context, baseURL!);
        await mockApi(page);
        await page.goto(`/${lang}`);
        await applyTheme(page, theme, mode);
        await page.getByTestId('notification-bell').click();
        const panel = page.getByTestId('notification-dropdown');
        await expect(panel.getByTestId('notification-item')).toHaveCount(8);
        await page.mouse.move(0, 0);
        await page.waitForTimeout(300);
        await page.screenshot({ path: info.outputPath(`notifications-${theme}-${mode}-${lang}.png`) });

        const texts = await measureText(page, '[data-testid=notification-dropdown]');
        expect(texts.length).toBeGreaterThan(8);
        const low = texts.filter((t) => t.ratio < 4.5);
        expect(low, `low contrast:\n${low.map((t) => `${t.ratio}:1 ${t.fg} on ${t.bg} "${t.text}" (${t.selector})`).join('\n')}`).toEqual([]);

        // The unread badge on the bell (in the night header) is readable too
        // Measured at rest (the harness drops a text that changed while it was measured): it must be there
        const bell = await measureText(page, '[data-testid=notification-bell]');
        expect(bell.some((t) => t.selector.startsWith('notification-badge')), 'the badge was measured').toBe(true);
        const badge = bell.filter((t) => t.ratio < 4.5);
        expect(badge, `badge: ${JSON.stringify(badge)}`).toEqual([]);

        // Read and unread rows differ by more than colour: the unread dot carries a name
        await expect(panel.locator('[data-read=false] [role=img]').first()).toHaveAccessibleName(/.+/);

        const axe = await new AxeBuilder({ page }).include('[data-testid=notification-dropdown]').withRules(['color-contrast']).analyze();
        expect(axe.violations.flatMap((v) => v.nodes.map((n) => n.failureSummary))).toEqual([]);
      });
    }
  }
}
