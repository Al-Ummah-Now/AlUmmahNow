import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkControls, duplicateIds, findControls, latinDigitsInArabic, tipIds, validateArea } from '../src/validate.ts';
import { localizeArea, tipData } from '../src/content.ts';
import { VIDEOS_ADMIN_HELP } from '../content/videos-admin/index.ts';
import type { HelpArea } from '../src/types.ts';

const b = (en: string, ar = 'نص') => ({ en, ar });
const entry = (over: Record<string, unknown> = {}) => ({
  id: 'demo.thing.limit', anchor: 'thing-limit', label: b('Limit'), summary: b('Short.'), what: b('What.'), changes: b('Changes.'),
  default: b('{#10}', '{#10}'), cautions: [], rules: [], sources: ['x.tsx'], ...over,
});
const area = (settings: unknown[], over: Record<string, unknown> = {}) => ({ area: 'demo', route: '/demo', title: b('Demo'), intro: b('Intro'), settings, ...over });

test('the shipped content is valid', () => {
  for (const a of VIDEOS_ADMIN_HELP) assert.deepEqual(validateArea(`${a.area}.json`, a, a.area), []);
  assert.deepEqual(duplicateIds(VIDEOS_ADMIN_HELP.map((a) => ({ file: a.area, area: a }))), []);
});

test('a valid area passes', () => {
  assert.deepEqual(validateArea('demo.json', area([entry()]), 'demo'), []);
});

test('missing Arabic fails', () => {
  const problems = validateArea('demo.json', area([entry({ what: { en: 'What.' } })]), 'demo');
  assert.ok(problems.some((p) => p.message.includes('what needs en and ar')));
});

test('a long popover summary fails', () => {
  const problems = validateArea('demo.json', area([entry({ summary: b('x'.repeat(300)) })]), 'demo');
  assert.ok(problems.some((p) => p.message.includes('summary.en is 300 characters')));
});

test('a free input without a default fails', () => {
  const problems = validateArea('demo.json', area([entry({ default: undefined })]), 'demo');
  assert.ok(problems.some((p) => p.message.includes('needs a default')));
});

test('duplicate anchors and ids fail', () => {
  assert.ok(validateArea('d.json', area([entry(), entry({ id: 'demo.other.x' })]), 'demo').some((p) => p.message.includes('used twice')));
  const a = area([entry()]) as unknown as HelpArea;
  assert.equal(duplicateIds([{ file: 'a', area: a }, { file: 'b', area: a }]).length, 1);
});

test('Arabic 0–9 is caught outside {#n}, URLs and Latin names', () => {
  assert.deepEqual(latinDigitsInArabic('حتى {#100} مستخدم، OAuth2 و AES-256 https://x.com/1'), []);
  assert.deepEqual(latinDigitsInArabic('حتى 100 مستخدم'), ['100']);
  assert.ok(validateArea('d.json', area([entry({ what: b('What.', 'خلال 30 ثانية') })]), 'demo').some((p) => p.message.includes('{#n}')));
});

test('an https source is required for rules', () => {
  const problems = validateArea('d.json', area([entry({ rules: [{ ...b('Rule'), source: 'http://x' }] })]), 'demo');
  assert.ok(problems.some((p) => p.message.includes('https URL')));
});

test('controls without help fail; exempt, hidden and named ones pass', () => {
  const src = `
    <input type="text" value={v} onChange={(e) => set(e.target.value > 1 ? 'a' : 'b')} />
    <input type="hidden" name="id" />
    <input type="search" data-help-exempt="search box" />
    <select data-help="demo.thing.limit">{opts}</select>
    <NumberField data-help="demo.missing" />
    <HelpTip id="demo.thing.limit" />`;
  assert.equal(findControls(src).length, 5);
  const problems = checkControls('f.tsx', src, new Set(['demo.thing.limit']));
  assert.deepEqual(problems.map((p) => p.line), [2, 6]);
  assert.match(problems[1]?.message ?? '', /demo\.missing/);
});

test('tipIds reads HelpTip ids and helpId props', () => {
  assert.deepEqual(tipIds('<HelpTip id="a.b" /> <Field helpId="c.d" />'), ['a.b', 'c.d']);
});

test('localizing fills numbers and builds the guide link', () => {
  const fill = (l: string, t: string) => t.replace(/\{#(\d+)\}/g, (_, n: string) => (l === 'ar' ? n.replace(/\d/g, (d) => '٠١٢٣٤٥٦٧٨٩'[Number(d)] ?? d) : n));
  const a = area([entry({ tipCaution: b('Careful') })]) as unknown as HelpArea;
  const ar = localizeArea(a, 'ar', fill);
  assert.equal(ar.settings[0]?.default, '١٠');
  assert.equal(ar.settings[0]?.href, '/help/demo#thing-limit');
  const tips = tipData([a], 'en', fill);
  assert.deepEqual(Object.keys(tips['demo.thing.limit'] ?? {}).sort(), ['href', 'id', 'label', 'summary', 'tipCaution']);
});

test('code spans in backticks may hold 0–9 in Arabic', () => {
  assert.deepEqual(latinDigitsInArabic('مثل `1.4.0` أو {#5}'), []);
});
