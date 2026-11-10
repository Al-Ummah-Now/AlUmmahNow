import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import sharp from 'sharp';
import { asModule, buildApp, desktopIco, ENV_DOT, manifest, svgWrap } from '../src/build.ts';
import { APP_IDS, appOfName, cropBox, MAPPING, sourcesIn } from '../src/crop.ts';
import { ico, pngSize } from '../src/ico.ts';

const entries = (body: Uint8Array) => {
  const v = new DataView(body.buffer, body.byteOffset, body.byteLength);
  return Array.from({ length: v.getUint16(4, true) }, (_, i) => pngSize(body.subarray(v.getUint32(6 + 16 * i + 12, true))).width);
};

test('file names map to apps, longest name first, with aliases', () => {
  assert.equal(appOfName('setC-videos-admin-v2.png'), 'videos-admin');
  assert.equal(appOfName('setC-videos-magnific-v1.png'), 'videos');
  assert.equal(appOfName('setC-signin-keyhole.png'), 'auth');
  assert.equal(appOfName('setC-account-flat-silhouette.png'), 'profile');
  assert.equal(appOfName('setC-staff-ring-octagon.png'), undefined);
});

test('a newer file named for an app replaces its mapped source', () => {
  const dir = mkdtempSync(join(tmpdir(), 'icons-'));
  try {
    for (const f of new Set(Object.values(MAPPING))) if (f !== 'logo') writeFileSync(join(dir, f), 'x');
    assert.deepEqual(sourcesIn(dir), MAPPING);
    writeFileSync(join(dir, 'setC-videos-magnific-v2.png'), 'x');
    utimesSync(join(dir, 'setC-videos-magnific-v2.png'), new Date(), new Date(Date.now() + 60_000));
    writeFileSync(join(dir, 'setC-videos-admin-new.png'), 'x');
    utimesSync(join(dir, 'setC-videos-admin-new.png'), new Date(), new Date(Date.now() + 60_000));
    const s = sourcesIn(dir);
    assert.equal(s.videos, 'setC-videos-magnific-v2.png');
    assert.equal(s['videos-admin'], 'setC-videos-admin-new.png');
    assert.equal(s.tools, MAPPING.tools);
  } finally { rmSync(dir, { recursive: true }) }
});

test('the crop is a square inside a baked-in rounded frame, clear of its corners', async () => {
  // a 1376x768 canvas with a centred 600 px tile: 20 px bevel with rounded corners, art inside
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1376" height="768"><rect width="1376" height="768" fill="#2a2f35"/>
    <rect x="388" y="84" width="600" height="600" rx="90" fill="#9cc"/><rect x="408" y="104" width="560" height="560" rx="70" fill="#0a2a3a"/></svg>`;
  const file = join(mkdtempSync(join(tmpdir(), 'icons-')), 'framed.png');
  await sharp(Buffer.from(svg)).png().toFile(file);
  const box = await cropBox(file);
  assert.equal(box.frame, true);
  assert.ok(box.size >= 480 && box.size <= 560, `size ${box.size}`);
  assert.ok(Math.abs(box.left + box.size / 2 - 688) <= 2 && Math.abs(box.top + box.size / 2 - 384) <= 2);
  const { data } = await sharp(file).extract({ left: box.left, top: box.top, width: box.size, height: box.size }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  for (let i = 0; i < data.length; i += 3) assert.ok(data[i] < 40, 'no frame pixel left in the crop');
  rmSync(file);
});

test('production SVG is the art alone; QA and stage add the corner dot', () => {
  const png = new Uint8Array([1, 2, 3]);
  assert.ok(!svgWrap(png).includes('<circle'));
  assert.ok(svgWrap(png, 'qa').includes(ENV_DOT.qa));
  assert.ok(svgWrap(png, 'stage').includes(ENV_DOT.stage));
});

test('every app builds every size from its crop', async () => {
  for (const app of APP_IDS) {
    const files = new Map((await buildApp(app, { legacyPng: true })).map((f) => [f.path, f.body]));
    assert.deepEqual(entries(files.get('favicon.ico')!), [16, 32, 48], app);
    for (const [path, size] of [['apple-touch-icon.png', 180], ['icon-192.png', 192], ['icon-512.png', 512], ['favicon-16x16.png', 16]] as const) {
      assert.deepEqual(pngSize(files.get(path)!), { width: size, height: size }, `${app} ${path}`);
    }
    assert.ok(!files.has('icon-maskable-512.png'));
  }
});

test('manifest, Tools desktop ICO and the TS module', async () => {
  const m = JSON.parse(manifest('cms', { base: '/icons/' }));
  assert.equal(m.name, 'Al Ummah Now CMS');
  assert.deepEqual(m.icons.map((i: { src: string }) => i.src), ['/icons/icon-192.png', '/icons/icon-512.png']);
  assert.deepEqual(entries(await desktopIco('tools')), [16, 24, 32, 48, 64, 128, 256]);
  assert.match(asModule('auth', await buildApp('auth')), /'\/favicon\.svg': \{ type: 'image\/svg\+xml', body: '/);
});

test('ico rejects oversize entries', () => {
  const fake = new Uint8Array(24);
  fake.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  new DataView(fake.buffer).setUint32(16, 512);
  new DataView(fake.buffer).setUint32(20, 512);
  assert.throws(() => ico([fake]), /256/);
});
