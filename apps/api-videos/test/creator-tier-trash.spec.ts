/**
 * Creator tier soft delete (search migration 0016): a deleted tier leaves the
 * tier list and cannot be assigned, can be restored, "Delete permanently now"
 * only queues it, and purgeTiers (run by the admin-api cleanup) is the only
 * hard delete: after 30 days or once queued, never while someone holds it.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { purgeCutoff } from '@al-ummah/shared-types';
import { assignTier, deleteTier, purgeTiers, readDeletedTiers, readTier, readTiers, requestTierPurge, restoreTier, saveTier } from '../src/lib/creatorTiers';
import { SqliteD1 } from './search-sqlite-d1';

const SMALL = { name: 'Small', perHour: 5, perDay: 10, maxConcurrent: 2, maxChannels: 1 };
const DAY = 86_400_000;

async function setup() {
	const db = new SqliteD1();
	const d1 = db as unknown as D1Database;
	await saveTier(d1, 'small', SMALL, 'admin-1', { create: true });
	return { db, d1 };
}

const rowCount = (db: SqliteD1, id: string) => Number((db.db.prepare('SELECT COUNT(*) AS n FROM creator_tiers WHERE id = ?').get(id) as { n: number }).n);

describe('creator tier soft delete', () => {
	it('hides a deleted tier from the list and from assignment, and keeps who, when and why', async () => {
		const { d1 } = await setup();
		await deleteTier(d1, 'small', { actorId: 'admin-1', reason: 'replaced by Medium' }, '2026-11-10T10:00:00.000Z');
		assert.equal((await readTiers(d1)).some((t) => t.id === 'small'), false);
		assert.equal(await readTier(d1, 'small'), null);
		await assert.rejects(assignTier(d1, 'alice', 'small', 'admin-1'), /tier_not_found/);
		assert.deepEqual(await readDeletedTiers(d1), [
			{ id: 'small', name: 'Small', deletedAt: '2026-11-10T10:00:00.000Z', deletedBy: 'admin-1', reason: 'replaced by Medium', purgeRequestedAt: null, purgeRequestedBy: null },
		]);
		// Deleting it again is a 404, not a second delete
		await assert.rejects(deleteTier(d1, 'small', { actorId: 'admin-1' }), /tier_not_found/);
	});

	it('refuses to create a tier over a deleted one; restore brings it back assignable', async () => {
		const { d1 } = await setup();
		await deleteTier(d1, 'small', { actorId: 'admin-1' });
		await assert.rejects(saveTier(d1, 'small', SMALL, 'admin-2', { create: true }), { code: 'tier_deleted' });
		await requestTierPurge(d1, 'small', 'admin-2');
		const { tier } = await restoreTier(d1, 'small');
		assert.equal(tier.id, 'small');
		assert.deepEqual(await readDeletedTiers(d1), []);
		await assignTier(d1, 'alice', 'small', 'admin-1');
		await assert.rejects(restoreTier(d1, 'small'), { code: 'tier_not_deleted' });
	});

	it('still refuses shipped tiers and tiers someone holds', async () => {
		const { d1 } = await setup();
		await assignTier(d1, 'alice', 'small', 'admin-1');
		await assert.rejects(deleteTier(d1, 'small', { actorId: 'admin-1' }), /hold this tier/);
		await assert.rejects(deleteTier(d1, 'creator', { actorId: 'admin-1' }), /cannot be deleted/);
	});
});

describe('creator tier purge (the cleanup)', () => {
	it('purges only after 30 days or once queued; queuing deletes nothing by itself', async () => {
		const { db, d1 } = await setup();
		await saveTier(d1, 'medium', { ...SMALL, name: 'Medium' }, 'admin-1', { create: true });
		const now = new Date('2026-12-20T12:00:00.000Z');
		await deleteTier(d1, 'small', { actorId: 'admin-1' }, new Date(now.getTime() - 31 * DAY).toISOString());
		await deleteTier(d1, 'medium', { actorId: 'admin-1' }, new Date(now.getTime() - 2 * DAY).toISOString());

		// Not yet: medium is 2 days old and not queued
		assert.deepEqual(await purgeTiers(d1, purgeCutoff(now)), { purged: ['small'], failed: [] });
		assert.equal(rowCount(db, 'small'), 0);
		assert.equal(rowCount(db, 'medium'), 1);

		// Promote: queued, still there and restorable until the cleanup runs
		const queued = await requestTierPurge(d1, 'medium', 'admin-2', now.toISOString());
		assert.equal(queued.purgeRequestedAt, now.toISOString());
		assert.equal(rowCount(db, 'medium'), 1);
		assert.equal((await readDeletedTiers(d1))[0].purgeRequestedBy, 'admin-2');

		assert.deepEqual(await purgeTiers(d1, purgeCutoff(now)), { purged: ['medium'], failed: [] });
		assert.equal(rowCount(db, 'medium'), 0);
		// Idempotent: nothing left to do
		assert.deepEqual(await purgeTiers(d1, purgeCutoff(now)), { purged: [], failed: [] });
	});

	it('never purges a live tier, and reports a deleted tier that someone holds instead of deleting it', async () => {
		const { db, d1 } = await setup();
		const now = new Date('2026-12-20T12:00:00.000Z');
		await deleteTier(d1, 'small', { actorId: 'admin-1' }, new Date(now.getTime() - 40 * DAY).toISOString());
		// An assignment that reached the row behind the delete's back (e.g. written by hand)
		db.db.prepare("INSERT INTO creator_tier_assignments (user_id, tier_id, source, assigned_by, assigned_at) VALUES ('bob', 'small', 'admin', 'x', 'now')").run();
		const result = await purgeTiers(d1, purgeCutoff(now));
		assert.deepEqual(result.purged, []);
		assert.equal(result.failed[0].id, 'small');
		assert.equal(rowCount(db, 'small'), 1);
		assert.equal(rowCount(db, 'creator'), 1);
	});

	it('queue for permanent deletion is refused for a tier that is not deleted', async () => {
		const { d1 } = await setup();
		await assert.rejects(requestTierPurge(d1, 'small', 'admin-1'), { code: 'tier_not_deleted' });
	});
});
