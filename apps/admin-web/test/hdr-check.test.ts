/** HDR check panel (Delivery): labels in both languages, and which videos may be re-encoded. */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import en from '../src/i18n/messages/en';
import ar from '../src/i18n/messages/ar';
import { createTranslator } from '../src/i18n/translate';
import { HDR_KIND_LABEL, HDR_NOW_LABEL, HDR_REENCODE_MAX, hdrSelectable } from '../src/app/(protected)/delivery/hdr-check-view';

const item = (id: string, now?: 'same' | 'encoding' | 'replaced' | 'gone') => ({ id, title: null, kind: 'hlg' as const, rev: 'r', ...(now ? { now } : {}) });

describe('HDR check', () => {
  it('offers only videos still showing the HDR rendition', () => {
    assert.deepEqual(hdrSelectable([item('a', 'same'), item('b', 'encoding'), item('c', 'replaced'), item('d', 'gone'), item('e')]), ['a', 'e']);
    assert.equal(HDR_REENCODE_MAX, 50);
  });
  it('has every string in both languages, with the same placeholders, and no «فيديو»', () => {
    const holes = (s: string) => [...s.matchAll(/\{[^}]+\}/g)].map((m) => m[0]).sort();
    for (const [key, text] of Object.entries(en.hdrCheck)) {
      const arabic = (ar.hdrCheck as Record<string, string>)[key];
      assert.ok(arabic, key);
      assert.deepEqual(holes(arabic), holes(text), key);
      assert.ok(!arabic.includes('فيديو'), key);
    }
    for (const t of [createTranslator('en'), createTranslator('ar')]) {
      for (const key of [...Object.values(HDR_KIND_LABEL), ...Object.values(HDR_NOW_LABEL)]) assert.notEqual(t(key), key);
    }
  });
});
