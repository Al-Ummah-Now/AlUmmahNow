/**
 * Refused releases name their source in words (wiki AUN-APP-UPDATES): GitHub and the private
 * bucket in both languages, with the repo isolated; anything else as it is, never a dangling comma.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';
import * as React from 'react';

// These components rely on the automatic JSX runtime; under tsx (classic) React must be in scope
(globalThis as unknown as { React: typeof React }).React = React;
import { createTranslator } from '../src/i18n/translate';
import { ReleaseSource } from '../src/components/app-config/ReleaseSource';

const html = (source: string, locale: 'en' | 'ar') =>
  renderToStaticMarkup(React.createElement(ReleaseSource as unknown as React.FC<object>, { source, t: createTranslator(locale) } as object) as never);
const REPO = '<bdi><bdi dir="ltr">AlUmmahNowTools</bdi></bdi>';

describe('release source', () => {
  it('GitHub and private releases, in English and Arabic, with the repo isolated left to right', () => {
    assert.equal(html('github:AlUmmahNowTools', 'en'), `GitHub, ${REPO}`);
    assert.equal(html('admin:AlUmmahNowTools', 'en'), `Private releases, ${REPO}`);
    assert.equal(html('github:AlUmmahNowTools', 'ar'), `منصة GitHub، ${REPO}`);
    assert.equal(html('admin:AlUmmahNowTools', 'ar'), `الإصدارات الخاصة، ${REPO}`);
  });

  it('an unknown source, or one without a repo, shows as it is and left to right', () => {
    for (const locale of ['en', 'ar'] as const) {
      for (const source of ['github', 'github:', 'github: ', 'admin', 'admin:', 'mirror:AlUmmahNowTools', ':AlUmmahNowTools', '12:34', 'toString:x']) {
        assert.equal(html(source, locale), `<bdi dir="ltr" class="font-mono">${source}</bdi>`, `${locale} ${source}`);
      }
    }
  });

  it('keeps everything after the first colon as the repo', () => {
    assert.equal(html('github:a:b', 'en'), 'GitHub, <bdi><bdi dir="ltr">a:b</bdi></bdi>');
  });
});
