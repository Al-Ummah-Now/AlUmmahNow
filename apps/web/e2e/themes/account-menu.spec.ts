import { test, expect } from '@playwright/test';
import { AxeBuilder } from '@axe-core/playwright';
import { applyTheme, LANGS, measureText, menuLineContrast, MODES, mockApi, signIn, THEMES } from './harness';

/**
 * THEME-NAV (docs/design/NAV.md): the header account button and menu follow the shared nav
 * contract (packages/fanous-tokens/nav/aun-nav.css) and read in every built-in theme, light and
 * dark, English and Arabic: the button's name and every menu text at least 4.5:1 from the
 * rendered pixels, and axe colour-contrast clean. The menu is its own surface, never the dark
 * header's light text on a light popover.
 */
// The first tests on a cold dev server measured while it was still compiling (every text repainting,
// so none measurable): open the page and the menu once before the matrix, and allow one retry
test.describe.configure({ retries: 1 });
test.beforeAll(async ({ browser, baseURL }) => {
  test.setTimeout(180_000);
  const context = await browser.newContext();
  await signIn(context, baseURL!);
  const page = await context.newPage();
  await mockApi(page);
  for (const lang of LANGS) {
    await page.goto(`${baseURL}/${lang}`, { timeout: 150_000 });
    await page.locator('[data-testid="nav-menu-trigger"]:visible').first().click();
    await expect(page.getByTestId('nav-menu')).toBeVisible({ timeout: 60_000 });
  }
  await context.close();
});

for (const lang of LANGS) {
  for (const theme of THEMES) {
    for (const mode of MODES) {
      test(`account menu ${theme} ${mode} ${lang}`, async ({ page, context, baseURL }, info) => {
        await signIn(context, baseURL!);
        await mockApi(page);
        await page.goto(`/${lang}`);
        await applyTheme(page, theme, mode);
        const trigger = page.locator('[data-testid="nav-menu-trigger"]:visible').first();
        await expect(trigger).toHaveClass(/aun-acct-btn/);
        if (info.project.name === 'desktop') {
          const button = await measureText(page, '[data-testid="nav-menu-trigger"]');
          const lowButton = button.filter((t) => t.ratio < 4.5);
          expect(lowButton, `account button:\n${lowButton.map((t) => `${t.ratio}:1 "${t.text}"`).join('\n')}`).toEqual([]);
        }
        await trigger.click();
        const menu = page.getByTestId('nav-menu');
        await expect(menu).toHaveClass(/aun-menu/);
        await expect(menu.getByTestId('nav-sign-out')).toBeVisible();
        await page.mouse.move(0, 0);
        await page.waitForTimeout(300);
        await page.screenshot({ path: info.outputPath(`account-menu-${theme}-${mode}-${lang}.png`) });

        // The first test on a cold dev server can measure before the menu's text has painted: look again
        let texts = await measureText(page, '[data-testid=nav-menu]');
        await expect.poll(async () => (texts = await measureText(page, '[data-testid=nav-menu]')).length, { timeout: 20_000 }).toBeGreaterThan(3);
        const low = texts.filter((t) => t.ratio < 4.5);
        expect(low, `low contrast:\n${low.map((t) => `${t.ratio}:1 ${t.fg} on ${t.bg} "${t.text}" (${t.selector})`).join('\n')}`).toEqual([]);

        const axe = await new AxeBuilder({ page }).include('[data-testid=nav-menu]').withRules(['color-contrast']).analyze();
        expect(axe.violations.flatMap((v) => v.nodes.map((n) => n.failureSummary))).toEqual([]);

        // The lines between sections must show (owner review rev 4: "in dark you can't see the lines
        // between rows"): separators ≥ 1.8:1 on the dark menu (≥ 1.25:1 on the light page background),
        // and the outer border ≥ 3:1 in both modes
        const lines = await menuLineContrast(page, '[data-testid=nav-menu]');
        expect(lines.count, 'separators rendered').toBeGreaterThan(2);
        expect(lines.separators, `separator contrast ${theme} ${mode}`).toBeGreaterThanOrEqual(mode === 'dark' ? 1.8 : 1.25);
        expect(lines.edge, `menu border contrast ${theme} ${mode}`).toBeGreaterThanOrEqual(3);
      });
    }
  }
}

test.describe('THEME-NAV structure', () => {
  test('the button shows the name; the menu sections come in the shared order', async ({ page, context, baseURL }) => {
    await signIn(context, baseURL!);
    await mockApi(page);
    await page.goto('/en');
    const trigger = page.locator('[data-testid="nav-menu-trigger"]:visible').first();
    // Avatar + display name, never the email when a name exists (the name stays the accessible name on phones)
    await expect(trigger).toHaveAccessibleName(/Theme Sweep/);
    await expect(trigger).not.toHaveAccessibleName(/@/);
    await trigger.click();
    const menu = page.getByTestId('nav-menu');
    const order = await menu.evaluate((m) => {
      const ids = ['nav-profile-link', 'nav-channel-layer', 'nav-switch-channel', 'nav-switch-account', 'nav-add-account', 'nav-apps', 'nav-sign-out'];
      const all = Array.from(m.querySelectorAll('[data-testid]')).map((el) => el.getAttribute('data-testid'));
      return ids.map((id) => all.indexOf(id));
    });
    // who → the app's context slot (the channel layer) → accounts → add account → other apps → sign out
    expect(order.every((i) => i >= 0), `sections present: ${order}`).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    // The other apps, never this one; "Website" first
    const apps = menu.getByTestId('nav-apps');
    await expect(apps.locator('[data-app="videos"]')).toHaveCount(0);
    await expect(apps.getByRole('menuitem').first()).toHaveText('Website');
    // Separators are the shared divider, the surface the shared menu surface
    await expect(menu.locator('.aun-menu-sep').first()).toBeVisible();
  });
});
