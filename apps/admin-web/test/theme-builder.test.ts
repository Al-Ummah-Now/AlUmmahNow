/**
 * The theme builder's pure parts: the preview document, contrast per field, field helpers, and that
 * every builder string and component name exists in English and Arabic.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { COMPONENT_PARTS, artSvgPaths, compilePackage, duplicatePackage, validatePackage, type ThemePackage } from '@al-ummah/theme-packages';
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
      assert.ok(html.includes('<header class="ah aun-header">'), page);
      // the shared header's pieces (packages/fanous-tokens/nav/header.js), in the page language and mode
      assert.ok(html.includes('<a class="aun-brand" href="#">') && html.includes('<span class="aun-brand-name">الأمة الآن</span><span class="aun-brand-app">المرئيات</span>'), page);
      assert.ok(html.includes('<a class="aun-lang" href="#" hreflang="en">'), page);
      assert.ok(html.includes('aria-label="التبديل إلى الوضع الفاتح"'), page);
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

  it('shows the home page\'s sign-in banner, in the preview\'s language, with the box its art paints', () => {
    const en = previewDocument({ themeId: 'x', css: '', page: 'home', mode: 'dark', lang: 'en' });
    assert.ok(en.includes('<section class="sib" aria-label="Join Al Ummah Now" dir="ltr"'));
    assert.ok(en.includes('class="sib-art" aria-hidden="true"'));
    assert.ok(en.includes('Request creator access'));
    const ar = previewDocument({ themeId: 'x', css: '', page: 'home', mode: 'light', lang: 'ar' });
    assert.ok(ar.includes('dir="rtl"') && ar.includes('مرئيات'));
    // The banner's stylesheet ships in the kit the preview loads
    const kit = readFileSync(new URL('../../../packages/theme-packages/scripts/admin-kit.ts', import.meta.url), 'utf8');
    assert.ok(kit.includes("'src/theme/signin-banner.css'"));
  });

  it('compiles the edited theme\'s banner art for light and dark from the SVG files it names', () => {
    // What Preview.tsx does: fetch artSvgPaths(theme) from the draft, hand the text to compilePackage
    const dir = new URL('../../../packages/theme-packages/themes/fawanees/', import.meta.url);
    const copy = duplicatePackage(fawanees, 'my-theme', { en: 'Mine', ar: 'لي' }, 'admin@test');
    const files = Object.fromEntries(artSvgPaths(copy).map((p) => [p, readFileSync(new URL(p, dir), 'utf8')]));
    assert.ok(Object.keys(files).length >= 2);
    const css = compilePackage(copy, { svgText: (p) => files[p] }).css;
    assert.match(css, /html\[data-theme='my-theme'\]\.dark \{\n {2}--fanous-header-graphic: url\("data:image\/svg\+xml,/);
    assert.match(css, /html\[data-theme='my-theme'\]:not\(\.dark\) \{\n {2}--fanous-header-graphic: url\("data:image\/svg\+xml,/);
    // Until the files arrive the banner has no art rather than a broken image
    assert.match(compilePackage(copy).css, /--fanous-header-graphic: none;/);
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
