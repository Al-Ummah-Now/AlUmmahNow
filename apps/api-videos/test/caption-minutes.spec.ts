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
	cancelMinutes,
	listGrants,
	listLedger,
	readHold,
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

	it('charges the estimate at the start, warns at 80%, and December has its own month', async () => {
		const { d1 } = await setup(60);
		const alice = await captionSubject(d1, { userId: 'alice' });
		assert.ok((await reserveMinutes(d1, alice, 'job-1', 40, NOV)).ok);
		let usage = await readUsage(d1, alice, NOV);
		assert.equal(usage.remaining, 20, 'counted before the job finishes');
		assert.equal(usage.held, 40);
		assert.equal(usage.warning, false);
		assert.ok((await reserveMinutes(d1, alice, 'job-3', 8, NOV)).ok);
		assert.equal((await readUsage(d1, alice, NOV)).warning, true);
		assert.ok((await reserveMinutes(d1, alice, 'job-4', 30, DEC)).ok, 'December has its own 60');
		usage = await readUsage(d1, alice, DEC);
		assert.equal(usage.monthUsed, 30);
		assert.equal(usage.overdraft, 0);
	});

	it('a start needs a balance above 0, may go below it, and nothing starts once it is 0 or below', async () => {
		const { d1 } = await setup(10);
		const alice = await captionSubject(d1, { userId: 'alice' });
		const first = await reserveMinutes(d1, alice, 'job-1', 17, NOV);
		assert.ok(first.ok, '10 left: a 17-minute job starts');
		let usage = await readUsage(d1, alice, NOV);
		assert.equal(usage.remaining, -7);
		assert.equal(usage.overdraft, 7);
		assert.equal(usage.monthUsed, 10);
		assert.equal(usage.warning, true);
		const refused = await reserveMinutes(d1, alice, 'job-2', 1, NOV);
		assert.equal(refused.ok, false);
		assert.equal((refused as { usage: { remaining: number } }).usage.remaining, -7);
		// It runs to the end and costs what it used: 19, so 2 more go on the overdraft
		const settled = await commitMinutes(d1, 'job-1', 19, NOV);
		assert.equal(settled!.charged, 19);
		usage = await readUsage(d1, alice, NOV);
		assert.equal(usage.remaining, -9);
		assert.equal(usage.held, 0);
		// A tier with no caption minutes and nothing granted never starts
		const { d1: none } = await setup(0);
		assert.equal((await reserveMinutes(none, await captionSubject(none, { userId: 'alice' }), 'job-x', 1, NOV)).ok, false);
	});

	it('the overdraft comes off next month and a grant pays it first', async () => {
		const { d1 } = await setup(10);
		const alice = await captionSubject(d1, { userId: 'alice' });
		await reserveMinutes(d1, alice, 'job-1', 17, NOV);
		await commitMinutes(d1, 'job-1', 17, NOV);
		let dec = await readUsage(d1, alice, DEC);
		assert.equal(dec.overdraft, 0, 'paid from the new month');
		assert.equal(dec.monthUsed, 7);
		assert.equal(dec.remaining, 3);
		// An overdraft larger than a month carries on
		const { d1: big } = await setup(10);
		const bob = await captionSubject(big, { userId: 'alice' });
		await reserveMinutes(big, bob, 'job-1', 35, NOV);
		dec = await readUsage(big, bob, DEC);
		assert.equal(dec.monthUsed, 10);
		assert.equal(dec.overdraft, 15);
		assert.equal(dec.remaining, -15);
		// Grants pay it down: a month grant, then an until-used grant (the rest stays on the grant)
		await addGrant(big, 'alice', { minutes: 5, scope: 'month', reason: 'goodwill' }, 'admin-1', DEC);
		assert.equal((await readUsage(big, bob, DEC)).overdraft, 10);
		const pack = await addGrant(big, 'alice', { minutes: 25, scope: 'until_used', reason: 'invoice 7' }, 'admin-1', DEC);
		dec = await readUsage(big, bob, DEC);
		assert.equal(dec.overdraft, 0);
		assert.equal(dec.packsRemaining, 15);
		assert.equal(dec.remaining, 15);
		assert.equal((await listGrants(big, 'alice')).find((g) => g.id === pack.id)!.used, 10);
		const paydowns = (await listLedger(big, 'alice')).filter((e) => e.kind === 'paydown');
		assert.deepEqual(paydowns.map((e) => e.minutes).sort((a, b) => a - b), [5, 10, 10]);
	});

	it('settling gives back the overdraft first, and a refund or cancel brings the balance back up', async () => {
		const { d1 } = await setup(10);
		const alice = await captionSubject(d1, { userId: 'alice' });
		await reserveMinutes(d1, alice, 'job-1', 17, NOV);
		await commitMinutes(d1, 'job-1', 12, NOV);
		let usage = await readUsage(d1, alice, NOV);
		assert.equal(usage.overdraft, 2);
		assert.equal(usage.monthUsed, 10);
		await commitMinutes(d1, 'job-1', 1, NOV);
		assert.equal((await readUsage(d1, alice, NOV)).overdraft, 2, 'settled once');

		const { d1: other } = await setup(10);
		const bob = await captionSubject(other, { userId: 'alice' });
		await reserveMinutes(other, bob, 'job-1', 17, NOV);
		await releaseMinutes(other, 'job-1', NOV);
		usage = await readUsage(other, bob, NOV);
		assert.deepEqual([usage.monthUsed, usage.overdraft, usage.remaining], [0, 0, 10]);
		await reserveMinutes(other, bob, 'job-2', 16, NOV);
		await cancelMinutes(other, 'job-2', 4, NOV);
		usage = await readUsage(other, bob, NOV);
		assert.deepEqual([usage.monthUsed, usage.overdraft, usage.remaining], [4, 0, 6]);
		const hold = await readHold(other, 'job-2');
		assert.deepEqual([hold!.state, hold!.charged], ['committed', 4]);
	});

	it('every step is one ledger row with the balance after it; a retried step writes nothing', async () => {
		const { d1 } = await setup(10);
		const alice = await captionSubject(d1, { userId: 'alice' });
		await reserveMinutes(d1, alice, 'job-1', 17, NOV);
		await reserveMinutes(d1, alice, 'job-1', 17, NOV);
		await commitMinutes(d1, 'job-1', 18, NOV);
		await commitMinutes(d1, 'job-1', 18, NOV);
		await releaseMinutes(d1, 'job-1', NOV);
		const ledger = await listLedger(d1, 'alice');
		assert.deepEqual(
			ledger.map((e) => [e.id, e.kind, e.minutes, e.balanceAfter]).sort(),
			[
				['job-1:settle', 'settle', 1, -8],
				['job-1:start', 'start', 17, -7],
			],
		);
		assert.equal((await readUsage(d1, alice, NOV)).remaining, -8);
	});

	it('jobs starting at once against a small balance: each started job runs to the end, none starts at 0 or below', async () => {
		const { d1 } = await setup(20);
		const alice = await captionSubject(d1, { userId: 'alice' });
		const ids = Array.from({ length: 8 }, (_, i) => `job-${i}`);
		const results = await Promise.all(ids.map((id) => reserveMinutes(d1, alice, id, 17, NOV)));
		const started = ids.filter((_, i) => results[i]!.ok);
		assert.equal(started.length, 2, '20 → 3 → -14, then refused');
		for (const r of results) if (!r.ok) assert.ok((r.usage.remaining ?? 0) <= 0);
		let usage = await readUsage(d1, alice, NOV);
		assert.deepEqual([usage.monthUsed, usage.overdraft, usage.remaining, usage.held], [20, 14, -14, 34]);
		await Promise.all(started.map((id) => commitMinutes(d1, id, 17, NOV)));
		for (const id of started) assert.equal((await readHold(d1, id))!.charged, 17);
		usage = await readUsage(d1, alice, NOV);
		assert.deepEqual([usage.overdraft, usage.held], [14, 0]);
		assert.equal((await listLedger(d1, 'alice')).length, 4);
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
		for (const table of ['caption_minute_usage', 'caption_minute_holds', 'caption_minute_grants', 'caption_minute_overdraft', 'caption_minute_ledger']) assert.equal(db.count(table), 0, table);
	});
});
