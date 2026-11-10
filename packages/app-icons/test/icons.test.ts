import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildApp, manifest, asModule } from '../src/build.ts';
import { ico, pngSize } from '../src/ico.ts';
import { APP_IDS, APPS, ENV_DOT, bleedSvg, faviconSvg } from '../src/marks.ts';

test('every app has a distinct tile+glyph+palette', () => {
  const seen = new Set(APP_IDS.map((id) => faviconSvg(id, { scheme: 'light' })));
  assert.equal(seen.size, APP_IDS.length);
});

test('favicon.svg carries a dark variant; fixed-scheme SVGs do not', () => {
  for (const id of APP_IDS) {
    assert.match(faviconSvg(id), /@media\(prefers-color-scheme:dark\)/);
    assert.doesNotMatch(faviconSvg(id, { scheme: 'light' }), /@media/);
  }
});

test('staff tools use the octagon seal, public sites the rounded tile', () => {
  for (const id of APP_IDS) {
    const octagon = faviconSvg(id).includes('class="r"');
    assert.equal(octagon, APPS[id].staff, id);
  }
});

test('only non-production variants carry the environment dot', () => {
  assert.ok(!faviconSvg('www').includes(ENV_DOT.qa));
  assert.ok(faviconSvg('www', { env: 'qa' }).includes(ENV_DOT.qa));
  assert.ok(faviconSvg('www', { env: 'stage' }).includes(ENV_DOT.stage));
});

test('apple-touch art is opaque: a full-canvas background rect', () => {
  for (const id of APP_IDS) assert.match(bleedSvg(id, 0.62), /<rect width="32" height="32" fill="#/);
});

test('ico packs PNG entries with their sizes', async () => {
  const files = await buildApp('cms');
  const file = files.find((f) => f.path === 'favicon.ico')!;
  const v = new DataView(file.body.buffer, file.body.byteOffset, file.body.byteLength);
  assert.equal(v.getUint16(2, true), 1);
  assert.equal(v.getUint16(4, true), 3);
  assert.deepEqual([0, 1, 2].map((i) => v.getUint8(6 + 16 * i)), [16, 32, 48]);
  const at = v.getUint32(6 + 16 * 2 + 12, true);
  assert.deepEqual(pngSize(file.body.subarray(at)), { width: 48, height: 48 });
});

test('the set has every size, small files, and a valid manifest', async () => {
  const files = await buildApp('videos', { base: '/icons/', legacyPng: true });
  const byPath = new Map(files.map((f) => [f.path, f]));
  for (const [path, size] of [['apple-touch-icon.png', 180], ['icon-192.png', 192], ['icon-512.png', 512], ['icon-maskable-512.png', 512], ['favicon-32x32.png', 32]] as const) {
    assert.deepEqual(pngSize(byPath.get(path)!.body), { width: size, height: size }, path);
  }
  for (const f of files) assert.ok(f.body.length < 24_000, `${f.path} is ${f.body.length} B`);
  const m = JSON.parse(new TextDecoder().decode(byPath.get('site.webmanifest')!.body));
  assert.equal(m.icons[0].src, '/icons/icon-192.png');
  assert.ok(m.icons.some((i: { purpose: string }) => i.purpose === 'maskable'));
  assert.deepEqual(JSON.parse(manifest('cms')).name, 'Al Ummah Now CMS');
});

test('ts module form maps request paths to base64 bodies', async () => {
  const mod = asModule('auth', await buildApp('auth'));
  assert.match(mod, /'\/favicon\.svg': \{ type: 'image\/svg\+xml', body: '/);
  assert.match(mod, /'\/apple-touch-icon\.png'/);
});

test('ico rejects oversize entries', () => {
  const fake = new Uint8Array(24);
  fake.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  new DataView(fake.buffer).setUint32(16, 512);
  new DataView(fake.buffer).setUint32(20, 512);
  assert.throws(() => ico([fake]), /256/);
});
