import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { eraseTombstoneKey, type ErrorEventInput } from '@al-ummah/shared-types';
import { erasedUserIds, ingestErrorEvents } from '../src/lib/errors-store';
import { sqliteD1 } from './d1-sqlite';

/**
 * #1255: an error report that arrives after its user's account was erased (a page still open) is
 * stored anonymised: the erased marker as user, no identifying extra keys, no affected-user row.
 */

const ERASED = 'usr_0123456789abcdef0123456789abcdef';
const ALIVE = 'usr_fedcba9876543210fedcba9876543210';

const ev = (over: Partial<ErrorEventInput>): ErrorEventInput =>
  ({ app: 'web', kind: 'caught', ref: `ERR-${Math.random().toString(36).slice(2, 10)}`, name: 'TypeError', message: 'setVolume of null', route: '/en/video/x', shown: true, ...over }) as ErrorEventInput;

describe('erase tombstones in error ingestion', () => {
  it('anonymises reports of erased users and keeps the others', async () => {
    const db = sqliteD1();
    await db.prepare('INSERT INTO erased_users (user_key, erased_at) VALUES (?, ?)').bind(await eraseTombstoneKey(ERASED), 1).run();
    assert.deepEqual([...(await erasedUserIds(db, [{ userId: ERASED }, { userId: ALIVE }, {}]))], [ERASED]);

    await ingestErrorEvents(db, [ev({ userId: ERASED, extra: { email: 'gone@example.com', step: 'play' } }), ev({ userId: ALIVE })], { now: new Date('2026-11-13T12:00:00Z'), environment: 'qa' } as never);
    const events = (await db.prepare('SELECT user_id, extra_json FROM error_events ORDER BY user_id').all()).results.map((r) => ({ ...r }));
    assert.deepEqual(events, [
      { user_id: 'deleted-user', extra_json: JSON.stringify({ step: 'play' }) },
      { user_id: ALIVE, extra_json: null },
    ]);
    const users = (await db.prepare('SELECT user_key FROM error_group_users').all()).results.map((r) => ({ ...r }));
    assert.deepEqual(users, [{ user_key: ALIVE }]);
    const all = JSON.stringify((await db.prepare('SELECT * FROM error_events').all()).results);
    assert.ok(!all.includes(ERASED) && !all.includes('gone@example.com'));
  });
});
