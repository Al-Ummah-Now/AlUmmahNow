/**
 * #716: a revoked invite past its purge erases what it left on the videos side once auth purged the
 * invited account, and only then drops its mirror row (lib/invite-erase.ts). Never for an accepted
 * invite; failures keep the row and flag the admin.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { sqliteD1 } from './d1-sqlite';
import { AUTH_GRACE_MS, dueRevokedInvites, inviteEraseItemKey, settleRevokedInvites, type InviteEraseDeps } from '../src/lib/invite-erase';
import { BUILTIN_RETRIES } from '../src/lib/errors-actions';

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.parse('2026-12-20T12:00:00.000Z');
const daysAgo = (n: number) => new Date(NOW - n * DAY).toISOString();

async function seed(db: ReturnType<typeof sqliteD1>, id: string, fields: Record<string, unknown> = {}) {
  const row: Record<string, unknown> = {
    id,
    user_id: `usr_${id}`,
    email: `${id}@example.com`,
    name: null,
    locale: 'en',
    role: 'creator',
    delivery_status: 'sent',
    status: 'revoked',
    accepted_at: null,
    deleted_at: daysAgo(31),
    created_by: 'usr_admin',
    created_at: daysAgo(40),
    updated_at: daysAgo(31),
    ...fields,
  };
  const cols = Object.keys(row);
  await db.prepare(`INSERT INTO creator_invites (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`).bind(...cols.map((c) => row[c])).run();
}

function harness(held: string[] = []) {
  const db = sqliteD1();
  const erased: string[] = [];
  const flagged: { id: string; reason: string }[] = [];
  const resolved: string[] = [];
  const asked: string[][] = [];
  let authDown = false;
  let eraseFails = false;
  const deps: InviteEraseDeps = {
    now: NOW,
    auth: {
      invites: async (ids: string[]) => {
        asked.push(ids);
        if (authDown) throw new Error('auth 503');
        return ids.filter((id) => held.includes(id)).map((id) => ({ id }) as never);
      },
    },
    erase: async (row) => {
      if (eraseFails) throw new Error('videos 500');
      erased.push(row.user_id);
      return { erased: true, tierRemoved: false };
    },
    flag: async (row, reason) => void flagged.push({ id: row.id, reason }),
    resolve: async (row) => void resolved.push(row.id),
  };
  const env = { REPORTS_DB: db } as never;
  const remaining = async () => ((await db.prepare('SELECT id FROM creator_invites ORDER BY id').all<{ id: string }>()).results ?? []).map((r) => r.id);
  return { db, env, deps, erased, flagged, resolved, asked, remaining, downAuth: () => void (authDown = true), failErase: () => void (eraseFails = true) };
}

const settle = async (h: ReturnType<typeof harness>) => settleRevokedInvites(h.env, await dueRevokedInvites(h.db as never, daysAgo(30), 50), h.deps);

describe('revoked invite erase (#716)', () => {
  it('erases the videos side of an invite auth purged, then drops its mirror', async () => {
    const h = harness();
    await seed(h.db, 'gone');
    const out = await settle(h);
    assert.deepEqual(out, { purged: ['gone'], erased: ['gone'], waiting: [], failed: [] });
    assert.deepEqual(h.erased, ['usr_gone']);
    assert.deepEqual(h.asked, [['gone']]);
    assert.deepEqual(h.resolved, ['gone']);
    assert.deepEqual(await h.remaining(), []);
  });

  it('waits while auth still holds the invite (its cleanup has not purged the account)', async () => {
    const h = harness(['held']);
    await seed(h.db, 'held');
    const out = await settle(h);
    assert.deepEqual(out, { purged: [], erased: [], waiting: ['held'], failed: [] });
    assert.deepEqual(h.erased, []);
    assert.deepEqual(h.flagged, []);
    assert.deepEqual(await h.remaining(), ['held']);
  });

  it('flags an invite auth still holds two days after its purge was due', async () => {
    const h = harness(['stuck']);
    await seed(h.db, 'stuck', { deleted_at: new Date(NOW - 30 * DAY - AUTH_GRACE_MS - 60_000).toISOString() });
    await settle(h);
    assert.deepEqual(h.flagged.map((f) => f.id), ['stuck']);
    assert.deepEqual(await h.remaining(), ['stuck']);
  });

  it('never erases an accepted invite: only its mirror goes', async () => {
    const h = harness();
    await seed(h.db, 'acc', { accepted_at: daysAgo(35), status: 'active' });
    const out = await settle(h);
    assert.deepEqual(out, { purged: ['acc'], erased: [], waiting: [], failed: [] });
    assert.deepEqual(h.erased, []);
    assert.deepEqual(h.asked, []);
  });

  it('erases an invite that never reached auth without asking auth', async () => {
    const h = harness();
    await seed(h.db, 'unsent', { delivery_status: 'failed', status: null });
    const out = await settle(h);
    assert.deepEqual(out.purged, ['unsent']);
    assert.deepEqual(h.erased, ['usr_unsent']);
    assert.deepEqual(h.asked, []);
  });

  it('keeps the mirror and flags the admin when auth cannot be asked or the erase fails', async () => {
    const h = harness();
    await seed(h.db, 'a');
    h.downAuth();
    let out = await settle(h);
    assert.deepEqual(out.failed, [{ id: 'a', error: 'auth_unreachable' }]);
    assert.deepEqual(await h.remaining(), ['a']);

    const h2 = harness();
    await seed(h2.db, 'b');
    h2.failErase();
    out = await settle(h2);
    assert.deepEqual(out.failed, [{ id: 'b', error: 'videos 500' }]);
    assert.deepEqual(h2.flagged.map((f) => f.id), ['b']);
    assert.deepEqual(h2.resolved, []);
    assert.deepEqual(await h2.remaining(), ['b']);
  });

  it('leaves invites not yet due alone', async () => {
    const h = harness();
    await seed(h.db, 'recent', { deleted_at: daysAgo(3) });
    assert.deepEqual(await settle(h), { purged: [], erased: [], waiting: [], failed: [] });
    assert.deepEqual(await h.remaining(), ['recent']);
  });

  it('has an Errors page Retry that settles one invite; one purged or restored meanwhile closes the item', async () => {
    const db = sqliteD1();
    const retry = BUILTIN_RETRIES['invite-videos-erase'];
    assert.ok(retry);
    assert.equal(inviteEraseItemKey('inv_1'), 'invite-videos-erase:inv_1');
    assert.deepEqual(await retry({ REPORTS_DB: db } as never, { id: 'inv_missing' }, 'a1'), { ok: true, status: 'resolved', result: 'The invite is already purged' });
    await seed(db, 'restored', { deleted_at: null, status: 'invited' });
    assert.equal((await retry({ REPORTS_DB: db } as never, { id: 'restored' }, 'a1')).status, 'dismissed');
  });
});
