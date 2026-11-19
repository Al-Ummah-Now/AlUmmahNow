/**
 * The admin number fields (#1643): typed text in either digit set becomes a Latin number, values
 * show ٠–٩ and «٫» in Arabic, range messages, the rendered field, and that no type="number" box
 * (which only ever shows 0–9) is left in admin-web.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { I18nProvider } from '../src/i18n/I18nProvider';
import { NumberField } from '../src/components/forms/NumberField';
import { latinOf, numberProblem, showNumber, toLatinNumber } from '../src/components/forms/number-text';

(globalThis as unknown as { React: unknown }).React = React;
const h = React.createElement;

describe('toLatinNumber', () => {
  const whole = { decimal: false, negative: false };
  const dec = { decimal: true, negative: false };
  it('reads ٠–٩ and ۰–۹ as 0–9 and drops anything that is not a digit', () => {
    assert.equal(toLatinNumber('١٠', whole), '10');
    assert.equal(toLatinNumber('۱۲', whole), '12');
    assert.equal(toLatinNumber(' 1 4a4 0 ', whole), '1440');
    assert.equal(toLatinNumber('١٬٤٤٠', whole), '1440', 'the Arabic thousands mark is dropped');
  });
  it('keeps one decimal mark («٫», "." or ",") only where decimals are allowed', () => {
    assert.equal(toLatinNumber('٥٫٦٠', dec), '5.60');
    assert.equal(toLatinNumber('5,5', dec), '5.5');
    assert.equal(toLatinNumber('1.2.3', dec), '1.23');
    assert.equal(toLatinNumber('5.5', whole), '55');
  });
  it('a minus only at the start and only when negatives are allowed', () => {
    assert.equal(toLatinNumber('-3', whole), '3');
    assert.equal(toLatinNumber('-3', { decimal: false, negative: true }), '-3');
    assert.equal(toLatinNumber('3-', { decimal: false, negative: true }), '3');
  });
});

describe('showNumber and latinOf', () => {
  it('Arabic shows ٠–٩ and «٫»; English is unchanged', () => {
    assert.equal(showNumber('ar', '10'), '١٠');
    assert.equal(showNumber('ar', '0.05'), '٠٫٠٥');
    assert.equal(showNumber('en', '0.05'), '0.05');
  });
  it('controlled values: numbers, text and NaN', () => {
    assert.equal(latinOf(10), '10');
    assert.equal(latinOf(Number.NaN), '');
    assert.equal(latinOf(null), '');
    assert.equal(latinOf('٤٠'), '40');
  });
});

describe('numberProblem', () => {
  it('range, one-sided bounds, whole numbers; empty is left to required', () => {
    assert.deepEqual(numberProblem('0', { min: 1, max: 60, whole: true }), { key: 'range', min: 1, max: 60 });
    assert.deepEqual(numberProblem('-1', { min: 0, whole: true }), { key: 'min', min: 0 });
    assert.deepEqual(numberProblem('101', { max: 100, whole: true }), { key: 'max', max: 100 });
    assert.deepEqual(numberProblem('1.5', { min: 0, max: 10, whole: true }), { key: 'whole' });
    assert.equal(numberProblem('1.5', { min: 0, max: 10, whole: false }), null);
    assert.equal(numberProblem('', { min: 1, whole: true }), null);
    assert.deepEqual(numberProblem('.', { whole: false }), { key: 'invalid' });
  });
});

describe('rendered field', () => {
  const render = (locale: 'en' | 'ar', props: Record<string, unknown>) =>
    renderToStaticMarkup(h(I18nProvider as never, { locale, theme: 'light' } as never, h(NumberField as never, { id: 'n', ...props } as never)));

  it('a text box with the numeric keyboard showing Arabic digits, the Latin value in data-value', () => {
    const html = render('ar', { value: 10, min: 1, max: 10000, onChange: () => {} });
    assert.match(html, /type="text"/);
    assert.match(html, /inputMode="numeric"/);
    assert.match(html, /value="١٠"/);
    assert.match(html, /data-value="10"/);
    assert.doesNotMatch(html, /type="number"/);
  });

  it('decimal fields get the decimal keyboard; English shows 0–9', () => {
    const html = render('en', { value: '5.6', decimal: true, onChange: () => {} });
    assert.match(html, /inputMode="decimal"/);
    assert.match(html, /value="5.6"/);
  });

  it('with a name, a hidden input submits the Latin value', () => {
    const html = render('ar', { name: 'retentionDays', defaultValue: 365 });
    assert.match(html, /<input type="hidden"[^>]*name="retentionDays"[^>]*value="365"/);
    assert.match(html, /value="٣٦٥"/);
  });
});

describe('no type="number" in admin-web', () => {
  const root = join(__dirname, '..', 'src');
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.tsx?$/.test(name)) files.push(p);
    }
  };
  walk(root);
  it('every number field is NumberField (or shows locale digits itself, like the R2 range)', () => {
    const offenders = files.filter((f) => /type=["{']*number/.test(readFileSync(f, 'utf8'))).map((f) => f.slice(root.length + 1));
    assert.deepEqual(offenders.filter((f) => !f.endsWith('R2Settings.tsx') && !f.endsWith('NumberField.tsx')), []);
  });
});
