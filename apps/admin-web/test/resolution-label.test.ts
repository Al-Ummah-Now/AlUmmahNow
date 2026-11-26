/** Resolutions, a video's details and the Arabic of the media pages (lib/resolution-label.ts). */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createTranslator } from '../src/i18n/translate';
import ar from '../src/i18n/messages/ar';
import { resolutionLabel, resolutionsLabel } from '../src/lib/resolution-label';

const t = { en: createTranslator('en'), ar: createTranslator('ar') };

describe('resolutions', () => {
  it('are read in the reader\'s language: digits ٠–٩ and the unit in words in Arabic', () => {
    assert.equal(resolutionsLabel('360p,480p,720p', t.en), '360p, 480p, 720p');
    assert.equal(resolutionsLabel('360p,480p,720p', t.ar), '٣٦٠ بكسل، ٤٨٠ بكسل، ٧٢٠ بكسل');
    assert.equal(resolutionsLabel(['1080p', ' 2160p '], t.ar), '١٠٨٠ بكسل، ٢١٦٠ بكسل');
    // Not a resolution: as it is
    assert.equal(resolutionLabel('audio', t.ar), 'audio');
  });
});

describe('the Arabic of the media pages', () => {
  it('Bunny takes a masculine verb, and Processing health has one name', () => {
    const text = JSON.stringify(ar);
    assert.doesNotMatch(text, /(تُبلغ عنه|رفضت|لم تنتهِ) Bunny/);
    assert.doesNotMatch(text, /صحة المعالجة/);
  });
});
