/** Event tags (wiki E17 §5.1): who may set one, the `kind` and `eventType` list filters, and reminder counts in the lists. */
import { beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { forgetFeatureSwitches, ownershipCompleteKey, writeFeatureSwitch } from '@al-ummah/shared-types';
import { LiveStreamCreate } from '../src/endpoints/live/liveStreamCreate';
import { LiveStreamGet, LiveStreamStateGet } from '../src/endpoints/live/liveSession';
import { LiveStreamUpdate } from '../src/endpoints/live/liveStreamUpdate';
import { LiveStreamsList } from '../src/endpoints/live/liveStreamsList';
import { VideoPremiereCreate } from '../src/endpoints/live/premiere';
import { saveTier } from '../src/lib/creatorTiers';
import { streamListIds } from '../src/lib/search/ownership';
import { withSearchSync } from '../src/lib/search/sync';
import { JobsQueue, MemoryBucket, MemoryQueue, buildApp, videoFixture } from './helpers';
import { SqliteD1 } from './search-sqlite-d1';
import { createSqliteD1 } from './sqlite-d1';

type Json = Record<string, any>;
const HOUR = 3_600_000;
beforeEach(() => forgetFeatureSwitches());

async function setup(tier: Json = { live: true }) {
	const db = new SqliteD1();
	const pending: Promise<unknown>[] = [];
	const raw: Json = { SEARCH_DB: db, NOTIFICATIONS_DB: createSqliteD1(), ADMIN_JOBS_QUEUE: new JobsQueue(), queue: new MemoryQueue(), SCHEDULED_VIDEOS: new MemoryBucket(), global_settings: new MemoryBucket() };
	for (const b of ['videos', 'channels', 'profiles', 'playlists', 'community_posts', 'subtitles']) raw[b] = new MemoryBucket();
	const env = withSearchSync(raw, { waitUntil: (p: Promise<unknown>) => void pending.push(p) }) as Json;
	const settle = async () => { while (pending.length) await pending.shift(); };
	await raw.channels.put('ch1', JSON.stringify({ id: 'ch1', userId: 'owner', name: 'Channel', members: [] }));
	await saveTier(db as never, 'creator', tier, 'test');
	db.db.prepare("INSERT INTO creator_tier_assignments (user_id, tier_id, source, assigned_by, assigned_at) VALUES ('owner', 'creator', 'admin', 'test', '2026-11-01')").run();
	db.db.prepare('INSERT INTO search_meta (key, value, updated_at) VALUES (?, ?, ?)').run(ownershipCompleteKey('stream'), '1', 1);
	const flip = async (key: string, on: boolean) => {
		const row = db.db.prepare('SELECT version, enabled FROM feature_switches WHERE key = ?').get(key) as Json | undefined;
		await writeFeatureSwitch(env as never, { key: key as never, enabled: on, expectedVersion: row?.version ?? 0, actorId: 'usr_a', currentStored: !!row?.enabled });
	};
	const put = async (id: string, over: Json = {}) => {
		await env.videos.put(`livestream:${id}`, JSON.stringify({
			id, title: id, description: '', userId: 'owner', channelId: 'ch1', status: 'scheduled', isPrivate: false, allowChat: true, tags: [], likes: [], dislikes: [], comments: [],
			currentViewers: 0, peakViewers: 0, views: 0, dateCreated: '2026-11-20T00:00:00.000Z', dateModified: '2026-11-20T00:00:00.000Z', scheduledStartTime: new Date(Date.now() + HOUR).toISOString(), ...over,
		}));
		await settle();
	};
	const stream = async (id: string) => (await (await raw.videos.get(`livestream:${id}`))?.json()) as Json;
	const call = async (userId: string | null, method: string, path: string, body?: unknown) => {
		const app = buildApp((r) => {
			r.get('/api/live-streams', LiveStreamsList);
			r.post('/api/live-streams', LiveStreamCreate);
			r.patch('/api/live-streams/:id', LiveStreamUpdate);
			r.get('/api/live-streams/:id/state', LiveStreamStateGet);
			r.get('/api/live-streams/:id', LiveStreamGet);
			r.post('/api/videos/:id/premiere', VideoPremiereCreate);
		}, userId ? { userId } : null);
		const res = await app.request(`/api/${path}`, { method, headers: { 'Content-Type': 'application/json', ...(method === 'POST' ? { channelId: 'ch1' } : {}) }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) }, env);
		await settle();
		return { status: res.status, json: (await res.json().catch(() => ({}))) as Json };
	};
	const ids = async (query: string, userId: string | null = null) => {
		const { status, json } = await call(userId, 'GET', `live-streams?${query}`);
		assert.equal(status, 200, JSON.stringify(json));
		return (json.result.data as Json[]).map((s) => s.id).sort();
	};
	return { db, raw, env, flip, put, stream, call, ids };
}

const isOff = (r: { status: number; json: Json }) => assert.deepEqual([r.status, r.json.code, r.json.feature], [404, 'feature_off', 'liveEvents']);

describe('setting a tag', () => {
	it('needs the switch', async () => {
		const t = await setup();
		await t.put('s1');
		isOff(await t.call('owner', 'PATCH', 'live-streams/s1', { eventType: 'halqa' }));
		assert.equal((await t.stream('s1')).eventType, undefined);
		await t.flip('liveEvents', true);
		const saved = await t.call('owner', 'PATCH', 'live-streams/s1', { eventType: 'halqa' });
		assert.deepEqual([saved.status, saved.json.result.stream.eventType, (await t.stream('s1')).eventType], [200, 'halqa', 'halqa']);
		assert.equal((t.db.db.prepare("SELECT event_type FROM live_stream_metadata WHERE stream_id = 's1'").get() as Json).event_type, 'halqa');
	});

	it('needs the owner’s tier', async () => {
		const t = await setup({ live: true, liveEvents: false });
		await t.flip('liveEvents', true);
		await t.put('s1');
		isOff(await t.call('owner', 'PATCH', 'live-streams/s1', { eventType: 'jumuah' }));
		assert.equal((await t.stream('s1')).eventType, undefined);
	});

	it('takes only the listed tags, and only from who manages the stream', async () => {
		const t = await setup();
		await t.flip('liveEvents', true);
		await t.put('s1');
		assert.equal((await t.call('owner', 'PATCH', 'live-streams/s1', { eventType: 'party' })).status, 400);
		assert.equal((await t.call('stranger', 'PATCH', 'live-streams/s1', { eventType: 'jumuah' })).status, 403);
	});

	it('can always be taken off', async () => {
		const t = await setup();
		await t.put('s1', { eventType: 'conference' });
		const r = await t.call('owner', 'PATCH', 'live-streams/s1', { eventType: null });
		assert.deepEqual([r.status, (await t.stream('s1')).eventType], [200, null]);
		assert.equal((t.db.db.prepare("SELECT event_type FROM live_stream_metadata WHERE stream_id = 's1'").get() as Json).event_type, null);
	});

	it('other fields are saved while tags are off, and the tag stays', async () => {
		const t = await setup();
		await t.put('s1', { eventType: 'conference' });
		const r = await t.call('owner', 'PATCH', 'live-streams/s1', { title: 'New title' });
		assert.deepEqual([r.status, r.json.result.stream.title, r.json.result.stream.eventType, (await t.stream('s1')).eventType], [200, 'New title', null, 'conference']);
	});

	it('a premiere takes one too', async () => {
		const t = await setup();
		await t.flip('livePremieres', true);
		await t.env.videos.put('v1', JSON.stringify({ ...videoFixture(), id: 'v1', userId: 'owner', channelId: 'ch1', isPublic: false, uploadStatus: 'ready', duration: 600, width: 1920, height: 1080, title: 'Lecture' }));
		const body = { scheduledStartTime: new Date(Date.now() + HOUR).toISOString(), eventType: 'taraweeh' };
		isOff(await t.call('owner', 'POST', 'videos/v1/premiere', body));
		assert.equal(((await (await t.raw.videos.get('v1')).json()) as Json).premiereHold, undefined);
		await t.flip('liveEvents', true);
		const r = await t.call('owner', 'POST', 'videos/v1/premiere', body);
		assert.deepEqual([r.status, r.json.result.stream.eventType], [200, 'taraweeh']);
	});

	it('a refused tag creates no stream', async () => {
		const t = await setup();
		isOff(await t.call('owner', 'POST', 'live-streams', { title: 'Khutbah', eventType: 'jumuah' }));
		assert.equal((await t.raw.videos.list({ prefix: 'livestream:' })).objects.length, 0);
	});
});

describe('reading', () => {
	it('shows no tag while tags are off', async () => {
		const t = await setup();
		await t.put('s1', { eventType: 'jumuah' });
		const read = async () => [
			(await t.call(null, 'GET', 'live-streams/s1')).json.result.stream.eventType,
			(await t.call(null, 'GET', 'live-streams/s1/state')).json.result.eventType,
			(await t.call(null, 'GET', 'live-streams')).json.result.data[0].eventType,
		];
		assert.deepEqual(await read(), [null, null, null]);
		await t.flip('liveEvents', true);
		assert.deepEqual(await read(), ['jumuah', 'jumuah', 'jumuah']);
	});

	it('gives the reminder count while reminders are on', async () => {
		const t = await setup();
		await t.put('s1');
		t.db.db.prepare("UPDATE live_stream_metadata SET reminder_count = 7 WHERE stream_id = 's1'").run();
		const read = async () => [(await t.call(null, 'GET', 'live-streams/s1')).json.result.stream.reminderCount, (await t.call(null, 'GET', 'live-streams')).json.result.data[0].reminderCount];
		assert.deepEqual(await read(), [0, 0]);
		await t.flip('liveReminders', true);
		assert.deepEqual(await read(), [7, 7]);
	});
});

describe('the list filters', () => {
	async function filled() {
		const t = await setup();
		await t.flip('liveEvents', true);
		await t.flip('livePremieres', true);
		await t.put('plain');
		await t.put('friday', { eventType: 'jumuah' });
		await t.put('friday-over', { eventType: 'jumuah', status: 'ended' });
		await t.put('friday-private', { eventType: 'jumuah', isPrivate: true });
		await t.put('friday-hidden', { eventType: 'jumuah', isHidden: true });
		await t.put('other-channel', { eventType: 'jumuah', channelId: 'ch2', userId: 'someone' });
		await t.put('premiere', { kind: 'premiere', premiereVideoId: 'v9', durationSeconds: 60, eventType: 'conference' });
		return t;
	}

	it('by tag, with the same visibility as the list', async () => {
		const t = await filled();
		assert.deepEqual(await t.ids('eventType=jumuah'), ['friday', 'friday-over', 'other-channel']);
		assert.deepEqual(await t.ids('eventType=jumuah', 'owner'), ['friday', 'friday-hidden', 'friday-over', 'friday-private', 'other-channel']);
		assert.deepEqual(await t.ids('eventType=jumuah&status=ended'), ['friday-over']);
		assert.deepEqual(await t.ids('eventType=jumuah&channelId=ch2'), ['other-channel']);
		assert.deepEqual(await t.ids('eventType=halqa'), []);
	});

	it('by kind', async () => {
		const t = await filled();
		assert.deepEqual(await t.ids('kind=premiere'), ['premiere']);
		assert.deepEqual(await t.ids('kind=live'), ['friday', 'friday-over', 'other-channel', 'plain']);
		assert.deepEqual(await t.ids('kind=premiere&eventType=conference'), ['premiere']);
		assert.deepEqual(await t.ids('kind=live&eventType=conference'), []);
	});

	it('pages through a filtered list without repeats', async () => {
		const t = await filled();
		const seen: string[] = [];
		let cursor = '';
		for (let i = 0; i < 5; i++) {
			const { json } = await t.call(null, 'GET', `live-streams?eventType=jumuah&limit=1${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`);
			seen.push(...(json.result.data as Json[]).map((s) => s.id));
			cursor = json.result.cursor;
			if (!cursor) break;
		}
		assert.deepEqual(seen.sort(), ['friday', 'friday-over', 'other-channel']);
	});

	it('gives the same answer while the index is not complete', async () => {
		const t = await filled();
		t.db.db.prepare('DELETE FROM search_meta WHERE key = ?').run(ownershipCompleteKey('stream'));
		assert.deepEqual(await t.ids('eventType=jumuah'), ['friday', 'friday-over', 'other-channel']);
		assert.deepEqual(await t.ids('kind=premiere'), ['premiere']);
	});

	it('answers feature_off while tags are off, and 400 for an unknown value', async () => {
		const t = await filled();
		assert.equal((await t.call(null, 'GET', 'live-streams?eventType=party')).status, 400);
		assert.equal((await t.call(null, 'GET', 'live-streams?kind=other')).status, 400);
		await t.flip('liveEvents', false);
		isOff(await t.call(null, 'GET', 'live-streams?eventType=jumuah'));
		assert.deepEqual(await t.ids('kind=premiere'), ['premiere']);
	});

	it('reads the model by its indexes', async () => {
		const t = await filled();
		const seen: string[] = [];
		const prepare = t.db.prepare.bind(t.db);
		(t.db as Json).prepare = (sql: string) => (seen.push(sql), prepare(sql));
		for (const q of [{ eventType: 'jumuah' }, { kind: 'premiere' }, { kind: 'live' }, { kind: 'premiere', eventType: 'halqa', channelId: 'ch1', status: 'scheduled' }]) {
			await streamListIds({ SEARCH_DB: t.db } as never, { channelId: null, limit: 10, viewerId: null, ...q } as never);
		}
		const lists = seen.filter((sql) => /live_stream_metadata/.test(sql));
		assert.equal(lists.length, 4);
		for (const sql of lists) {
			const args = (sql.match(/\?/g) ?? []).map(() => 'x');
			const plan = (t.db.db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all(...args) as Json[]).map((r) => r.detail as string);
			assert.ok(!plan.some((d) => /^SCAN (live_stream_metadata|m|content_ownership)\b(?!.*USING (COVERING )?INDEX)/.test(d)), `${sql}\n${plan.join('\n')}`);
		}
	});
});
