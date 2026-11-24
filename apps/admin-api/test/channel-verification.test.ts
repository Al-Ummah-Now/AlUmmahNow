import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { applyVerification, cleanNote, MAX_VERIFICATION_NOTE } from '../src/lib/channelVerification';

const now = '2026-11-08T18:00:00.000Z';
const decision = (verified: boolean, note?: string, kind: 'scholar' | 'institution' | null = verified ? 'scholar' : null) => ({ verified, note, kind, actorId: 'admin1', now, id: 'log1' });

describe('channel verification (Epic 6.1; scholar label, wiki E21-D4)', () => {
  it('verifies an unverified channel and writes an audit row', () => {
    const r = applyVerification({ id: 'ch1', name: 'Noor' }, decision(true, '  Ijazah in hadith, Al-Azhar  '));
    assert.equal(r.changed, true);
    assert.equal(r.channel.isVerified, true);
    assert.equal(r.channel.verifiedAt, now);
    assert.equal(r.channel.verifiedByUserId, 'admin1');
    assert.equal(r.channel.name, 'Noor');
    assert.equal(r.channel.verificationKind, 'scholar');
    assert.deepEqual(r.log, { id: 'log1', channel_id: 'ch1', verified: 1, note: 'Ijazah in hadith, Al-Azhar', kind: 'scholar', actor_id: 'admin1', created_at: now });
  });

  it('removes verification', () => {
    const r = applyVerification({ id: 'ch1', isVerified: true, verificationKind: 'scholar', verifiedAt: '2026-01-01' }, decision(false, 'Credentials withdrawn'));
    assert.equal(r.changed, true);
    assert.equal(r.channel.isVerified, false);
    assert.equal(r.channel.verificationKind, undefined);
    assert.equal(r.log?.kind, null);
    assert.equal(r.channel.unverifiedAt, now);
    assert.equal(r.log?.verified, 0);
    assert.equal(r.log?.note, 'Credentials withdrawn');
  });

  it('is a no-op when the state is unchanged (no write, no audit row)', () => {
    assert.deepEqual(applyVerification({ id: 'ch1', isVerified: true, verificationKind: 'scholar' }, decision(true)).log, null);
    assert.equal(applyVerification({ id: 'ch1' }, decision(false)).changed, false);
  });

  it('a new grant with another kind changes the kind and keeps the first verified date', () => {
    const r = applyVerification({ id: 'ch1', isVerified: true, verificationKind: 'scholar', verifiedAt: '2026-01-01' }, decision(true, 'It is a seminary', 'institution'));
    assert.equal(r.changed, true);
    assert.equal(r.channel.verificationKind, 'institution');
    assert.equal(r.channel.verifiedAt, '2026-01-01');
    assert.equal(r.log?.kind, 'institution');
  });

  it('caps and trims notes', () => {
    assert.equal(cleanNote('   '), null);
    assert.equal(cleanNote(42), null);
    assert.equal(cleanNote('x'.repeat(MAX_VERIFICATION_NOTE + 50))?.length, MAX_VERIFICATION_NOTE);
  });
});
