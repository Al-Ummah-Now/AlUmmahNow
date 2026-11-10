/**
 * New uploads → playlists (owner, 2026-11-10): adds are requested once the
 * video record exists, queued per video→playlist with retry/backoff and an
 * admin Retry, idempotent, in upload order, and only for the channel's
 * playlist managers.
 */
import { afterEach, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
	addVideoInOrder,
	handlePlaylistAddBatch,
	insertionIndex,
	isPlaylistAddMessage,
	needsActionKey,
	orderKeyFor,
	PLAYLIST_ADD_KIND,
	PLAYLIST_ADD_MAX_DELIVERIES,
	playlistAddRetryDelaySeconds,
	readPlaylistAddStatus,
	recordKey,
	requestPlaylistAdds,
	retryPlaylistAdd,
	runPlaylistAdd,
	type PlaylistAddMessage,
	type PlaylistAddRecord,
} from '../src/lib/playlistUploadAdds';
import { memberMayActAs } from '../src/lib/channelAccess';
import { toPlaylistResponse } from '../src/lib/playlists';
import { PlaylistUploadAddsCreate, PlaylistUploadAddsStatus } from '../src/endpoints/playlist/playlistUploadAdds';
import { PlaylistCreate } from '../src/endpoints/playlist/playlistCreate';
import { PlaylistsList } from '../src/endpoints/playlist/playlistsList';
import { PlaylistAddVideo } from '../src/endpoints/playlist/playlistAddVideo';
import { createPlaylistAddsInternalRouter } from '../src/endpoints/playlist/playlistAddsInternal';
import { MemoryBucket, MemoryQueue, buildApp, videoFixture } from './helpers';

const realFetch = globalThis.fetch;

class DelayQueue {
	sent: { body: any; delaySeconds?: number }[] = [];
	fail = false;
	async send(body: unknown, opts?: { delaySeconds?: number }) {
		if (this.fail) throw new Error('queue down');
		this.sent.push({ body, delaySeconds: opts?.delaySeconds });
	}
}

function member(userId: string, role: string) {
	return { userId, role, addedBy: 'owner', addedAt: '2026-11-01T00:00:00.000Z' };
}

function playlist(id: string, overrides: Record<string, unknown> = {}) {
	return {
		id, title: `Playlist ${id}`, userId: 'owner', channelId: 'ch', videos: [], isPublic: true,
		dateCreated: '2026-11-01T00:00:00.000Z', dateModified: '2026-11-01T00:00:00.000Z',
		...overrides,
	};
}

function makeEnv() {
	return {
		videos: new MemoryBucket({
			v1: videoFixture({ id: 'v1', userId: 'owner', channelId: 'ch' }),
			v2: videoFixture({ id: 'v2', userId: 'owner', channelId: 'ch' }),
			v3: videoFixture({ id: 'v3', userId: 'owner', channelId: 'ch' }),
			other: videoFixture({ id: 'other', userId: 'x', channelId: 'xch' }),
		}),
		channels: new MemoryBucket({
			ch: { id: 'ch', userId: 'owner', members: [member('sara', 'editor'), member('mod', 'moderator'), member('ali', 'admin')] },
			xch: { id: 'xch', userId: 'x' },
		}),
		playlists: new MemoryBucket({
			p1: playlist('p1'),
			p2: playlist('p2', { isPublic: false }),
			foreign: playlist('foreign', { userId: 'x', channelId: 'xch' }),
			gone: playlist('gone', { isDeleted: true }),
		}),
		global_settings: new MemoryBucket(),
		PROCESSING_CHECK_QUEUE: new DelayQueue(),
		queue: new MemoryQueue(),
		ERRORS_INGEST_URL: 'https://admin.api.test/internal/errors',
		INTERNAL_API_KEY: 'k',
	};
}

type Env = ReturnType<typeof makeEnv>;

/** Records the reports posted to the admin Errors page. */
function captureReports() {
	const posts: any[] = [];
	globalThis.fetch = (async (_url: RequestInfo | URL, init?: RequestInit) => {
		posts.push(JSON.parse(String(init?.body)));
		return new Response(null, { status: 202 });
	}) as typeof fetch;
	return posts;
}

const pendingWork: Promise<unknown>[] = [];
const ctx = { waitUntil: (p: Promise<unknown>) => void pendingWork.push(p) };
const flush = () => Promise.all(pendingWork.splice(0));

function queueMessage(body: unknown, attempts = 1) {
	const m = { body, attempts, acked: false, retried: undefined as undefined | { delaySeconds?: number } };
	return Object.assign(m, {
		ack() { m.acked = true; },
		retry(opts?: { delaySeconds?: number }) { m.retried = opts ?? {}; },
	});
}

async function request(env: Env, videoId: string, playlistIds: string[], userId = 'owner', index = 0) {
	return requestPlaylistAdds(env as never, { videoId, channelId: 'ch', userId, playlistIds, orderKey: orderKeyFor('batch1', index) }, ctx);
}

async function drain(env: Env) {
	const sent = env.PROCESSING_CHECK_QUEUE.sent.splice(0);
	for (const s of sent) await handlePlaylistAddBatch({ messages: [queueMessage(s.body)] }, env as never, ctx);
}

describe('upload order', () => {
	it('places a batch video after its earlier batch-mates and before its later ones', () => {
		const order = { a: orderKeyFor('b', 0), c: orderKeyFor('b', 2), x: orderKeyFor('other', 1) };
		assert.equal(insertionIndex(['old', 'a', 'c', 'x'], order, orderKeyFor('b', 1)), 2);
		assert.equal(insertionIndex(['old', 'a', 'c'], order, orderKeyFor('b', 3)), 3);
		assert.equal(insertionIndex(['old', 'c'], order, orderKeyFor('b', 0)), 1);
		// Another batch, or no batch-mate yet: at the end
		assert.equal(insertionIndex(['old', 'a', 'c'], order, orderKeyFor('new', 0)), 3);
	});

	it('keeps upload order when the adds arrive out of order', async () => {
		const env = makeEnv();
		await env.playlists.put('p1', JSON.stringify(playlist('p1', { videos: ['old'] })));
		for (const [videoId, index] of [['v3', 2], ['v1', 0], ['v2', 1]] as const) {
			assert.equal(await addVideoInOrder(env as never, 'p1', videoId, orderKeyFor('b', index), () => true), 'added');
		}
		assert.deepEqual(env.playlists.read('p1').videos, ['old', 'v1', 'v2', 'v3']);
		// The order map is internal: never in API answers
		assert.equal('uploadOrder' in toPlaylistResponse(env.playlists.read('p1')), false);
	});

	it('is idempotent: a video already in the playlist stays where it is', async () => {
		const env = makeEnv();
		await env.playlists.put('p1', JSON.stringify(playlist('p1', { videos: ['v1', 'old'] })));
		assert.equal(await addVideoInOrder(env as never, 'p1', 'v1', orderKeyFor('b', 5), () => true), 'already');
		assert.deepEqual(env.playlists.read('p1').videos, ['v1', 'old']);
	});
});

describe('requestPlaylistAdds', () => {
	it('queues one add per playlist for the owner, with a pending record', async () => {
		const env = makeEnv();
		const result = await request(env, 'v1', ['p1', 'p2', 'p1']);
		assert.deepEqual(result, { ok: true, items: [{ playlistId: 'p1', status: 'pending' }, { playlistId: 'p2', status: 'pending' }] });
		assert.equal(env.PROCESSING_CHECK_QUEUE.sent.length, 2);
		const msg = env.PROCESSING_CHECK_QUEUE.sent[0].body as PlaylistAddMessage;
		assert.equal(msg.kind, PLAYLIST_ADD_KIND);
		assert.equal(isPlaylistAddMessage(msg), true);
		const record = env.global_settings.read<PlaylistAddRecord>(recordKey('v1', 'p1'))!;
		assert.equal(record.status, 'pending');
		assert.equal(record.loopId, msg.loopId);
		assert.equal(record.requestedBy, 'owner');
	});

	it('lets channel roles that manage playlists add (editor, admin), never a moderator', async () => {
		const env = makeEnv();
		assert.deepEqual((await request(env, 'v1', ['p1'], 'sara')), { ok: true, items: [{ playlistId: 'p1', status: 'pending' }] });
		assert.deepEqual((await request(env, 'v2', ['p1'], 'ali')), { ok: true, items: [{ playlistId: 'p1', status: 'pending' }] });
		assert.deepEqual((await request(env, 'v3', ['p1'], 'mod')), { ok: true, items: [{ playlistId: 'p1', status: 'failed', refusal: 'forbidden' }] });
		assert.equal(env.PROCESSING_CHECK_QUEUE.sent.length, 2);
	});

	it("refuses another channel's playlist and a deleted one, queues the rest", async () => {
		const env = makeEnv();
		const result = await request(env, 'v1', ['foreign', 'gone', 'missing', 'p1']);
		assert.deepEqual(result, { ok: true, items: [
			{ playlistId: 'foreign', status: 'failed', refusal: 'other_channel' },
			{ playlistId: 'gone', status: 'failed', refusal: 'playlist_not_found' },
			{ playlistId: 'missing', status: 'failed', refusal: 'playlist_not_found' },
			{ playlistId: 'p1', status: 'pending' },
		] });
		assert.equal(env.PROCESSING_CHECK_QUEUE.sent.length, 1);
	});

	it('refuses a video of another channel and bad input', async () => {
		const env = makeEnv();
		assert.deepEqual(await request(env, 'other', ['p1']), { ok: false, status: 403, error: 'The video belongs to another channel' });
		assert.equal((await request(env, 'nope', ['p1'])).ok, false);
		assert.equal((await request(env, 'v1', [])).ok, false);
		assert.equal((await requestPlaylistAdds(env as never, { videoId: 'v1', channelId: 'ch', userId: 'owner', playlistIds: ['p1'], orderKey: 'bad key!' })).ok, false);
	});

	it('answers "added" without queuing when the video is already in the playlist (a retried request)', async () => {
		const env = makeEnv();
		await request(env, 'v1', ['p1']);
		await drain(env);
		assert.deepEqual(await request(env, 'v1', ['p1']), { ok: true, items: [{ playlistId: 'p1', status: 'added' }] });
		assert.equal(env.PROCESSING_CHECK_QUEUE.sent.length, 0);
		assert.deepEqual(env.playlists.read('p1').videos, ['v1']);
	});

	it('flags the add for an admin when the queue cannot take it (the request still answers)', async () => {
		const posts = captureReports();
		try {
			const env = makeEnv();
			env.PROCESSING_CHECK_QUEUE.fail = true;
			const result = await request(env, 'v1', ['p1']);
			assert.equal(result.ok, true);
			await flush();
			assert.equal(env.global_settings.read<PlaylistAddRecord>(recordKey('v1', 'p1'))!.status, 'failed');
			const action = posts[0].events[0].action;
			assert.equal(action.key, needsActionKey('v1', 'p1'));
			assert.deepEqual(action.retry, { kind: 'service', service: 'api-videos', path: '/internal/playlist-adds/retry', body: { videoId: 'v1', playlistId: 'p1' } });
		} finally {
			globalThis.fetch = realFetch;
		}
	});
});

describe('queue consumer', () => {
	let posts: any[];
	beforeEach(() => { posts = captureReports(); });
	afterEach(() => { globalThis.fetch = realFetch; });

	it('adds the video in upload order and marks the record added', async () => {
		const env = makeEnv();
		await request(env, 'v2', ['p1'], 'owner', 1);
		await request(env, 'v1', ['p1'], 'owner', 0);
		await request(env, 'v3', ['p1'], 'sara', 2);
		await drain(env);
		assert.deepEqual(env.playlists.read('p1').videos, ['v1', 'v2', 'v3']);
		assert.equal(env.global_settings.read<PlaylistAddRecord>(recordKey('v3', 'p1'))!.status, 'added');
	});

	it('drops a message of a superseded loop and a duplicate delivery', async () => {
		const env = makeEnv();
		await request(env, 'v1', ['p1']);
		const first = env.PROCESSING_CHECK_QUEUE.sent[0].body as PlaylistAddMessage;
		await request(env, 'v1', ['p1']);
		assert.equal(await runPlaylistAdd(env as never, first), 'superseded');
		await drain(env);
		assert.equal(await runPlaylistAdd(env as never, env.global_settings.read<PlaylistAddRecord>(recordKey('v1', 'p1')) as never), 'already');
		assert.deepEqual(env.playlists.read('p1').videos, ['v1']);
	});

	it('gives up without retrying when the playlist was deleted or the role was taken away', async () => {
		const env = makeEnv();
		await request(env, 'v1', ['p1']);
		await request(env, 'v2', ['p2'], 'sara');
		const p1 = env.playlists.read('p1');
		await env.playlists.put('p1', JSON.stringify({ ...p1, isDeleted: true }));
		await env.channels.put('ch', JSON.stringify({ id: 'ch', userId: 'owner', members: [member('sara', 'moderator')] }));
		const messages = env.PROCESSING_CHECK_QUEUE.sent.splice(0).map((s) => queueMessage(s.body));
		await handlePlaylistAddBatch({ messages }, env as never, ctx);
		assert.ok(messages.every((m) => m.acked && !m.retried));
		assert.equal(env.global_settings.read<PlaylistAddRecord>(recordKey('v1', 'p1'))!.refusal, 'playlist_not_found');
		assert.equal(env.global_settings.read<PlaylistAddRecord>(recordKey('v2', 'p2'))!.refusal, 'forbidden');
		assert.deepEqual(env.playlists.read('p2').videos, []);
		await flush();
		assert.equal(posts.length, 0);
	});

	it('retries a failure with backoff, then flags it for an admin and lets the queue dead-letter it', async () => {
		const env = makeEnv();
		await request(env, 'v1', ['p1']);
		const body = env.PROCESSING_CHECK_QUEUE.sent[0].body;
		const realGet = env.playlists.get.bind(env.playlists);
		env.playlists.get = async () => { throw new Error('R2 unavailable'); };

		const early = queueMessage(body, 2);
		await handlePlaylistAddBatch({ messages: [early] }, env as never, ctx);
		assert.deepEqual(early.retried, { delaySeconds: playlistAddRetryDelaySeconds(2) });
		assert.equal(playlistAddRetryDelaySeconds(2), 120);
		const retrying = env.global_settings.read<PlaylistAddRecord>(recordKey('v1', 'p1'))!;
		assert.equal(retrying.status, 'retrying');
		assert.equal(retrying.attempts, 2);
		await flush();
		assert.equal(posts.length, 0);

		const last = queueMessage(body, PLAYLIST_ADD_MAX_DELIVERIES);
		await handlePlaylistAddBatch({ messages: [last] }, env as never, ctx);
		assert.ok(last.retried && !last.acked, 'the queue dead-letters the last delivery');
		assert.equal(env.global_settings.read<PlaylistAddRecord>(recordKey('v1', 'p1'))!.status, 'failed');
		await flush();
		assert.equal(posts.length, 1);
		const action = posts[0].events[0].action;
		assert.equal(action.source, 'queue');
		assert.equal(action.retry.path, '/internal/playlist-adds/retry');

		// The admin's Retry starts a new loop; once it works, the Errors item resolves
		env.playlists.get = realGet;
		assert.equal(await retryPlaylistAdd(env as never, 'v1', 'p1', ctx), 'pending');
		await drain(env);
		assert.deepEqual(env.playlists.read('p1').videos, ['v1']);
		await flush();
		assert.deepEqual(posts.at(-1).resolved, [{ key: needsActionKey('v1', 'p1') }]);
		assert.equal(await retryPlaylistAdd(env as never, 'v1', 'p1', ctx), 'added');
		assert.equal(await retryPlaylistAdd(env as never, 'v1', 'nope', ctx), null);
	});

	it('drops a malformed message', async () => {
		const env = makeEnv();
		const m = queueMessage({ kind: PLAYLIST_ADD_KIND, videoId: '../x', playlistId: 'p1', loopId: 'l' });
		await handlePlaylistAddBatch({ messages: [m] }, env as never, ctx);
		assert.ok(m.acked);
	});
});

describe('status for the uploader', () => {
	it("lists only the caller's adds", async () => {
		const env = makeEnv();
		await request(env, 'v1', ['p1', 'p2']);
		await request(env, 'v2', ['p1'], 'sara');
		await drain(env);
		const mine = await readPlaylistAddStatus(env as never, ['v1', 'v2'], 'owner');
		assert.deepEqual(mine.map((i) => [i.videoId, i.playlistId, i.status]), [['v1', 'p1', 'added'], ['v1', 'p2', 'added']]);
	});
});

describe('routes', () => {
	const ROUTES = (r: any) => {
		r.get('/api/playlists', PlaylistsList);
		r.post('/api/playlists', PlaylistCreate);
		r.post('/api/playlists/upload-adds', PlaylistUploadAddsCreate);
		r.get('/api/playlists/upload-adds', PlaylistUploadAddsStatus);
		r.post('/api/playlists/:id/videos', PlaylistAddVideo);
	};
	const json = (body: unknown, headers: Record<string, string> = {}) => ({ method: 'POST', headers: { 'content-type': 'application/json', channelId: 'ch', ...headers }, body: JSON.stringify(body) });

	it('POST /api/playlists/upload-adds answers 202 and the status read follows', async () => {
		const env = makeEnv();
		const app = buildApp(ROUTES, { userId: 'sara', channelOwnerId: 'owner' });
		const res = await app.request('/api/playlists/upload-adds', json({ videoId: 'v1', playlistIds: ['p1'], orderKey: orderKeyFor('b', 0) }), env as never);
		assert.equal(res.status, 202);
		assert.deepEqual(((await res.json()) as any).result.items, [{ playlistId: 'p1', status: 'pending' }]);
		const status = await app.request('/api/playlists/upload-adds?videoIds=v1', {}, env as never);
		assert.equal(status.status, 200);
		assert.equal(((await status.json()) as any).result.items[0].status, 'pending');
		const anonymous = await buildApp(ROUTES, null).request('/api/playlists/upload-adds', json({ videoId: 'v1', playlistIds: ['p1'], orderKey: 'b:0' }), env as never);
		assert.equal(anonymous.status, 401);
	});

	it('a member creates a playlist for the channel: it belongs to the owner and the member sees it, private or not', async () => {
		const env = makeEnv();
		const app = buildApp(ROUTES, { userId: 'sara', channelOwnerId: 'owner' });
		const res = await app.request('/api/playlists', json({ title: '  Tafsir  ', isPublic: false, description: 'Weekly' }), env as never);
		assert.equal(res.status, 200);
		const created = ((await res.json()) as any).result.playlist;
		assert.equal(created.title, 'Tafsir');
		const stored = env.playlists.read(created.id);
		assert.equal(stored.userId, 'owner');
		assert.equal(stored.createdBy, 'sara');
		const list = await app.request('/api/playlists?channelId=ch', {}, env as never);
		const ids = ((await list.json()) as any).data.map((p: any) => p.id);
		assert.ok(ids.includes(created.id) && ids.includes('p2'));
		// A visitor does not see private ones
		const visitor = await buildApp(ROUTES, { userId: 'guest' }).request('/api/playlists?channelId=ch', {}, env as never);
		assert.equal(((await visitor.json()) as any).data.some((p: any) => p.id === 'p2'), false);
		// An empty title is refused
		assert.equal((await app.request('/api/playlists', json({ title: '   ' }), env as never)).status, 400);
	});

	it('an editor may add a video to the channel playlist by hand; a moderator may not', async () => {
		const env = makeEnv();
		const editor = await buildApp(ROUTES, { userId: 'sara' }).request('/api/playlists/p1/videos', json({ videoId: 'v1' }), env as never);
		assert.equal(editor.status, 200);
		const moderator = await buildApp(ROUTES, { userId: 'mod' }).request('/api/playlists/p1/videos', json({ videoId: 'v2' }), env as never);
		assert.equal(moderator.status, 403);
	});

	it('channel member routes: playlist writes need playlist.manage', () => {
		assert.equal(memberMayActAs('editor', 'POST', '/api/playlists'), true);
		assert.equal(memberMayActAs('editor', 'POST', '/api/playlists/upload-adds'), true);
		assert.equal(memberMayActAs('editor', 'POST', '/api/playlists/p1/videos'), true);
		assert.equal(memberMayActAs('editor', 'DELETE', '/api/playlists/p1/videos/v1'), true);
		assert.equal(memberMayActAs('moderator', 'POST', '/api/playlists/upload-adds'), false);
		assert.equal(memberMayActAs('moderator', 'POST', '/api/playlists'), false);
		// Editing or deleting a playlist itself stays owner only
		assert.equal(memberMayActAs('editor', 'PATCH', '/api/playlists/p1'), false);
		assert.equal(memberMayActAs('admin', 'DELETE', '/api/playlists/p1'), false);
	});

	it('POST /internal/playlist-adds/retry restarts a failed add, 404 for an unknown one', async () => {
		const env = makeEnv();
		const record: PlaylistAddRecord = { videoId: 'v1', playlistId: 'p1', channelId: 'ch', requestedBy: 'owner', orderKey: 'b:000000', status: 'failed', loopId: 'old', attempts: 6, createdAt: 'x', updatedAt: 'x' };
		await env.global_settings.put(recordKey('v1', 'p1'), JSON.stringify(record));
		const app = createPlaylistAddsInternalRouter();
		const post = (body: unknown) => app.request('/retry', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }, env as never);
		const res = await post({ videoId: 'v1', playlistId: 'p1' });
		assert.equal(res.status, 200);
		assert.equal(env.PROCESSING_CHECK_QUEUE.sent.length, 1);
		assert.equal((await post({ videoId: 'v1', playlistId: 'nope' })).status, 404);
		assert.equal((await post({})).status, 400);
	});
});
