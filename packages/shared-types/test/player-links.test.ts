import assert from 'node:assert/strict';
import { test } from 'node:test';
import { applySwitchesToUserFeatures, effectiveSwitches, FEATURE_REGISTRY, withDefaults } from '../src/feature-registry.ts';
import { SYSTEM_CREDITS, type SystemCredit } from '../src/player-links.ts';

test('the super-admin player credits switch defaults on and controls Quran text', () => {
  const entry = FEATURE_REGISTRY.find(({ key }) => key === 'playerCredits');
  assert.equal(entry?.group, 'grow');
  assert.equal(entry?.toggle, 'superAdmin');
  assert.equal(entry?.default, true);
  const features = { playerCredits: true, quranText: true };
  assert.deepEqual(applySwitchesToUserFeatures(features, effectiveSwitches(withDefaults({ playerCredits: false }))), {
    playerCredits: false,
    quranText: false,
  });
});

test('the system credit registry contains the bilingual Quran Foundation credit', () => {
  const credits: readonly SystemCredit[] = SYSTEM_CREDITS;
  assert.deepEqual(credits.map(({ id, url, name, when, required }) => ({ id, url, name, when, required })), [{
    id: 'quranFoundation',
    url: 'https://quran.foundation/',
    when: { cueCredit: 'quran' },
    required: true,
    name: { en: 'Quran Foundation', ar: 'مؤسسة القرآن' },
  }]);
});
