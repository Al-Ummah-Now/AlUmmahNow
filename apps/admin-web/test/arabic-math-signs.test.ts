/**
 * Arabic messages never use a mirrored comparison sign (≤ ≥ < >) between words: in a right-to-left
 * line the browser mirrors the glyph, so «١ ≤ الحد الأدنى» was drawn and read as «١ ≥ …» (#1439
 * audit). Comparisons are written in words («من ١ إلى ١٠»، «لا يقل عن»).
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import ar from '../src/i18n/messages/ar';

describe('Arabic comparisons are in words', () => {
  it('no ≤ ≥ < > signs in Arabic messages', () => {
    const found: string[] = [];
    const visit = (node: unknown, path: string) => {
      if (typeof node === 'string') {
        // HTML-ish tags and arrows are not comparisons; only the math signs
        if (/[≤≥]|\s[<>]\s/.test(node)) found.push(`${path}: ${node}`);
      } else if (node && typeof node === 'object') for (const [k, v] of Object.entries(node)) visit(v, path ? `${path}.${k}` : k);
    };
    visit(ar, '');
    assert.deepEqual(found, []);
  });
});
