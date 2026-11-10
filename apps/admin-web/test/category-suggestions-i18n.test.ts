/**
 * AI category suggestions page: every label exists in English and Arabic, and
 * every category the AI can suggest has a label in both languages.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { VIDEO_CATEGORIES, VideoCategory } from '@al-ummah/shared-types';
import en from '../src/i18n/messages/en';
import ar from '../src/i18n/messages/ar';

const ARABIC = /[؀-ۿ]/;

describe('category suggestion labels', () => {
  it('en and ar define the same keys, with Arabic text in ar', () => {
    const enKeys = Object.keys(en.categorySuggestions).sort();
    assert.deepEqual(Object.keys(ar.categorySuggestions).sort(), enKeys);
    for (const key of enKeys) assert.ok(ARABIC.test((ar.categorySuggestions as Record<string, string>)[key]), `ar categorySuggestions.${key}`);
    assert.ok(ARABIC.test(ar.nav.categorySuggestions));
  });

  it('labels every queue, status, source and refusal the API returns', () => {
    const keys = [
      ...['review', 'needs_category', 'flagged', 'reviewed', 'all'].flatMap((v) => [`view_${v}`, `viewHint_${v}`]),
      ...['pending', 'done', 'failed', 'budget', 'disabled', 'empty'].map((s) => `status_${s}`),
      ...['ai', 'uploader', 'admin'].map((s) => `source_${s}`),
      ...['changed_since', 'no_suggestion', 'video_missing'].map((e) => `error_${e}`),
    ];
    for (const key of keys) assert.ok((en.categorySuggestions as Record<string, string>)[key], `en categorySuggestions.${key}`);
  });

  it('every category has an English and an Arabic label', () => {
    for (const value of Object.values(VideoCategory)) {
      const found = VIDEO_CATEGORIES.find((c) => c.value === value);
      assert.ok(found?.label.en && found.label.ar && ARABIC.test(found.label.ar), value);
    }
  });
});
