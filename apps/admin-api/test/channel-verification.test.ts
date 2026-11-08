import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { applyVerification, cleanNote, MAX_VERIFICATION_NOTE } from '../src/lib/channelVerification';

const now = '2026-11-08T18:00:00.000Z';
const decision = (verified: boolean, note?: string) => ({ verified, note, actorId: 'admin1', now, id: 'log1' });

describe('channel verification (Epic 6.1)', () => {
  it('verifies an unverified channel and writes an audit row', () => {
    const r = applyVerification({ id: 'ch1', name: 'Noor' }, decision(true, '  Ijazah in hadith, Al-Azhar  '));
    assert.equal(r.changed, true);
    assert.equal(r.channel.isVerified, true);
    assert.equal(r.channel.verifiedAt, now);
    assert.equal(r.channel.verifiedByUserId, 'admin1');
    assert.equal(r.channel.name, 'Noor');
    assert.deepEqual(r.log, { id: 'log1', channel_id: 'ch1', verified: 1, note: 'Ijazah in hadith, Al-Azhar', actor_id: 'admin1', created_at: now });
  });

  it('removes verification', () => {
    const r = applyVerification({ id: 'ch1', isVerified: true, verifiedAt: '2026-01-01' }, decision(false));
    assert.equal(r.changed, true);
    assert.equal(r.channel.isVerified, false);
    assert.equal(r.channel.unverifiedAt, now);
    assert.equal(r.log?.verified, 0);
    assert.equal(r.log?.note, null);
  });

  it('is a no-op when the state is unchanged (no write, no audit row)', () => {
    assert.deepEqual(applyVerification({ id: 'ch1', isVerified: true }, decision(true)).log, null);
    assert.equal(applyVerification({ id: 'ch1' }, decision(false)).changed, false);
  });

  it('caps and trims notes', () => {
    assert.equal(cleanNote('   '), null);
    assert.equal(cleanNote(42), null);
    assert.equal(cleanNote('x'.repeat(MAX_VERIFICATION_NOTE + 50))?.length, MAX_VERIFICATION_NOTE);
  });
});
