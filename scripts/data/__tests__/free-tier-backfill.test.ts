import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { backfillAll, backfillPage, BACKFILL_ASSIGNER, type Query } from '../free-tier-backfill.ts';

function db() {
  const d = new DatabaseSync(':memory:');
  d.exec(`CREATE TABLE content_ownership (kind TEXT NOT NULL, id TEXT NOT NULL, owner_id TEXT, is_deleted INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (kind, id));
    CREATE INDEX idx_content_ownership_owner ON content_ownership (kind, owner_id);
    CREATE TABLE creator_tier_assignments (user_id TEXT PRIMARY KEY, tier_id TEXT NOT NULL, source TEXT NOT NULL DEFAULT 'admin', assigned_by TEXT NOT NULL, assigned_at TEXT NOT NULL) WITHOUT ROWID;`);
  const rows = [
    ['profile', 'usr_a', 'usr_a', 0], ['profile', 'usr_b', 'usr_b', 0], ['profile', 'usr_c', 'usr_c', 0], ['profile', 'usr_gone', 'usr_gone', 1],
    ['channel', 'ch1', 'usr_a', 0], ['channel', 'ch2', 'usr_noprof', 0], ['video', 'v1', 'usr_vidonly', 0], ['video', 'v2', 'usr_noprof', 0],
  ];
  for (const r of rows) d.prepare('INSERT INTO content_ownership (kind, id, owner_id, is_deleted) VALUES (?, ?, ?, ?)').run(...r);
  d.prepare("INSERT INTO creator_tier_assignments VALUES ('usr_b', 'creator', 'admin', 'admin-1', 'then')").run();
  const query: Query = async <Row,>(sql: string, params: unknown[] = []) => d.prepare(sql).all(...(params as never[])) as Row[];
  return { d, query };
}

const tiers = (d: DatabaseSync) => Object.fromEntries((d.prepare('SELECT user_id, tier_id FROM creator_tier_assignments ORDER BY user_id').all() as { user_id: string; tier_id: string }[]).map((r) => [r.user_id, r.tier_id]));

describe('Free tier backfill', () => {
  it('a dry run counts accounts without a tier (profiles, then channel and video owners without a profile) and writes nothing', async () => {
    const { d, query } = db();
    const result = await backfillAll(query, { dryRun: true });
    assert.deepEqual(result.bySource, { profile: { missing: 2, written: 0 }, channel: { missing: 1, written: 0 }, video: { missing: 1, written: 0 } });
    assert.equal(result.missing, 4);
    assert.deepEqual(tiers(d), { usr_b: 'creator' });
  });

  it('apply writes Free to each of them, keeps existing tiers, and a second run changes nothing', async () => {
    const { d, query } = db();
    const result = await backfillAll(query, { dryRun: false, limit: 2, now: '2026-11-16T00:00:00.000Z' });
    assert.equal(result.written, 4);
    assert.deepEqual(tiers(d), { usr_a: 'member', usr_b: 'creator', usr_c: 'member', usr_noprof: 'member', usr_vidonly: 'member' });
    assert.equal((d.prepare("SELECT assigned_by FROM creator_tier_assignments WHERE user_id = 'usr_a'").get() as { assigned_by: string }).assigned_by, BACKFILL_ASSIGNER);
    const again = await backfillAll(query, { dryRun: false });
    assert.deepEqual([again.missing, again.written], [0, 0]);
  });

  it('pages by keyset on the index: the cursor is the last id, and a short page ends the walk', async () => {
    const { query } = db();
    const first = await backfillPage(query, 'profile', '', { dryRun: true, limit: 2 });
    assert.deepEqual([first.missing, first.next], [['usr_a'], 'usr_b']);
    const second = await backfillPage(query, 'profile', first.next!, { dryRun: true, limit: 2 });
    assert.deepEqual([second.missing, second.next], [['usr_c'], null]);
  });
});
