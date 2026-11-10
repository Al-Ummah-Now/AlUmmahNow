/**
 * Channel playlists in bulk (lib/playlistBulk.ts, endpoints/playlist/playlistBulk.ts):
 * ordered idempotent validated adds, the queued job above the inline cap or
 * after a failed inline write, reorder/remove, who may manage, and the
 * picker's video list filters.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Hono } from 'hono';
import { fromHono } from 'chanfana';
import { ADMIN_JOB_MAX_RETRIES, PLAYLIST_BULK_SYNC_MAX, mergePlaylistOrder, playlistSortOf, sortPlaylistVideoIds, uniqueVideoIds, type PlaylistSort } from '@al-ummah/shared-types';
import { MemoryBucket, MemoryQueue, SlowBucket, buildApp, videoFixture } from './helpers';
import { SqliteD1 } from './search-sqlite-d1';
import { handleAdminJobBatch, type JobMessage } from '../src/lib/admin/jobs';
import { ADMIN_JOB_HANDLERS } from '../src/lib/admin/service';
import { channelIdMiddleware } from '../src/middleware/auth';
import { errorHandler } from '../src/middleware/error-handler';
import { PlaylistCreate } from '../src/endpoints/playlist/playlistCreate';
import { PlaylistFetch } from '../src/endpoints/playlist/playlistFetch';
import { PlaylistsList } from '../src/endpoints/playlist/playlistsList';
import { PlaylistUpdate } from '../src/endpoints/playlist/playlistUpdate';
import { PlaylistDelete } from '../src/endpoints/playlist/playlistDelete';
import { PlaylistAddVideo } from '../src/endpoints/playlist/playlistAddVideo';
import {
	PlaylistJobFetch,
	PlaylistJobRetry,
	PlaylistManageItems,
	PlaylistVideosBulkAdd,
	PlaylistVideosBulkRemove,
	PlaylistVideosReorder,
} from '../src/endpoints/playlist/playlistBulk';
import { VideosList, normalizeTitleQuery, titleMatches } from '../src/endpoints/video/videoList';

const OWNER = 'owner';

/** Admin-jobs queue double: delivers like Cloudflare Queues (retry with backoff, DLQ after max_retries). */
class JobsQueue {
	pending: { body: unknown; attempts: number }[] = [];
	dlq: unknown[] = [];
	refuse = false;
	async send(body: unknown) {
		if (this.refuse) throw new Error('Queue send failed');
		this.pending.push({ body, attempts: 1 });
	}
	async drain(env: unknown) {
		for (let guard = 0; this.pending.length && guard < 500; guard++) {
			const delivery = this.pending.shift()!;
			let acked = true;
			const msg: JobMessage = { body: delivery.body, attempts: delivery.attempts, ack: () => { acked = true; }, retry: () => { acked = false; } };
			await handleAdminJobBatch({ messages: [msg] }, env as never, ADMIN_JOB_HANDLERS);
			if (acked) continue;
			if (delivery.attempts > ADMIN_JOB_MAX_RETRIES) this.dlq.push(delivery.body);
			else this.pending.push({ ...delivery, attempts: delivery.attempts + 1 });
		}
	}
}

/** A playlists bucket whose conditional puts can be made to fail (every attempt loses the race). */
class FlakyBucket extends MemoryBucket {
	failPuts = 0;
	async put(key: string, value: string, options?: { onlyIf?: { etagMatches?: string; etagDoesNotMatch?: string } }) {
		if (this.failPuts > 0 && options?.onlyIf?.etagMatches) {
			this.failPuts--;
			return null;
		}
		return super.put(key, value, options);
	}
}

const ids = (n: number, prefix = 'v') => Array.from({ length: n }, (_, i) => `${prefix}${String(i).padStart(4, '0')}`);

function channel(id: string, overrides: Record<string, unknown> = {}) {
	return {
		id, name: `Channel ${id}`, userId: OWNER, email: 'owner@test.local', isMain: true,
		dateCreated: '2026-01-01T00:00:00.000Z', dateModified: '2026-01-01T00:00:00.000Z',
		members: [
			{ userId: 'ed', role: 'editor', addedBy: OWNER, addedAt: '2026-11-01T00:00:00.000Z' },
			{ userId: 'adm', role: 'admin', addedBy: OWNER, addedAt: '2026-11-01T00:00:00.000Z' },
			{ userId: 'mod', role: 'moderator', addedBy: OWNER, addedAt: '2026-11-01T00:00:00.000Z' },
		],
		...overrides,
	};
}

function playlist(id: string, overrides: Record<string, unknown> = {}) {
	return { id, userId: OWNER, channelId: 'ch', title: `Playlist ${id}`, videos: [], isPublic: true, dateCreated: '2026-01-01T00:00:00.000Z', dateModified: '2026-01-01T00:00:00.000Z', ...overrides };
}

function setup(opts: { videos?: number; playlists?: Record<string, unknown>; playlistsBucket?: MemoryBucket; extraVideos?: Record<string, unknown> } = {}) {
	const videos: Record<string, unknown> = {};
	for (const id of ids(opts.videos ?? 30)) videos[id] = videoFixture({ id, title: `Lesson ${id}`, userId: OWNER, channelId: 'ch' });
	Object.assign(videos, opts.extraVideos ?? {});
	const playlistsBucket = opts.playlistsBucket ?? new MemoryBucket();
	for (const [k, v] of Object.entries(opts.playlists ?? { pl: playlist('pl') })) playlistsBucket.store.set(k, JSON.stringify(v));
	const env = {
		SEARCH_DB: new SqliteD1(),
		ADMIN_JOBS_QUEUE: new JobsQueue(),
		playlists: playlistsBucket,
		videos: new MemoryBucket(videos),
		channels: new MemoryBucket({ ch: channel('ch'), other: channel('other', { userId: 'someone', members: [] }) }),
		queue: new MemoryQueue(),
	};
	return env;
}

const ROUTES = (r: any) => {
	r.get('/api/playlists', PlaylistsList);
	r.post('/api/playlists', PlaylistCreate);
	r.get('/api/playlists/:id', PlaylistFetch);
	r.patch('/api/playlists/:id', PlaylistUpdate);
	r.delete('/api/playlists/:id', PlaylistDelete);
	r.post('/api/playlists/:id/videos', PlaylistAddVideo);
	r.post('/api/playlists/:id/videos/bulk', PlaylistVideosBulkAdd);
	r.post('/api/playlists/:id/videos/remove', PlaylistVideosBulkRemove);
	r.put('/api/playlists/:id/videos/order', PlaylistVideosReorder);
	r.get('/api/playlists/:id/items', PlaylistManageItems);
	r.get('/api/playlists/:id/jobs/:jobId', PlaylistJobFetch);
	r.post('/api/playlists/:id/jobs/:jobId/retry', PlaylistJobRetry);
	r.get('/api/videos', VideosList);
};

async function call(env: unknown, userId: string, method: string, path: string, body?: unknown, headers: Record<string, string> = {}) {
	const res = await buildApp(ROUTES, { userId }).request(path, {
		method,
		headers: { 'content-type': 'application/json', ...headers },
		...(body !== undefined ? { body: JSON.stringify(body) } : {}),
	}, env as never);
	const text = await res.text();
	return { status: res.status, body: text ? JSON.parse(text) : null };
}

const stored = (env: ReturnType<typeof setup>, id = 'pl') => env.playlists.read(id)?.videos as string[];

describe('shared helpers', () => {
	it('mergePlaylistOrder keeps the requested order, appends concurrent adds, drops removed ids', () => {
		assert.deepEqual(mergePlaylistOrder(['a', 'b', 'c', 'd'], ['d', 'c', 'b', 'a']), ['d', 'c', 'b', 'a']);
		// 'e' was added after the client read the list; 'b' was removed meanwhile
		assert.deepEqual(mergePlaylistOrder(['a', 'c', 'd', 'e'], ['d', 'c', 'b', 'a']), ['d', 'c', 'a', 'e']);
		assert.deepEqual(mergePlaylistOrder(['a', 'b'], ['b', 'b', 'x']), ['b', 'a']);
	});

	it('uniqueVideoIds keeps the first occurrence and drops blanks', () => {
		assert.deepEqual(uniqueVideoIds(['b', ' a ', '', 'b', 3, 'c']), ['b', 'a', 'c']);
	});

	it('title search matches any translation, case-insensitively', () => {
		const q = normalizeTitleQuery('  TAFSIR ')!;
		assert.equal(titleMatches({ title: 'Tafsir of al-Fatiha' }, q), true);
		assert.equal(titleMatches({ title: 'x', titleLocalized: { ar: 'تفسير', en: 'Tafsir lesson' } }, q), true);
		assert.equal(titleMatches({ title: 'Seerah' }, q), false);
		assert.equal(normalizeTitleQuery('   '), null);
		assert.equal(titleMatches({ title: 'درس تفسير' }, normalizeTitleQuery('تفسير')!), true);
	});
});

describe('POST /api/playlists/:id/videos/bulk', () => {
	it('adds in the given order after the current videos, once each, only the channel\'s videos', async () => {
		const env = setup({
			playlists: { pl: playlist('pl', { videos: ['v0005'] }) },
			extraVideos: {
				foreign: videoFixture({ id: 'foreign', userId: 'someone', channelId: 'other' }),
				gone: videoFixture({ id: 'gone', userId: OWNER, channelId: 'ch', isDeleted: true }),
				hidden: videoFixture({ id: 'hidden', userId: OWNER, channelId: 'ch', isHidden: true }),
				private: videoFixture({ id: 'private', userId: OWNER, channelId: 'ch', isPublic: false }),
			},
		});
		const res = await call(env, OWNER, 'POST', '/api/playlists/pl/videos/bulk', {
			videoIds: ['v0003', 'v0001', 'v0005', 'foreign', 'gone', 'hidden', 'missing', 'v0003', 'private', 'v0002'],
		});
		assert.equal(res.status, 200);
		assert.deepEqual(res.body.result, { status: 'done', added: 4, alreadyInPlaylist: 1, notInChannel: 4, pending: 0, videosCount: 5 });
		assert.deepEqual(stored(env), ['v0005', 'v0003', 'v0001', 'private', 'v0002']);

		// Idempotent: the same request again changes nothing
		const again = await call(env, OWNER, 'POST', '/api/playlists/pl/videos/bulk', { videoIds: ['v0003', 'v0001'] });
		assert.equal(again.body.result.added, 0);
		assert.equal(again.body.result.alreadyInPlaylist, 2);
		assert.deepEqual(stored(env), ['v0005', 'v0003', 'v0001', 'private', 'v0002']);
	});

	it('channel admins and editors may add; moderators and outsiders may not', async () => {
		const env = setup();
		for (const userId of ['adm', 'ed']) {
			const res = await call(env, userId, 'POST', '/api/playlists/pl/videos/bulk', { videoIds: [userId === 'adm' ? 'v0001' : 'v0002'] });
			assert.equal(res.status, 200, userId);
		}
		assert.equal((await call(env, 'mod', 'POST', '/api/playlists/pl/videos/bulk', { videoIds: ['v0003'] })).status, 403);
		assert.equal((await call(env, 'mallory', 'POST', '/api/playlists/pl/videos/bulk', { videoIds: ['v0003'] })).status, 403);
		assert.deepEqual(stored(env), ['v0001', 'v0002']);
	});

	it('a private playlist looks missing to someone who cannot manage it', async () => {
		const env = setup({ playlists: { pl: playlist('pl', { isPublic: false }) } });
		assert.equal((await call(env, 'mallory', 'POST', '/api/playlists/pl/videos/bulk', { videoIds: ['v0001'] })).status, 404);
		assert.equal((await call(env, 'mod', 'GET', '/api/playlists/pl/items')).status, 404);
		assert.equal((await call(env, 'ed', 'GET', '/api/playlists/pl/items')).status, 200);
	});

	it('rejects an empty or oversized list', async () => {
		const env = setup();
		assert.equal((await call(env, OWNER, 'POST', '/api/playlists/pl/videos/bulk', { videoIds: [] })).status, 400);
		assert.equal((await call(env, OWNER, 'POST', '/api/playlists/pl/videos/bulk', { videoIds: ids(1001) })).status, 400);
		assert.equal((await call(env, OWNER, 'POST', '/api/playlists/nope/videos/bulk', { videoIds: ['v0001'] })).status, 404);
	});

	it('above the inline cap: the first 200 now, the rest by the queued job, all in order', async () => {
		const env = setup({ videos: 450 });
		const all = ids(450);
		const requested = [...all].reverse();
		const res = await call(env, 'ed', 'POST', '/api/playlists/pl/videos/bulk', { videoIds: requested });
		assert.equal(res.status, 200);
		const { result } = res.body;
		assert.equal(result.status, 'queued');
		assert.equal(result.added, PLAYLIST_BULK_SYNC_MAX);
		assert.equal(result.pending, 250);
		assert.ok(result.jobId);
		assert.deepEqual(stored(env), requested.slice(0, PLAYLIST_BULK_SYNC_MAX));

		const queued = await call(env, 'ed', 'GET', `/api/playlists/pl/jobs/${result.jobId}`);
		assert.equal(queued.status, 200);
		assert.equal(queued.body.result.status, 'queued');
		assert.equal(queued.body.result.total, 250);

		await env.ADMIN_JOBS_QUEUE.drain(env);
		assert.deepEqual(stored(env), requested);
		const done = await call(env, 'ed', 'GET', `/api/playlists/pl/jobs/${result.jobId}`);
		assert.equal(done.body.result.status, 'succeeded');
		assert.equal(done.body.result.processed, 250);
		assert.equal(done.body.result.added, 250);

		// The job is the playlist's: another playlist cannot read it, a moderator cannot either
		assert.equal((await call(env, 'mod', 'GET', `/api/playlists/pl/jobs/${result.jobId}`)).status, 403);
	});

	it('an inline write that keeps losing the race goes to the queue instead of failing', async () => {
		const bucket = new FlakyBucket();
		const env = setup({ playlistsBucket: bucket });
		bucket.failPuts = 1000;
		const res = await call(env, OWNER, 'POST', '/api/playlists/pl/videos/bulk', { videoIds: ['v0002', 'v0001'] });
		assert.equal(res.status, 200);
		assert.equal(res.body.result.status, 'queued');
		assert.equal(res.body.result.added, 0);
		assert.equal(res.body.result.pending, 2);
		assert.deepEqual(stored(env), []);
		bucket.failPuts = 0;
		await env.ADMIN_JOBS_QUEUE.drain(env);
		assert.deepEqual(stored(env), ['v0002', 'v0001']);
	});

	it('a job that keeps failing ends failed (admin flag + DLQ); the manager can retry it', async () => {
		const bucket = new FlakyBucket();
		const env = setup({ playlistsBucket: bucket });
		bucket.failPuts = 100_000;
		const res = await call(env, OWNER, 'POST', '/api/playlists/pl/videos/bulk', { videoIds: ['v0001'] });
		const jobId = res.body.result.jobId;
		await env.ADMIN_JOBS_QUEUE.drain(env);
		assert.equal(env.ADMIN_JOBS_QUEUE.dlq.length, 1, 'dead-lettered after the retries');
		const row = await env.SEARCH_DB.prepare('SELECT status, kind, target_id, last_error FROM admin_jobs WHERE id = ?').bind(jobId).first<{ status: string; kind: string; target_id: string; last_error: string }>();
		assert.equal(row?.status, 'failed');
		assert.equal(row?.kind, 'playlist.add-videos');
		assert.equal(row?.target_id, 'ch');
		assert.match(row?.last_error ?? '', /Busy/);

		bucket.failPuts = 0;
		const retried = await call(env, 'adm', 'POST', `/api/playlists/pl/jobs/${jobId}/retry`);
		assert.equal(retried.status, 200);
		assert.equal(retried.body.result.status, 'queued');
		await env.ADMIN_JOBS_QUEUE.drain(env);
		assert.deepEqual(stored(env), ['v0001']);
		assert.equal((await call(env, OWNER, 'GET', `/api/playlists/pl/jobs/${jobId}`)).body.result.status, 'succeeded');
	});

	it('when the job cannot even be queued, the answer says failed (never silent)', async () => {
		const bucket = new FlakyBucket();
		const env = setup({ playlistsBucket: bucket });
		bucket.failPuts = 1000;
		env.ADMIN_JOBS_QUEUE.refuse = true;
		const res = await call(env, OWNER, 'POST', '/api/playlists/pl/videos/bulk', { videoIds: ['v0001'] });
		assert.equal(res.status, 200);
		assert.equal(res.body.result.status, 'failed');
		assert.equal(res.body.result.pending, 1);
		const row = await env.SEARCH_DB.prepare('SELECT status FROM admin_jobs WHERE id = ?').bind(res.body.result.jobId).first<{ status: string }>();
		assert.equal(row?.status, 'failed', 'the failed job is on the admin list with Retry');
	});

	it('two bulk adds racing keep every video, each batch in its own order', async () => {
		const env = setup({ videos: 120, playlistsBucket: new SlowBucket() });
		const a = ids(120).slice(0, 60);
		const b = ids(120).slice(60);
		const results = await Promise.all([
			call(env, OWNER, 'POST', '/api/playlists/pl/videos/bulk', { videoIds: a }),
			call(env, 'ed', 'POST', '/api/playlists/pl/videos/bulk', { videoIds: b }),
			...ids(120).slice(0, 10).map((videoId) => call(env, OWNER, 'POST', '/api/playlists/pl/videos/bulk', { videoIds: [videoId] })),
		]);
		assert.ok(results.every((r) => r.status === 200));
		const final = stored(env);
		assert.equal(final.length, 120);
		assert.equal(new Set(final).size, 120);
		assert.deepEqual(final.filter((id) => b.includes(id)), b);
	});
});

describe('reorder and remove', () => {
	it('reorder keeps a concurrent add and drops a concurrent remove', async () => {
		const env = setup({ playlists: { pl: playlist('pl', { videos: ['v0001', 'v0002', 'v0003'] }) }, playlistsBucket: new SlowBucket() });
		await Promise.all([
			call(env, OWNER, 'PUT', '/api/playlists/pl/videos/order', { videoIds: ['v0003', 'v0002', 'v0001'] }),
			call(env, 'ed', 'POST', '/api/playlists/pl/videos/bulk', { videoIds: ['v0009'] }),
			call(env, 'ed', 'POST', '/api/playlists/pl/videos/remove', { videoIds: ['v0002'] }),
		]);
		const final = stored(env);
		assert.deepEqual([...final].sort(), ['v0001', 'v0003', 'v0009']);
		assert.ok(final.indexOf('v0003') < final.indexOf('v0001'), final.join(','));
	});

	it('remove is idempotent and answers the new count', async () => {
		const env = setup({ playlists: { pl: playlist('pl', { videos: ['v0001', 'v0002', 'v0003'] }) } });
		const res = await call(env, 'adm', 'POST', '/api/playlists/pl/videos/remove', { videoIds: ['v0002', 'nope'] });
		assert.deepEqual(res.body.result, { removed: 1, videosCount: 2 });
		const again = await call(env, 'adm', 'POST', '/api/playlists/pl/videos/remove', { videoIds: ['v0002'] });
		assert.deepEqual(again.body.result, { removed: 0, videosCount: 2 });
		assert.equal((await call(env, 'mod', 'POST', '/api/playlists/pl/videos/remove', { videoIds: ['v0001'] })).status, 403);
	});

	it('items list every entry in order, unavailable ones as null, private videos for managers', async () => {
		const env = setup({
			playlists: { pl: playlist('pl', { videos: ['v0002', 'gone', 'private', 'v0001'] }) },
			extraVideos: {
				gone: videoFixture({ id: 'gone', userId: OWNER, channelId: 'ch', isDeleted: true }),
				private: videoFixture({ id: 'private', title: 'Draft', userId: OWNER, channelId: 'ch', isPublic: false, width: 1080, height: 1920, duration: 30 }),
			},
		});
		const res = await call(env, 'ed', 'GET', '/api/playlists/pl/items?offset=0&limit=3');
		assert.equal(res.status, 200);
		const { items, nextOffset, playlist: meta } = res.body.result;
		assert.deepEqual(items.map((i: any) => i.id), ['v0002', 'gone', 'private']);
		assert.equal(items[1].video, null);
		assert.equal(items[2].video.title, 'Draft');
		assert.equal(items[2].video.isPublic, false);
		assert.equal(items[2].video.isShort, true);
		assert.equal(nextOffset, 3);
		assert.equal(meta.videosCount, 4);
	});
});

describe('existing playlist routes follow playlist.manage', () => {
	it('an editor edits and deletes a channel playlist; a moderator cannot', async () => {
		const env = setup({ playlists: { pl: playlist('pl'), p2: playlist('p2') } });
		assert.equal((await call(env, 'mod', 'PATCH', '/api/playlists/pl', { title: 'x' }, { channelId: 'ch' })).status, 403);
		assert.equal((await call(env, 'ed', 'PATCH', '/api/playlists/pl', { title: 'Renamed' }, { channelId: 'ch' })).status, 200);
		assert.equal(env.playlists.read('pl').title, 'Renamed');
		assert.equal((await call(env, 'mod', 'DELETE', '/api/playlists/p2', undefined, { channelId: 'ch' })).status, 403);
		assert.equal((await call(env, 'adm', 'DELETE', '/api/playlists/p2', undefined, { channelId: 'ch' })).status, 200);
		assert.equal((await call(env, 'ed', 'POST', '/api/playlists/pl/videos', { videoId: 'v0001' }, { channelId: 'ch' })).status, 200);
	});

	it('managers see the channel\'s private playlists in the list and by id; others do not', async () => {
		const env = setup({ playlists: { pl: playlist('pl', { isPublic: false }), pub: playlist('pub') } });
		const listFor = async (userId: string) => (await call(env, userId, 'GET', '/api/playlists?channelId=ch&limit=50')).body.data.map((p: any) => p.id).sort();
		assert.deepEqual(await listFor('ed'), ['pl', 'pub']);
		assert.deepEqual(await listFor('mod'), ['pub']);
		assert.deepEqual(await listFor('mallory'), ['pub']);
		assert.equal((await call(env, 'adm', 'GET', '/api/playlists/pl')).status, 200);
		assert.equal((await call(env, 'mod', 'GET', '/api/playlists/pl')).status, 404);
	});
});

describe('POST /api/playlists with videos', () => {
	it('creates the playlist with the chosen videos in order, validated', async () => {
		const env = setup({ playlists: {}, extraVideos: { foreign: videoFixture({ id: 'foreign', userId: 'someone', channelId: 'other' }) } });
		const res = await call(env, OWNER, 'POST', '/api/playlists', { title: 'New', isPublic: false, videos: ['v0004', 'foreign', 'v0002', 'v0004'] }, { channelId: 'ch' });
		assert.equal(res.status, 200);
		const { playlist: created, add } = res.body.result;
		assert.equal(add.status, 'done');
		assert.equal(add.added, 2);
		assert.equal(add.notInChannel, 1);
		assert.deepEqual(env.playlists.read(created.id).videos, ['v0004', 'v0002']);
		assert.equal(env.playlists.read(created.id).isPublic, false);
		assert.equal(env.playlists.read(created.id).userId, OWNER);
	});

	it('a member creates it for the channel: owned by the channel owner, created by the member', async () => {
		const env = setup({ playlists: {} });
		const res = await buildApp(ROUTES, { userId: 'ed', channelOwnerId: OWNER }).request('/api/playlists', {
			method: 'POST', headers: { 'content-type': 'application/json', channelId: 'ch' }, body: JSON.stringify({ title: 'Team list', videos: ['v0001'] }),
		}, env as never);
		assert.equal(res.status, 200);
		const { result } = (await res.json()) as any;
		const record = env.playlists.read(result.playlist.id);
		assert.equal(record.userId, OWNER);
		assert.equal(record.createdBy, 'ed');
		assert.deepEqual(record.videos, ['v0001']);
	});

	it('above the cap or after an inline failure the playlist stays and the add is queued', async () => {
		const bucket = new FlakyBucket();
		const env = setup({ videos: 260, playlists: {}, playlistsBucket: bucket });
		const big = await call(env, OWNER, 'POST', '/api/playlists', { title: 'Big', videos: ids(260) }, { channelId: 'ch' });
		assert.equal(big.body.result.add.status, 'queued');
		assert.equal(big.body.result.add.pending, 60);
		assert.equal(big.body.result.playlist.videos?.length ?? env.playlists.read(big.body.result.playlist.id).videos.length, 200);

		bucket.failPuts = 1000;
		const flaky = await call(env, OWNER, 'POST', '/api/playlists', { title: 'Flaky', videos: ['v0003', 'v0001'] }, { channelId: 'ch' });
		assert.equal(flaky.status, 200);
		const flakyId = flaky.body.result.playlist.id;
		assert.ok(env.playlists.read(flakyId), 'the playlist stays');
		assert.equal(flaky.body.result.add.status, 'queued');
		assert.deepEqual(env.playlists.read(flakyId).videos, []);

		bucket.failPuts = 0;
		await env.ADMIN_JOBS_QUEUE.drain(env);
		assert.deepEqual(env.playlists.read(flakyId).videos, ['v0003', 'v0001']);
		assert.deepEqual(env.playlists.read(big.body.result.playlist.id).videos, ids(260));
	});
});

describe('acting as the channel (channelIdMiddleware)', () => {
	function appWith(userId: string) {
		const app = new Hono();
		app.onError(errorHandler);
		app.use('*', async (c, next) => {
			c.set('auth' as never, { userId, email: `${userId}@test.local`, payload: {} } as never);
			c.set('userId' as never, userId as never);
			await next();
		});
		app.use('/api/*', channelIdMiddleware);
		ROUTES(fromHono(app));
		return app;
	}
	const post = (userId: string, env: unknown, path: string, body: unknown) =>
		appWith(userId).request(path, { method: 'POST', headers: { 'content-type': 'application/json', channelId: 'ch' }, body: JSON.stringify(body) }, env as never);

	it('editors create and fill playlists as the channel; moderators are refused', async () => {
		const env = setup();
		assert.equal((await post('ed', env, '/api/playlists', { title: 'By editor' })).status, 200);
		assert.equal((await post('ed', env, '/api/playlists/pl/videos/bulk', { videoIds: ['v0001'] })).status, 200);
		assert.equal((await post('mod', env, '/api/playlists', { title: 'By moderator' })).status, 403);
		assert.equal((await post('mod', env, '/api/playlists/pl/videos/bulk', { videoIds: ['v0002'] })).status, 403);
		assert.deepEqual(stored(env), ['v0001']);
	});
});

describe('GET /api/videos: the picker filters', () => {
	it('format and title search filter a channel\'s videos and page with the cursor', async () => {
		const env = setup({
			videos: 0,
			extraVideos: {
				a: videoFixture({ id: 'a', title: 'Tafsir part 1', userId: OWNER, channelId: 'ch', dateCreated: '2026-01-05T00:00:00.000Z' }),
				b: videoFixture({ id: 'b', title: 'Short reminder', userId: OWNER, channelId: 'ch', width: 1080, height: 1920, duration: 40, dateCreated: '2026-01-04T00:00:00.000Z' }),
				c: videoFixture({ id: 'c', title: 'x', titleLocalized: { en: 'Tafsir part 2' }, userId: OWNER, channelId: 'ch', dateCreated: '2026-01-03T00:00:00.000Z' }),
				d: videoFixture({ id: 'd', title: 'Tafsir elsewhere', userId: 'someone', channelId: 'other' }),
			},
		});
		const list = async (query: string) => (await call(env, OWNER, 'GET', `/api/videos?channelId=ch&limit=50&${query}`)).body.data.map((v: any) => v.id).sort();
		assert.deepEqual(await list('format=short'), ['b']);
		assert.deepEqual(await list('format=video'), ['a', 'c']);
		assert.deepEqual(await list('q=tafsir'), ['a', 'c']);
		assert.deepEqual(await list('q=TAFSIR&format=short'), []);
	});
});

describe('playlist order: manual or automatic', () => {
	const vids: Record<string, { title: string; dateCreated: string; publishedAt?: string; views: number; duration?: number }> = {
		a: { title: 'Part 10', dateCreated: '2026-01-03T00:00:00.000Z', views: 50, duration: 300 },
		b: { title: 'part 2', dateCreated: '2026-01-01T00:00:00.000Z', publishedAt: '2026-01-09T00:00:00.000Z', views: 900, duration: 60 },
		c: { title: 'تفسير', dateCreated: '2026-01-02T00:00:00.000Z', views: 50 },
		d: { title: 'Adab', dateCreated: '2026-01-04T00:00:00.000Z', views: 7, duration: 1200 },
	};
	const added = { a: '2026-02-04T00:00:00.000Z', b: '2026-02-01T00:00:00.000Z', c: '2026-02-03T00:00:00.000Z', d: '2026-02-02T00:00:00.000Z' };
	const sort = (sortField: PlaylistSort['sortField'], sortDirection: PlaylistSort['sortDirection']) =>
		sortPlaylistVideoIds(['a', 'b', 'c', 'd', 'gone'], { sortMode: 'auto', sortField, sortDirection }, (id) => vids[id] ?? null, added);

	it('sorts by each field in both directions; ties keep the stored order; unknown values last', () => {
		// 'gone' has no add date: an undated entry counts as the oldest
		assert.deepEqual(sort('added', 'asc'), ['gone', 'b', 'd', 'c', 'a']);
		assert.deepEqual(sort('added', 'desc').slice(0, 4), ['a', 'c', 'd', 'b']);
		// Published: publishedAt when set, else dateCreated
		assert.deepEqual(sort('published', 'asc'), ['c', 'a', 'd', 'b', 'gone']);
		assert.deepEqual(sort('published', 'desc'), ['b', 'd', 'a', 'c', 'gone']);
		// Title: one collation for every viewer: Arabic script first (the ar rule), then
		// Latin, case-insensitive, numbers by value ("part 2" before "Part 10")
		assert.deepEqual(sort('title', 'asc'), ['c', 'd', 'b', 'a', 'gone']);
		assert.deepEqual(sort('title', 'desc'), ['a', 'b', 'd', 'c', 'gone']);
		// Views: a and c tie at 50 and keep their stored order in both directions
		assert.deepEqual(sort('views', 'asc'), ['d', 'a', 'c', 'b', 'gone']);
		assert.deepEqual(sort('views', 'desc'), ['b', 'a', 'c', 'd', 'gone']);
		// Duration: c has none and goes last with the missing video
		assert.deepEqual(sort('duration', 'asc'), ['b', 'a', 'd', 'c', 'gone']);
		assert.deepEqual(sort('duration', 'desc'), ['d', 'a', 'b', 'c', 'gone']);
	});

	it('ids added before dates were recorded count as the oldest, in stored order', () => {
		const order = sortPlaylistVideoIds(['old1', 'old2', 'new'], { sortMode: 'auto', sortField: 'added', sortDirection: 'asc' }, () => ({ title: 'x' }), { new: '2026-02-01T00:00:00.000Z' });
		assert.deepEqual(order, ['old1', 'old2', 'new']);
		const desc = sortPlaylistVideoIds(['old1', 'old2', 'new'], { sortMode: 'auto', sortField: 'added', sortDirection: 'desc' }, () => ({ title: 'x' }), { new: '2026-02-01T00:00:00.000Z' });
		assert.deepEqual(desc, ['new', 'old2', 'old1']);
	});

	it('manual keeps the stored order; old records without an order are manual', () => {
		assert.deepEqual(sortPlaylistVideoIds(['c', 'a', 'b'], playlistSortOf({}), (id) => vids[id]), ['c', 'a', 'b']);
		assert.deepEqual(playlistSortOf({ sortMode: 'bogus', sortField: 'nope' }), { sortMode: 'manual', sortField: 'added', sortDirection: 'desc' });
	});

	function sortEnv(n = 7) {
		const extra: Record<string, unknown> = {};
		for (let i = 0; i < n; i++) {
			extra[`s${i}`] = videoFixture({ id: `s${i}`, title: `Lesson ${n - i}`, userId: OWNER, channelId: 'ch', views: (i * 37) % 11, duration: 100 + i, dateCreated: `2026-01-0${i + 1}T00:00:00.000Z` });
		}
		return setup({ videos: 0, playlists: {}, extraVideos: extra });
	}
	const all = (n = 7) => Array.from({ length: n }, (_, i) => `s${i}`);

	it('creates with an automatic order and every listing (fetch, items pages) uses it, pages never overlap', async () => {
		const env = sortEnv();
		const res = await call(env, OWNER, 'POST', '/api/playlists', { title: 'By title', sortMode: 'auto', sortField: 'title', sortDirection: 'asc', videos: all() }, { channelId: 'ch' });
		assert.equal(res.status, 200);
		const id = res.body.result.playlist.id;
		const expected = ['s6', 's5', 's4', 's3', 's2', 's1', 's0']; // "Lesson 1" … "Lesson 7"
		assert.deepEqual(env.playlists.read(id).videos, expected, 'the stored order is materialized');
		assert.equal(env.playlists.read(id).sortMode, 'auto');

		const fetched = await call(env, 'mallory', 'GET', `/api/playlists/${id}?includeVideos=true`);
		assert.deepEqual(fetched.body.videos, expected);
		assert.deepEqual(fetched.body.videoItems.map((v: any) => v.id), expected);
		assert.equal(fetched.body.sortField, 'title');
		assert.equal(fetched.body.videoAddedAt, undefined, 'add dates stay internal');

		// Paging the manager list in pages of 2: sorted before the cut, no overlap, no gap
		const seen: string[] = [];
		for (let offset: number | null = 0; offset !== null;) {
			const page = await call(env, 'ed', 'GET', `/api/playlists/${id}/items?offset=${offset}&limit=2`);
			assert.equal(page.body.result.playlist.sortMode, 'auto');
			seen.push(...page.body.result.items.map((i: any) => i.id));
			offset = page.body.result.nextOffset;
		}
		assert.deepEqual(seen, expected);
	});

	it('views order follows fresh view counts on read', async () => {
		const env = sortEnv(3);
		const res = await call(env, OWNER, 'POST', '/api/playlists', { title: 'Popular', sortMode: 'auto', sortField: 'views', sortDirection: 'desc', videos: all(3) }, { channelId: 'ch' });
		const id = res.body.result.playlist.id;
		const v = env.videos.read('s0');
		env.videos.store.set('s0', JSON.stringify({ ...v, views: 10_000 }));
		const fetched = await call(env, OWNER, 'GET', `/api/playlists/${id}`);
		assert.equal(fetched.body.videos[0], 's0');
	});

	it('adds: manual appends at the end, automatic places by the order', async () => {
		const env = sortEnv();
		env.playlists.store.set('man', JSON.stringify(playlist('man', { videos: ['s3', 's1'] })));
		env.playlists.store.set('aut', JSON.stringify(playlist('aut', { videos: ['s6', 's1'], sortMode: 'auto', sortField: 'duration', sortDirection: 'asc' })));
		await call(env, OWNER, 'POST', '/api/playlists/man/videos/bulk', { videoIds: ['s0', 's2'] });
		assert.deepEqual(env.playlists.read('man').videos, ['s3', 's1', 's0', 's2']);
		await call(env, OWNER, 'POST', '/api/playlists/aut/videos/bulk', { videoIds: ['s0', 's4'] });
		assert.deepEqual(env.playlists.read('aut').videos, ['s0', 's1', 's4', 's6']);
		await call(env, OWNER, 'POST', '/api/playlists/aut/videos', { videoId: 's2' }, { channelId: 'ch' });
		assert.deepEqual(env.playlists.read('aut').videos, ['s0', 's1', 's2', 's4', 's6']);
		assert.ok(env.playlists.read('aut').videoAddedAt.s2, 'the add date is recorded');
	});

	it('date added order: newest first follows the add sequence', async () => {
		const env = sortEnv();
		env.playlists.store.set('pl', JSON.stringify(playlist('pl', { sortMode: 'auto', sortField: 'added', sortDirection: 'desc' })));
		for (const id of ['s2', 's5', 's0']) {
			await call(env, OWNER, 'POST', '/api/playlists/pl/videos/bulk', { videoIds: [id] });
			await new Promise((r) => setTimeout(r, 5));
		}
		assert.deepEqual(env.playlists.read('pl').videos, ['s0', 's5', 's2']);
	});

	it('switching auto → manual keeps the automatic order; reorder by hand needs manual', async () => {
		const env = sortEnv(4);
		env.playlists.store.set('pl', JSON.stringify(playlist('pl', { videos: ['s0', 's1', 's2', 's3'] })));
		const toAuto = await call(env, 'ed', 'PATCH', '/api/playlists/pl', { sortMode: 'auto', sortField: 'duration', sortDirection: 'desc' }, { channelId: 'ch' });
		assert.equal(toAuto.status, 200);
		assert.deepEqual(env.playlists.read('pl').videos, ['s3', 's2', 's1', 's0']);

		const refused = await call(env, 'ed', 'PUT', '/api/playlists/pl/videos/order', { videoIds: ['s0', 's1', 's2', 's3'] });
		assert.equal(refused.status, 409);
		assert.equal(refused.body.code, 'PLAYLIST_SORT_AUTOMATIC');
		assert.equal((await call(env, 'ed', 'PATCH', '/api/playlists/pl', { videos: ['s0', 's1', 's2', 's3'] }, { channelId: 'ch' })).status, 409);

		const toManual = await call(env, 'ed', 'PATCH', '/api/playlists/pl', { sortMode: 'manual' }, { channelId: 'ch' });
		assert.equal(toManual.status, 200);
		assert.equal(env.playlists.read('pl').sortMode, 'manual');
		assert.deepEqual(env.playlists.read('pl').videos, ['s3', 's2', 's1', 's0'], 'the automatic order is the starting manual order');
		const moved = await call(env, 'ed', 'PUT', '/api/playlists/pl/videos/order', { videoIds: ['s1', 's3', 's2', 's0'] });
		assert.equal(moved.status, 200);
		assert.deepEqual(env.playlists.read('pl').videos, ['s1', 's3', 's2', 's0']);
	});

	it('rejects an unknown sort value', async () => {
		const env = sortEnv(1);
		env.playlists.store.set('pl', JSON.stringify(playlist('pl')));
		assert.equal((await call(env, OWNER, 'PATCH', '/api/playlists/pl', { sortMode: 'auto', sortField: 'likes' }, { channelId: 'ch' })).status, 400);
		assert.equal((await call(env, OWNER, 'POST', '/api/playlists', { title: 'x', sortDirection: 'up' }, { channelId: 'ch' })).status, 400);
	});
});
