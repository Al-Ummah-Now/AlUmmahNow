import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compare, countByFile, formatBaseline, parseBaseline, scanText, FORMATTER } from '../check-locale-format.ts';

test('flags direct Intl, toLocale*String, pinned locale literals and chartLocale', () => {
  const src = [
    "const a = new Intl.NumberFormat('ar').format(1);",
    'const b = n.toLocaleString();',
    "const c = d.toLocaleDateString('ar-SA');",
    "const e = 'ar-u-nu-latn';",
    "const g = chartLocale(locale);",
  ].join('\n');
  const rules = scanText('apps/web/src/x.ts', src).map((f) => f.rule);
  assert.deepEqual(rules, ['Intl constructor', 'toLocale*String', 'toLocale*String', 'locale literal', 'locale literal', 'chartLocale']);
});

test('skips the formatter, comments and lines marked as machine formatting', () => {
  assert.deepEqual(scanText(FORMATTER, "new Intl.NumberFormat('ar')"), []);
  assert.deepEqual(scanText('a.ts', ' * new Intl.NumberFormat(locale)\n// n.toLocaleString()'), []);
  assert.deepEqual(scanText('a.ts', "// locale-format: machine (time-zone maths)\nnew Intl.DateTimeFormat('en-US', { timeZone })"), []);
  assert.deepEqual(scanText('a.ts', "new Intl.DateTimeFormat('en-US', { timeZone }) // locale-format: machine"), []);
});

test('the baseline can only shrink and must be kept current', () => {
  const findings = scanText('a.ts', 'x.toLocaleString(); y.toLocaleString();');
  const counts = countByFile(findings);
  assert.deepEqual(compare(counts, parseBaseline(formatBaseline(counts)), findings), []);
  assert.match(compare(counts, parseBaseline('a.ts 1'), findings)[0], /baseline allows 1/);
  assert.match(compare(new Map(), parseBaseline('a.ts 2'), [])[0], /update the baseline/);
  assert.match(compare(counts, new Map(), findings)[0], /baseline allows 0/);
});
