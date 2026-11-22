/**
 * The Errors page's 14-day sparkline runs like every other chart: oldest to newest left to right
 * in English, right to left in Arabic, so today sits where the Studio chart puts it (#1665
 * re-audit 4).
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Sparkline } from '../src/app/(protected)/errors/ui';

(globalThis as unknown as { React: unknown }).React = React;

const xs = (html: string) => (html.match(/points="([^"]+)"/)?.[1] ?? '').split(' ').map((p) => Number(p.split(',')[0]));

describe('error sparkline direction', () => {
  it('English: oldest on the left, today on the right', () => {
    const x = xs(renderToStaticMarkup(React.createElement(Sparkline, { values: [1, 2, 3], label: 'l', width: 100 })));
    assert.deepEqual(x, [0, 50, 100]);
  });

  it('Arabic: oldest on the right, today on the left', () => {
    const x = xs(renderToStaticMarkup(React.createElement(Sparkline, { values: [1, 2, 3], label: 'l', width: 100, rtl: true })));
    assert.deepEqual(x, [100, 50, 0]);
  });
});
