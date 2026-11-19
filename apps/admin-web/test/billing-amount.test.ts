/** Prices: English with the usual symbol; Arabic with ٠–٩ and the currency's Arabic name, never «US$». */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatBillingAmount } from '@al-ummah/shared-types';

test('English: the usual symbol and 0–9', () => {
  assert.equal(formatBillingAmount(900, 'USD', 'en'), '$9.00');
  assert.equal(formatBillingAmount(450, 'EUR', 'en'), '€4.50');
});

test('Arabic: Eastern Arabic digits and the Arabic currency name, no Latin letters or symbol', () => {
  const usd = formatBillingAmount(900, 'USD', 'ar');
  assert.match(usd, /٩٫٠٠/);
  assert.match(usd, /دولار أمريكي/);
  assert.doesNotMatch(usd, /[0-9A-Za-z$]/);
  const eur = formatBillingAmount(450, 'EUR', 'ar');
  assert.match(eur, /٤٫٥٠/);
  assert.match(eur, /يورو/);
  assert.doesNotMatch(eur, /€/);
});
