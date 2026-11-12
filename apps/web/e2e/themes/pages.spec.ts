import { test, expect } from '@playwright/test';
import { AxeBuilder } from '@axe-core/playwright';
import { applyTheme, LANGS, measureText, MODES, mockApi, signIn, THEMES } from './harness';

/**
 * THEME-PAGES: the pages of the visual suite (e2e/visual, VISUAL_PAGE_IDS in
 * e2e/test-utils/page-catalog.ts) are readable in every built-in theme, light and dark, English and
 * Arabic. The visual snapshots are taken in one reference theme only (Lantern), so this is what
 * covers the others: every visible text at least 4.5:1 measured from the rendered pixels, and axe
 * colour-contrast clean. The mock API (mock-server.mjs) gives each page realistic content.
 */
const THEME_PAGES = [
  { id: 'home', path: '' },
  { id: 'channels', path: '/channels' },
  { id: 'channel', path: '/channels/c1' },
  { id: 'watch', path: '/video/v1' },
  { id: 'not-found', path: '/this-page-does-not-exist' },
  { id: 'privacy', path: '/settings/privacy' },
  { id: 'upload', path: '/upload', channel: true },
  { id: 'dashboard', path: '/studio/go/content/videos', channel: true },
] as const satisfies ReadonlyArray<{ id: string; path: string; channel?: boolean }>;

for (const entry of THEME_PAGES) {
  for (const lang of LANGS) {
    test(`page ${entry.id} ${lang}: readable in every theme`, async ({ page, context, baseURL }, info) => {
      test.setTimeout(240_000);
      await signIn(context, baseURL!, { channel: 'channel' in entry && entry.channel });
      await mockApi(page);
      await page.goto(`/${lang}${entry.path}`);
      await page.waitForLoadState('networkidle').catch(() => {});
      await expect(page.locator('#page-content')).toBeVisible();
      // Colours are checked at rest: a theme switch must not be measured mid-transition
      await page.addStyleTag({ content: '*,*::before,*::after{transition:none!important;animation-duration:0s!important;animation-delay:0s!important}' });
      const findings: string[] = [];
      for (const theme of THEMES) {
        for (const mode of MODES) {
          await applyTheme(page, theme, mode);
          await page.mouse.move(0, 0);
          await page.waitForTimeout(250);
          await page.screenshot({ path: info.outputPath(`${entry.id}-${theme}-${mode}-${lang}.png`) });
          for (const t of await measureText(page, 'body')) {
            if (t.ratio < 4.5) findings.push(`${theme} ${mode}: pixels ${t.ratio}:1 ${t.fg} on ${t.bg} "${t.text}" (${t.selector})`);
          }
          // The player is covered by its own specs; the dev overlay is not part of the site
          const axe = await new AxeBuilder({ page }).exclude('video').exclude('nextjs-portal').withRules(['color-contrast']).analyze();
          for (const v of axe.violations) {
            for (const n of v.nodes) findings.push(`${theme} ${mode}: axe ${n.target.join(' ')} ${n.failureSummary?.split('\n').slice(1).join(' ').slice(0, 160)}`);
          }
        }
      }
      expect(findings, `low contrast on ${entry.id} (${lang}):\n${findings.join('\n')}`).toEqual([]);
    });
  }
}
