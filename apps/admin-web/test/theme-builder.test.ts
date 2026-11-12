/**
 * The theme builder's pure parts: the preview document, contrast per field, field helpers, and that
 * every builder string and component name exists in English and Arabic.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { COMPONENT_PARTS, compilePackage, duplicatePackage, validatePackage, type ThemePackage } from '@al-ummah/theme-packages';
import en from '../src/i18n/messages/en';
import ar from '../src/i18n/messages/ar';
import { previewDocument } from '../src/app/(protected)/site-theme/builder/preview-document';
import { partContrast, roleContrast, traceIssues } from '../src/app/(protected)/site-theme/builder/contrast';

const fawanees = JSON.parse(readFileSync(new URL('../../../packages/theme-packages/themes/fawanees/theme.json', import.meta.url), 'utf8')) as ThemePackage;
const ARABIC = /[؀-ۿ]/;

describe('theme builder preview', () => {
  it('renders the site components in the chosen language, mode and theme', () => {
    const css = compilePackage(fawanees).css;
    for (const page of ['home', 'watch', 'settings', 'components'] as const) {
      const html = previewDocument({ themeId: 'fawanees', css, page, mode: 'dark', lang: 'ar' });
      assert.match(html, /<html lang="ar" dir="rtl" data-theme="fawanees" data-rail="closed" class="dark"/);
      assert.ok(html.includes('<header class="ah">'), page);
      assert.ok(html.includes('class="nv-panel"'), page);
      assert.ok(html.includes('/theme-kit/site.css'), page);
    }
    assert.ok(previewDocument({ themeId: 'x', css: '', page: 'watch', mode: 'light', lang: 'en' }).includes('pv-player'));
    assert.ok(previewDocument({ themeId: 'x', css: '', page: 'home', mode: 'light', lang: 'en' }).includes('data-testid="video-grid"'));
  });

  it('opts out of browser dark modes, so it paints the theme\'s own colours', () => {
    // Chrome's auto dark and Dark Reader repainted the light preview (2026-11-12): pale text, brown chips
    for (const mode of ['light', 'dark'] as const) {
      const html = previewDocument({ themeId: 'x', css: '', page: 'home', mode, lang: 'en' });
      assert.ok(html.includes(`style="color-scheme:only ${mode}"`), mode);
      assert.ok(html.includes(`<meta name="color-scheme" content="only ${mode}">`), mode);
      assert.ok(html.includes('<meta name="darkreader-lock">'), mode);
    }
  });

  it('keeps the CSS inside its <style> and escapes the id', () => {
    const html = previewDocument({ themeId: '"><script>', css: 'a{}</style><script>alert(1)</script>', page: 'home', mode: 'light', lang: 'en' });
    assert.ok(!html.includes('</style><script>'));
    assert.ok(!html.includes('data-theme=""><script>'));
  });
});

describe('theme builder contrast', () => {
  it('names the worst pair for a role and a component part', () => {
    const text = roleContrast(fawanees, 'dark', 'textPrimary');
    assert.ok(text.length >= 3 && text.every((c) => c.ratio >= c.min));
    const bad = structuredClone(fawanees);
    bad.tokens.color.light.textPrimary = bad.tokens.color.light.background;
    assert.ok(roleContrast(bad, 'light', 'textPrimary')[0].ratio < 4.5);
    const nav = partContrast(fawanees, 'light', 'nav.text');
    assert.ok(nav.some((c) => c.against === 'nav.bg'));
  });
});

describe('theme builder contrast gate', () => {
  it('files a failing pair under the brand colour it comes from', () => {
    const lantern = JSON.parse(readFileSync(new URL('../../../packages/theme-packages/themes/lantern/theme.json', import.meta.url), 'utf8')) as ThemePackage;
    const copy = duplicatePackage(lantern, 'lantern-copy', { en: 'Lantern copy', ar: 'نسخة الفانوس' }, 'admin@test');
    assert.equal(validatePackage(copy).ok, true);
    // Night is the header: a light night makes the header light and its parchment text unreadable
    copy.tokens.brand.night = '#f0e6d2';
    const result = validatePackage(copy);
    assert.equal(result.ok, false);
    const traced = traceIssues(copy, result.errors);
    assert.ok((traced.get('tokens.brand.night') ?? []).some((m) => m.startsWith('the header is dark')), [...traced.keys()].join('\n'));
  });
});

describe('theme builder strings', () => {
  it('every builder string and component has English and Arabic', () => {
    const e = en.themeBuilder as Record<string, unknown>;
    const a = ar.themeBuilder as Record<string, unknown>;
    assert.deepEqual(Object.keys(a).sort(), Object.keys(e).sort());
    for (const name of Object.keys(COMPONENT_PARTS)) {
      assert.ok((en.themeBuilder.components as Record<string, string>)[name], name);
      assert.match((ar.themeBuilder.components as Record<string, string>)[name], ARABIC, name);
    }
  });
});
