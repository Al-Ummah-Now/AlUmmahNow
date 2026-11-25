// Every problem the validator reports has a code, so an app can word it in its own language.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validatePackage } from '../src/validate.ts';
import { THEMES_DIR, loadPackageDir } from '../scripts/load.ts';

const broken = (change: (t: any) => void, assets?: Record<string, Uint8Array>) => {
  const pack = loadPackageDir(`${THEMES_DIR}/zujaj`);
  const t = structuredClone(pack.theme) as any;
  change(t);
  return validatePackage(t, assets ? { assets: { ...pack.assets, ...assets } } : {}).errors;
};
const codes = (errors: { code?: string }[]) => [...new Set(errors.map((e) => e.code))];
const text = (s: string) => new TextEncoder().encode(s);

test('each kind of problem has its code', () => {
  assert.deepEqual(codes(broken((t) => { t.name.ar = ''; })), ['empty']);
  assert.deepEqual(codes(broken((t) => { t.name.en = 'x'.repeat(81); })), ['tooLong']);
  assert.deepEqual(codes(broken((t) => { delete t.name.ar; })), ['missing']);
  assert.deepEqual(codes(broken((t) => { t.surprise = true; })), ['unknownField']);
  assert.deepEqual(codes(broken((t) => { t.name = 'Zujaj'; })), ['wrongType']);
  assert.deepEqual(codes(broken((t) => { t.components.header.colors.light.bg = '#ffffff'; })).includes('headerContrast'), true);
  assert.deepEqual(codes(broken((t) => { t.banner = { enabled: true }; })), ['bannerText']);
  assert.deepEqual(codes(broken((t) => { t.imagery.pattern = 'assets/none.svg'; }, {})), ['fileMissing']);
  assert.deepEqual(codes(broken(() => {}, { 'assets/a.txt': text('x') })), ['fileName']);
  assert.deepEqual(codes(broken(() => {}, { 'assets/a.png': text('x') })), ['fileType']);
  assert.deepEqual(codes(broken(() => {}, { 'assets/a.svg': text('<svg><script/></svg>') })), ['fileUnsafe']);
});

test('a contrast problem carries the two colors and the numbers', () => {
  const errors = broken((t) => { t.tokens.color.light.textPrimary = t.tokens.color.light.background; });
  const hit = errors.find((e) => e.path === 'tokens.color.light.textPrimary');
  assert.equal(hit?.code, 'contrast');
  assert.equal(hit?.params?.color, 'textPrimary');
  assert.equal(hit?.params?.min, 4.5);
  assert.equal(typeof hit?.params?.ratio, 'number');
});

test('no problem is without a code', () => {
  const errors = broken((t) => {
    t.formatVersion = 9; t.kind = 'nope'; t.name.ar = ''; t.tokens.color.dark.oops = 3; t.components.header.colors.light.bg = 'gold'; t.materials.radius = null; t.imagery.logo = 5;
  });
  assert.ok(errors.length >= 6);
  assert.deepEqual(errors.filter((e) => !e.code), []);
});
