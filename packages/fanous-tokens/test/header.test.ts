import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import {
  HEADER_LABELS,
  HEADER_ORDER,
  appLinksHtml,
  brandHtml,
  envBadgeHtml,
  langButtonHtml,
  modeButtonHtml,
  signInHtml,
} from '../nav/header.js';
import { modeIconSvg } from '../nav/mode-toggle.js';

/**
 * The header contract (docs/design/NAV.md "Header"): every app renders these strings, or, in React,
 * markup its own tests compare with them. Pinning the exact output here makes a change to the
 * contract visible in review, and every vendored copy is checked against this file.
 */
const css = readFileSync(new URL('../nav/aun-nav.css', import.meta.url), 'utf8');

test('the slots keep one order', () => {
  assert.deepEqual(HEADER_ORDER, ['menu', 'brand', 'env', 'primary', 'actions', 'apps', 'lang', 'mode', 'account']);
});

test('brand: the logo, the wordmark and the app name, in both languages', () => {
  assert.equal(
    brandHtml({ lang: 'en', href: '/en/', app: 'Status' }),
    '<a class="aun-brand" href="/en/"><img class="aun-brand-mark" src="/brand/logo-64.webp" alt="" width="36" height="36">' +
      '<span class="aun-brand-text"><span class="aun-brand-name">Al Ummah Now</span><span class="aun-brand-app">Status</span></span></a>'
  );
  assert.match(brandHtml({ lang: 'ar', href: '/ar/' }), /<span class="aun-brand-name">الأمة الآن<\/span><\/span><\/a>$/);
  assert.match(brandHtml({ lang: 'en', href: '/?a=1&b=2', logoSrc: '/x.png' }), /href="\/\?a=1&amp;b=2"><img class="aun-brand-mark" src="\/x.png"/);
});

test('environment badge: QA and STAGE only', () => {
  assert.equal(
    envBadgeHtml('qa', 'en'),
    '<span class="aun-env" role="note" aria-label="QA environment" title="QA environment">QA</span>'
  );
  assert.match(envBadgeHtml('STAGE', 'ar'), />STAGE<\/span>$/);
  for (const env of ['production', 'development', '', undefined, null]) assert.equal(envBadgeHtml(env, 'en'), '');
});

test('app links: Website and Videos with their icons, nothing else', () => {
  assert.equal(
    appLinksHtml({ lang: 'en', links: [{ id: 'www', href: 'https://www.alummahnow.net/en/' }] }),
    '<nav class="aun-apps" aria-label="Al Ummah Now apps"><a class="aun-app" href="https://www.alummahnow.net/en/">' +
      '<img class="aun-app-mark" src="/aun-nav/icons/www.webp" alt="" width="22" height="22"><span class="aun-app-name">Website</span></a></nav>'
  );
  const ar = appLinksHtml({ lang: 'ar', links: [{ id: 'www', href: '/w' }, { id: 'videos', href: '/v' }, { id: 'cms', href: '/c' }] });
  assert.match(ar, /الموقع.*المرئيات/);
  assert.doesNotMatch(ar, /cms/);
  assert.equal(appLinksHtml({ lang: 'en', links: [] }), '');
});

test('language button: the other language, marked with its lang; the name holds the visible label', () => {
  assert.equal(
    langButtonHtml({ lang: 'en', href: '/ar/videos?page=2' }),
    '<a class="aun-lang" href="/ar/videos?page=2" hreflang="ar"><span class="aun-visually-hidden">Switch to Arabic: </span>' +
      '<span lang="ar">العربية</span></a>'
  );
  assert.equal(
    langButtonHtml({ lang: 'ar', href: '/en/' }),
    '<a class="aun-lang" href="/en/" hreflang="en"><span class="aun-visually-hidden">التبديل إلى الإنجليزية: </span>' +
      '<span lang="en">English</span></a>'
  );
});

test('light/dark button: the shared icons and action names', () => {
  const dark = modeButtonHtml({ lang: 'en', dark: true });
  assert.ok(dark.includes(modeIconSvg('sun')));
  assert.match(dark, /aria-label="Switch to light mode" title="Switch to light mode"/);
  assert.match(dark, /^<button type="button" class="aun-icon-btn aun-mode" id="mode-toggle" data-testid="theme-toggle"/);
  assert.ok(modeButtonHtml({ lang: 'ar', dark: false }).includes('التبديل إلى الوضع الداكن'));
});

test('sign in: a solid pill', () => {
  assert.equal(signInHtml({ lang: 'en', href: '/login' }), '<a class="aun-signin" href="/login">Sign in</a>');
  assert.equal(signInHtml({ lang: 'ar', href: '/login' }), '<a class="aun-signin" href="/login">تسجيل الدخول</a>');
});

test('labels exist in both languages', () => {
  assert.deepEqual(Object.keys(HEADER_LABELS.en).sort(), Object.keys(HEADER_LABELS.ar).sort());
});

test('the stylesheet defines every class the builders use, one control height and the breakpoints', () => {
  for (const cls of ['aun-header', 'aun-header-row', 'aun-header-primary', 'aun-header-tools', 'aun-brand', 'aun-brand-mark', 'aun-brand-text',
    'aun-brand-name', 'aun-brand-app', 'aun-env', 'aun-apps', 'aun-app', 'aun-app-mark', 'aun-app-name', 'aun-lang', 'aun-icon-btn',
    'aun-signin', 'aun-acct-btn', 'aun-visually-hidden']) {
    assert.match(css, new RegExp(`\\.${cls}[\\s,{:]`), `.${cls} is styled`);
  }
  // every control is 2.5rem (40px) tall; the bar 4rem, 3.5rem on phones
  for (const sel of ['.aun-lang,\n.aun-app {', '.aun-brand {', '.aun-signin {']) {
    const block = css.slice(css.indexOf(sel), css.indexOf('}', css.indexOf(sel)));
    assert.match(block, /min-height: 2\.5rem;/, `${sel} is 2.5rem tall`);
  }
  assert.match(css, /--aun-header-height: 4rem;/);
  assert.match(css, /--aun-header-height: 3\.5rem;/);
  for (const bp of ['79.99rem', '63.99rem', '47.99rem', '39.99rem', '24.99rem']) assert.ok(css.includes(`(max-width: ${bp})`), bp);
});
