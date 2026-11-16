/**
 * Approved-design check (2026-11-15): people and channels by name, never by id or a user @handle,
 * on the Backfill runs, the channel transfer picker and the token/settings "changed by" lines.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { AdminNames, BackfillRun } from '@al-ummah/shared-types';
import { createTranslator } from '../src/i18n/translate';
import { scopeChannelRefs, scopeText } from '../src/app/(protected)/backfill/labels';
import en from '../src/i18n/messages/en';
import ar from '../src/i18n/messages/ar';

const tEn = createTranslator('en');
const tAr = createTranslator('ar');
const run = (scope: Partial<BackfillRun['scope']>) => ({ id: 'bf-1', scope: { kind: 'channel', onlyMissing: false, ...scope } }) as unknown as BackfillRun;
const names: AdminNames = { users: {}, items: { 'channel:ch_5k1p': { title: 'Daily reminders', found: true } } } as unknown as AdminNames;

describe('backfill run scope', () => {
  it('names the channel when known, the id only as a fallback', () => {
    assert.equal(scopeText(run({ channelId: 'ch_5k1p' }), tEn, names), 'Channel Daily reminders');
    assert.equal(scopeText(run({ channelId: 'ch_5k1p' }), tAr, names), 'القناة Daily reminders');
    assert.equal(scopeText(run({ channelId: 'ch_x' }), tEn, names), 'Channel ch_x');
  });
  it('asks for each channel once', () => {
    assert.deepEqual(scopeChannelRefs([run({ channelId: 'a' }), run({ channelId: 'a' }), run({ kind: 'all' } as never)]), [{ kind: 'channel', id: 'a' }]);
  });
});

describe('transfer picker copy', () => {
  it('never offers a user @handle', () => {
    for (const m of [en, ar]) {
      assert.doesNotMatch(m.channels.newOwnerHint, /@/);
      assert.doesNotMatch(m.channels.newOwnerPlaceholder, /@/);
    }
  });
});
