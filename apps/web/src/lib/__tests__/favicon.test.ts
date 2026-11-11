import assert from 'node:assert/strict';
import { appIcons, faviconSvgPath } from '../favicon';

test('production and unknown envs have no SVG (it would be preferred and blurred)', () => {
  assert.equal(faviconSvgPath('production'), null);
  assert.equal(faviconSvgPath(undefined), null);
});

test('QA, dev and stage get the marked variants', () => {
  assert.equal(faviconSvgPath('qa'), '/favicon-qa.svg');
  assert.equal(faviconSvgPath('development'), '/favicon-qa.svg');
  assert.equal(faviconSvgPath('stage'), '/favicon-stage.svg');
});

test('production links the ICO and exact-size PNGs with sizes', () => {
  const icons = appIcons('production') as { icon: { url: string; sizes?: string; type?: string }[]; apple: string };
  assert.deepEqual(icons.icon.map((i) => [i.url, i.sizes]), [
    ['/favicon.ico', '16x16 32x32 48x48'],
    ['/favicon-16x16.png', '16x16'],
    ['/favicon-32x32.png', '32x32'],
    ['/favicon-48x48.png', '48x48'],
    ['/favicon-96x96.png', '96x96'],
  ]);
  assert.ok(icons.icon.every((i) => i.type !== 'image/svg+xml'));
  assert.equal(icons.apple, '/apple-touch-icon.png');
});

test('QA links the ICO and the dot SVG', () => {
  const icons = appIcons('qa') as { icon: { url: string }[] };
  assert.deepEqual(icons.icon.map((i) => i.url), ['/favicon.ico', '/favicon-qa.svg']);
});
