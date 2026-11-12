import { test } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { AxeBuilder } from '@axe-core/playwright';
import { applyTheme, LANGS, measureText, MODES, mockApi, signIn, THEMES } from './harness';

/**
 * Audit sweep (report only, SWEEP=1): pages and overlays x themes x modes x languages. Writes every
 * text under 4.5:1 (rendered pixels) and every axe colour-contrast node to test-results-themes/sweep/.
 */
test.skip(!process.env.SWEEP, 'audit run only: SWEEP=1');

interface Step { name: string; path: string; open?: (page: import('@playwright/test').Page) => Promise<void>; root?: string }
const STEPS: Step[] = [
  { name: 'home', path: '' },
  { name: 'search', path: '/search?q=test' },
  { name: 'explore', path: '/explore' },
  { name: 'library', path: '/library' },
  { name: 'history', path: '/history' },
  { name: 'notifications-page', path: '/notifications' },
  { name: 'settings', path: '/settings' },
  { name: 'studio', path: '/studio' },
  { name: 'upload', path: '/upload' },
  { name: 'channels', path: '/channels' },
  { name: 'contact', path: '/contact' },
  { name: 'account-menu', path: '', open: async (p) => { await p.getByTestId('nav-menu-trigger').first().click(); }, root: '.ah' },
  { name: 'notifications-menu', path: '', open: async (p) => { await p.getByTestId('notification-bell').click(); }, root: '[data-testid=notification-dropdown]' },
  { name: 'side-nav', path: '', open: async (p) => { await p.getByTestId('nav-drawer-toggle').click(); }, root: '[data-testid=side-nav]' },
  { name: 'search-suggest', path: '', open: async (p) => {
    const open = p.getByTestId('header-search-open');
    if (await open.isVisible()) await open.click();
    await p.locator('.ah input[type=search], [data-testid=header-search-sheet] input').first().fill('qur');
    await p.waitForTimeout(600);
  }, root: 'body' },
];

for (const step of STEPS) {
  for (const lang of LANGS) {
    test(`sweep ${step.name} ${lang}`, async ({ page, context, baseURL }, info) => {
      test.setTimeout(240_000);
      await signIn(context, baseURL!);
      await mockApi(page);
      await page.goto(`/${lang}${step.path}`);
      await page.waitForLoadState('networkidle').catch(() => {});
      const dir = `test-results-themes/sweep/${info.project.name}`;
      mkdirSync(dir, { recursive: true });
      const findings: unknown[] = [];
      for (const theme of THEMES) {
        for (const mode of MODES) {
          await applyTheme(page, theme, mode);
          if (step.open) {
            await page.keyboard.press('Escape');
            await step.open(page).catch((e) => findings.push({ theme, mode, error: String(e).slice(0, 120) }));
          }
          await page.mouse.move(0, 0);
          await page.waitForTimeout(250);
          const shot = `${dir}/${step.name}-${theme}-${mode}-${lang}.png`;
          await page.screenshot({ path: shot });
          const root = step.root ?? 'body';
          for (const t of await measureText(page, root)) if (t.ratio < 4.5) findings.push({ theme, mode, kind: 'pixels', ...t, shot });
          const axe = await new AxeBuilder({ page }).include(root).withRules(['color-contrast']).analyze();
          for (const v of axe.violations) for (const n of v.nodes) findings.push({ theme, mode, kind: 'axe', target: n.target.join(' '), summary: n.failureSummary?.split('\n').slice(1).join(' ').slice(0, 200), html: n.html.slice(0, 120), shot });
        }
      }
      writeFileSync(`${dir}/${step.name}-${lang}.json`, JSON.stringify(findings, null, 1));
    });
  }
}
