/** An unknown user's id (CopyId) sits inside paragraphs, so it and the names around it are phrasing content only. */
import './support/next-navigation-stub';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { I18nProvider } from '../src/i18n/I18nProvider';
import { UserName } from '../src/components/audit/UserName';

(globalThis as unknown as { React: unknown }).React = React;

const PHRASING = new Set(['a', 'bdi', 'button', 'code', 'span']);

describe('an unknown user', () => {
  for (const locale of ['en', 'ar'] as const) {
    it(`renders only what a paragraph may hold (${locale})`, () => {
      const Provider = I18nProvider as unknown as React.FC<{ locale: string; theme: string; children?: React.ReactNode }>;
      const html = renderToStaticMarkup(React.createElement(Provider, { locale, theme: 'light' }, React.createElement(UserName, { id: 'usr_nobody' })) as never);
      const tags = [...new Set([...html.matchAll(/<([a-z0-9]+)[\s>]/g)].map((m) => m[1]!))];
      assert.deepEqual(tags.filter((tag) => !PHRASING.has(tag)), []);
      // Closed at first, the id there and reachable
      assert.match(html, /aria-expanded="false"/);
      assert.match(html, /<span id="[^"]+" hidden="">/);
      assert.match(html, /usr_nobody<\/code>/);
    });
  }
});
