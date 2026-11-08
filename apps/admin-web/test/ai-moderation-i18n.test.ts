/**
 * Epic 28: every AI moderation category, decision and surface has an English and an Arabic label.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { LLAMA_GUARD_CATEGORIES, MODERATION_EXTENSION_CATEGORIES } from '@al-ummah/shared-types';
import en from '../src/i18n/messages/en';
import ar from '../src/i18n/messages/ar';

const ARABIC = /[؀-ۿ]/;

describe('AI moderation labels', () => {
  const groups: [keyof typeof en, string[]][] = [
    ['aiCategory', [...Object.keys(LLAMA_GUARD_CATEGORIES), ...MODERATION_EXTENSION_CATEGORIES]],
    ['aiDecision', ['none', 'would_flag', 'would_hide', 'flag', 'hide', 'skipped']],
    ['aiSurface', ['video_comment', 'community_post', 'post_comment', 'video_metadata']],
    ['aiReview', ['pending', 'agreed', 'disagreed', 'n/a']],
    ['aiSkip', ['disabled', 'budget', 'error', 'empty']],
  ];
  for (const [group, keys] of groups) {
    it(`${String(group)} is labelled in en and ar`, () => {
      const enGroup = en[group] as Record<string, string>;
      const arGroup = ar[group] as Record<string, string>;
      for (const key of keys) {
        assert.ok(enGroup[key], `en ${String(group)}.${key}`);
        assert.ok(arGroup[key] && ARABIC.test(arGroup[key]), `ar ${String(group)}.${key}`);
      }
    });
  }
});
