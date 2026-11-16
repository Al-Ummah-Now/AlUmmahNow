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
import { writeAudit } from '../src/lib/content/audit';

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
  let transferFails = false;
  const owners = new Map<string, string | null>();
  const transfers: [string, string][] = [];
  const deleted = new Set<string>();
  const jobs = new Map<string, string>();
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
    channelOwner: async (id) => (owners.has(id) ? { ownerId: owners.get(id) ?? null, isDeleted: deleted.has(id) } : null),
    jobStatus: async (id) => (jobs.get(id) ?? 'succeeded') as never,
    transferChannel: async (id, to) => {
      if (transferFails) throw new Error('videos 500');
      transfers.push([id, to]);
    },
  };
  const env = { REPORTS_DB: db } as never;
  const remaining = async () => ((await db.prepare('SELECT id FROM creator_invites ORDER BY id').all<{ id: string }>()).results ?? []).map((r) => r.id);
  return { db, env, deps, erased, flagged, resolved, asked, remaining, owners, transfers, deleted, jobs, downAuth: () => void (authDown = true), failErase: () => void (eraseFails = true), failTransfer: () => void (transferFails = true) };
}

const settle = async (h: ReturnType<typeof harness>) => settleRevokedInvites(h.env, await dueRevokedInvites(h.db as never, daysAgo(30), 50), h.deps);

/** The invite moved ch_moved from usr_prev (as invites.router.ts audits it); ch_new was made for it. */
async function seedMovedChannel(h: ReturnType<typeof harness>, id: string, previousOwner: string | null = 'usr_prev') {
  const channels = [
    { id: 'ch_new', name: 'New', action: 'created' },
    { id: 'ch_moved', name: 'Moved', action: 'transferred', jobId: 'job_1' },
  ];
  await seed(h.db, id, { channels: JSON.stringify(channels) });
  await writeAudit(h.db as never, { kind: 'channel', id: 'ch_moved', action: 'transfer', actorId: 'usr_admin', details: { newOwnerId: `usr_${id}`, inviteId: id }, previous: { ownerId: previousOwner } }, daysAgo(40));
  h.owners.set('ch_new', `usr_${id}`);
  h.owners.set('ch_moved', `usr_${id}`);
}

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

  it('gives a channel the invite moved back to its previous owner before erasing anything', async () => {
    const h = harness();
    await seedMovedChannel(h, 'mv');
    let out = await settle(h);
    assert.deepEqual(out, { purged: [], erased: [], waiting: ['mv'], failed: [] });
    assert.deepEqual(h.transfers, [['ch_moved', 'usr_prev']]);
    assert.deepEqual(h.erased, []);
    const audit = await h.db.prepare("SELECT actor_id, new_value, old_value FROM site_settings_log WHERE key = 'content:channel:ch_moved' ORDER BY created_at DESC").first<{ actor_id: string; new_value: string; old_value: string }>();
    assert.equal(audit?.actor_id, 'system:trash-cleanup');
    assert.deepEqual(JSON.parse(audit!.new_value).details, { newOwnerId: 'usr_prev', inviteId: 'mv', reason: 'revoked-invite' });
    assert.deepEqual(JSON.parse(audit!.old_value), { ownerId: 'usr_mv' });

    // The job has not landed yet: wait, without queueing it again
    out = await settle(h);
    assert.deepEqual(out.waiting, ['mv']);
    assert.equal(h.transfers.length, 1);

    // Landed: the channel is the previous owner's again, so the erase goes on
    h.owners.set('ch_moved', 'usr_prev');
    out = await settle(h);
    assert.deepEqual(out, { purged: ['mv'], erased: ['mv'], waiting: [], failed: [] });
    assert.deepEqual(h.erased, ['usr_mv']);
  });

  it('never erases when a moved channel has no known previous owner, or cannot be given back', async () => {
    const h = harness();
    await seedMovedChannel(h, 'orphan', null);
    const out = await settle(h);
    assert.equal(out.failed[0]?.id, 'orphan');
    assert.match(out.failed[0]!.error, /previous owner is unknown/);
    assert.deepEqual(h.erased, []);
    assert.deepEqual(h.transfers, []);
    assert.deepEqual(h.flagged.map((f) => f.id), ['orphan']);
    assert.deepEqual(await h.remaining(), ['orphan']);

    const h2 = harness();
    await seedMovedChannel(h2, 'stuck');
    h2.failTransfer();
    const out2 = await settle(h2);
    assert.match(out2.failed[0]!.error, /could not be given back/);
    assert.deepEqual(h2.erased, []);
    assert.deepEqual(h2.flagged.map((f) => f.id), ['stuck']);
  });

  it('flags a give-back that has not landed two days after it was queued', async () => {
    const h = harness();
    await seedMovedChannel(h, 'slow');
    await writeAudit(h.db as never, { kind: 'channel', id: 'ch_moved', action: 'transfer', actorId: 'system:trash-cleanup', details: { newOwnerId: 'usr_prev', inviteId: 'slow', reason: 'revoked-invite' }, previous: { ownerId: 'usr_slow' } }, new Date(NOW - AUTH_GRACE_MS - 60_000).toISOString());
    const out = await settle(h);
    assert.match(out.failed[0]!.error, /has not finished/);
    assert.deepEqual(h.transfers, []);
    assert.deepEqual(h.erased, []);
  });

  it('erases at once when a moved channel already left the invited user', async () => {
    const h = harness();
    await seedMovedChannel(h, 'left');
    h.owners.set('ch_moved', 'usr_someone');
    assert.deepEqual((await settle(h)).erased, ['left']);
    assert.deepEqual(h.transfers, []);
  });

  it("never erases while the invite's own move has not settled, or a moved channel sits deleted", async () => {
    for (const [status, reason] of [['running', /has not finished/], ['retrying', /has not finished/], ['failed', /could still be retried/]] as const) {
      const h = harness();
      await seedMovedChannel(h, 'mv');
      h.owners.set('ch_moved', 'usr_prev'); // the move never landed
      h.jobs.set('job_1', status);
      const out = await settle(h);
      assert.match(out.failed[0]!.error, reason, status);
      assert.deepEqual(h.erased, []);
      assert.deepEqual(h.flagged.map((f) => f.id), ['mv']);
    }
    const h = harness();
    await seedMovedChannel(h, 'del');
    h.deleted.add('ch_moved');
    const out = await settle(h);
    assert.match(out.failed[0]!.error, /Recently deleted/);
    assert.deepEqual(h.erased, []);
    assert.deepEqual(h.transfers, []);
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
    // A Retry never erases ahead of the purge window
    await seed(db, 'early', { deleted_at: new Date(Date.now() - 3 * DAY).toISOString() });
    assert.deepEqual(await retry({ REPORTS_DB: db } as never, { id: 'early' }, 'a1'), { ok: false, status: 'dismissed', result: 'The invite is not due for its purge yet' });
  });
});
