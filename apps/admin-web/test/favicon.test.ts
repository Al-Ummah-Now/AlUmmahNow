import assert from 'node:assert/strict';
import { test } from 'node:test';
import { appIcons, faviconSvgPath } from '../src/lib/favicon';

test('production and unknown envs get the plain mark', () => {
  assert.equal(faviconSvgPath('production'), '/favicon.svg');
  assert.equal(faviconSvgPath(undefined), '/favicon.svg');
});

test('QA, dev and stage get the marked variants', () => {
  assert.equal(faviconSvgPath('qa'), '/favicon-qa.svg');
  assert.equal(faviconSvgPath('development'), '/favicon-qa.svg');
  assert.equal(faviconSvgPath('stage'), '/favicon-stage.svg');
});

test('icons list the ICO fallback, the SVG and the apple-touch icon', () => {
  const icons = appIcons('qa') as { icon: { url: string }[]; apple: string };
  assert.deepEqual(icons.icon.map((i) => i.url), ['/favicon.ico', '/favicon-qa.svg']);
  assert.equal(icons.apple, '/apple-touch-icon.png');
});
