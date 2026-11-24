/** Live chat (wiki E17 §5.2): who reads and posts, pace, paging, moderation, settings and the realtime close. */
import { beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { forgetFeatureSwitches, middlewareFeatureRoutes } from '@al-ummah/shared-types';
import { forgetCachedBan } from '../src/lib/admin/bans';
import { LiveChatList, LiveChatModerate, LiveChatPost, LiveChatSettingsUpdate } from '../src/endpoints/live/liveChat';
import { forgetChatTiers, latestPage, postMessage, readChatStream, readSnapshot, replayPage } from '../src/lib/live/chat';
import { saveTier } from '../src/lib/creatorTiers';
import { withSearchSync } from '../src/lib/search/sync';
import { requireFeature } from '../src/middleware/require-feature';
import { MemoryBucket, MemoryQueue, JobsQueue, buildApp } from './helpers';
import { SqliteD1 } from './search-sqlite-d1';
import { createSqliteD1 } from './sqlite-d1';

type Json = Record<string, any>;

const limiter = (limit: number) => {
	const counts = new Map<string, number>();
	return { counts, limit: async ({ key }: { key: string }) => { const n = (counts.get(key) ?? 0) + 1; counts.set(key, n); return { success: n <= limit }; } };
};

async function setup(over: Json = {}) {
	forgetChatTiers();
	const db = new SqliteD1();
	const ndb = createSqliteD1() as any;
	const pending: Promise<unknown>[] = [];
	const sent: Json[] = [];
	const raw: Json = {
		videos: new MemoryBucket(), channels: new MemoryBucket(), profiles: new MemoryBucket(), playlists: new MemoryBucket(), community_posts: new MemoryBucket(),
		SEARCH_DB: db, NOTIFICATIONS_DB: ndb, ADMIN_JOBS_QUEUE: new JobsQueue(), MODERATION_QUEUE: new MemoryQueue(), LIVE_CHAT_IP_LIMITER: limiter(120),
		WEBSOCKET_URL: 'https://realtime.test', INTERNAL_API_KEY: 'k',
	};
	globalThis.fetch = (async (url: string, init?: RequestInit) => {
		if (String(url).startsWith('https://realtime.test/broadcast')) { const b = JSON.parse(String(init?.body)); sent.push({ channel: b.channel, type: b.message.type, ...b.message.data }); return Response.json({ success: true }); }
		throw new Error(`unexpected fetch ${url}`);
	}) as never;
	const env = withSearchSync(raw, { waitUntil: (p: Promise<unknown>) => void pending.push(p) }) as Json;
	await raw.channels.put('ch1', JSON.stringify({ id: 'ch1', userId: 'owner', name: 'Channel', members: [{ userId: 'mod', role: 'moderator' }, { userId: 'editor', role: 'editor' }] }));
	for (const id of ['owner', 'mod', 'editor', 'ali', 'sara', 'blocked']) await raw.profiles.put(id, JSON.stringify({ id, userId: id, displayName: id.toUpperCase() }));
	// The owner's tier includes live, so chat
	await saveTier(db as never, 'creator', { live: true }, 'test');
	db.db.prepare("INSERT INTO creator_tier_assignments (user_id, tier_id, source, assigned_by, assigned_at) VALUES ('owner', 'creator', 'admin', 'test', '2026-11-01')").run();
	const put = (value: Json) => env.videos.put(`livestream:${value.id}`, JSON.stringify({ userId: 'owner', channelId: 'ch1', title: 'Halqa', status: 'live', isPrivate: false, dateCreated: '2026-11-20T10:00:00.000Z', actualStartTime: new Date(Date.now() - 60_000).toISOString(), ...value }));
	await put({ id: 's1', ...over });
	const as = (userId: string | null) =>
		buildApp((router) => {
			router.get('/api/live-streams/:id/chat', LiveChatList);
			router.post('/api/live-streams/:id/chat', LiveChatPost);
			router.post('/api/live-streams/:id/chat/:messageId/moderate', LiveChatModerate);
			router.patch('/api/live-streams/:id/chat/settings', LiveChatSettingsUpdate);
		}, userId ? { userId } : null);
	const call = async (userId: string | null, method: string, path: string, body?: unknown, headers: Json = {}) => {
		const res = await as(userId).request(`/api/live-streams/${path}`, { method, headers: { 'Content-Type': 'application/json', ...headers }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) }, env);
		const json = (await res.json()) as Json;
		while (pending.length) await pending.shift();
		await new Promise((r) => setTimeout(r, 0));
		return { status: res.status, json, headers: res.headers };
	};
	const post = (userId: string, text: string, stream = 's1') => call(userId, 'POST', `${stream}/chat`, { text });
	const read = async (userId: string | null, query = '', stream = 's1') => call(userId, 'GET', `${stream}/chat${query}`);
	const texts = (r: { json: Json }) => r.json.result.messages.map((m: Json) => m.text);
	/** Ages a person's messages so the pace lets them write again. */
	const age = () => db.db.exec('UPDATE live_chat_messages SET created_at = created_at - 100000');
	return { db, ndb, raw, env, put, call, post, read, texts, sent, age };
}

describe('posting', () => {
	it('stores, announces and scans a message', async () => {
		const t = await setup();
		const r = await t.post('ali', ' السلام عليكم​ ');
		assert.equal(r.status, 201, JSON.stringify(r.json));
		assert.equal(r.json.result.message.text, 'السلام عليكم');
		assert.equal(r.json.result.message.authorName, 'ALI');
		assert.ok(r.json.result.message.offsetMs >= 59_000);
		assert.deepEqual(t.texts(await t.read(null)), ['السلام عليكم']);
		const event = t.sent.find((e) => e.type === 'live_chat_message')!;
		assert.equal(event.channel, 'live:s1');
		assert.equal(event.message.id, r.json.result.message.id);
		const scan = t.raw.MODERATION_QUEUE.messages[0].payload;
		assert.deepEqual([scan.surface, scan.subjectId, scan.parentId, scan.event], ['live_chat', r.json.result.message.id, 's1', 'create']);
	});

	it('refuses text the filter refuses; links only from the team', async () => {
		const t = await setup();
		assert.equal((await t.post('ali', '  ')).json.code, 'live_chat_empty');
		assert.equal((await t.post('ali', 'a'.repeat(501))).json.code, 'live_chat_too_long');
		assert.equal((await t.post('ali', 'join scam.com')).json.code, 'live_chat_link');
		assert.equal((await t.post('ali', 'قحبة')).json.code, 'live_chat_blocked_word');
		assert.equal((await t.post('mod', 'notes: example.com/notes')).status, 201);
		assert.equal((await t.post('owner', 'notes: example.com/notes')).json.result.message.authorRole, 'owner');
		assert.equal(t.db.count('live_chat_messages'), 2);
	});

	it('keeps the pace: two seconds, or slow mode; the same text once in 30 seconds', async () => {
		const t = await setup();
		const stream = (await readChatStream(t.db as never, 's1'))!;
		const base = { userId: 'ali', authorChannelId: null, authorName: 'Ali', authorHandle: null, authorAvatar: null, authorRole: null, held: false };
		const at = Date.now();
		// Parallel posts: one passes
		const many = await Promise.all(Array.from({ length: 8 }, (_, i) => postMessage(t.db as never, stream, { ...base, text: `m${i}` }, at)));
		assert.equal(many.filter((r) => r.ok).length, 1);
		const early = await postMessage(t.db as never, stream, { ...base, text: 'x' }, at + 1500);
		assert.deepEqual([early.ok, (early as Json).code, (early as Json).retryAfter], [false, 'live_chat_slow_mode', 1]);
		assert.equal((await postMessage(t.db as never, stream, { ...base, text: 'm0' }, at + 3000) as Json).code, 'live_chat_duplicate');
		assert.equal((await postMessage(t.db as never, stream, { ...base, text: 'new' }, at + 3000)).ok, true);
		const slow = { ...stream, settings: { ...stream.settings, slowModeSeconds: 30 as const } };
		assert.deepEqual([(await postMessage(t.db as never, slow, { ...base, text: 'y' }, at + 20_000) as Json).retryAfter], [13]);
		assert.equal((await postMessage(t.db as never, slow, { ...base, authorRole: 'moderator', text: 'z' }, at + 4100)).ok, true, 'the team keeps a one second pace');
	});

	it('one address may carry many people, not an endless number of messages', async () => {
		const t = await setup();
		t.raw.LIVE_CHAT_IP_LIMITER = limiter(3);
		(t.env as Json).LIVE_CHAT_IP_LIMITER = t.raw.LIVE_CHAT_IP_LIMITER;
		const from = (user: string, text: string) => t.call(user, 'POST', 's1/chat', { text }, { 'CF-Connecting-IP': '203.0.113.9' });
		for (const user of ['ali', 'sara', 'editor']) assert.equal((await from(user, `hello ${user}`)).status, 201);
		const fourth = await from('blocked', 'hello');
		assert.deepEqual([fourth.status, fourth.json.code], [429, 'rate_limited']);
		assert.deepEqual([...t.raw.LIVE_CHAT_IP_LIMITER.counts.keys()], ['live-chat:203.0.113.9']);
	});

	it('is closed unless the stream is on air, or starts within half an hour; and by each setting', async () => {
		for (const [over, status] of [
			[{ status: 'ended' }, 404],
			[{ status: 'cancelled' }, 404],
			[{ status: 'scheduled', actualStartTime: undefined, scheduledStartTime: new Date(Date.now() + 31 * 60_000).toISOString() }, 404],
			[{ status: 'scheduled', actualStartTime: undefined, scheduledStartTime: new Date(Date.now() + 29 * 60_000).toISOString() }, 201],
			[{ allowChat: false }, 404],
			[{ madeForKids: true }, 404],
			[{ isPrivate: true }, 404],
			[{ isHidden: true }, 404],
		] as const) {
			const t = await setup(over as Json);
			assert.equal((await t.post('ali', 'hello')).status, status, JSON.stringify(over));
		}
		const t = await setup();
		assert.equal((await t.post('ali', 'hello', 'nope')).status, 404);
	});

	it('answers feature_off when the owner’s tier has no chat', async () => {
		const t = await setup();
		await saveTier(t.db as never, 'creator', { liveChat: false }, 'test');
		forgetChatTiers();
		assert.deepEqual([(await t.post('ali', 'hello')).json.code], ['feature_off']);
	});

	it('subscribers only: subscribers and the team', async () => {
		const t = await setup({ subscribersOnly: true });
		assert.equal((await t.post('ali', 'hello')).json.code, 'live_chat_subscribers_only');
		await t.ndb.prepare('INSERT INTO channel_subscriptions (channel_id, subscriber_channel_id, user_id, id, created_at) VALUES (?, ?, ?, ?, ?)').bind('ch1', 'user:ali', 'ali', 'x', 1).run();
		assert.equal((await t.post('ali', 'hello')).status, 201);
		assert.equal((await t.post('mod', 'hello')).status, 201);
	});

	it('a blocked person’s messages reach only them', async () => {
		const t = await setup();
		t.db.db.prepare("INSERT INTO channel_blocks (channel_id, user_id, blocked_by, created_at) VALUES ('ch1', 'blocked', 'owner', '2026')").run();
		const r = await t.post('blocked', 'quiet');
		assert.equal(r.status, 201);
		assert.ok(!('status' in r.json.result.message), 'nothing tells them');
		assert.deepEqual(t.sent, []);
		assert.equal(t.raw.MODERATION_QUEUE.messages.length, 0);
		await t.post('ali', 'hello');
		assert.deepEqual(t.texts(await t.read('sara')), ['hello']);
		assert.deepEqual(t.texts(await t.read(null)), ['hello']);
		assert.deepEqual(t.texts(await t.read('blocked')).sort(), ['hello', 'quiet']);
	});
});

describe('reading', () => {
	it('a private stream is its team’s; chat off or made for kids is nobody’s', async () => {
		const t = await setup({ isPrivate: true });
		await t.post('owner', 'hello');
		for (const user of [null, 'ali', 'editor']) assert.equal((await t.read(user)).status, 404, String(user));
		for (const user of ['owner', 'mod']) assert.deepEqual(t.texts(await t.read(user)), ['hello'], user);
		await t.put({ id: 's1', madeForKids: true });
		for (const user of [null, 'owner']) assert.equal((await t.read(user)).status, 404);
		await t.put({ id: 's1', allowChat: false });
		assert.equal((await t.read('owner')).status, 404);
	});

	it('is never kept by a browser', async () => {
		const t = await setup();
		assert.equal((await t.read(null)).headers.get('cache-control'), 'private, no-store');
	});

	it('pages by message, also inside one millisecond; a deleted anchor starts over', async () => {
		const t = await setup();
		const add = t.db.db.prepare("INSERT INTO live_chat_messages (id, stream_id, user_id, author_name, text, created_at, updated_at) VALUES (?, 's1', 'u', 'U', ?, ?, ?)");
		// 250 messages, ten to a millisecond
		for (let i = 0; i < 250; i++) add.run(`m${String(i).padStart(3, '0')}`, `t${i}`, 1000 + Math.floor(i / 10), 1);
		const latest = await t.read(null, '?limit=100');
		assert.deepEqual([latest.json.result.messages[0].id, latest.json.result.messages.at(-1).id, latest.json.result.hasMore], ['m150', 'm249', true]);
		const seen: string[] = [];
		let before = latest.json.result.messages[0].id;
		for (;;) {
			const page = (await t.read(null, `?before=${before}&limit=40`)).json.result;
			seen.unshift(...page.messages.map((m: Json) => m.id));
			if (!page.hasMore) break;
			before = page.messages[0].id;
		}
		assert.deepEqual(seen, Array.from({ length: 150 }, (_, i) => `m${String(i).padStart(3, '0')}`));
		// After a message inside the cached page, and after one older than it
		assert.deepEqual((await t.read(null, '?afterId=m247')).json.result.messages.map((m: Json) => m.id), ['m248', 'm249']);
		const older = (await t.read(null, '?afterId=m004&limit=8')).json.result;
		assert.deepEqual([older.messages[0].id, older.messages.length, older.hasMore, older.resync], ['m005', 8, true, false]);
		const gone = (await t.read(null, '?afterId=nope&limit=2')).json.result;
		assert.deepEqual([gone.resync, gone.messages.map((m: Json) => m.id)], [true, ['m248', 'm249']]);
		assert.deepEqual((await t.read(null, '?afterId=m249')).json.result.messages, []);
	});

	it('a held recording closes the chat to everyone but the team (VR9)', async () => {
		const t = await setup({ status: 'ended' });
		t.db.db.prepare("INSERT INTO live_chat_messages (id, stream_id, user_id, author_name, text, created_at, updated_at) VALUES ('m1', 's1', 'u', 'U', 't', 1, 1)").run();
		assert.equal((await t.read('ali', '?fromMs=0')).status, 200);
		t.sent.length = 0;
		await t.put({ id: 's1', status: 'ended', sessionId: 'x', review: { status: 'in_review' } });
		await new Promise((r) => setTimeout(r, 5));
		assert.deepEqual(t.sent.map((e) => e.type), ['live_chat_closed']);
		for (const query of ['', '?fromMs=0', '?before=m1']) {
			assert.equal((await t.read('ali', query)).status, 404, query);
			assert.equal((await t.read('mod', query)).status, 200, query);
		}
	});

	it('a banned member reads like a visitor: not a private stream', async () => {
		const t = await setup({ isPrivate: true });
		assert.equal((await t.read('mod')).status, 200);
		t.db.db.prepare("INSERT INTO videos_bans (user_id, reason, banned_by, banned_at) VALUES ('mod', NULL, 'a', '2026')").run();
		forgetCachedBan('mod');
		assert.equal((await t.read('mod')).status, 404);
		forgetCachedBan('mod');
	});

	it('a removed message as the cursor starts over', async () => {
		const t = await setup();
		const id = (await t.post('ali', 'one')).json.result.message.id;
		await t.call('mod', 'POST', `s1/chat/${id}/moderate`, { action: 'remove' });
		assert.equal((await t.read(null, `?afterId=${id}`)).json.result.resync, true);
		assert.equal((await t.read(null, `?before=${id}`)).json.result.resync, true);
	});

	it('a removed message is gone from every page', async () => {
		const t = await setup();
		const id = (await t.post('ali', 'one')).json.result.message.id;
		await t.call('mod', 'POST', `s1/chat/${id}/moderate`, { action: 'remove' });
		assert.deepEqual(t.texts(await t.read(null)), []);
		assert.deepEqual(t.texts(await t.read('ali')), []);
	});

	it('replays an ended stream by time, when replay is on', async () => {
		const t = await setup({ status: 'ended' });
		const add = t.db.db.prepare("INSERT INTO live_chat_messages (id, stream_id, user_id, author_name, text, offset_ms, created_at, updated_at) VALUES (?, 's1', 'u', 'U', 't', ?, 1, 1)");
		for (let i = 0; i < 300; i++) add.run(`m${String(i).padStart(3, '0')}`, i * 100);
		const page = (await t.read(null, '?fromMs=1000&toMs=2000')).json.result;
		assert.deepEqual([page.messages[0].id, page.messages.at(-1).id, page.truncated], ['m010', 'm019', false]);
		const wide = await replayPage(t.db as never, 's1', 0, 10 * 60_000);
		assert.deepEqual([wide.messages.length, wide.truncated], [200, true]);
		await t.put({ id: 's1', status: 'ended', chatReplay: false });
		assert.equal((await t.read(null, '?fromMs=0')).status, 404);
		await t.put({ id: 's1', status: 'live' });
		assert.equal((await t.read(null, '?fromMs=0')).status, 404);
	});

	it('the cached page is never shared while the stream is not open to anyone', async () => {
		const t = await setup();
		const store = new Map<string, Response>();
		(globalThis as any).caches = { default: { match: async (u: string) => store.get(u)?.clone(), put: async (u: string, r: Response) => void store.set(u, r), delete: async (u: string) => store.delete(u) } };
		try {
			await t.post('ali', 'one');
			await t.read(null);
			assert.equal(store.size, 1);
			// Any write that closes the stream drops the page, wherever it came from
			t.env.VIDEOS_API_URL = t.raw.VIDEOS_API_URL = 'http://localhost';
			await t.read(null);
			await t.put({ id: 's1', isHidden: true });
			assert.equal(store.size, 0);
			await t.put({ id: 's1' });
			await t.read(null);
			assert.match([...store.keys()][0], /\/__edge-cache\/live-chat\/s1\/latest$/);
			await t.put({ id: 's1', isPrivate: true });
			store.clear();
			assert.equal((await t.read('owner')).status, 200);
			assert.equal(store.size, 0, 'a page read by the team is not cached');
			assert.equal((await t.read(null)).status, 404);
		} finally {
			delete (globalThis as any).caches;
		}
	});
});

describe('moderation', () => {
	it('the team moderates; an author removes their own; others may not', async () => {
		const t = await setup();
		const id = (await t.post('ali', 'one')).json.result.message.id;
		const act = (user: string, action: string, message = id) => t.call(user, 'POST', `s1/chat/${message}/moderate`, { action });
		for (const user of ['sara', 'editor']) assert.equal((await act(user, 'remove')).status, 403, user);
		assert.equal((await act('ali', 'pin')).status, 403);
		assert.equal((await act('mod', 'pin')).status, 200);
		assert.equal((await t.read(null)).json.result.pinned.id, id);
		t.age();
		const second = (await t.post('ali', 'two')).json.result.message.id;
		await act('owner', 'pin', second);
		assert.equal(t.db.db.prepare('SELECT COUNT(*) AS n FROM live_chat_messages WHERE is_pinned = 1').get()!.n, 1);
		// A pin that fails leaves the one there
		t.db.db.prepare("UPDATE live_chat_messages SET status = 'held' WHERE id = ?").run(id);
		assert.equal((await act('mod', 'pin')).status, 409);
		assert.equal((await t.read(null)).json.result.pinned.id, second);
		t.db.db.prepare("UPDATE live_chat_messages SET status = 'published' WHERE id = ?").run(id);
		assert.equal((await act('mod', 'remove', second)).status, 200);
		assert.equal((await t.read(null)).json.result.pinned, null);
		assert.equal((await act('mod', 'remove', second)).status, 409);
		assert.equal((await act('mod', 'restore', second)).status, 200);
		assert.equal((await act('ali', 'remove', second)).status, 200);
		assert.equal((await act('mod', 'restore', second)).status, 409, 'what its author removed stays removed');
		assert.equal((await act('mod', 'remove', 'nope')).status, 404);
		assert.deepEqual(t.sent.filter((e) => e.type !== 'live_chat_message').map((e) => e.type), ['live_chat_pinned', 'live_chat_pinned', 'live_chat_removed', 'live_chat_removed']);
	});

	it('blocking removes what the person wrote here and silences them; the team cannot be blocked', async () => {
		const t = await setup();
		const first = (await t.post('sara', 'one')).json.result.message.id;
		t.age();
		await t.post('sara', 'two');
		const modMessage = (await t.post('mod', 'team')).json.result.message.id;
		assert.equal((await t.call('owner', 'POST', `s1/chat/${modMessage}/moderate`, { action: 'block_author' })).json.code, 'live_chat_cannot_block');
		assert.equal((await t.call('mod', 'POST', `s1/chat/${first}/moderate`, { action: 'block_author' })).status, 200);
		assert.deepEqual(t.texts(await t.read('ali')), ['team']);
		t.age();
		await t.post('sara', 'three');
		assert.deepEqual(t.texts(await t.read('ali')), ['team']);
	});

	it('settings: saved on the record, announced; turning chat off closes the channel', async () => {
		const t = await setup();
		for (const user of ['ali', 'editor']) assert.equal((await t.call(user, 'PATCH', 's1/chat/settings', { slowModeSeconds: 10 })).status, 403, user);
		assert.equal((await t.call('mod', 'PATCH', 's1/chat/settings', { slowModeSeconds: 7 })).status, 400);
		const saved = await t.call('mod', 'PATCH', 's1/chat/settings', { slowModeSeconds: 10, subscribersOnly: true });
		assert.deepEqual(saved.json.result.settings, { allowChat: true, chatReplay: true, slowModeSeconds: 10, subscribersOnly: true });
		assert.equal(t.db.db.prepare('SELECT slow_mode_seconds FROM live_stream_metadata').get()!.slow_mode_seconds, 10);
		assert.deepEqual(t.sent.map((e) => e.type), ['live_chat_settings']);
		await t.call('owner', 'PATCH', 's1/chat/settings', { allowChat: false });
		assert.deepEqual(t.sent.slice(1).map((e) => e.type).sort(), ['live_chat_closed', 'live_chat_settings']);
	});

	it('a ban, or a role taken away, reaches the person’s open sockets', async () => {
		const t = await setup();
		const { banUser } = await import('../src/lib/admin/service');
		await banUser(t.env as never, 'ali', 'usr_admin');
		assert.deepEqual(t.sent.map((e) => [e.channel, e.type]), [['user:ali', 'access_changed']]);
		const team = (members: Json[]) => t.env.channels.put('ch1', JSON.stringify({ id: 'ch1', userId: 'owner', name: 'Channel', members }));
		await team([{ userId: 'mod', role: 'moderator' }, { userId: 'editor', role: 'editor' }]);
		t.sent.length = 0;
		await team([{ userId: 'mod', role: 'editor' }]);
		await new Promise((r) => setTimeout(r, 5));
		assert.deepEqual(t.sent.map((e) => e.channel).sort(), ['user:editor', 'user:mod']);
		t.sent.length = 0;
		await team([{ userId: 'mod', role: 'editor' }, { userId: 'new', role: 'admin' }]);
		await new Promise((r) => setTimeout(r, 5));
		assert.deepEqual(t.sent, []);
	});

	it('any write that closes the stream closes its channel', async () => {
		const t = await setup();
		for (const over of [{ isPrivate: true }, { isHidden: true }, { status: 'cancelled' }]) {
			t.sent.length = 0;
			await t.put({ id: 's1', ...over });
			await new Promise((r) => setTimeout(r, 5));
			assert.deepEqual(t.sent.map((e) => [e.channel, e.type]), [['live:s1', 'live_chat_closed']], JSON.stringify(over));
		}
		t.sent.length = 0;
		await t.env.videos.delete('livestream:s1');
		await new Promise((r) => setTimeout(r, 5));
		assert.deepEqual(t.sent.map((e) => e.type), ['live_chat_closed']);
	});
});

describe('switch and query plans', () => {
	beforeEach(() => forgetFeatureSwitches());

	it('is 404 feature_off while the switch is off (its default)', async () => {
		const t = await setup();
		const app = buildApp((router) => {
			router.use('*', requireFeature('liveChat'));
			router.get('/api/live-streams/:id/chat', LiveChatList);
		}, null);
		const res = await app.request('/api/live-streams/s1/chat', {}, t.env);
		assert.deepEqual([res.status, ((await res.json()) as Json).code], [404, 'feature_off']);
	});

	it('is refused while the switches cannot be read, cached page or not', async () => {
		const t = await setup();
		const broken = { ...t.env, SEARCH_DB: { prepare: () => { throw new Error('D1 down'); } } };
		const routes = middlewareFeatureRoutes('api-videos').filter((r) => r.key === 'liveChat');
		assert.equal(routes.length, 4);
		const app = buildApp((router) => {
			for (const r of routes) router.on(r.method, r.path, requireFeature(r.key, { failClosed: r.failClosed }));
			router.get('/api/live-streams/:id/chat', LiveChatList);
		}, null);
		(globalThis as any).caches = { default: { match: async () => Response.json({ stream: { gate: { visibility: 'public', status: 'live', madeForKids: false, recordingWithheld: false, allowChat: true, chatReplay: true } }, messages: [], pinned: null }) } };
		try {
			forgetFeatureSwitches();
			for (const r of routes) {
				const res = await app.request(r.path.replace(':id', 's1').replace(':messageId', 'm1'), { method: r.method }, broken);
				assert.equal(((await res.json()) as Json).code, 'feature_off', `${r.method} ${r.path}`);
			}
		} finally {
			delete (globalThis as any).caches;
		}
	});

	it('every statement uses an index', async () => {
		const t = await setup();
		const id = (await t.post('ali', 'one')).json.result.message.id;
		t.db.db.prepare("INSERT INTO channel_blocks (channel_id, user_id, blocked_by, created_at) VALUES ('ch1', 'blocked', 'owner', '2026')").run();
		t.db.trace = [];
		await t.post('ali', 'too soon');
		await t.read('blocked');
		await t.read(null, `?before=${id}`);
		await replayPage(t.db as never, 's1', 0, 1000);
		const stream = (await readChatStream(t.db as never, 's1'))!;
		await latestPage(t.db as never, { ...(await readSnapshot(t.db as never, stream)), messages: [] }, id, 10);
		for (const action of ['pin', 'unpin', 'remove', 'restore', 'block_author']) await t.call('owner', 'POST', `s1/chat/${id}/moderate`, { action });
		const live = t.db.trace.filter((q) => /live_(chat_messages|stream_metadata)/.test(q.sql));
		assert.ok(live.length > 12);
		for (const query of live) {
			const plan = t.db.plan(query).filter((d) => !/CONSTANT ROW/.test(d)).join(' ; ');
			assert.ok(!/\bSCAN\b/.test(plan), `${query.sql}\n${plan}`);
		}
	});
});
