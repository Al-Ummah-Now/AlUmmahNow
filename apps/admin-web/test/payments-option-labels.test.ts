/**
 * Payment provider choice settings (#1649): every option a provider offers (Paddle's tax category
 * and tax mode codes) has an English and an Arabic label; the code stays the stored value.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { PAYMENT_PROVIDERS } from '@al-ummah/shared-types';
import { createTranslator, translateDynamic } from '../src/i18n/translate';

const en = createTranslator('en');
const ar = createTranslator('ar');

describe('payment provider option labels', () => {
  const choices = Object.values(PAYMENT_PROVIDERS).flatMap((p) => p.settings.filter((s) => s.kind === 'choice').map((s) => ({ provider: p.id, spec: s })));

  it('there are choice settings to label (Paddle tax category and mode)', () => {
    assert.ok(choices.length >= 2);
  });

  for (const { provider, spec } of choices) {
    it(`${provider}.${spec.key}: every option has en and ar labels, never the raw code`, () => {
      for (const code of spec.options ?? []) {
        const prefix = `payments.provider.settingOptions.${spec.key}`;
        const enLabel = translateDynamic(en, prefix, code);
        const arLabel = translateDynamic(ar, prefix, code);
        assert.notEqual(enLabel, code, `${code}: English label missing`);
        assert.notEqual(arLabel, code, `${code}: Arabic label missing`);
        assert.match(arLabel, /[؀-ۿ]/, `${code}: the Arabic label is in Arabic`);
        assert.notEqual(arLabel, enLabel, `${code}: Arabic is not the English text`);
      }
    });
  }
});
