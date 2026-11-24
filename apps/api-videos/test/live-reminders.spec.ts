/** Reminders (wiki E17 §5.5): setting them, the heads-up (once per start time), and the owner's notice. */
import { beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { forgetFeatureSwitches, writeFeatureSwitch } from '@al-ummah/shared-types';
import { LiveReminderClear, LiveReminderSet } from '../src/endpoints/live/liveReminders';
import { LiveStreamStateGet } from '../src/endpoints/live/liveSession';
import { cancelPremiere } from '../src/lib/live/premieres';
import { HEADS_UP_MS, runHeadsUps } from '../src/lib/live/reminders';
import { withSearchSync } from '../src/lib/search/sync';
import { JobsQueue, MemoryBucket, MemoryQueue, buildApp } from './helpers';
import { SqliteD1 } from './search-sqlite-d1';
import { createSqliteD1 } from './sqlite-d1';

type Json = Record<string, any>;
beforeEach(() => forgetFeatureSwitches());

async function setup() {
	const db = new SqliteD1();
	const ndb = createSqliteD1() as any;
	const raw: Json = { SEARCH_DB: db, NOTIFICATIONS_DB: ndb, ADMIN_JOBS_QUEUE: new JobsQueue(), queue: new MemoryQueue() };
	for (const b of ['videos', 'channels', 'profiles', 'playlists', 'community_posts']) raw[b] = new MemoryBucket();
	const env = withSearchSync(raw, { waitUntil: () => undefined }) as Json;
	await raw.channels.put('ch1', JSON.stringify({ id: 'ch1', userId: 'owner', name: 'Channel' }));
	const flip = async (on: boolean, key: 'liveReminders' | 'livePremieres' = 'liveReminders') => {
		const row = db.db.prepare('SELECT version FROM feature_switches WHERE key = ?').get(key) as Json | undefined;
		await writeFeatureSwitch(env as never, { key, enabled: on, expectedVersion: row?.version ?? 0, actorId: 'usr_a', currentStored: !on });
	};
	await flip(true);
	await flip(true, 'livePremieres');
	const now = Date.now();
	const put = (over: Json = {}) => env.videos.put(`livestream:${over.id ?? 's1'}`, JSON.stringify({ id: 's1', userId: 'owner', channelId: 'ch1', title: 'Halqa', status: 'scheduled', dateCreated: '2026-11-20T10:00:00.000Z', scheduledStartTime: new Date(now + 10 * 60_000).toISOString(), ...over }));
	await put();
	const call = async (userId: string | null, method: string, path: string) => {
		const app = buildApp((r) => {
			r.post('/api/live-streams/:id/reminders', LiveReminderSet);
			r.delete('/api/live-streams/:id/reminders', LiveReminderClear);
			r.get('/api/live-streams/:id/state', LiveStreamStateGet);
		}, userId ? { userId } : null);
		const res = await app.request(`/api/live-streams/${path}`, { method }, env);
		return { status: res.status, json: (await res.json()) as Json };
	};
	const sent = () => raw.queue.messages.map((m: Json) => m.payload).filter((p: Json) => p.kind === 'live_soon');
	const count = () => (db.db.prepare("SELECT reminder_count AS n FROM live_stream_metadata WHERE stream_id = 's1'").get() as Json).n;
	return { db, ndb, raw, env, put, call, sent, count, now, flip };
}

describe('setting', () => {
	it('counts a person once, and takes back what was set', async () => {
		const t = await setup();
		for (let i = 0; i < 3; i++) assert.deepEqual((await t.call('ali', 'POST', 's1/reminders')).json.result, { set: true, count: 1 });
		assert.deepEqual((await t.call('sara', 'POST', 's1/reminders')).json.result, { set: true, count: 2 });
		assert.deepEqual((await t.call('ali', 'GET', 's1/state')).json.result.reminder, { enabled: true, count: 2, set: true });
		assert.deepEqual((await t.call(null, 'GET', 's1/state')).json.result.reminder, { enabled: true, count: 2, set: false });
		for (let i = 0; i < 2; i++) assert.deepEqual((await t.call('ali', 'DELETE', 's1/reminders')).json.result, { set: false, count: 1 });
		assert.equal(t.count(), 1);
	});

	it('only on a public scheduled stream of a channel, not made for kids; taking one back always works', async () => {
		for (const over of [{ status: 'live' }, { status: 'ended' }, { status: 'cancelled' }, { isPrivate: true }, { isHidden: true }, { madeForKids: true }, { channelId: undefined }]) {
			const t = await setup();
			await t.call('ali', 'POST', 's1/reminders');
			await t.put(over);
			assert.equal((await t.call('sara', 'POST', 's1/reminders')).status, 404, JSON.stringify(over));
			assert.equal((await t.call('ali', 'DELETE', 's1/reminders')).status, 200, JSON.stringify(over));
			assert.deepEqual((await t.ndb.prepare('SELECT * FROM live_reminders').all()).results, []);
		}
		const t = await setup();
		assert.equal((await t.call('ali', 'POST', 'nope/reminders')).status, 404);
	});

	it('survives a write of the stream', async () => {
		const t = await setup();
		await t.call('ali', 'POST', 's1/reminders');
		await t.put({ title: 'New title' });
		assert.equal(t.count(), 1);
	});
});

describe('heads-up', () => {
	it('is sent once per start time, in the 30 minutes before it, and again when it moves', async () => {
		const t = await setup();
		await t.call('ali', 'POST', 's1/reminders');
		const at = Date.parse(new Date(t.now + 10 * 60_000).toISOString());
		assert.equal((await runHeadsUps(t.env as never, at - HEADS_UP_MS - 1)).sent, 0);
		const both = await Promise.all([runHeadsUps(t.env as never, at - HEADS_UP_MS), runHeadsUps(t.env as never, at - HEADS_UP_MS)]);
		assert.equal(both[0].sent + both[1].sent, 1);
		assert.equal((await runHeadsUps(t.env as never, at - 1000)).sent, 0);
		const [payload] = t.sent();
		assert.deepEqual([payload.audience, payload.entityId, payload.startsAt, payload.actionUrl, payload.params.streamTitle, payload.params.channelName], ['reminders', 's1', at, '/live/s1', 'Halqa', 'Channel']);
		const later = at + 3 * 3_600_000;
		await t.put({ scheduledStartTime: new Date(later).toISOString() });
		assert.equal((await runHeadsUps(t.env as never, later - 60_000)).sent, 1);
		assert.equal(t.sent()[1].startsAt, later);
	});

	it('a failed queue is tried again; nobody asking sends nothing; the count is put right', async () => {
		const t = await setup();
		assert.equal((await runHeadsUps(t.env as never, t.now)).sent, 0);
		await t.put({ scheduledStartTime: new Date(t.now + 11 * 60_000).toISOString() });
		await t.call('ali', 'POST', 's1/reminders');
		t.db.db.exec("UPDATE live_stream_metadata SET reminder_count = 99 WHERE stream_id = 's1'");
		const send = t.raw.queue.send;
		t.raw.queue.send = async () => { throw new Error('queue down'); };
		assert.deepEqual(await runHeadsUps(t.env as never, t.now), { sent: 0, cancelled: 0, failed: 1 });
		t.raw.queue.send = send;
		assert.equal((await runHeadsUps(t.env as never, t.now)).sent, 1);
		assert.equal(t.count(), 1);
	});

	it('a read that fails is tried again: the heads-up is not lost', async () => {
		for (const where of ['record', 'count', 'channel'] as const) {
			const t = await setup();
			await t.call('ali', 'POST', 's1/reminders');
			const { videos, channels, NOTIFICATIONS_DB: ndb } = t.env;
			const failing = (bucket: any) => new Proxy(bucket, { get: (target, p) => (p === 'get' ? async () => { throw new Error('R2 down'); } : typeof target[p] === 'function' ? target[p].bind(target) : target[p]) });
			if (where === 'record') t.env.videos = failing(videos);
			if (where === 'count') t.env.NOTIFICATIONS_DB = { prepare: () => { throw new Error('D1 down'); } };
			// The channel's name is optional: without it the heads-up still goes
			if (where === 'channel') t.env.channels = failing(channels);
			const first = await runHeadsUps(t.env as never, t.now);
			Object.assign(t.env, { videos, channels, NOTIFICATIONS_DB: ndb });
			const second = await runHeadsUps(t.env as never, t.now);
			assert.equal(first.sent + second.sent, 1, where);
			if (where !== 'channel') assert.deepEqual([first.failed, second.sent], [1, 1], where);
		}
	});

	it('never for a stream that is not public and scheduled, nor while the switch is off', async () => {
		for (const over of [{ status: 'cancelled' }, { isPrivate: true }, { isHidden: true }, { madeForKids: true }]) {
			const t = await setup();
			await t.call('ali', 'POST', 's1/reminders');
			await t.put(over);
			assert.equal((await runHeadsUps(t.env as never, t.now)).sent, 0, JSON.stringify(over));
		}
		const t = await setup();
		await t.call('ali', 'POST', 's1/reminders');
		await t.flip(false);
		assert.equal((await runHeadsUps(t.env as never, t.now)).sent, 0);
	});

	it('a premiere reminds nobody while premieres are off', async () => {
		const t = await setup();
		await t.put({ kind: 'premiere', premiereVideoId: 'v1', durationSeconds: 60 });
		await t.call('ali', 'POST', 's1/reminders');
		await t.flip(false, 'livePremieres');
		assert.deepEqual(await runHeadsUps(t.env as never, t.now), { sent: 0, cancelled: 0, failed: 0 });
		assert.equal((await t.call('sara', 'POST', 's1/reminders')).status, 404);
	});

	it('a premiere that cannot be shown any more is cancelled, and its owner told once', async () => {
		const t = await setup();
		await t.put({ kind: 'premiere', premiereVideoId: 'gone', durationSeconds: 60 });
		await t.call('ali', 'POST', 's1/reminders');
		assert.deepEqual(await runHeadsUps(t.env as never, t.now), { sent: 0, cancelled: 1, failed: 0 });
		await cancelPremiere(t.env as never, 's1', 'missed');
		const notices = t.raw.queue.messages.map((m: Json) => m.payload).filter((p: Json) => p.notificationKey === 'premiereCancelled');
		assert.equal(notices.length, 1);
		assert.deepEqual([notices[0].recipientUserId, notices[0].actionUrl, notices[0].dedupeKey], ['owner', '/studio/ch1/content/live', 'premiere-cancelled:s1']);
	});

	it('every query uses an index', async () => {
		const t = await setup();
		t.db.trace = [];
		await t.call('ali', 'POST', 's1/reminders');
		await runHeadsUps(t.env as never, t.now);
		const live = t.db.trace.filter((q) => q.sql.includes('live_stream_metadata'));
		assert.ok(live.length >= 4);
		for (const q of live) assert.ok(!/\bSCAN\b/.test(t.db.plan(q).join(' ; ')), `${q.sql}\n${t.db.plan(q).join(' ; ')}`);
		const plan = async (sql: string, ...args: unknown[]) => ((await t.ndb.prepare(`EXPLAIN QUERY PLAN ${sql}`).bind(...args).all()).results as Json[]).map((r) => r.detail).join(' ; ');
		for (const [sql, ...args] of [['SELECT COUNT(*) AS n FROM live_reminders WHERE stream_id = ?', 's'], ['SELECT user_id FROM live_reminders WHERE stream_id = ? AND user_id > ? ORDER BY user_id LIMIT ?', 's', '', 10]] as const) assert.match(await plan(sql, ...args), /^SEARCH live_reminders USING (COVERING )?(PRIMARY KEY|INDEX)/);
	});
});
