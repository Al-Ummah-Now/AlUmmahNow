import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compare, countByFile, formatBaseline, parseBaseline, scanRepo, scanText } from '../check-error-bodies.ts';

test('flags hand-written success: false bodies, one per occurrence', () => {
  const src = [
    "return c.json({ success: false, code: 'not_found' }, 404);",
    "const a = { success:false }, b = { success: false };",
    "return apiError(c, 404, 'not_found');",
    'const ok = { success: true };',
  ].join('\n');
  assert.deepEqual(scanText('apps/admin-api/src/x.ts', src).map((f) => f.line), [1, 2, 2]);
});

test('skips comments and lines marked as not an HTTP body', () => {
  assert.deepEqual(scanText('a.ts', ' * returns { success: false }\n// { success: false }'), []);
  assert.deepEqual(scanText('a.ts', '// error-body: not-http (queue result)\nreturn { success: false, retry: true };'), []);
  assert.deepEqual(scanText('a.ts', 'return { success: false }; // error-body: not-http'), []);
});

test('the baseline can only shrink and must be kept current', () => {
  const findings = scanText('a.ts', 'c.json({ success: false }); c.json({ success: false });');
  const counts = countByFile(findings);
  assert.deepEqual(compare(counts, parseBaseline(formatBaseline(counts)), findings), []);
  assert.match(compare(counts, parseBaseline('a.ts 1'), findings)[0], /baseline allows 1/);
  assert.match(compare(new Map(), parseBaseline('a.ts 2'), [])[0], /update the baseline/);
  assert.match(compare(counts, new Map(), findings)[0], /baseline allows 0/);
});

test('the repo matches its baseline, and the helpers themselves write no hand-made body', () => {
  const findings = scanRepo(process.cwd());
  assert.ok(!findings.some((f) => f.file.endsWith('/lib/api-error.ts')), 'lib/api-error.ts builds bodies through apiErrorBody');
  assert.ok(!findings.some((f) => f.file === 'apps/api-videos/src/lib/features/off.ts'), 'featureOff goes through apiError');
});
