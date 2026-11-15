/**
 * Drift guard (docs/design/NAV.md "Header"): the videos header's pieces render exactly the markup of
 * packages/fanous-tokens/nav/header.js, the builders every other app renders. Only app hooks may be
 * added: test ids, the logo's eager-load attributes, event handlers.
 */
import { renderToStaticMarkup } from 'react-dom/server';
import {
  brandHtml,
  envBadgeHtml,
  langButtonHtml,
  menuButtonHtml,
  modeButtonHtml,
  signInHtml,
} from '../../../../../../packages/fanous-tokens/nav/header.js';
import { HeaderBrand, HeaderEnvBadge, HeaderLangButton, HeaderMenuButton, HeaderModeButton, HeaderSignIn, langSwitchHref } from '../HeaderParts';

/** React's spelling → the builders': void tags, apostrophes; app-only attributes dropped. */
const norm = (html: string) =>
  html
    // React 19 emits a preload hint for a high-priority image; in a page it goes to <head>
    .replace(/^<link rel="preload" as="image"[^>]*>/, '')
    .replace(/\s(data-testid|srcset|srcSet|loading|fetchpriority|fetchPriority|decoding)="[^"]*"/g, '')
    .replace(/\s*\/>/g, '>')
    .replace(/&#x27;/g, '&#39;')
    // HTML attribute names are case-insensitive; React 18's server renderer keeps hrefLang's camel case
    .replace(/\shrefLang=/g, ' hreflang=');
const r = (el: React.ReactElement) => norm(renderToStaticMarkup(el));

describe.each(['en', 'ar'] as const)('header pieces equal the shared builders (%s)', (lang) => {
  it('brand', () => {
    expect(r(<HeaderBrand lang={lang} href={`/${lang}/`} app="Videos" img={{ srcSet: '/a 1x', loading: 'eager', fetchPriority: 'high', decoding: 'async', 'data-testid': 'brand-logo' }} />))
      .toBe(norm(brandHtml({ lang, href: `/${lang}/`, app: 'Videos' })));
    expect(r(<HeaderBrand lang={lang} href="/" />)).toBe(norm(brandHtml({ lang, href: '/' })));
  });

  it('environment badge', () => {
    for (const env of ['qa', 'stage', 'production', 'development', '']) {
      expect(r(<span>{HeaderEnvBadge({ environment: env, lang })}</span>)).toBe(`<span>${envBadgeHtml(env, lang)}</span>`);
    }
  });

  it('language button', () => {
    const href = lang === 'ar' ? '/en/search?q=a&type=video' : '/ar/search?q=a&type=video';
    expect(r(<HeaderLangButton lang={lang} href={href} />)).toBe(norm(langButtonHtml({ lang, href })));
  });

  it('drawer toggle: menuButtonHtml\'s button, icon and name (a drawer, not a popover: no popovertarget, no aun-menu-collapse)', () => {
    const want = norm(menuButtonHtml({ lang, panel: 'p' })).replace(' aun-menu-collapse', '').replace(' popovertarget="p"', '');
    expect(r(<HeaderMenuButton lang={lang} />)).toBe(want);
    // the videos drawer adds its own class and names the button for closing while the drawer is open
    expect(r(<HeaderMenuButton lang={lang} className="ah-menu" label="Close menu" aria-expanded />))
      .toBe(want.replace('aun-menu-btn"', 'aun-menu-btn ah-menu"').replace(/aria-label="[^"]*" title="[^"]*"/, 'aria-label="Close menu" title="Close menu" aria-expanded="true"'));
  });

  it('light / dark button', () => {
    for (const dark of [true, false]) {
      expect(r(<HeaderModeButton lang={lang} dark={dark} />)).toBe(norm(modeButtonHtml({ lang, dark })));
    }
  });

  it('Sign in: the builder\'s class and words (a submit button here: the sign-in action is a form post)', () => {
    const want = /^<a class="([^"]+)" href="[^"]*">([^<]+)<\/a>$/.exec(signInHtml({ lang, href: '/x' }))!;
    expect(r(<HeaderSignIn lang={lang} />)).toBe(`<button type="submit" class="${want[1]}">${want[2]}</button>`);
  });
});

describe('langSwitchHref: the same page and query in the other language, never off-site', () => {
  it('swaps the locale prefix and keeps the path and query', () => {
    expect(langSwitchHref('/en/search', 'en', 'q=a&type=video')).toBe('/ar/search?q=a&type=video');
    expect(langSwitchHref('/ar/watch/abc', 'ar')).toBe('/en/watch/abc');
    expect(langSwitchHref('/en', 'en')).toBe('/ar');
    expect(langSwitchHref('/en/', 'en')).toBe('/ar');
    expect(langSwitchHref('', 'en')).toBe('/ar');
    // a path that merely starts with the letters is not the prefix
    expect(langSwitchHref('/english', 'en')).toBe('/ar/english');
  });
  it('a request path cannot make it protocol-relative', () => {
    for (const p of ['//evil.example', '/\\evil.example', '/en//evil.example', '/en/\\evil.example', '\\\\evil.example']) {
      const href = langSwitchHref(p, 'en');
      expect(href).toMatch(/^\/ar(\/[^/\\]|$)/);
      expect(new URL(href, 'https://videos.qa.alummahnow.net').host).toBe('videos.qa.alummahnow.net');
    }
  });
});
