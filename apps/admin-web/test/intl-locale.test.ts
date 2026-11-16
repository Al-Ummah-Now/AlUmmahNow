/** Arabic numbers and dates have the same digits on the server (Node) and in every browser (main red 2026-11-15: React #418 in Safari). */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { intlLocale } from '../src/i18n/intl-locale';
import { createTranslator, formatDate, formatNumber } from '../src/i18n/translate';

test('ar pins Latin digits; en and an explicit numbering system are left alone', () => {
  assert.equal(intlLocale('ar'), 'ar-u-nu-latn');
  assert.equal(intlLocale('ar-EG'), 'ar-EG-u-nu-latn');
  assert.equal(intlLocale('ar-u-nu-arab'), 'ar-u-nu-arab');
  assert.equal(intlLocale('en'), 'en');
});

test('the translator and formatters write Latin digits in Arabic', () => {
  assert.equal(formatNumber(1234, 'ar'), '1,234');
  assert.match(formatDate('2026-11-15T00:00:00Z', 'ar'), /2026/);
  const t = createTranslator('ar');
  assert.doesNotMatch(t('errorsPage.navBadge', { count: 1 }), /[٠-٩]/);
});
