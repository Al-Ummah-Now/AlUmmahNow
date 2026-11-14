/**
 * Caption minutes (search migration 0032; owner decision 2026-11-14): a tier's
 * monthly minutes plus the admin's grants, reserved per job, committed with the
 * difference given back, refunded in full on failure, never twice.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { captionMinutesFor } from '@al-ummah/shared-types';
import { assignTier, readTier, saveTier } from '../src/lib/creatorTiers';
import {
	addGrant,
	captionSubject,
	commitMinutes,
	eraseCaptionMinutes,
	listGrants,
	readUsage,
	releaseMinutes,
	reserveMinutes,
	revokeGrant,
	subjectOfUser,
} from '../src/lib/captions/minutes';
import { SqliteD1 } from './search-sqlite-d1';

const NOV = new Date('2026-11-14T12:00:00.000Z');
const DEC = new Date('2026-12-01T00:00:01.000Z');

async function setup(minutes = 60) {
	const db = new SqliteD1();
	const d1 = db as unknown as D1Database;
	await saveTier(d1, 'captions', { name: 'Captions', perHour: 5, perDay: 10, maxConcurrent: 2, maxChannels: 1, captionMinutesMonth: minutes }, 'admin-1', { create: true });
	await assignTier(d1, 'alice', 'captions', 'admin-1');
	return { db, d1 };
}

describe('caption minutes', () => {
	it('a job costs started video-minutes × languages', () => {
		assert.equal(captionMinutesFor(0), 1);
		assert.equal(captionMinutesFor(61), 2);
		assert.equal(captionMinutesFor(17 * 60, 2), 34);
	});

	it('the tier sets the month; the shipped tiers start at 0; Unlimited ignores it', async () => {
		const { d1 } = await setup();
		assert.equal((await readTier(d1, 'captions'))!.captionMinutesMonth, 60);
		assert.equal((await readTier(d1, 'creator'))!.captionMinutesMonth, 0);
		await assert.rejects(saveTier(d1, 'captions', { captionMinutesMonth: -1 }, 'admin-1'), /captionMinutesMonth/);
		const unlimited = await captionSubject(d1, { userId: 'boss', roles: ['super_admin'] });
		assert.equal(unlimited.unlimited, true);
		assert.ok((await reserveMinutes(d1, unlimited, 'job-u', 100_000, NOV)).ok);
		assert.equal((await readUsage(d1, unlimited, NOV)).remaining, null);
	});

	it('reserves within the month, refuses past it with the usage, and resets next month', async () => {
		const { d1 } = await setup(60);
		const alice = await captionSubject(d1, { userId: 'alice' });
		assert.ok((await reserveMinutes(d1, alice, 'job-1', 40, NOV)).ok);
		const refused = await reserveMinutes(d1, alice, 'job-2', 30, NOV);
		assert.equal(refused.ok, false);
		assert.equal((refused as { usage: { remaining: number } }).usage.remaining, 20);
		assert.equal((await readUsage(d1, alice, NOV)).warning, false);
		assert.ok((await reserveMinutes(d1, alice, 'job-3', 20, NOV)).ok);
		assert.equal((await readUsage(d1, alice, NOV)).warning, true);
		assert.ok((await reserveMinutes(d1, alice, 'job-4', 30, DEC)).ok, 'December has its own 60');
	});

	it('the same job never reserves twice', async () => {
		const { d1 } = await setup(60);
		const alice = await captionSubject(d1, { userId: 'alice' });
		await reserveMinutes(d1, alice, 'job-1', 40, NOV);
		const again = await reserveMinutes(d1, alice, 'job-1', 40, NOV);
		assert.ok(again.ok);
		assert.equal((await readUsage(d1, alice, NOV)).monthUsed, 40);
	});

	it('commit keeps what the job used and gives back the rest; a failure gives back everything, once', async () => {
		const { d1 } = await setup(60);
		const alice = await captionSubject(d1, { userId: 'alice' });
		await reserveMinutes(d1, alice, 'job-1', 30, NOV);
		const committed = await commitMinutes(d1, 'job-1', 24, NOV);
		assert.equal(committed!.state, 'committed');
		assert.equal(committed!.charged, 24);
		assert.equal((await readUsage(d1, alice, NOV)).monthUsed, 24);
		await releaseMinutes(d1, 'job-1', NOV);
		assert.equal((await readUsage(d1, alice, NOV)).monthUsed, 24, 'a committed job is not refunded');

		await reserveMinutes(d1, alice, 'job-2', 20, NOV);
		await releaseMinutes(d1, 'job-2', NOV);
		await releaseMinutes(d1, 'job-2', NOV);
		assert.equal((await readUsage(d1, alice, NOV)).monthUsed, 24);
	});

	it('month grants raise this month; until-used grants are spent after it and refunded into the grant', async () => {
		const { d1 } = await setup(10);
		await addGrant(d1, 'alice', { minutes: 5, scope: 'month', reason: 'launch' }, 'admin-1', NOV);
		const pack = await addGrant(d1, 'alice', { minutes: 100, scope: 'until_used', reason: 'invoice 42' }, 'admin-1', NOV);
		const alice = await captionSubject(d1, { userId: 'alice' });
		let usage = await readUsage(d1, alice, NOV);
		assert.equal(usage.monthLimit, 15);
		assert.equal(usage.remaining, 115);
		const r = await reserveMinutes(d1, alice, 'job-1', 40, NOV);
		assert.ok(r.ok);
		assert.deepEqual((r as { hold: { monthMinutes: number; packs: unknown } }).hold.monthMinutes, 15);
		assert.deepEqual((r as { hold: { packs: unknown } }).hold.packs, [{ grantId: pack.id, minutes: 25 }]);
		// Finished using 30: the 10 given back come off the pack first
		await commitMinutes(d1, 'job-1', 30, NOV);
		usage = await readUsage(d1, alice, NOV);
		assert.equal(usage.monthUsed, 15);
		assert.equal(usage.packsRemaining, 85);
		// December: the month grant is gone, the pack stays
		assert.equal((await readUsage(d1, alice, DEC)).remaining, 10 + 85);
	});

	it('a revoked grant stops counting; a grant needs minutes, a scope and a reason', async () => {
		const { d1 } = await setup(0);
		const g = await addGrant(d1, 'alice', { minutes: 50, scope: 'until_used', reason: 'trial' }, 'admin-1', NOV);
		await revokeGrant(d1, 'alice', g.id, 'trial over', 'admin-2', NOV);
		const alice = await subjectOfUser(d1, 'alice');
		assert.equal((await readUsage(d1, alice, NOV)).remaining, 0);
		await assert.rejects(revokeGrant(d1, 'alice', g.id, 'again', 'admin-2', NOV), /grant_revoked/);
		await assert.rejects(addGrant(d1, 'alice', { minutes: 0, scope: 'month', reason: 'x' }, 'admin-1'), /minutes/);
		await assert.rejects(addGrant(d1, 'alice', { minutes: 5, scope: 'forever', reason: 'x' }, 'admin-1'), /scope/);
		await assert.rejects(addGrant(d1, 'alice', { minutes: 5, scope: 'month', reason: ' ' }, 'admin-1'), /reason/);
		const [listed] = await listGrants(d1, 'alice');
		assert.equal(listed!.revokedBy, 'admin-2');
		assert.equal(listed!.revokeReason, 'trial over');
	});

	it('a manager works on the owner\'s minutes', async () => {
		const { d1 } = await setup(60);
		const asManager = await captionSubject(d1, { userId: 'bob', channelOwnerId: 'alice' });
		assert.equal(asManager.subjectId, 'alice');
		assert.equal(asManager.tierMinutes, 60);
	});

	it('account erasure removes the usage, holds and grants', async () => {
		const { db, d1 } = await setup(60);
		await addGrant(d1, 'alice', { minutes: 5, scope: 'until_used', reason: 'x' }, 'admin-1', NOV);
		await reserveMinutes(d1, await captionSubject(d1, { userId: 'alice' }), 'job-1', 10, NOV);
		await eraseCaptionMinutes(d1, 'alice');
		for (const table of ['caption_minute_usage', 'caption_minute_holds', 'caption_minute_grants']) assert.equal(db.count(table), 0, table);
	});
});
