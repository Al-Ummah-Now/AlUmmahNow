/**
 * Owner rule 2026-11-20 (same text as Android, Apple and Desktop): Arabic compact counts cut to
 * one decimal and the scale word agrees with the number shown: whole 1 «ألف», 2 «ألفان», 3–10
 * «آلاف», 11+ or a decimal «ألف» (likewise مليون/مليار). After a scale word the noun is singular;
 * under 1,000 the noun takes the CLDR plural of the count. English is unchanged.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { compactNumber, formatCountNoun } from '@al-ummah/shared-types';
import { opsFormats } from '../src/app/(protected)/operations/model';
import { visitFormats } from '../src/lib/site-visits';

const sp = (s: string) => s.replace(/[  ]/g, ' ').replace(/[‎‏؜]/g, '');
const COUNTS = [1, 2, 3, 8, 10, 11, 1310, 2000, 8020, 12000, 1_200_000, 3_000_000, 15_000_000];
const AR = ['١', '٢', '٣', '٨', '١٠', '١١', '١٫٣ ألف', '٢ ألفان', '٨ آلاف', '١٢ ألف', '١٫٢ مليون', '٣ ملايين', '١٥ مليون'];
const EN = ['1', '2', '3', '8', '10', '11', '1.3K', '2K', '8K', '12K', '1.2M', '3M', '15M'];

describe('admin compact counts', () => {
  it('chart axes and Operations counts (ar)', () => {
    assert.deepEqual(COUNTS.map((n) => sp(compactNumber('ar')(n))), AR);
    assert.deepEqual(COUNTS.map((n) => sp(opsFormats('ar').count(n))), AR);
    assert.deepEqual(COUNTS.map((n) => sp(visitFormats('ar').axis(n))), AR);
  });

  it('chart axes and Operations counts (en)', () => {
    assert.deepEqual(COUNTS.map((n) => compactNumber('en')(n)), EN);
    assert.deepEqual(COUNTS.map((n) => opsFormats('en').count(n)), EN);
    assert.deepEqual(COUNTS.map((n) => visitFormats('en').axis(n)), EN);
  });

  it('compact views with their noun (ar)', () => {
    assert.deepEqual(COUNTS.map((n) => sp(formatCountNoun('ar', n, 'view', { compact: true }))), [
      'مشاهدة واحدة', 'مشاهدتان', '٣ مشاهدات', '٨ مشاهدات', '١٠ مشاهدات', '١١ مشاهدة',
      '١٫٣ ألف مشاهدة', '٢ ألفان مشاهدة', '٨ آلاف مشاهدة', '١٢ ألف مشاهدة', '١٫٢ مليون مشاهدة', '٣ ملايين مشاهدة', '١٥ مليون مشاهدة',
    ]);
  });

  it('compact views with their noun (en)', () => {
    assert.deepEqual(COUNTS.map((n) => formatCountNoun('en', n, 'view', { compact: true })), [
      '1 view', '2 views', '3 views', '8 views', '10 views', '11 views', '1.3K views', '2K views', '8K views', '12K views', '1.2M views', '3M views', '15M views',
    ]);
  });
});
