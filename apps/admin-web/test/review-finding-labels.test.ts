/**
 * Review workspace: automated findings show labels in the admin's language,
 * never raw codes such as "religious_misattribution", "transcript" or "S10".
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { CATEGORY_WEIGHTS, NSFW_TEXT_CATEGORIES, ESCALATE_CATEGORIES, REVIEW_REASON_CODES } from '@al-ummah/shared-types';
import { createTranslator } from '../src/i18n/translate';
import { findingCategoryLabel, findingSourceLabel } from '../src/lib/review-labels';

const ARABIC = /[؀-ۿ]/;
const CATEGORIES = [...new Set([
  ...Object.keys(CATEGORY_WEIGHTS), ...NSFW_TEXT_CATEGORIES, ...ESCALATE_CATEGORIES, ...Object.keys(REVIEW_REASON_CODES),
  'gore', 'disturbing', 'minor_present', 'S1', 'S4', 'S10', 'S12',
])];
const SOURCES = ['metadata', 'thumbnail', 'frame', 'transcript', 'image'];

describe('review finding labels', () => {
  for (const locale of ['en', 'ar'] as const) {
    const t = createTranslator(locale);
    it(`labels every category and source in ${locale}`, () => {
      for (const category of CATEGORIES) {
        const label = findingCategoryLabel(t, category);
        assert.notEqual(label, category, `${locale} category ${category}`);
        if (locale === 'ar') assert.ok(ARABIC.test(label), `ar category ${category}: ${label}`);
      }
      for (const source of SOURCES) {
        const label = findingSourceLabel(t, source);
        assert.notEqual(label, source, `${locale} source ${source}`);
        if (locale === 'ar') assert.ok(ARABIC.test(label), `ar source ${source}`);
      }
    });
  }

  it('shows an unknown code as is rather than nothing', () => {
    assert.equal(findingCategoryLabel(createTranslator('en'), 'brand_new_code'), 'brand_new_code');
  });
});
