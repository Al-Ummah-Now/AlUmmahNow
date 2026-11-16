/**
 * Title-template dates: the *_ar variables are Gregorian with Eastern Arabic (Hindi) numerals
 * ٠–٩ (they used ar-SA, the Hijri calendar, before), the English ones keep Arabic numerals 0–9
 * (owner decision 2026-11-15, #1488/#1496).
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { processTemplateVariables } from '../src/lib/templates/variables';

describe('template date variables', () => {
  it('Arabic dates are Gregorian in ٠–٩', () => {
    const text = processTemplateVariables('{{date_ar}} {{day_ar}} {{month_ar}}');
    assert.doesNotMatch(text, /[0-9]/, text);
    assert.match(text, new RegExp(String(new Date().getUTCFullYear()).replace(/[0-9]/g, (d) => '٠١٢٣٤٥٦٧٨٩'[Number(d)])));
    assert.doesNotMatch(text, /هـ/, 'not the Hijri calendar');
  });

  it('English dates keep 0–9', () => {
    assert.match(processTemplateVariables('{{date}}'), /^\d{1,2}\/\d{1,2}\/\d{4}$/);
    assert.match(processTemplateVariables('{{time_24}}'), /^\d{1,2}:\d{2}:\d{2}$/);
    assert.match(processTemplateVariables('{{datetime}}'), /^\d{1,2}\/\d{1,2}\/\d{4}, \d{1,2}:\d{2}:\d{2} [AP]M$/);
  });
});
