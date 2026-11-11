import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import sharp from 'sharp';
import { asModule, buildApp, desktopIco, DOT_SVG_SIZE, ENV_DOT, manifest, svgWrap, TAB_SIZES } from '../src/build.ts';
import { APP_IDS, appOfName, cropBox, FRAMING, framed, MAPPING, sourcesIn } from '../src/crop.ts';
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

test('the owner\'s framing is a square inside the frame-free crop', () => {
  const box = { left: 100, top: 50, size: 512 };
  assert.deepEqual(framed(box), box);
  assert.deepEqual(framed(box, FRAMING.videos), { left: 215, top: 230, size: 300 });
  for (const [app, [l, t, s]] of Object.entries(FRAMING)) assert.ok(l >= 0 && t >= 0 && l + s <= 1 && t + s <= 1, app);
  // the admins' octagon frame is their mark: never reframed
  for (const app of ['videos-admin', 'auth-admin', 'tools', 'www'] as const) assert.equal(FRAMING[app], undefined);
});

test('QA and stage SVGs add the corner dot', () => {
  const png = new Uint8Array([1, 2, 3]);
  assert.ok(svgWrap(png, 'qa').includes(ENV_DOT.qa));
  assert.ok(svgWrap(png, 'stage').includes(ENV_DOT.stage));
});

test('every app builds every size from its crop', async () => {
  for (const app of APP_IDS) {
    const files = new Map((await buildApp(app)).map((f) => [f.path, f.body]));
    assert.deepEqual(entries(files.get('favicon.ico')!), [16, 32, 48], app);
    const pngs = [['apple-touch-icon.png', 180], ['icon-192.png', 192], ['icon-512.png', 512], ...TAB_SIZES.map((s) => [`favicon-${s}x${s}.png`, s])] as const;
    for (const [path, size] of pngs) {
      assert.deepEqual(pngSize(files.get(path)!), { width: size, height: size }, `${app} ${path}`);
    }
    assert.ok(!files.has('icon-maskable-512.png'));
    // no production SVG: browsers would prefer it over the exact-size PNGs and blur it
    assert.ok(!files.has('favicon.svg'), `${app} favicon.svg`);
    for (const env of ['qa', 'stage'] as const) {
      const svg = new TextDecoder().decode(files.get(`favicon-${env}.svg`)!);
      const inner = Buffer.from(svg.match(/base64,([^"]+)"/)![1], 'base64');
      assert.deepEqual(pngSize(inner), { width: DOT_SVG_SIZE, height: DOT_SVG_SIZE }, `${app} ${env} svg image`);
      assert.ok(svg.includes(ENV_DOT[env]));
    }
    // true colour (RGB or RGBA), never a quantised palette: the art is used as is
    for (const [path] of pngs) assert.ok([2, 6].includes(files.get(path)![25]), `${app} ${path} colour type`);
  }
});

test('manifest, Tools desktop ICO and the TS module', async () => {
  const m = JSON.parse(manifest('cms', { base: '/icons/' }));
  assert.equal(m.name, 'Al Ummah Now CMS');
  assert.deepEqual(m.icons.map((i: { src: string }) => i.src), ['/icons/icon-192.png', '/icons/icon-512.png']);
  assert.deepEqual(entries(await desktopIco('tools')), [16, 24, 32, 48, 64, 128, 256]);
  assert.match(asModule('auth', await buildApp('auth')), /'\/favicon-32x32\.png': \{ type: 'image\/png', body: '/);
});

test('ico rejects oversize entries', () => {
  const fake = new Uint8Array(24);
  fake.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  new DataView(fake.buffer).setUint32(16, 512);
  new DataView(fake.buffer).setUint32(20, 512);
  assert.throws(() => ico([fake]), /256/);
});
