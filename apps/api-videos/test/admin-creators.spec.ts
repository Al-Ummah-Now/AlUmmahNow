/**
 * The admin's Creators list, tier counts and bulk tier change
 * (src/lib/admin/creators.ts) on real SQLite with the search migrations.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { MAX_BULK_CREATOR_TIER, SUPER_ADMIN_TIER_ASSIGNER } from '@al-ummah/shared-types';
import { assignTier, readAssignment } from '../src/lib/creatorTiers';
import { bulkAssignTier, limitHitsSince, listCreators, tierCounts } from '../src/lib/admin/creators';
import { SqliteD1 } from './search-sqlite-d1';

const NOW = Date.UTC(2026, 10, 10, 12, 0, 0);
const profiles = { get: async () => null } as unknown as R2Bucket;

async function seed() {
  const db = new SqliteD1();
  const d1 = db as unknown as D1Database;
  const profile = (id: string, title: string, handle: string, email: string) =>
    db.db.prepare("INSERT INTO content_ownership (kind, id, owner_id, admin_title, handle, email) VALUES ('profile', ?, ?, ?, ?, ?)").run(id, id, title, handle, email);
  const own = (kind: string, id: string, owner: string) => db.db.prepare('INSERT INTO content_ownership (kind, id, owner_id) VALUES (?, ?, ?)').run(kind, id, owner);
  const hit = (user: string, secondsAgo: number) =>
    db.db.prepare("INSERT INTO upload_limit_hits (id, user_id, period, tier_id, hit_at) VALUES (?, ?, 'hour', 'creator', ?)").run(crypto.randomUUID(), user, Math.floor(NOW / 1000) - secondsAgo);
  profile('usr_admin', 'Amina Admin', 'amina', 'amina@example.com');
  profile('usr_owner', 'The Owner', 'owner', 'owner@example.com');
  profile('usr_creator', 'Bilal Creator', 'bilal', 'bilal@example.com');
  profile('usr_viewer', 'Viewer Only', 'viewer', 'viewer@example.com');
  profile('usr_migrated', 'Migrated', 'migrated', 'migrated@example.com');
  own('channel', 'ch-1', 'usr_creator');
  own('video', 'v-1', 'usr_creator');
  own('video', 'v-2', 'usr_migrated');
  await assignTier(d1, 'usr_owner', 'unlimited', SUPER_ADMIN_TIER_ASSIGNER, 'admin', '2026-11-09T00:00:00.000Z');
  await assignTier(d1, 'usr_creator', 'creator', 'usr_admin', 'admin', '2026-11-08T00:00:00.000Z');
  hit('usr_creator', 3600);
  hit('usr_creator', 3 * 86400);
  hit('usr_viewer', 10 * 86400);
  return { db, d1 };
}

describe('admin Creators list', () => {
  it('lists every videos user with the origin of their tier and who assigned it', async () => {
    const { d1 } = await seed();
    const page = await listCreators({ SEARCH_DB: d1, profiles }, {}, NOW);
    const byId = new Map(page.items.map((r) => [r.userId, r]));
    assert.equal(page.total, 5, 'every profile, with or without a tier');
    assert.equal(byId.get('usr_owner')?.origin, 'super_admin');
    assert.equal(byId.get('usr_owner')?.assignedByName, null);
    assert.equal(byId.get('usr_creator')?.origin, 'admin');
    assert.equal(byId.get('usr_creator')?.assignedByName, 'Amina Admin');
    assert.equal(byId.get('usr_creator')?.channels, 1);
    assert.equal(byId.get('usr_creator')?.limitHits7d, 2);
    assert.equal(byId.get('usr_viewer')?.origin, null);
    assert.equal(byId.get('usr_viewer')?.limitHits7d, 0, 'hits older than 7 days do not count');
    assert.equal(page.items[0].userId, 'usr_migrated', 'Needs tier first');
    assert.equal(page.items[1].userId, 'usr_creator', 'then who hit a limit');
    assert.equal(page.limitHits7d, 1);
    assert.equal(page.limitHits24h, 1);
    assert.equal(page.needsTier, 1);
  });

  it('searches by name, email or handle (with or without @) and filters by tier', async () => {
    const { d1 } = await seed();
    const ids = async (query: Parameters<typeof listCreators>[1]) => (await listCreators({ SEARCH_DB: d1, profiles }, query, NOW)).items.map((r) => r.userId);
    assert.deepEqual(await ids({ q: 'bilal' }), ['usr_creator']);
    assert.deepEqual(await ids({ q: 'OWNER@example' }), ['usr_owner']);
    assert.deepEqual(await ids({ q: '@viewer' }), ['usr_viewer']);
    assert.deepEqual(await ids({ q: '100%' }), [], 'LIKE wildcards are escaped');
    assert.deepEqual(await ids({ tierId: 'unlimited' }), ['usr_owner']);
    assert.deepEqual((await ids({ tierId: 'none' })).sort(), ['usr_admin', 'usr_migrated', 'usr_viewer']);
    assert.deepEqual(await ids({ filter: 'limited' }), ['usr_creator']);
    const second = await listCreators({ SEARCH_DB: d1, profiles }, { page: 2, pageSize: 2 }, NOW);
    assert.equal(second.items.length, 2);
    assert.equal(second.total, 5);
  });

  it('counts users per tier and those without one, and the week\'s limit hits', async () => {
    const { d1 } = await seed();
    assert.deepEqual(await tierCounts(d1), { byTier: { creator: 1, unlimited: 1 }, none: 3 });
    assert.equal(await limitHitsSince(d1, NOW), 1);
  });
});

describe('bulk tier change', () => {
  it('changes the selected users in one batch, skips super admins and users already on the tier, and is idempotent', async () => {
    const { d1 } = await seed();
    const users = ['usr_owner', 'usr_creator', 'usr_viewer', 'usr_migrated'];
    const plan = await bulkAssignTier(d1, { userIds: users, tierId: 'creator', dryRun: true }, 'usr_admin');
    assert.deepEqual(plan.changed.map((c) => c.userId), ['usr_viewer', 'usr_migrated']);
    assert.deepEqual(plan.unchanged, ['usr_creator']);
    assert.deepEqual(plan.skippedSuperAdmin, ['usr_owner']);
    assert.equal(await readAssignment(d1, 'usr_viewer'), null, 'a dry run writes nothing');

    await bulkAssignTier(d1, { userIds: users, tierId: 'creator' }, 'usr_admin', '2026-11-10T12:00:00.000Z');
    assert.equal((await readAssignment(d1, 'usr_viewer'))?.tierId, 'creator');
    assert.equal((await readAssignment(d1, 'usr_viewer'))?.assignedBy, 'usr_admin');
    assert.equal((await readAssignment(d1, 'usr_owner'))?.tierId, 'unlimited', 'the super admin keeps Unlimited');
    const again = await bulkAssignTier(d1, { userIds: users, tierId: 'creator' }, 'usr_admin');
    assert.equal(again.changed.length, 0);

    const removed = await bulkAssignTier(d1, { userIds: users, tierId: null }, 'usr_admin');
    assert.deepEqual(removed.changed.map((c) => [c.userId, c.previous?.tierId]), [['usr_creator', 'creator'], ['usr_viewer', 'creator'], ['usr_migrated', 'creator']]);
    assert.deepEqual(removed.skippedSuperAdmin, ['usr_owner']);
    assert.equal(await readAssignment(d1, 'usr_creator'), null);
  });

  it('refuses a missing tier, bad ids and too many users', async () => {
    const { d1 } = await seed();
    await assert.rejects(bulkAssignTier(d1, { userIds: ['usr_viewer'], tierId: 'gold' }, 'a'), /tier_not_found/);
    await assert.rejects(bulkAssignTier(d1, { userIds: ['bad id'], tierId: 'creator' }, 'a'), /userIds/);
    await assert.rejects(bulkAssignTier(d1, { userIds: [], tierId: 'creator' }, 'a'), /userIds/);
    const many = Array.from({ length: MAX_BULK_CREATOR_TIER + 1 }, (_, i) => `u${i}`);
    await assert.rejects(bulkAssignTier(d1, { userIds: many, tierId: 'creator' }, 'a'), /userIds/);
  });
});
