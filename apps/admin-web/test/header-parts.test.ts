/**
 * Drift guard (docs/design/NAV.md "Header"): the admin header's pieces render exactly the markup of
 * packages/fanous-tokens/nav/header.js, the builders every other app renders. Only app hooks may be
 * added (test ids, handlers). The logo is the videos site's file, byte for byte.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import * as React from 'react';
import { appLinksHtml, brandHtml, envBadgeHtml, langButtonHtml, menuButtonHtml, modeButtonHtml, signInHtml } from '../../../packages/fanous-tokens/nav/header.js';
import { modeIconSvg } from '../../../packages/fanous-tokens/nav/mode-toggle.js';
import { HeaderAppLinks, HeaderBrand, HeaderEnvBadge, HeaderLangButton, HeaderMenuButton, HeaderModeButton, HeaderSignIn, selfHref } from '../src/components/shell/HeaderParts';

// tsx compiles the components' JSX in classic mode (tsconfig jsx: preserve): they read the global React
(globalThis as unknown as { React: unknown }).React = React;

const h = React.createElement as (type: unknown, props?: Record<string, unknown> | null, ...children: unknown[]) => React.ReactElement;
/** React's spelling → the builders': void tags, apostrophes, attribute-name case; test ids and preload hints dropped. */
const norm = (html: string) =>
  html
    // React 19's server renderer adds image preload hints ahead of the markup: not part of the element
    .replace(/<link rel="preload" as="image"[^>]*\/?>/g, '')
    .replace(/\sdata-testid="[^"]*"/g, '')
    .replace(/\s*\/>/g, '>')
    .replace(/&#x27;/g, '&#39;')
    .replace(/\shrefLang=/g, ' hreflang=');
const r = (type: unknown, props: Record<string, unknown>) => norm(renderToStaticMarkup(h(type, props)));

for (const lang of ['en', 'ar'] as const) {
  describe(`admin header pieces equal the shared builders (${lang})`, () => {
    it('brand', () => {
      assert.equal(r(HeaderBrand, { lang, href: '/dashboard', app: 'Admin' }), norm(brandHtml({ lang, href: '/dashboard', app: 'Admin' })));
    });

    it('environment badge', () => {
      for (const env of ['qa', 'stage', 'production', 'development', '']) {
        assert.equal(norm(renderToStaticMarkup(h('span', null, h(HeaderEnvBadge, { environment: env, lang })))), `<span>${envBadgeHtml(env, lang)}</span>`, env);
      }
    });

    it('app links: Website and Videos', () => {
      const links = [{ id: 'www', href: 'https://www.qa.alummahnow.net/en/' }, { id: 'videos', href: 'https://videos.qa.alummahnow.net/en' }];
      assert.equal(r(HeaderAppLinks, { lang, links }), norm(appLinksHtml({ lang, links })));
    });

    it('language button: the current page and query (the language is a cookie)', () => {
      assert.equal(r(HeaderLangButton, { lang, href: '/videos?q=a&page=2' }), norm(langButtonHtml({ lang, href: '/videos?q=a&page=2' })));
    });

    it('drawer toggle: menuButtonHtml\'s button, icon and name, the same as the videos site\'s (no popovertarget: a drawer)', () => {
      const want = norm(menuButtonHtml({ lang, panel: 'p' })).replace(' aun-menu-collapse', '').replace(' popovertarget="p"', '');
      assert.equal(r(HeaderMenuButton, { lang }), want);
      assert.equal(r(HeaderMenuButton, { lang, className: 'admin-menu-btn' }), want.replace('aun-menu-btn"', 'aun-menu-btn admin-menu-btn"'));
    });

    it('light / dark: the builder\'s button, with both icons (CSS shows the one for the mode on screen)', () => {
      for (const dark of [true, false]) {
        const html = r(HeaderModeButton, { lang, dark });
        const want = norm(modeButtonHtml({ lang, dark }));
        const open = (s: string) => s.slice(0, s.indexOf('>') + 1);
        assert.equal(open(html), open(want));
        assert.equal(html.slice(open(html).length), `${modeIconSvg('moon', 'mode-icon mode-moon')}${modeIconSvg('sun', 'mode-icon mode-sun')}</button>`);
      }
    });

    it('Sign in', () => {
      assert.equal(r(HeaderSignIn, { lang, href: '/login' }), norm(signInHtml({ lang, href: '/login' })));
    });
  });
}

describe('header logo', () => {
  it('is the videos site\'s /brand/logo-64.webp', () => {
    assert.deepEqual(readFileSync(new URL('../public/brand/logo-64.webp', import.meta.url)), readFileSync(new URL('../../web/public/brand/logo-64.webp', import.meta.url)));
  });
});

describe('language link (selfHref): this page and query, never off-site', () => {
  it('keeps the page and the query', () => {
    assert.equal(selfHref('/videos', '?status=ready&page=2'), '/videos?status=ready&page=2');
    assert.equal(selfHref('/dashboard', ''), '/dashboard');
    assert.equal(selfHref('/dashboard', '?'), '/dashboard');
    assert.equal(selfHref(null, ''), '/');
  });
  it('a request path cannot make it protocol-relative', () => {
    for (const p of ['//evil.example', '/\\evil.example', '\\\\evil.example', '///a']) {
      const href = selfHref(p, '?x=1');
      assert.match(href, /^\/[^/\\]/);
      assert.equal(new URL(href, 'https://admin.qa.alummahnow.net').host, 'admin.qa.alummahnow.net');
    }
  });
});
