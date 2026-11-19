import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test, expect, type Page } from '@playwright/test';

/**
 * THEME-BUILDER-PREVIEW: the admin theme builder's preview paints the theme's own colours (owner
 * report 2026-11-12, "it doesn't seem to show the real colors"). The preview is the builder's
 * document with the site's component stylesheets (what admin-kit.ts copies into /theme-kit/site.css)
 * and the package compiled by compilePackage, the same call publishing makes. A brand swatch edit
 * must reach the element it paints: night is the header.
 */
const ROOT = join(__dirname, '../../../..');
// The same files in the same order as admin-kit.ts: font faces, the shared header (aun-nav.css), system.css, pages.css
const SITE_CSS = [
  join(ROOT, 'apps/web/src/theme/font-faces.css'),
  join(ROOT, 'packages/fanous-tokens/nav/aun-nav.css'),
  join(ROOT, 'apps/web/src/theme/system.css'),
  join(ROOT, 'apps/web/src/theme/pages.css'),
].map((f) => readFileSync(f, 'utf8')).join('\n');
const lantern = JSON.parse(readFileSync(join(ROOT, 'packages/theme-packages/themes/lantern/theme.json'), 'utf8')) as ThemePackage;

// The theme package is loaded at run time: it is ESM (built by the workflow before this suite), which a
// static import would require(), and outside this tsconfig
interface ThemePackage { id: string; tokens: { brand: Record<string, string>; color: Record<'light' | 'dark', Record<string, string>> }; components: Record<string, { colors?: Record<'light' | 'dark', Record<string, string>> }> }
interface ThemePackages {
  compilePackage: (t: ThemePackage) => { css: string };
  duplicatePackage: (t: ThemePackage, id: string, name: { en: string; ar: string }, author: string) => ThemePackage;
}
type PreviewDocument = (o: { themeId: string; css: string; page: 'home'; mode: 'light' | 'dark'; lang: 'en' }) => string;
// The builder's own preview document, required by path: it is in admin-web's project, and a static
// import would pull it into this tsconfig (TS6307). Playwright's require hook transpiles it.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { previewDocument } = require(join(ROOT, 'apps/admin-web/src/app/(protected)/site-theme/builder/preview-document.ts')) as { previewDocument: PreviewDocument };
let tp: ThemePackages;
test.beforeAll(async () => {
  tp = await import(join(ROOT, 'packages/theme-packages/dist/index.js'));
});
const compilePackage = (t: ThemePackage) => tp.compilePackage(t);
const duplicatePackage = (...args: Parameters<ThemePackages['duplicatePackage']>) => tp.duplicatePackage(...args);

const rgb = (hex: string) => `rgb(${[1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)).join(', ')})`;

async function openPreview(page: Page, theme: ThemePackage, mode: 'light' | 'dark') {
  await page.route('**/theme-kit/site.css', (route) => route.fulfill({ contentType: 'text/css', body: SITE_CSS }));
  await page.route('http://preview.test/', (route) => route.fulfill({ contentType: 'text/html', body: previewDocument({ themeId: theme.id, css: '', page: 'home', mode, lang: 'en' }) }));
  await page.goto('http://preview.test/');
  await setCss(page, theme);
}

/** What Preview.tsx does on every edit: the compiled CSS replaces the theme <style>. */
async function setCss(page: Page, theme: ThemePackage) {
  const css = compilePackage(theme).css;
  await page.evaluate((text) => { document.getElementById('pv-theme')!.textContent = text; }, css);
}

const headerVar = (page: Page) => page.locator('.ah').evaluate((el) => getComputedStyle(el).getPropertyValue('--fanous-c-nav-bg').trim());
// The header's colour is painted on its frost layer (::before, apps/web/src/theme/system.css), over the blurred page
const headerBackground = (page: Page) => page.locator('.ah').evaluate((el) => getComputedStyle(el, '::before').backgroundImage);

test.describe('theme builder preview', () => {
  test.skip(({ isMobile }) => isMobile, 'one viewport is enough: this checks colours, not layout');

  for (const mode of ['light', 'dark'] as const) {
    test(`a brand colour edit repaints the preview (${mode})`, async ({ page }) => {
      const theme = duplicatePackage(lantern, 'lantern-copy', { en: 'Lantern copy', ar: 'نسخة الفانوس' }, 'e2e');
      await openPreview(page, theme, mode);
      const before = mode === 'light' ? theme.tokens.brand.night : theme.tokens.brand.nightDeep;
      expect(await headerVar(page)).toBe(before);
      expect(await headerBackground(page)).toContain(rgb(before));

      // Night drives the light header, nightDeep the dark one
      const edited = structuredClone(theme);
      const next = '#3a1d5c';
      if (mode === 'light') edited.tokens.brand.night = next; else edited.tokens.brand.nightDeep = next;
      await setCss(page, edited);
      expect(await headerVar(page)).toBe(next);
      expect(await headerBackground(page)).toContain(rgb(next));
      expect(await headerBackground(page)).not.toContain(rgb(before));
    });
  }

  test('light preview text is the theme\'s light text, on a dark header', async ({ page }) => {
    const theme = duplicatePackage(lantern, 'lantern-copy', { en: 'Lantern copy', ar: 'نسخة الفانوس' }, 'e2e');
    await openPreview(page, theme, 'light');
    const light = theme.tokens.color.light;
    await expect(page.locator('.home-hero h2')).toHaveCSS('color', rgb(light.textPrimary));
    await expect(page.getByRole('button', { name: 'Lectures' })).toHaveCSS('color', rgb(light.textPrimary));
    await expect(page.locator('.aun-brand-name')).toHaveCSS('color', rgb(lantern.components.header.colors!.light.text));
    // Browser dark modes (Chrome auto dark, Dark Reader) are told to leave the preview alone
    await expect(page.locator('meta[name="color-scheme"]')).toHaveAttribute('content', 'only light');
    await expect(page.locator('meta[name="darkreader-lock"]')).toHaveCount(1);
  });
});
