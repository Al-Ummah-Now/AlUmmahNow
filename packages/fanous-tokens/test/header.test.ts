import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import {
  HEADER_LABELS,
  HEADER_ORDER,
  brandHtml,
  envBadgeHtml,
  langButtonHtml,
  menuButtonHtml,
  modeButtonHtml,
  samePath,
  signInHtml,
} from '../nav/header.js';
import * as header from '../nav/header.js';
import { modeIconSvg } from '../nav/mode-toggle.js';

/**
 * The header contract (docs/design/NAV.md "Header"): every app renders these strings, or, in React,
 * markup its own tests compare with them. Pinning the exact output here makes a change to the
 * contract visible in review, and every vendored copy is checked against this file.
 */
const css = readFileSync(new URL('../nav/aun-nav.css', import.meta.url), 'utf8');

test('the slots keep one order', () => {
  assert.deepEqual(HEADER_ORDER, ['menu', 'brand', 'env', 'primary', 'actions', 'lang', 'mode', 'account']);
});

test('brand: the logo, the wordmark and the app name, in both languages', () => {
  assert.equal(
    brandHtml({ lang: 'en', href: '/en/', app: 'Status' }),
    '<a class="aun-brand" href="/en/"><img class="aun-brand-mark" src="/brand/logo-64.webp" alt="" width="36" height="36">' +
      '<span class="aun-brand-text"><span class="aun-brand-name">Al Ummah Now</span><span class="aun-brand-app">Status</span></span></a>'
  );
  assert.match(brandHtml({ lang: 'ar', href: '/ar/' }), /<span class="aun-brand-name">الأمة الآن<\/span><\/span><\/a>$/);
  assert.match(brandHtml({ lang: 'en', href: '/?a=1&b=2', logoSrc: '/x.png' }), /href="\/\?a=1&amp;b=2"><img class="aun-brand-mark" src="\/x.png"/);
  // a white-label site passes its own name (escaped); the app line is unchanged
  assert.match(
    brandHtml({ lang: 'en', href: '/', name: 'Shaykh <A> & Co', app: 'Videos' }),
    /<span class="aun-brand-name">Shaykh &lt;A&gt; &amp; Co<\/span><span class="aun-brand-app">Videos<\/span>/
  );
  assert.equal(brandHtml({ lang: 'ar', href: '/', name: '' }), brandHtml({ lang: 'ar', href: '/' }));
});

test('samePath: a self-link from the request path is never protocol-relative', () => {
  assert.equal(samePath('/ar/search?q=a'), '/ar/search?q=a');
  assert.equal(samePath('//evil.example/x?y=1'), '/evil.example/x?y=1');
  assert.equal(samePath('/\\evil.example'), '/evil.example');
  assert.equal(samePath('\\\\evil.example'), '/evil.example');
  assert.equal(samePath('///\\/a'), '/a');
  assert.equal(samePath('https://evil.example/'), '/');
  assert.equal(samePath('evil.example'), '/');
  assert.equal(samePath(''), '/');
  assert.equal(samePath(undefined), '/');
});

test('environment badge: QA and STAGE only', () => {
  assert.equal(
    envBadgeHtml('qa', 'en'),
    '<span class="aun-env" role="note" aria-label="QA environment" title="QA environment">QA</span>'
  );
  assert.match(envBadgeHtml('STAGE', 'ar'), />STAGE<\/span>$/);
  for (const env of ['production', 'development', '', undefined, null]) assert.equal(envBadgeHtml(env, 'en'), '');
});

test('no links to other sites in the header (owner, 2026-11-15)', () => {
  assert.equal(typeof (header as Record<string, unknown>).appLinksHtml, 'undefined');
  assert.ok(!(HEADER_ORDER as readonly string[]).includes('apps'));
  assert.doesNotMatch(css, /\.aun-apps?[\s,{:]|\.aun-app-(mark|name)/);
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
  // WCAG 2.5.3 (axe label-content-name-mismatch): no aria-label, so the name is the text content
  // (hidden action + visible label) and the visible label is inside it
  for (const lang of ['en', 'ar'] as const) {
    const html = langButtonHtml({ lang, href: '/x' });
    assert.doesNotMatch(html, /aria-label/i, lang);
    const visible = /<span lang="[a-z]+">([^<]+)<\/span>/.exec(html)![1];
    // the text content: every run of text between tags, joined
    const text = [...html.matchAll(/>([^<]*)</g)].map((m) => m[1]).join('');
    assert.equal(visible, HEADER_LABELS[lang].otherLang, lang);
    assert.ok(text.includes(visible), `${lang}: "${text}" contains "${visible}"`);
    assert.ok(text.startsWith(HEADER_LABELS[lang].switchLang), lang);
  }
});

test('light/dark button: the shared icons and action names', () => {
  const dark = modeButtonHtml({ lang: 'en', dark: true });
  assert.ok(dark.includes(modeIconSvg('sun')));
  assert.match(dark, /aria-label="Switch to light mode" title="Switch to light mode"/);
  assert.match(dark, /^<button type="button" class="aun-icon-btn aun-mode" id="mode-toggle" data-testid="theme-toggle"/);
  assert.ok(modeButtonHtml({ lang: 'ar', dark: false }).includes('التبديل إلى الوضع الداكن'));
});

test('menu button: the videos drawer icon, named, opening the panel popover', () => {
  assert.equal(
    menuButtonHtml({ lang: 'en', panel: 'site-menu' }),
    '<button type="button" class="aun-icon-btn aun-menu-btn aun-menu-collapse" popovertarget="site-menu" aria-label="Menu" title="Menu">' +
      '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" ' +
      'stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-menu" aria-hidden="true" focusable="false">' +
      '<line x1="4" x2="20" y1="12" y2="12"></line><line x1="4" x2="20" y1="6" y2="6"></line><line x1="4" x2="20" y1="18" y2="18"></line></svg></button>'
  );
  assert.match(menuButtonHtml({ lang: 'ar', panel: 'a"b' }), /popovertarget="a&quot;b" aria-label="القائمة"/);
  // .aun-menu is the account menu's surface (absolute, 21rem wide): the button never wears it
  assert.ok(!/class="([^"]*)"/.exec(menuButtonHtml({ lang: 'en', panel: 'p' }))![1].split(' ').includes('aun-menu'));
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
    'aun-brand-name', 'aun-brand-app', 'aun-env', 'aun-lang', 'aun-icon-btn',
    'aun-signin', 'aun-acct-btn', 'aun-visually-hidden', 'aun-menu-collapse', 'aun-header-panel', 'aun-collapse']) {
    assert.match(css, new RegExp(`\\.${cls}[\\s,{:]`), `.${cls} is styled`);
  }
  // every control is 2.5rem (40px) tall; the bar 4rem, 3.5rem on phones
  for (const sel of ['.aun-lang {\n  display', '.aun-brand {', '.aun-signin {']) {
    const block = css.slice(css.indexOf(sel), css.indexOf('}', css.indexOf(sel)));
    assert.match(block, /min-height: 2\.5rem;/, `${sel} is 2.5rem tall`);
  }
  assert.match(css, /--aun-header-height: 4rem;/);
  assert.match(css, /--aun-header-height: 3\.5rem;/);
  // the bar is exactly 64px / 56px including its 1px bottom border, alone or with a centred row inside
  const bar = css.slice(css.indexOf('.aun-header {'), css.indexOf('}', css.indexOf('.aun-header {')));
  assert.match(bar, /box-sizing: border-box;/);
  assert.match(bar, /min-height: var\(--aun-header-height\);/);
  assert.match(bar, /border-block-end: 1px solid/);
  const row = css.slice(css.indexOf('.aun-header-row {'), css.indexOf('}', css.indexOf('.aun-header-row {')));
  assert.match(row, /min-height: calc\(var\(--aun-header-height\) - 1px\);/);
  // one typeface, and the bar is full width in every app (never centred in a max width)
  assert.match(bar, /font-family: var\(--aun-header-font, system-ui/);
  assert.match(css, /\.aun-header:lang\(ar\) \{\n(  \/\*[^]*?\*\/\n)?  font-family: var\(--aun-header-font-ar, 'Noto Naskh Arabic', 'Geeza Pro', system-ui,/);
  assert.doesNotMatch(row, /max-width/);
  // one line at every width: nothing wraps, the brand is the group that shrinks, its name truncates
  assert.match(bar, /flex-wrap: nowrap;/);
  assert.match(row, /flex-wrap: nowrap;/);
  const brand = css.slice(css.indexOf('.aun-brand {'), css.indexOf('}', css.indexOf('.aun-brand {')));
  assert.match(brand, /flex: 0 1 auto;/);
  const name = css.slice(css.indexOf('.aun-brand-name {'), css.indexOf('}', css.indexOf('.aun-brand-name {')));
  assert.match(name, /text-overflow: ellipsis;/);
  assert.doesNotMatch(css, /--aun-header-max/);
  // below 1024px a site's own links leave the bar for the panel; the menu button shows only there
  assert.match(css, /@media \(max-width: 63\.99rem\) \{[^@]*\.aun-header-primary\.aun-collapse \{\n    display: none;/);
  assert.match(css, /@media \(min-width: 64rem\) \{\n  \.aun-menu-collapse \{\n    display: none;/);
  for (const bp of ['63.99rem', '47.99rem', '39.99rem', '24.99rem']) assert.ok(css.includes(`(max-width: ${bp})`), bp);
  // below 400px language and Sign in narrow after their own rules, so the Arabic Sign in fits a 320px bar
  const tight = css.indexOf('@media (max-width: 24.99rem) {\n  .aun-lang {');
  assert.ok(tight > css.indexOf('.aun-signin {') && tight > css.indexOf('.aun-lang {\n  display'), 'the 400px Sign in / language rule comes after theirs');
  assert.match(css.slice(tight, css.indexOf('\n}\n', tight)), /\.aun-signin \{\n    padding-inline: var\(--fanous-spacing-md, 12px\);/);
});

test('the account button has one width, so switching who you act as never moves the header (AUDIT-2 2026-11-21)', () => {
  const css = readFileSync(new URL('../nav/aun-nav.css', import.meta.url), 'utf8');
  const name = css.slice(css.indexOf('.aun-acct-name {'), css.indexOf('}', css.indexOf('.aun-acct-name {')));
  // the name is a cap, not a slot: the caret follows a short name straight away (AUDIT-2 2026-11-22:
  // a fixed 9rem name slot left ~72px between "Noor Studio" and the caret)
  assert.match(name, /max-inline-size: 9rem;/);
  assert.doesNotMatch(name, /(^|[^-])inline-size:/m);
  // a longer name ends in an ellipsis on one line
  assert.match(name, /text-overflow: ellipsis;/);
  assert.match(name, /white-space: nowrap;/);
  // the one width is on the button where the name shows (768px up), packed to the start, so any
  // spare room sits after the caret; it is sized for the name's full 9rem
  const at = css.indexOf('@media (min-width: 48rem) {\n  .aun-acct-btn:has(.aun-acct-name) {');
  assert.ok(at >= 0, 'button width rule');
  const btn = css.slice(at, css.indexOf('}', at));
  assert.match(btn, /box-sizing: border-box;/);
  assert.match(btn, /inline-size: calc\([^;]*1\.75rem[^;]*9rem[^;]*0\.875rem\);/);
  assert.match(btn, /justify-content: flex-start;/);
});

test('the account name hugs the avatar in both directions, whatever its script (AUDIT-2 2026-11-22)', () => {
  const css = readFileSync(new URL('../nav/aun-nav.css', import.meta.url), 'utf8');
  // dir="auto" gives a Latin name in Arabic its own LTR direction, so `start` alone would put it at the
  // slot's far (left) edge, ~68px from the avatar; the side comes from the page's dir instead
  const side = (dir: string) => {
    const at = css.search(new RegExp(`\\[dir='${dir}'\\] \\.aun-acct-name,`));
    assert.ok(at >= 0, `[dir='${dir}'] .aun-acct-name`);
    return css.slice(at, css.indexOf('}', at));
  };
  assert.match(side('rtl'), /text-align: right;/);
  assert.match(side('ltr'), /text-align: left;/);
  // and nothing later sends it back to its own start
  const ltr = css.search(/\[dir='ltr'\] \.aun-acct-name,/);
  const later = css.slice(css.indexOf('}', ltr));
  assert.doesNotMatch(later, /\.aun-acct-name[^{]*\{[^}]*text-align/);
});
