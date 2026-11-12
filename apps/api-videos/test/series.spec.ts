/**
 * Numbered series continue in order (lib/series.ts; the owner's 2026-11-11 rule "not 1 leading to
 * 11 and 2 leading to 11").
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { findSeriesNext, normalizeTitle } from '../src/lib/series';

const v = (id: string, ...titles: string[]) => ({ id, titles });
const lessons = (...ns: number[]) => ns.map((n) => v(`l${n}`, `Lesson ${n}`));

describe('findSeriesNext', () => {
  it('1 → 2, never 1 → 11', () => {
    assert.equal(findSeriesNext(v('l1', 'Lesson 1'), lessons(11, 2, 1, 10, 3)), 'l2');
  });

  it('9 → 10', () => {
    assert.equal(findSeriesNext(v('l9', 'Lesson 9'), lessons(1, 10, 9, 2)), 'l10');
  });

  it('2 → 3 when 11 exists', () => {
    assert.equal(findSeriesNext(v('l2', 'Lesson 2'), lessons(11, 3, 2, 1)), 'l3');
  });

  it('padded numbers: "01" → "02"', () => {
    const series = [v('a', 'Tafsir 01'), v('b', 'Tafsir 02'), v('c', 'Tafsir 10')];
    assert.equal(findSeriesNext(v('a', 'Tafsir 01'), series), 'b');
  });

  it('Arabic-Indic digits, tatweel, diacritics and punctuation', () => {
    const series = [v('a', 'الدرس ١'), v('b', 'الـدَّرْسُ - ٢'), v('k', 'الدرس ١١')];
    assert.equal(findSeriesNext(v('a', 'الدرس ١'), series), 'b');
    assert.equal(normalizeTitle('الحلقةُ  ٣!'), 'الحلقة 3');
  });

  it('Arabic and English series words ("الحلقة ٣", "Episode 3")', () => {
    assert.equal(findSeriesNext(v('e3', 'Episode 3'), [v('e3', 'Episode 3'), v('e4', 'episode  4'), v('x', 'Episode 3 extra')]), 'e4');
    assert.equal(findSeriesNext(v('h3', 'الحلقة ٣'), [v('h4', 'الحلقة 4'), v('h3', 'الحلقة ٣')]), 'h4');
  });

  it('the translated title continues the series too', () => {
    const series = [v('a', 'Lesson 1', 'الدرس ١'), v('b', 'Second lesson', 'الدرس ٢')];
    assert.equal(findSeriesNext(v('a', 'Lesson 1', 'الدرس ١'), series), 'b');
  });

  it('several numbers: the one that varies across the channel ("Part 2 – 2024")', () => {
    const series = [v('p1', 'Part 1 – 2024'), v('p2', 'Part 2 – 2024'), v('p3', 'Part 3 – 2024'), v('y', 'Part 2 – 2025')];
    assert.equal(findSeriesNext(v('p2', 'Part 2 – 2024'), series), 'p3');
  });

  it('a gap: 3 missing → 4', () => {
    assert.equal(findSeriesNext(v('l2', 'Lesson 2'), lessons(1, 2, 4, 5)), 'l4');
  });

  it('the series end, and titles without a number: nothing (the related ranking decides)', () => {
    assert.equal(findSeriesNext(v('l5', 'Lesson 5'), lessons(1, 2, 3, 4, 5)), null);
    assert.equal(findSeriesNext(v('x', 'Introduction'), lessons(1, 2)), null);
    // Another series with a number is not this one's continuation
    assert.equal(findSeriesNext(v('a', 'Fiqh 1'), [v('b', 'Seerah 2')]), null);
  });
});
