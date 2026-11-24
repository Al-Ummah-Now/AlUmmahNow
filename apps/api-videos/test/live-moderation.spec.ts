/** A moderator's decisions on live streams and chat messages, the admin lookup of both, and the 30-day purge (wiki E17-2b). */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { lookup } from '../src/lib/admin/lookup';
import { moderateLive } from '../src/lib/admin/liveModeration';
import { LiveStreamIngestGet, LiveStreamStart } from '../src/endpoints/live/liveSession';
import { LiveStreamUpdate } from '../src/endpoints/live/liveStreamUpdate';
import { insertSession, readSession, updateSession } from '../src/lib/live/store';
import { markStreamLive } from '../src/lib/live/streams';
import { REMOVED_CHAT_DAYS, chatCacheUrl, purgeRemovedChat } from '../src/lib/live/chat';
import { withSearchSync } from '../src/lib/search/sync';
import { JobsQueue, MemoryBucket, MemoryQueue, buildApp } from './helpers';
import { SqliteD1 } from './search-sqlite-d1';
import { createSqliteD1 } from './sqlite-d1';

type Json = Record<string, any>;
const DAY = 86_400_000;

function setup() {
	const db = new SqliteD1();
	const sent: Json[] = [];
	const pending: Promise<unknown>[] = [];
	const raw: Json = { SEARCH_DB: db, NOTIFICATIONS_DB: createSqliteD1(), ADMIN_JOBS_QUEUE: new JobsQueue(), queue: new MemoryQueue(), WEBSOCKET_URL: 'https://realtime.test', INTERNAL_API_KEY: 'k' };
	for (const b of ['videos', 'channels', 'profiles', 'playlists', 'community_posts']) raw[b] = new MemoryBucket();
	globalThis.fetch = (async (_u: string, init?: RequestInit) => { const b = JSON.parse(String(init?.body)); sent.push({ channel: b.channel, type: b.message.type, ...b.message.data }); return Response.json({}); }) as never;
	const env = withSearchSync(raw, { waitUntil: (p: Promise<unknown>) => void pending.push(p) }) as Json;
	const put = (over: Json = {}) => env.videos.put(`livestream:${over.id ?? 's1'}`, JSON.stringify({ id: 's1', userId: 'owner', channelId: 'ch1', title: 'Halqa', status: 'live', dateCreated: '2026-11-20T10:00:00.000Z', ...over }));
	const chat = (id: string, over: Json = {}) => {
		const r = { stream_id: 's1', user_id: 'ali', text: 'hello', status: 'published', updated_at: 1, held_by: null, removed_by: null, ...over };
		db.db.prepare('INSERT INTO live_chat_messages (id, stream_id, user_id, author_name, text, status, held_by, removed_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?)').run(id, r.stream_id, r.user_id, 'Ali', r.text, r.status, r.held_by, r.removed_by, r.updated_at);
	};
	const act = async (entityType: 'livestream' | 'live_chat', entityId: string, action: Json['x']) => { const r = await moderateLive(env as never, { entityType, entityId, action, actorId: 'usr_mod' }); while (pending.length) await pending.shift(); return r; };
	const stream = async (id = 's1') => (await (await raw.videos.get(`livestream:${id}`))?.json()) as Json;
	const status = (id: string) => (db.db.prepare('SELECT status, removed_by FROM live_chat_messages WHERE id = ?').get(id) as Json);
	const session = async (status: string) => {
		const id = crypto.randomUUID();
		await insertSession(db as never, { id, stream_id: 's1', channel_id: 'ch1', provider: 'selfhosted', provider_ref: id, reason: 'round_robin', preferred: null, seq: 1, failover_from: null, failover_error: null, low_latency: 0, is_test: 1, created_at: Date.now(), playback_url: null, owner_id: 'owner', limit_minutes: null });
		await updateSession(db as never, id, { status: status as never });
		return id;
	};
	const request = async (userId: string, method: string, path: string, body?: unknown) => {
		const app = buildApp((r) => {
			r.get('/api/live-streams/:id/ingest', LiveStreamIngestGet);
			r.post('/api/live-streams/:id/start', LiveStreamStart);
			r.patch('/api/live-streams/:id', LiveStreamUpdate);
		}, { userId });
		const res = await app.request(`/api/live-streams/${path}`, { method, headers: { 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) }, env);
		return { status: res.status, json: (await res.json().catch(() => ({}))) as Json };
	};
	return { db, env, raw, put, chat, act, sent, stream, status, session, request };
}

describe('chat messages', () => {
	it('removed, restored, and told to the channel', async () => {
		const t = setup();
		await t.put();
		t.chat('m1');
		for (const action of ['removed', 'banned', 'deleted']) {
			assert.deepEqual(await t.act('live_chat', 'm1', action), { found: true, changed: true }, action);
			assert.deepEqual({ ...t.status('m1') }, { status: 'removed', removed_by: 'admin' });
			assert.deepEqual(await t.act('live_chat', 'm1', action), { found: true, changed: false });
			assert.deepEqual(await t.act('live_chat', 'm1', 'restored'), { found: true, changed: true });
		}
		assert.deepEqual(t.sent.map((e) => [e.channel, e.type]).slice(0, 2), [['live:s1', 'live_chat_removed'], ['live:s1', 'live_chat_message']]);
		assert.deepEqual(await t.act('live_chat', 'm1', 'warning'), { found: true, changed: false });
		assert.deepEqual(await t.act('live_chat', 'nope', 'removed'), { found: false, changed: false });
	});

	it('a decision drops the shared latest page', async () => {
		const t = setup();
		t.env.VIDEOS_API_URL = 'https://api.test';
		await t.put();
		t.chat('m1');
		const dropped: string[] = [];
		(globalThis as any).caches = { default: { match: async () => undefined, put: async () => undefined, delete: async (u: string) => (dropped.push(u), true) } };
		try {
			const url = chatCacheUrl({ VIDEOS_API_URL: 'https://api.test' }, 's1');
			await t.act('live_chat', 'm1', 'removed');
			await t.act('live_chat', 'm1', 'restored');
			assert.deepEqual(dropped, [url, url]);
			await t.act('live_chat', 'm1', 'warning');
			assert.equal(dropped.length, 2);
		} finally {
			delete (globalThis as any).caches;
		}
	});

	it('what its author removed is not brought back', async () => {
		const t = setup();
		t.chat('m1', { status: 'removed', removed_by: 'author' });
		assert.deepEqual(await t.act('live_chat', 'm1', 'restored'), { found: true, changed: false });
	});
});

describe('live streams', () => {
	it('are found by their id, hidden, and everything follows: the index, the chat channel, what is on air', async () => {
		const t = setup();
		await t.put();
		assert.deepEqual(await t.act('livestream', 's1', 'removed'), { found: true, changed: true });
		const s = await t.stream();
		assert.deepEqual([s.isHidden, s.hiddenByUserId, s.status], [true, 'usr_mod', 'ended']);
		assert.equal((t.db.db.prepare("SELECT is_hidden FROM content_ownership WHERE kind = 'stream' AND id = 's1'").get() as Json).is_hidden, 1);
		assert.equal((t.db.db.prepare('SELECT visibility FROM live_stream_metadata').get() as Json).visibility, 'hidden');
		assert.ok(t.sent.some((e) => e.channel === 'live:s1' && e.type === 'live_chat_closed'));
		assert.deepEqual(await t.act('livestream', 'nope', 'removed'), { found: false, changed: false });
	});

	it('a warning marks it, deleting hides and deletes it, restoring shows it', async () => {
		const t = setup();
		await t.put();
		await t.act('livestream', 's1', 'warning');
		assert.deepEqual([(await t.stream()).hasWarning, (await t.stream()).status], [true, 'live']);
		await t.act('livestream', 's1', 'deleted');
		assert.deepEqual([(await t.stream()).isDeleted, (await t.stream()).isHidden], [true, true]);
		await t.act('livestream', 's1', 'restored');
		assert.deepEqual([(await t.stream()).isDeleted, (await t.stream()).isHidden], [false, false]);
	});

	for (const action of ['removed', 'banned', 'deleted']) {
		it(`${action}: a stream that only waits ends with its provisioned session, and can’t be set up or go on air`, async () => {
			const t = setup();
			const id = await t.session('provisioned');
			await t.put({ status: 'scheduled', sessionId: id });
			await t.act('livestream', 's1', action);
			assert.deepEqual([(await t.stream()).status, (await readSession(t.db as never, id))!.status], ['ended', 'ended']);
			for (const path of ['ingest', 'start']) {
				const r = await t.request('owner', path === 'ingest' ? 'GET' : 'POST', `s1/${path}`);
				assert.deepEqual([path, r.status, r.json.code], [path, 403, 'live_stream_removed']);
			}
			const live = await t.request('owner', 'PATCH', 's1', { status: 'live' });
			assert.deepEqual([live.status, live.json.code], [403, 'live_stream_removed']);
			await markStreamLive(t.env as never, 's1');
			assert.equal((await t.stream()).status, 'ended');
			// Shown again, it may be set up as before (the next gate answers)
			await t.act('livestream', 's1', 'restored');
			assert.notEqual((await t.request('owner', 'POST', 's1/start')).json.code, 'live_stream_removed');
		});
	}

	it('a session left open on a cancelled or ended stream is ended too', async () => {
		for (const status of ['cancelled', 'ended']) {
			const t = setup();
			const id = await t.session('provisioned');
			await t.put({ status, sessionId: id });
			await t.act('livestream', 's1', 'removed');
			assert.deepEqual([(await t.stream()).status, (await readSession(t.db as never, id))!.status], [status, 'ended']);
		}
	});

	it('a scheduled premiere is cancelled and its video freed', async () => {
		const t = setup();
		await t.env.videos.put('v1', JSON.stringify({ id: 'v1', userId: 'owner', channelId: 'ch1', isPublic: false, premiereHold: { streamId: 's1', heldAt: 'x', heldBy: 'owner' } }));
		await t.put({ kind: 'premiere', premiereVideoId: 'v1', status: 'scheduled' });
		await t.act('livestream', 's1', 'removed');
		assert.equal((await t.stream()).status, 'cancelled');
		assert.equal(((await (await t.raw.videos.get('v1'))!.json()) as Json).premiereHold, undefined);
	});
});

it('the admin lookup names reported streams and chat messages, by index', async () => {
	const t = setup();
	await t.put();
	t.chat('m1', { text: 'x'.repeat(400) });
	t.chat('m2', { status: 'removed' });
	t.db.trace = [];
	const { items } = await lookup(t.env as never, { items: [{ type: 'livestream', id: 's1' }, { type: 'live_chat', id: 'm1' }, { type: 'live_chat', id: 'm2' }, { type: 'live_chat', id: 'nope' }], users: [] });
	assert.deepEqual(items.map((i) => [i.found, i.title?.length ?? null, i.parentId, i.channelId, i.ownerId, i.isHidden]), [
		[true, 5, null, 'ch1', 'owner', false],
		[true, 400, 's1', 'ch1', 'ali', false],
		[true, 5, 's1', 'ch1', 'ali', true],
		[false, null, null, null, null, null],
	]);
	for (const q of t.db.trace.filter((x) => x.sql.includes('live_chat_messages'))) assert.ok(!/SCAN (m|s|live_)/.test(t.db.plan(q).join(' ; ')), t.db.plan(q).join(' ; '));
});

it('removed and held messages go after 30 days; published ones stay', async () => {
	const t = setup();
	const now = Date.now();
	const old = now - REMOVED_CHAT_DAYS * DAY - 1;
	for (let i = 0; i < 1300; i++) t.chat(`r${i}`, { status: i % 2 ? 'removed' : 'held', updated_at: old });
	t.chat('fresh', { status: 'removed', updated_at: now - DAY });
	t.chat('kept', { updated_at: old });
	t.db.trace = [];
	assert.equal(await purgeRemovedChat(t.db as never, now), 1300);
	assert.deepEqual(t.db.db.prepare('SELECT id FROM live_chat_messages ORDER BY id').all().map((r) => (r as Json).id), ['fresh', 'kept']);
	assert.ok(!/\bSCAN\b/.test(t.db.plan(t.db.trace[0]).join(' ; ')), t.db.plan(t.db.trace[0]).join(' ; '));
});
