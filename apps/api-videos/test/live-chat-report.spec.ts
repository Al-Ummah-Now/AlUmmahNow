/** Reporting a live chat message (wiki E17 §5.2): only what the reporter may read, and what it said goes with the report. */
import { beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { MessageType, forgetFeatureSwitches, writeFeatureSwitch } from '@al-ummah/shared-types';
import { ReportCreate } from '../src/endpoints/moderation/reportCreate';
import { forgetChatTiers } from '../src/lib/live/chat';
import { saveTier } from '../src/lib/creatorTiers';
import { withSearchSync } from '../src/lib/search/sync';
import { JobsQueue, MemoryBucket, MemoryQueue, buildApp } from './helpers';
import { SqliteD1 } from './search-sqlite-d1';
import { createSqliteD1 } from './sqlite-d1';

type Json = Record<string, any>;
beforeEach(() => forgetFeatureSwitches());

async function setup(tier: Json = { live: true }) {
	forgetChatTiers();
	const db = new SqliteD1();
	const pending: Promise<unknown>[] = [];
	const raw: Json = { SEARCH_DB: db, NOTIFICATIONS_DB: createSqliteD1(), ADMIN_JOBS_QUEUE: new JobsQueue(), queue: new MemoryQueue() };
	for (const b of ['videos', 'channels', 'profiles', 'playlists', 'community_posts', 'reports']) raw[b] = new MemoryBucket();
	const env = withSearchSync(raw, { waitUntil: (p: Promise<unknown>) => void pending.push(p) }) as Json;
	await env.channels.put('ch1', JSON.stringify({ id: 'ch1', userId: 'owner', name: 'Channel', members: [{ userId: 'mod', role: 'moderator' }] }));
	await saveTier(db as never, 'creator', tier, 'test');
	db.db.prepare("INSERT INTO creator_tier_assignments (user_id, tier_id, source, assigned_by, assigned_at) VALUES ('owner', 'creator', 'admin', 'test', '2026-11-01')").run();
	let version = 0;
	const flip = async (on: boolean) => void (await writeFeatureSwitch(env as never, { key: 'liveChat', enabled: on, expectedVersion: version++, actorId: 'usr_a', currentStored: !on && version > 1 }));
	const put = async (over: Json = {}) => {
		await env.videos.put('livestream:s1', JSON.stringify({ id: 's1', userId: 'owner', channelId: 'ch1', title: 'Halqa', status: 'live', isPrivate: false, dateCreated: '2026-11-20T10:00:00.000Z', ...over }));
		while (pending.length) await pending.shift();
	};
	await put();
	const chat = (id: string, status = 'published', text = 'bad\n words') => db.db.prepare('INSERT INTO live_chat_messages (id, stream_id, user_id, author_name, text, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, 1, 1)').run(id, 's1', 'ali', 'Ali', text, status);
	chat('m1');
	const report = async (userId: string, entityId = 'm1', body: Json = {}) => {
		const res = await buildApp((r) => { r.post('/api/reports', ReportCreate); }, { userId }).request('/api/reports', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ entityType: 'live_chat', entityId, reason: 'harassment', ...body }) }, env);
		return { status: res.status, json: (await res.json()) as Json };
	};
	const filed = () => raw.queue.messages.filter((m: Json) => m.type === MessageType.ReportCreate).map((m: Json) => m.payload);
	const stored = async () => (await raw.reports.list({})).objects.map((o: Json) => o.key);
	return { db, env, raw, flip, put, chat, report, filed, stored };
}

const refused = async (t: Awaited<ReturnType<typeof setup>>, r: { status: number; json: Json }, code: string) => {
	assert.deepEqual([r.status, r.json.code], [404, code]);
	// Nothing is claimed, so the same person may report it later
	assert.deepEqual([t.filed(), await t.stored()], [[], []]);
};

describe('reporting a chat message', () => {
	it('is off with live chat', async () => {
		const t = await setup();
		await refused(t, await t.report('sara'), 'feature_off');
	});

	it('is refused while the switch cannot be read', async () => {
		const t = await setup();
		await t.flip(true);
		forgetFeatureSwitches();
		const prepare = t.db.prepare.bind(t.db);
		(t.db as Json).prepare = (sql: string) => { if (/feature_switches/.test(sql)) throw new Error('D1 is down'); return prepare(sql); };
		await refused(t, await t.report('sara'), 'feature_off');
	});

	it('keeps the message and where it was', async () => {
		const t = await setup();
		await t.flip(true);
		const r = await t.report('sara');
		assert.equal(r.status, 200, JSON.stringify(r.json));
		assert.deepEqual(t.filed().map((p: Json) => [p.entityType, p.entityId, p.reporterId, p.subject]), [['live_chat', 'm1', 'sara', { text: 'bad words', parentId: 's1', channelId: 'ch1', ownerId: 'ali' }]]);
		// The reporter's copy does not hold another person's words, and the answer does not either
		const key = (await t.stored()).find((k: string) => k.startsWith('report:'))!;
		assert.ok(!JSON.stringify(t.raw.reports.read(key)).includes('bad words'));
		assert.ok(!JSON.stringify(r.json).includes('bad words'));
		assert.equal((await t.report('sara')).status, 409);
		assert.equal((await t.report('mod')).status, 200);
	});

	for (const [name, id, status] of [['a missing message', 'nope', null], ['a removed message', 'm2', 'removed'], ['a held message', 'm2', 'held']] as const) {
		it(`${name} cannot be reported`, async () => {
			const t = await setup();
			await t.flip(true);
			if (status) t.chat(id, status);
			await refused(t, await t.report('sara', id), 'not_found');
		});
	}

	for (const [name, over] of [['a private', { isPrivate: true }], ['a hidden', { isHidden: true }], ['a deleted', { isHidden: true, isDeleted: true }], ['a cancelled', { status: 'cancelled' }], ['a made-for-kids', { madeForKids: true }], ['a chat-off', { allowChat: false }], ['a replay-off ended', { status: 'ended', chatReplay: false }], ['a withheld', { status: 'ended', review: { status: 'in_review' } }]] as Array<[string, Json]>) {
		it(`${name} stream’s messages cannot be reported by a viewer`, async () => {
			const t = await setup();
			await t.flip(true);
			await t.put(over);
			await refused(t, await t.report('sara'), 'not_found');
		});
	}

	it('its team may report on a private stream', async () => {
		const t = await setup();
		await t.flip(true);
		await t.put({ isPrivate: true });
		assert.equal((await t.report('mod')).status, 200);
	});

	it('is off when the owner’s tier has no chat', async () => {
		const t = await setup({ live: true, liveChat: false });
		await t.flip(true);
		await refused(t, await t.report('sara'), 'not_found');
	});
});

it('other reports are as they were: no subject, and no switch', async () => {
	const t = await setup();
	assert.equal((await t.report('sara', 'v1', { entityType: 'video' })).status, 200);
	assert.equal('subject' in t.filed()[0], false);
});
