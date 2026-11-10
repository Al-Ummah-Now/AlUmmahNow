/**
 * Processing health / Errors pages (incident 2026-11-10): labels for every
 * state in both languages, filter parsing and the role gate.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import en from '../src/i18n/messages/en';
import ar from '../src/i18n/messages/ar';
import { createTranslator } from '../src/i18n/translate';
import { bunnyLabel, checkLabel, ourStatusLabel, parseFilter } from '../src/app/(protected)/processing/labels';
import { canUseProcessing } from '../src/lib/roles';

const ARABIC = /[؀-ۿ]/;

describe('processing health', () => {
  it('every processing and errors string exists in English and Arabic', () => {
    for (const group of ['processing', 'errorsPage'] as const) {
      for (const key of Object.keys(en[group])) {
        const value = (ar[group] as Record<string, string>)[key];
        assert.ok(value, `${group}.${key} missing in Arabic`);
        if (!/^(colBunny)$/.test(key)) assert.match(value, ARABIC, `${group}.${key} is not Arabic`);
      }
    }
  });

  it('maps Bunny states, our states and the check loop to labels', () => {
    const t = createTranslator('en');
    assert.equal(bunnyLabel(t, null), 'Not found at Bunny');
    assert.equal(bunnyLabel(t, undefined), 'Unknown');
    assert.equal(bunnyLabel(t, { status: 3, encodeProgress: 42 }), 'Encoding 42%');
    assert.equal(bunnyLabel(t, { status: 4 }), 'Finished');
    assert.equal(bunnyLabel(t, { status: 8 }), 'Playable');
    assert.equal(ourStatusLabel(t, 'processing'), 'Processing');
    assert.equal(checkLabel(t, null, (d) => d), 'Not running');
    assert.equal(checkLabel(t, { loopId: 'l', startedAt: 'a', attempt: 2, nextCheckAt: 'soon' }, (d) => d), 'Check 3, next soon');
    assert.equal(checkLabel(t, { loopId: 'l', startedAt: 'a', attempt: 2, finishedAt: 'x', outcome: 'ready' }, (d) => d), 'Finished: Becomes ready');
  });

  it('parses the filter and defaults to stuck', () => {
    assert.equal(parseFilter('failed'), 'failed');
    assert.equal(parseFilter('nonsense'), 'stuck');
    assert.equal(parseFilter(undefined), 'stuck');
  });

  it('is for admins and super admins, not moderators', () => {
    assert.equal(canUseProcessing('Admin'), true);
    assert.equal(canUseProcessing('Super Admin'), true);
    assert.equal(canUseProcessing('moderator'), false);
  });
});
