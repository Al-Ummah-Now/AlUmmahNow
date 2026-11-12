/**
 * #982: an admin save records which keys an admin edited, so a later deploy
 * (new static translations) updates every other key and keeps the edited ones.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { AR_TRANSLATIONS, applyTranslationOverrides } from '@al-ummah/shared-types';
import { MemoryR2 } from './r2-fake';
import { saveTranslations } from '../src/endpoints/i18n/translationsUpdate';

const NOW = '2026-11-12T00:00:00Z';
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));

describe('saveTranslations: admin edits survive a deploy (#982)', () => {
  it('lists the edited key; the next build changes the others and keeps it', async () => {
    const bucket = new MemoryR2();
    await saveTranslations(bucket, 'ar', { common: { save: 'احفظ الآن' } } as any, true, NOW);
    const stored = bucket.read('translations/ar.json');
    assert.deepEqual(stored.overrides, ['common.save']);

    // A deploy: the repo changes both the edited key and an unedited one
    const nextBuild = clone(AR_TRANSLATIONS) as any;
    nextBuild.common.save = 'حفظ (جديد)';
    nextBuild.a11y.goToHomePage = 'نص جديد من المستودع';
    const served = applyTranslationOverrides(nextBuild, stored.translations, stored.overrides) as any;
    assert.equal(served.common.save, 'احفظ الآن', 'the admin edit survives');
    assert.equal(served.a11y.goToHomePage, 'نص جديد من المستودع', 'the repo change reaches the store');
  });

  it('saving the repo value hands the key back to the repo', async () => {
    const bucket = new MemoryR2();
    await saveTranslations(bucket, 'ar', { common: { save: 'احفظ الآن' } } as any, true, NOW);
    await saveTranslations(bucket, 'ar', { common: { save: AR_TRANSLATIONS.common.save } } as any, true, NOW);
    assert.deepEqual(bucket.read('translations/ar.json').overrides, []);
  });

  it('a legacy file keeps its differing keys as edits when first saved', async () => {
    const legacy = clone(AR_TRANSLATIONS) as any;
    legacy.a11y.goToHomePage = 'نص قديم';
    const bucket = new MemoryR2();
    bucket.data.set('translations/ar.json', JSON.stringify({ version: '1.0.5', locale: 'ar', updatedAt: NOW, translations: legacy }));
    await saveTranslations(bucket, 'ar', { common: { save: 'احفظ الآن' } } as any, true, NOW);
    assert.deepEqual(bucket.read('translations/ar.json').overrides, ['a11y.goToHomePage', 'common.save']);
  });
});
