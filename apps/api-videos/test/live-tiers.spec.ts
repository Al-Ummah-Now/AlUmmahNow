/**
 * Live streaming in creator tiers (search migration 0060, lib/live/tier-gate.ts):
 * the channel owner's tier decides whether a stream may be created, provisioned
 * and started, within its monthly hours and streams at once; the live sweep ends
 * a session past its limit.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_CREATOR_TIER, LIVE_TIER_ERROR_CODES } from '@al-ummah/shared-types';
import { assignTier, readTier, saveTier, validateTier } from '../src/lib/creatorTiers';
import { checkLiveTier, liveAccess, liveUsage, streamTierContext } from '../src/lib/live/tier-gate';
import { endOverTierLimit } from '../src/lib/live/service';
import { eraseLiveSessionOwner, insertSession, readSession, updateSession } from '../src/lib/live/store';
import { SqliteD1 } from './search-sqlite-d1';

const NOW = Date.parse('2026-11-14T12:00:00.000Z');
const HOUR = 3_600_000;

async function setup() {
	const d1 = new SqliteD1() as unknown as D1Database;
	await saveTier(d1, 'small', { name: 'Small', perHour: 5, perDay: 10, maxConcurrent: 2, maxChannels: 1, live: true, liveHoursMonth: 2, liveMaxConcurrent: 1, liveMaxStreamMinutes: 30 }, 'admin-1', { create: true });
	await saveTier(d1, 'nolive', { name: 'No live', perHour: 5, perDay: 10, maxConcurrent: 2, maxChannels: 1 }, 'admin-1', { create: true });
	await assignTier(d1, 'alice', 'small', 'admin-1');
	await assignTier(d1, 'bob', 'nolive', 'admin-1');
	await assignTier(d1, 'carol', 'creator', 'admin-1');
	return d1;
}

let n = 0;
async function session(d1: D1Database, ownerId: string, set: { status?: string; firstSegmentAt?: number | null; endedAt?: number | null; startRequestedAt?: number | null; limitMinutes?: number | null; createdAt?: number } = {}) {
	const id = `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`;
	await insertSession(d1, {
		id, stream_id: `stream-${n}`, channel_id: 'ch-1', provider: 'selfhosted', provider_ref: id, reason: 'round_robin', preferred: null, seq: n,
		failover_from: null, failover_error: null, low_latency: 0, is_test: 1, created_at: set.createdAt ?? NOW - HOUR, playback_url: null,
		owner_id: ownerId, limit_minutes: set.limitMinutes ?? null,
	});
	await updateSession(d1, id, {
		status: (set.status ?? 'ended') as never,
		first_segment_at: set.firstSegmentAt === undefined ? NOW - HOUR : set.firstSegmentAt,
		ended_at: set.endedAt === undefined ? null : set.endedAt,
		start_requested_at: set.startRequestedAt ?? null,
	});
	return id;
}

describe('live in creator tiers', () => {
	it('ships Creator and Unlimited with live on, other tiers off; validates the limits', async () => {
		const d1 = await setup();
		const creator = (await readTier(d1, 'creator'))!;
		assert.equal(creator.live, true);
		assert.equal(creator.liveHoursMonth, DEFAULT_CREATOR_TIER.liveHoursMonth);
		assert.equal((await readTier(d1, 'unlimited'))!.live, true);
		assert.equal((await readTier(d1, 'nolive'))!.live, false);
		assert.throws(() => validateTier('x1', { name: 'X', perHour: 1, perDay: 1, maxConcurrent: 1, live: 'yes' }), /live must be true or false/);
		assert.throws(() => validateTier('x1', { name: 'X', perHour: 1, perDay: 1, maxConcurrent: 1, live: true, liveMaxStreamMinutes: 5 }), /liveMaxStreamMinutes/);
		// Turning live off keeps the limits, so turning it back on restores them
		await saveTier(d1, 'small', { live: false }, 'admin-1');
		const off = (await readTier(d1, 'small'))!;
		assert.equal(off.live, false);
		assert.equal(off.liveHoursMonth, 2);
	});

	it('refuses a user with no tier or a tier without live (403 live_not_in_tier)', async () => {
		const d1 = await setup();
		for (const userId of ['nobody', 'bob']) {
			const r = await checkLiveTier(d1, { userId }, 'create', { now: NOW });
			assert.ok('code' in r);
			assert.equal(r.status, 403);
			assert.equal(r.code, LIVE_TIER_ERROR_CODES.notInTier);
		}
		// Everyone holds a tier (Member when none is assigned, wiki AUN-TIER-REQUESTS): Member leaves live out
		assert.equal((await liveAccess(d1, 'nobody', [], NOW)).reason, 'not_in_tier');
		assert.equal((await liveAccess(d1, 'bob', [], NOW)).reason, 'not_in_tier');
	});

	it('applies the channel OWNER\'s tier, not the member\'s', async () => {
		const d1 = await setup();
		// bob (no live) working on alice's channel goes live under alice's tier
		const r = await checkLiveTier(d1, { userId: 'bob', channelOwnerId: 'alice' }, 'create', { now: NOW });
		assert.ok(!('code' in r));
		assert.equal(r.subjectId, 'alice');
	});

	it('limits a session to the longest stream or what is left of the month', async () => {
		const d1 = await setup();
		const fresh = await checkLiveTier(d1, { userId: 'alice' }, 'create', { now: NOW });
		assert.ok(!('code' in fresh));
		assert.equal(fresh.limitMinutes, 30);
		// 1 h 45 of the 2 h used this month: 15 minutes left
		await session(d1, 'alice', { firstSegmentAt: NOW - 3 * HOUR, endedAt: NOW - 3 * HOUR + 105 * 60_000 });
		assert.equal((await liveUsage(d1, 'alice', NOW)).usedMinutes, 105);
		const left = await checkLiveTier(d1, { userId: 'alice' }, 'start', { now: NOW });
		assert.ok(!('code' in left));
		assert.equal(left.limitMinutes, 15);
	});

	it('refuses once the month\'s hours are used (402), and a new month starts fresh', async () => {
		const d1 = await setup();
		await session(d1, 'alice', { firstSegmentAt: NOW - 4 * HOUR, endedAt: NOW - 2 * HOUR });
		const r = await checkLiveTier(d1, { userId: 'alice' }, 'start', { now: NOW });
		assert.ok('code' in r);
		assert.equal(r.status, 402);
		assert.equal(r.code, LIVE_TIER_ERROR_CODES.hoursUsed);
		assert.equal((await liveAccess(d1, 'alice', [], NOW)).allowed, false);
		const december = Date.parse('2026-12-01T00:30:00.000Z');
		assert.ok(!('code' in (await checkLiveTier(d1, { userId: 'alice' }, 'start', { now: december }))));
	});

	it('refuses a second stream at once on start only (403 live_concurrent_limit), not counting its own session', async () => {
		const d1 = await setup();
		const live = await session(d1, 'alice', { status: 'live', firstSegmentAt: NOW - 60_000 });
		const r = await checkLiveTier(d1, { userId: 'alice' }, 'start', { now: NOW });
		assert.ok('code' in r);
		assert.equal(r.code, LIVE_TIER_ERROR_CODES.concurrentLimit);
		assert.ok(!('code' in (await checkLiveTier(d1, { userId: 'alice' }, 'create', { now: NOW }))));
		assert.ok(!('code' in (await checkLiveTier(d1, { userId: 'alice' }, 'start', { now: NOW, sessionId: live }))));
	});

	it('super admins and Unlimited skip the limits', async () => {
		const d1 = await setup();
		await session(d1, 'boss', { firstSegmentAt: NOW - 400 * HOUR, endedAt: NOW });
		const r = await checkLiveTier(d1, { userId: 'boss', roles: ['Super Admin'] }, 'start', { now: NOW });
		assert.ok(!('code' in r));
		assert.equal(r.limitMinutes, null);
		const access = await liveAccess(d1, 'boss', ['Super Admin'], NOW);
		assert.equal(access.allowed, true);
		assert.equal(access.unlimited, true);
	});

	it('the sweep ends a session past its limit and leaves the others', async () => {
		const d1 = await setup();
		const over = await session(d1, 'alice', { status: 'live', firstSegmentAt: NOW - 31 * 60_000, limitMinutes: 30 });
		const within = await session(d1, 'alice', { status: 'live', firstSegmentAt: NOW - 10 * 60_000, limitMinutes: 30 });
		const unlimited = await session(d1, 'boss', { status: 'live', firstSegmentAt: NOW - 50 * HOUR, limitMinutes: null });
		const env = { SEARCH_DB: d1 } as never;
		assert.equal(await endOverTierLimit(env, NOW), 1);
		const ended = (await readSession(d1, over))!;
		assert.equal(ended.status, 'ended');
		assert.equal(ended.end_reason, 'tier_limit');
		assert.equal((await readSession(d1, within))!.status, 'live');
		assert.equal((await readSession(d1, unlimited))!.status, 'live');
	});

	it('the sweep ends the newest streams over the at-once cap, even ones that went live without Go live', async () => {
		const d1 = await setup();
		const first = await session(d1, 'alice', { status: 'live', firstSegmentAt: NOW - 5 * 60_000, limitMinutes: 30 });
		// The edge took this one live on its first segment, no start ever checked it
		const second = await session(d1, 'alice', { status: 'live', firstSegmentAt: NOW - 2 * 60_000, limitMinutes: 30 });
		assert.equal(await endOverTierLimit({ SEARCH_DB: d1 } as never, NOW), 1);
		assert.equal((await readSession(d1, first))!.status, 'live');
		assert.equal((await readSession(d1, second))!.end_reason, 'tier_limit');
	});

	it('the sweep ends every live stream once their hours together use the month, or the tier drops live', async () => {
		const d1 = await setup();
		await saveTier(d1, 'small', { liveMaxConcurrent: 2 }, 'admin-1');
		// Two 61-minute streams, each within its own limit, use the 2-hour month together
		const a = await session(d1, 'alice', { status: 'live', firstSegmentAt: NOW - 61 * 60_000, limitMinutes: 120 });
		const b = await session(d1, 'alice', { status: 'live', firstSegmentAt: NOW - 61 * 60_000, limitMinutes: 120 });
		assert.equal(await endOverTierLimit({ SEARCH_DB: d1 } as never, NOW), 2);
		assert.equal((await readSession(d1, a))!.status, 'ended');
		assert.equal((await readSession(d1, b))!.status, 'ended');

		const c = await session(d1, 'carol', { status: 'live', firstSegmentAt: NOW - 60_000, limitMinutes: 240 });
		await saveTier(d1, 'creator', { live: false }, 'admin-1');
		assert.equal(await endOverTierLimit({ SEARCH_DB: d1 } as never, NOW), 1);
		assert.equal((await readSession(d1, c))!.end_reason, 'tier_limit');
	});

	it('a member removed from the channel may not go live under the owner\'s tier', async () => {
		const channel = { userId: 'alice', members: [{ userId: 'bob', role: 'admin' }] };
		const bucket = (record: unknown) => ({ get: async () => ({ json: async () => record }) }) as unknown as R2Bucket;
		const stream = { channelId: 'ch-1', userId: 'bob' };
		assert.deepEqual(await streamTierContext({ channels: bucket(channel) }, stream, 'bob'), { ownerId: 'alice', callerMayGoLive: true });
		assert.deepEqual(await streamTierContext({ channels: bucket({ userId: 'alice', members: [] }) }, stream, 'bob'), { ownerId: 'alice', callerMayGoLive: false });
		assert.equal((await streamTierContext({ channels: bucket(channel) }, stream, 'alice')).callerMayGoLive, true);
	});

	it('account erasure clears the owner from their sessions and keeps the sessions', async () => {
		const d1 = await setup();
		const mine = await session(d1, 'alice');
		const theirs = await session(d1, 'carol');
		await eraseLiveSessionOwner(d1, 'alice');
		assert.equal((await readSession(d1, mine))!.owner_id, null);
		assert.equal((await readSession(d1, theirs))!.owner_id, 'carol');
	});
});
