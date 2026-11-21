/**
 * The i18n server actions (src/lib/api/i18n.ts) take a locale from the browser
 * and build their API path with translationsPath(): only 'en' or 'ar' may
 * reach fetch (CodeQL js/request-forgery); anything else gets no path, so the
 * actions return before making a request.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { isSupportedLocale, translationsPath } from '../src/lib/api/i18n-locale';

const UNTRUSTED = [
  '../../admin/users',
  'en/../../internal',
  'en?x=1',
  'en#x',
  '@evil.example',
  'https://evil.example',
  'EN',
  '',
  'fr',
];

describe('i18n locale guard', () => {
  it('accepts en and ar only', () => {
    assert.equal(isSupportedLocale('en'), true);
    assert.equal(isSupportedLocale('ar'), true);
    for (const value of [...UNTRUSTED, undefined, null, 1, {}]) assert.equal(isSupportedLocale(value), false, String(value));
  });

  it('builds the translations path for a supported locale and none otherwise', () => {
    assert.equal(translationsPath('ar'), '/api/i18n/translations/ar');
    assert.equal(translationsPath('en'), '/api/i18n/translations/en');
    for (const value of UNTRUSTED) assert.equal(translationsPath(value), null, value);
  });

  it('every translations request in the server actions goes through the guard', () => {
    const source = readFileSync(new URL('../src/lib/api/i18n.ts', import.meta.url), 'utf8');
    assert.doesNotMatch(source, /translations\/\$\{/, 'no locale interpolated into a URL by hand');
    assert.equal(source.match(/translationsPath\(locale\)/g)?.length, 2);
  });
});
