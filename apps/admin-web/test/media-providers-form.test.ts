/**
 * The provider settings forms (src/lib/media/providers-form.ts): list edits, weights, which
 * changes ask first, override drafts, and that every label the forms use exists in English and
 * Arabic (docs/media-delivery/PROVIDERS.md).
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_MEDIA_SETTINGS, type MediaSettings, type SettingsProblem } from '@al-ummah/shared-types';
import { createTranslator, type MessageKey } from '../src/i18n/translate';
import {
  OVERRIDE_PROBLEM_LABEL,
  PROBLEM_LABEL,
  PROVIDER_LABEL,
  draftOf,
  moveProvider,
  overrideOf,
  parseWhole,
  riskyChanges,
  toggleProvider,
  weightShares,
  withUnlisted,
} from '../src/lib/media/providers-form';

const settings = (patch: Partial<MediaSettings> = {}): MediaSettings => ({ ...DEFAULT_MEDIA_SETTINGS, ...patch });

describe('provider lists', () => {
  it('moves a provider one place and stops at the ends', () => {
    assert.deepEqual(moveProvider(['bunny', 'r2'], 'r2', -1), ['r2', 'bunny']);
    assert.deepEqual(moveProvider(['bunny', 'r2'], 'bunny', -1), ['bunny', 'r2']);
    assert.deepEqual(moveProvider(['bunny', 'r2'], 'r2', 1), ['bunny', 'r2']);
    assert.deepEqual(moveProvider(['bunny'], 'r2', 1), ['bunny']);
  });

  it('adds at the end, removes in place, never duplicates', () => {
    assert.deepEqual(toggleProvider(['bunny'], 'r2', true), ['bunny', 'r2']);
    assert.deepEqual(toggleProvider(['bunny', 'r2'], 'bunny', false), ['r2']);
    assert.deepEqual(toggleProvider(['bunny', 'r2'], 'bunny', true), ['r2', 'bunny']);
  });

  it('shows every provider, the listed ones first', () => {
    assert.deepEqual(withUnlisted(['r2']), ['r2', 'bunny']);
    assert.deepEqual(withUnlisted([]), ['bunny', 'r2']);
  });

  it('parses whole numbers in range only', () => {
    assert.equal(parseWhole(' 10 ', 0, 100), 10);
    assert.equal(parseWhole('101', 0, 100), null);
    assert.equal(parseWhole('1.5', 0, 100), null);
    assert.equal(parseWhole('', 0, 100), null);
    assert.equal(parseWhole('-1', 0, 100), null);
  });

  it('turns weights into shares of plays over the providers that play', () => {
    assert.deepEqual(weightShares(['bunny', 'r2'], { bunny: 30, r2: 10 }), { bunny: 75, r2: 25 });
    assert.deepEqual(weightShares(['bunny'], { bunny: 0 }), { bunny: 0 });
  });
});

describe('changes that ask first', () => {
  it('switching a provider off, changing who plays first, or dropping an upload target', () => {
    const before = settings({ playback: { ...DEFAULT_MEDIA_SETTINGS.playback, order: ['bunny', 'r2'] } });
    assert.deepEqual(riskyChanges(before, before), []);
    const r2First = settings({ playback: { ...DEFAULT_MEDIA_SETTINGS.playback, order: ['r2', 'bunny'] } });
    assert.deepEqual(riskyChanges(before, r2First), [{ kind: 'first_changed', from: 'bunny', to: 'r2' }]);
    const bunnyOff = settings({ providers: { bunny: { enabled: false }, r2: { enabled: true } }, ingest: ['r2'], playback: { ...DEFAULT_MEDIA_SETTINGS.playback, order: ['bunny', 'r2'] } });
    const kinds = riskyChanges(before, bunnyOff).map((r) => r.kind);
    assert.ok(kinds.includes('provider_off'));
    assert.ok(kinds.includes('first_changed'), 'Bunny off moves playback to R2');
    assert.ok(!kinds.includes('ingest_dropped'), 'an off provider is reported once, as off');
    const r2NoUploads = settings({ ingest: ['bunny'] });
    assert.deepEqual(riskyChanges(settings(), r2NoUploads), [{ kind: 'ingest_dropped', provider: 'r2' }]);
  });

  it('weights and health numbers save without a question', () => {
    const weighted = settings({ playback: { strategy: 'weighted', order: ['bunny', 'r2'], weights: { bunny: 90, r2: 10 }, assign: 'video' } });
    const moved = settings({ playback: { strategy: 'weighted', order: ['r2', 'bunny'], weights: { bunny: 50, r2: 50 }, assign: 'view' }, health: { ...DEFAULT_MEDIA_SETTINGS.health, cooldownMinutes: 30 } });
    assert.deepEqual(riskyChanges(weighted, moved), []);
  });
});

describe('override drafts', () => {
  it('round-trips an override and drops what follows the settings', () => {
    const o = { ingest: ['r2' as const], strategy: 'weighted' as const, order: ['r2' as const, 'bunny' as const], weights: { r2: 80, bunny: 20 }, note: ' slow Bunny edge ' };
    assert.deepEqual(overrideOf(draftOf(o), { ingest: true }), { ingest: ['r2'], strategy: 'weighted', order: ['r2', 'bunny'], weights: { r2: 80, bunny: 20 }, note: 'slow Bunny edge' });
    assert.equal(overrideOf(draftOf(null), { ingest: true }), null);
    assert.equal(overrideOf({ ...draftOf(null), note: 'only a note' }, { ingest: true }), null, 'a note alone is no override');
  });

  it('a video override never carries upload targets; weights only when weighted', () => {
    const d = { ...draftOf({ ingest: ['r2'], order: ['r2'] }), weights: { r2: '50' } };
    assert.deepEqual(overrideOf(d, { ingest: false }), { order: ['r2'] });
  });

  it('bad weight text is left out rather than saved as 0', () => {
    const d = { ...draftOf(null), strategy: 'weighted' as const, order: ['bunny' as const, 'r2' as const], weights: { bunny: 'x', r2: '40' } };
    assert.deepEqual(overrideOf(d, { ingest: false })!.weights, { r2: 40 });
  });
});

describe('labels exist in English and Arabic', () => {
  const problems: SettingsProblem[] = [
    'no_provider_enabled',
    'ingest_empty',
    'ingest_disabled',
    'playback_empty',
    'ingest_not_playable',
    'weights_zero',
    'thumbnail_store_disabled',
    'override_ingest_disabled',
    'override_not_playable',
  ];

  for (const locale of ['en', 'ar'] as const) {
    it(`every problem, provider and override label (${locale})`, () => {
      const t = createTranslator(locale);
      const keys: MessageKey[] = [...problems.map((p) => PROBLEM_LABEL[p]), ...Object.values(PROVIDER_LABEL), ...Object.values(OVERRIDE_PROBLEM_LABEL), 'content.errors.not_on_bunny' as MessageKey];
      for (const key of keys) assert.notEqual(t(key, { detail: 'x' }), key, `${key} is missing in ${locale}`);
    });
  }

  it('the Arabic copy says «مرئي», never «فيديو»', () => {
    const t = createTranslator('ar');
    for (const key of ['mediaProviders.video.copiesEmpty', 'mediaProviders.video.problemNotFound', 'content.errors.not_on_bunny'] as MessageKey[]) {
      assert.ok(t(key).includes('مرئي'), key);
      assert.ok(!t(key).includes('فيديو'), key);
    }
  });
});
