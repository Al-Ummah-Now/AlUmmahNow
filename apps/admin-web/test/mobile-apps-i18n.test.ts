/**
 * Mobile apps admin page (E22-S4): App Clip bundle id & short-links association i18n parity and Arabic rules.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import en from '../src/i18n/messages/en';
import ar from '../src/i18n/messages/ar';

describe('mobileApps i18n & Arabic conventions (E22-S4)', () => {
  it('defines matching en and ar keys with no ASCII digits or فيديو in Arabic', () => {
    assert.deepEqual(Object.keys(ar.mobileApps).sort(), Object.keys(en.mobileApps).sort());
    for (const [key, rawValue] of Object.entries(ar.mobileApps)) {
      const value = String(rawValue);
      assert.ok(value.trim().length > 0, `ar.mobileApps.${key} is empty`);
      const plain = value.replace(/\{[^}]+\}/g, '');
      assert.doesNotMatch(plain, /فيديو/, `ar.mobileApps.${key} must use مرئي/مرئيات`);
      if (['appClipBundleId', 'appClipHint', 'shortLinksFilesTitle', 'shortLinksFilesHint'].includes(key)) {
        assert.doesNotMatch(plain, /[0-9]/, `ar.mobileApps.${key} contains ASCII digits`);
        assert.doesNotMatch(plain, /,/, `ar.mobileApps.${key} must use Arabic comma ،`);
      }
    }
  });
});
