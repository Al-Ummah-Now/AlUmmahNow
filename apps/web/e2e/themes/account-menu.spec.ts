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
        // between rows", then the same in the CMS): separators ≥ 2.4:1 in both modes (the shared
        // --aun-menu-line, 2.47–3.81:1 across the themes), and the outer border ≥ 3:1
        const lines = await menuLineContrast(page, '[data-testid=nav-menu]');
        expect(lines.count, 'separators rendered').toBeGreaterThan(2);
        expect(lines.separators, `separator contrast ${theme} ${mode}`).toBeGreaterThanOrEqual(2.4);
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
      const ids = ['nav-profile-link', 'nav-channel-layer', 'nav-switch-channel', 'nav-add-account', 'nav-apps', 'nav-sign-out'];
      const all = Array.from(m.querySelectorAll('[data-testid]')).map((el) => el.getAttribute('data-testid'));
      return ids.map((id) => all.indexOf(id));
    });
    // who → the app's context slot (the channel layer) → more accounts → add account → other apps → sign out
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

test.describe('THEME-NAV drawer', () => {
  // Owner, 2026-11-13: the personal section is one "You" / «أنت» link to /library (YouTube's "You ›"),
  // replacing rev 4's "Yours" / «لك» heading with a separate "Library" item under it
  for (const [lang, you, old] of [['en', 'You', ['Yours', 'Library']], ['ar', 'أنت', ['لك', 'المكتبة']]] as const) {
    test(`the personal section is one "${you}" link to the hub (${lang})`, async ({ page, context, baseURL }) => {
      await signIn(context, baseURL!);
      await mockApi(page);
      await page.goto(`/${lang}`);
      const nav = page.getByTestId('side-nav');
      await expect(nav.getByTestId('nav-you')).toHaveAttribute('href', `/${lang}/library`);
      await expect(nav.getByTestId('nav-you')).toHaveText(you);
      for (const label of old) {
        await expect(nav.locator('.nv-heading, .nv').filter({ hasText: new RegExp(`^${label}$`) })).toHaveCount(0);
      }
    });
  }
});
