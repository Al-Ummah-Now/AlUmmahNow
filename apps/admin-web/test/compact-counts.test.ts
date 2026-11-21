/**
 * Owner's final rule 2026-11-20 (identical on Android, Apple, Desktop and web): Arabic compact
 * counts cut to one decimal; exactly 1 or 2 has no digit («ألف», «ألفان», and «ألفا» before a
 * noun), whole 3–10 takes the plural («٣ آلاف»), 11+ and every decimal the singular («١١ ألف»,
 * «١٫٣ ألف»); likewise مليون/مليار. The noun after a scale word is singular; under 1,000 it takes
 * the CLDR plural of the count. English is unchanged.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { compactNumber, formatCountNoun } from '@al-ummah/shared-types';
import { opsFormats } from '../src/app/(protected)/operations/model';
import { visitFormats } from '../src/lib/site-visits';
import { formatCount } from '../src/i18n/translate';

// No-break spaces (the noun joiner) read as spaces; the Arabic grouping space U+202F is kept, it is the point
const sp = (s: string) => s.replace(/\u00a0/g, ' ').replace(/[\u200e\u200f\u061c]/g, '');
const COUNTS = [1, 2, 3, 10, 11, 100, 1000, 1300, 2000, 2500, 3000, 8000, 11000, 1_000_000, 2_000_000, 3_000_000, 15_000_000];
const AR = ['١', '٢', '٣', '١٠', '١١', '١٠٠', 'ألف', '١٫٣ ألف', 'ألفان', '٢٫٥ ألف', '٣ آلاف', '٨ آلاف', '١١ ألف', 'مليون', 'مليونان', '٣ ملايين', '١٥ مليون'];
const EN = ['1', '2', '3', '10', '11', '100', '1K', '1.3K', '2K', '2.5K', '3K', '8K', '11K', '1M', '2M', '3M', '15M'];
const TICKS = [500, 1000, 1500, 2000, 3000, 2_000_000];

describe('admin compact counts', () => {
  it('chart axes and Operations counts (ar)', () => {
    assert.deepEqual(COUNTS.map((n) => sp(compactNumber('ar')(n))), AR);
    assert.deepEqual(COUNTS.map((n) => sp(opsFormats('ar').count(n))), AR);
    assert.deepEqual(COUNTS.map((n) => sp(visitFormats('ar').axis(n))), AR);
    assert.deepEqual(TICKS.map((n) => sp(compactNumber('ar')(n))), ['٥٠٠', 'ألف', '١٫٥ ألف', 'ألفان', '٣ آلاف', 'مليونان']);
  });

  it('chart axes and Operations counts (en)', () => {
    assert.deepEqual(COUNTS.map((n) => compactNumber('en')(n)), EN);
    assert.deepEqual(COUNTS.map((n) => opsFormats('en').count(n)), EN);
    assert.deepEqual(COUNTS.map((n) => visitFormats('en').axis(n)), EN);
    assert.deepEqual(TICKS.map((n) => compactNumber('en')(n)), ['500', '1K', '1.5K', '2K', '3K', '2M']);
  });

  it('compact views with their noun (ar)', () => {
    assert.deepEqual(COUNTS.map((n) => sp(formatCountNoun('ar', n, 'view', { compact: true }))), [
      'مشاهدة واحدة', 'مشاهدتان', '٣ مشاهدات', '١٠ مشاهدات', '١١ مشاهدة', '١٠٠ مشاهدة',
      'ألف مشاهدة', '١٫٣ ألف مشاهدة', 'ألفا مشاهدة', '٢٫٥ ألف مشاهدة', '٣ آلاف مشاهدة', '٨ آلاف مشاهدة', '١١ ألف مشاهدة',
      'مليون مشاهدة', 'مليونا مشاهدة', '٣ ملايين مشاهدة', '١٥ مليون مشاهدة',
    ]);
  });

  it('compact views with their noun (en)', () => {
    assert.deepEqual(COUNTS.map((n) => formatCountNoun('en', n, 'view', { compact: true })), [
      '1 view', '2 views', '3 views', '10 views', '11 views', '100 views', '1K views', '1.3K views', '2K views', '2.5K views',
      '3K views', '8K views', '11K views', '1M views', '2M views', '3M views', '15M views',
    ]);
  });

  it('admin formatCount (exact counts) keeps the CLDR plural', () => {
    assert.deepEqual([1, 2, 3, 11, 100, 2000].map((n) => sp(formatCount(n, 'view', 'ar'))), [
      'مشاهدة واحدة', 'مشاهدتان', '٣ مشاهدات', '١١ مشاهدة', '١٠٠ مشاهدة', '٢\u202f٠٠٠ مشاهدة',
    ]);
  });
});

describe('admin compact counts: English cuts like Arabic', () => {
  const cases: Array<[number, string, string]> = [[33_600, '33.6K', '٣٣٫٦ ألف'], [20_600, '20.6K', '٢٠٫٦ ألف'], [1_299, '1.2K', '١٫٢ ألف'], [2_999, '2.9K', '٢٫٩ ألف'], [12_000, '12K', '١٢ ألف'], [999_999, '999.9K', '٩٩٩٫٩ ألف'], [1_250_000, '1.2M', '١٫٢ مليون'], [15_000_000, '15M', '١٥ مليون']];
  for (const [n, en, ar] of cases) {
    it(`${n} → ${en} / ${ar}`, () => {
      assert.equal(compactNumber('en')(n), en);
      assert.equal(opsFormats('en').count(n), en);
      assert.equal(visitFormats('en').axis(n), en);
      assert.equal(sp(compactNumber('ar')(n)), ar);
    });
  }
});

