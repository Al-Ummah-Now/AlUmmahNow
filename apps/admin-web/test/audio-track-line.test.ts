import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { audioTrackLanguageName } from '../src/lib/audio-track-line';

describe('audio track line in the review queue', () => {
  it('names the language in the page language', () => {
    assert.equal(audioTrackLanguageName('en', 'Narration', 'ar'), 'الإنجليزية');
    assert.equal(audioTrackLanguageName('ur', 'Urdu commentary', 'en'), 'Urdu');
  });
  it('leaves it out when the label already says it, in either language', () => {
    assert.equal(audioTrackLanguageName('en', 'English', 'en'), null);
    assert.equal(audioTrackLanguageName('ar', 'العربية', 'en'), null);
    assert.equal(audioTrackLanguageName('ar', 'Arabic', 'en'), null);
    assert.equal(audioTrackLanguageName('en', 'English', 'ar'), null);
  });
});
