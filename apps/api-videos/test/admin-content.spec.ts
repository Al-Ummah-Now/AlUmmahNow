/**
 * Platform content management (/internal/admin/*, lib/admin/*) and videos bans
 * (middleware/videos-ban.ts) over in-memory R2 and a real SQLite search DB.
 */
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { fromHono } from 'chanfana';
import { applySuspensionHold, deletionDaysLeft, deletionStatusOf, isPurgeDue, liftSuspensionHold, MessageType, purgeAfterOf, VIDEOS_BANNED_CODE } from '@al-ummah/shared-types';
import { canViewPlaylist } from '../src/lib/playlists';
import { ownershipCompleteKey } from '@al-ummah/shared-types';
import { CHANNEL_HANDLE_PREFIX_SQL, PROFILE_EXACT_SQL } from '../src/lib/admin/userSearch';
import adminRouter from '../src/routers/admin.router';
import { withSearchSync } from '../src/lib/search/sync';
import { runOwnershipPass } from '../src/lib/search/ownership';
import { videosBanMiddleware, isBlockedForBannedUser } from '../src/middleware/videos-ban';
import { forgetCachedBan } from '../src/lib/admin/bans';
import { projectComments, commentSignature } from '../src/lib/admin/commentIndex';
import { ChannelFetch } from '../src/endpoints/channel/channelFetch';
import { ChannelsList } from '../src/endpoints/channel/channelList';
import { VideoFetch } from '../src/endpoints/video/videoFetch';
import { ProfileCreate } from '../src/endpoints/profile/profileCreate';
import { ProfileCurrentFetch } from '../src/endpoints/profile/profileCurrentFetch';
import { CommentCreate } from '../src/endpoints/video/commentCreate';
import { errorHandler } from '../src/middleware/error-handler';
import { channelIdMiddleware, channelRefusesWrite } from '../src/middleware/auth';
import { CreateCommunityPost } from '../src/endpoints/community/create-post';
import { LiveStreamsList } from '../src/endpoints/live/liveStreamsList';
import { LiveStreamUpdate } from '../src/endpoints/live/liveStreamUpdate';
import { MemoryBucket, MemoryQueue, commentFixture, videoFixture } from './helpers';
import { backoffSeconds, handleAdminJobBatch, type JobMessage } from '../src/lib/admin/jobs';
import { ADMIN_JOB_HANDLERS, purgeDeletion } from '../src/lib/admin/service';
import { createJob } from '../src/lib/admin/jobs';
import { runDeletionCleanup } from '../src/lib/admin/deletions';
import { SqliteD1 } from './search-sqlite-d1';

const OWNER = 'usr_owner';

/** Bunny Stream API stand-in: records calls; `bunny.status` makes deletes fail. */
const bunny = { calls: [] as string[], status: 200 };
const realFetch = globalThis.fetch;
before(() => {
	globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
		const url = String(input instanceof Request ? input.url : input);
		if (!url.startsWith('https://video.bunnycdn.com/')) return realFetch(input, init);
		bunny.calls.push(`${init?.method ?? 'GET'} ${new URL(url).pathname}`);
		return new Response(bunny.status < 300 ? '{}' : 'error', { status: bunny.status });
	}) as typeof fetch;
});
after(() => {
	globalThis.fetch = realFetch;
});

const MAX_RETRIES = 5; // wrangler: admin-jobs consumer max_retries

/**
 * The admin-jobs queue and its consumer, as Cloudflare runs them: a retried
 * message comes back with attempts + 1; after max_retries it goes to the DLQ.
 */
class JobsQueue {
	pending: { body: unknown; attempts: number; delaySeconds?: number }[] = [];
	dlq: unknown[] = [];
	delays: number[] = [];
	refuse = false;
	async send(body: unknown, options?: { delaySeconds?: number }) {
		if (this.refuse) throw new Error('Queue send failed');
		this.pending.push({ body, attempts: 1, delaySeconds: options?.delaySeconds });
	}
	/** Delivers messages (newest first when `reverse`) until the queue is empty. */
	async drain(env: unknown, opts: { reverse?: boolean } = {}) {
		for (let guard = 0; this.pending.length && guard < 200; guard++) {
			const delivery = opts.reverse ? this.pending.pop()! : this.pending.shift()!;
			let outcome: 'ack' | { delaySeconds?: number } = 'ack';
			const msg: JobMessage = {
				body: delivery.body,
				attempts: delivery.attempts,
				ack: () => { outcome = 'ack'; },
				retry: (o) => { outcome = { delaySeconds: o?.delaySeconds }; },
			};
			await handleAdminJobBatch({ messages: [msg] }, env as never, ADMIN_JOB_HANDLERS);
			if (outcome === 'ack') continue;
			this.delays.push((outcome as { delaySeconds?: number }).delaySeconds ?? 0);
			if (delivery.attempts > MAX_RETRIES) this.dlq.push(delivery.body);
			else this.pending.push({ ...delivery, attempts: delivery.attempts + 1 });
		}
	}
}
const OTHER = 'usr_other';

function profile(id: string, overrides: Record<string, unknown> = {}) {
	return { id, email: `${id}@example.com`, userName: id, displayName: `Name ${id}`, dateCreated: '2026-01-01T00:00:00.000Z', dateModified: '2026-01-01T00:00:00.000Z', channels: [], ...overrides };
}
function channel(id: string, overrides: Record<string, unknown> = {}) {
	return { id, userId: OWNER, email: `${OWNER}@example.com`, name: `Channel ${id}`, handle: id, isMain: true, dateCreated: '2026-02-01T00:00:00.000Z', dateModified: '2026-02-01T00:00:00.000Z', playlists: [], subscribers: [], ...overrides };
}

/** A wrapped env (writes update the indexes) with complete ownership passes. */
async function setup(seed: { profiles?: Record<string, unknown>; channels?: Record<string, unknown>; videos?: Record<string, unknown>; playlists?: Record<string, unknown> } = {}) {
	const db = new SqliteD1();
	const pending: Promise<unknown>[] = [];
	const raw = {
		SEARCH_DB: db,
		profiles: new MemoryBucket(seed.profiles ?? { [OWNER]: profile(OWNER, { channels: ['ch1'] }), [OTHER]: profile(OTHER) }),
		channels: new MemoryBucket(seed.channels ?? { ch1: channel('ch1') }),
		videos: new MemoryBucket(
			seed.videos ?? {
				v1: videoFixture({ id: 'v1', title: 'Tafsir lesson', userId: OWNER, channelId: 'ch1' }),
				v2: videoFixture({ id: 'v2', title: 'Seerah talk', userId: OWNER, channelId: 'ch1', isHidden: true, moderationAction: 'removed' }),
				legacy: videoFixture({ id: 'legacy', title: 'Old upload', userId: 'placeholder', channelId: null }),
			},
		),
		playlists: new MemoryBucket(seed.playlists ?? {}),
		community_posts: new MemoryBucket(),
		watch_history: new MemoryBucket(),
		channel_tabs: new MemoryBucket(),
		channel_sections: new MemoryBucket(),
		'upload-defaults': new MemoryBucket(),
		reports: new MemoryBucket(),
		queue: new MemoryQueue(),
		ADMIN_JOBS_QUEUE: new JobsQueue(),
		'bunny-stream-key': 'test-key',
		bunny_stream_library_id: '7',
	};
	for (const kind of ['video', 'channel', 'profile'] as const) await runOwnershipPass(raw as never, kind, { maxPages: 10 });
	const env = withSearchSync(raw, { waitUntil: (p: Promise<unknown>) => { pending.push(p); } });
	const app = new Hono();
	app.route('/internal/admin', adminRouter);
	const jobs = raw.ADMIN_JOBS_QUEUE;
	/** Calls admin; heavy actions' jobs then run through the consumer unless `hold`. */
	const call = async (method: string, path: string, body?: unknown, opts: { hold?: boolean } = {}) => {
		const res = await app.request(`/internal/admin${path}`, {
			method,
			headers: { 'Content-Type': 'application/json', 'X-Admin-Actor': 'usr_admin' },
			...(body !== undefined ? { body: JSON.stringify(body) } : {}),
		}, env);
		await Promise.all(pending.splice(0));
		const json = (await res.json()) as any;
		if (!opts.hold) {
			await jobs.drain(env);
			await Promise.all(pending.splice(0));
		}
		return { status: res.status, body: json };
	};
	/** The job a heavy action returned, as it stands now. */
	const jobOf = async (res: { body: any }) => (await call('GET', `/jobs/${res.body.result.job.id}`)).body.result;
	/** One run of the hourly deletion cleanup (lib/admin/deletions.ts), then the jobs it started, then a run that records them. */
	const cleanup = async (now = Date.now()) => {
		const purge = (d: any) => purgeDeletion(env as never, d);
		const first = await runDeletionCleanup(env as never, purge, { now });
		await Promise.all(pending.splice(0));
		await jobs.drain(env);
		await Promise.all(pending.splice(0));
		const second = await runDeletionCleanup(env as never, purge, { now });
		await Promise.all(pending.splice(0));
		return { first, second };
	};
	/** "Delete permanently now", then the cleanup; returns the purge job (if the kind uses one) as it stands. */
	const purgeNow = async (kind: string, id: string) => {
		const queued = await call('POST', `/deletions/${kind}/${id}/purge`);
		assert.equal(queued.status, 200, JSON.stringify(queued.body));
		assert.equal(queued.body.result.deletion.status, 'queued');
		await cleanup();
		const row = db.db.prepare('SELECT purge_job_id FROM admin_deletions WHERE kind = ? AND target_id = ?').get(kind, id) as { purge_job_id: string | null } | undefined;
		return row?.purge_job_id ? (await call('GET', `/jobs/${row.purge_job_id}`)).body.result : null;
	};
	return { db, raw, env, app, call, jobs, jobOf, cleanup, purgeNow, flush: () => Promise.all(pending.splice(0)) };
}

/** The public api-videos routes a visitor or user would call, with the ban middleware. */
function publicApp(env: unknown, userId: string | null) {
	const app = new Hono();
	app.onError(errorHandler);
	app.use('*', async (c, next) => {
		if (userId) {
			c.set('auth' as never, { userId, email: `${userId}@example.com`, payload: {} } as never);
			c.set('userId' as never, userId as never);
		}
		await next();
	});
	app.use('/api/*', videosBanMiddleware);
	const router = fromHono(app);
	router.get('/api/channels', ChannelsList);
	router.get('/api/channels/:id', ChannelFetch);
	router.get('/api/videos/:id', VideoFetch);
	router.post('/api/videos/:id/comments', CommentCreate);
	router.post('/api/profiles', ProfileCreate);
	router.get('/api/profile', ProfileCurrentFetch);
	return (method: string, path: string, body?: unknown, headers: Record<string, string> = {}) =>
		app.request(path, { method, headers: { 'Content-Type': 'application/json', ...headers }, ...(body ? { body: JSON.stringify(body) } : {}) }, env as never);
}

describe('suspension holds', () => {
	it('hide on the first hold and restore moderation\'s own decision on the last', () => {
		const record: Record<string, unknown> = { isHidden: false };
		assert.equal(applySuspensionHold(record, 'channel:c'), true);
		assert.equal(applySuspensionHold(record, 'user:u'), true);
		assert.equal(applySuspensionHold(record, 'user:u'), false);
		assert.equal(record.isHidden, true);
		liftSuspensionHold(record, 'channel:c');
		assert.equal(record.isHidden, true, 'still held by the ban');
		liftSuspensionHold(record, 'user:u');
		assert.equal(record.isHidden, false);
		assert.equal(record.suspensionHolds, undefined);

		const moderated: Record<string, unknown> = { isHidden: true, moderationAction: 'removed' };
		applySuspensionHold(moderated, 'channel:c');
		liftSuspensionHold(moderated, 'channel:c');
		assert.equal(moderated.isHidden, true, 'moderation-hidden content stays hidden');
	});
});

describe('search migrations', () => {
	it('apply in order, the Creator Studio columns included (QA applied that file from a preview under the same name)', () => {
		const dir = join(__dirname, '..', 'migrations', 'search');
		const db = new DatabaseSync(':memory:');
		for (const file of readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()) db.exec(readFileSync(join(dir, file), 'utf8'));
		const columns = (db.prepare("SELECT name FROM pragma_table_info('content_ownership')").all() as { name: string }[]).map((c) => c.name);
		assert.ok(['admin_title', 'title', 'studio_status', 'category', 'language'].every((c) => columns.includes(c)));
	});
});

describe('admin lists (ownership index)', () => {
	it('search channels by name, handle and owner email; filter suspended', async () => {
		const { call } = await setup({
			profiles: { [OWNER]: profile(OWNER, { email: 'scholar@example.org' }), [OTHER]: profile(OTHER) },
			channels: { ch1: channel('ch1', { name: 'Tafsir Circle', handle: 'tafsir' }), ch2: channel('ch2', { userId: OTHER, email: 'x@y.z', name: 'Fiqh', handle: 'fiqh', isMain: true }) },
		});
		assert.deepEqual((await call('GET', '/channels?q=circle')).body.result.items.map((c: any) => c.id), ['ch1']);
		assert.deepEqual((await call('GET', '/channels?q=fiq')).body.result.items.map((c: any) => c.id), ['ch2']);
		const byEmail = (await call('GET', '/channels?q=scholar@example')).body.result;
		assert.deepEqual(byEmail.items.map((c: any) => c.id), ['ch1']);
		assert.equal(byEmail.items[0].ownerEmail, 'scholar@example.org');
		assert.equal(byEmail.indexComplete, true);
		await call('POST', '/channels/ch2/suspend', { reason: 'spam' });
		assert.deepEqual((await call('GET', '/channels?suspended=yes')).body.result.items.map((c: any) => c.id), ['ch2']);
		assert.equal((await call('GET', '/channels?sort=name')).body.result.items[0].id, 'ch2');
	});

	it('lists videos across channels, including legacy videos without a channel', async () => {
		const { call } = await setup();
		const all = (await call('GET', '/videos')).body.result;
		assert.equal(all.total, 3);
		const legacy = (await call('GET', '/videos?noChannel=1')).body.result.items;
		assert.deepEqual(legacy.map((v: any) => [v.id, v.channelId, v.channelName]), [['legacy', null, null]]);
		assert.deepEqual((await call('GET', '/videos?q=tafsir')).body.result.items.map((v: any) => v.id), ['v1']);
		assert.deepEqual((await call('GET', '/videos?hidden=yes')).body.result.items.map((v: any) => v.id), ['v2']);
		assert.equal((await call('GET', '/videos?channelId=ch1&pageSize=1&page=2')).body.result.items.length, 1);
		assert.equal((await call('GET', '/videos?status=bogus')).status, 400);
	});

	it('rebuilds rows written before the admin columns', async () => {
		const { db, call } = await setup();
		db.db.prepare("UPDATE content_ownership SET admin_title = NULL, admin_cols = 0 WHERE kind = 'video'").run();
		const result = (await call('GET', '/videos?q=seerah')).body.result;
		assert.deepEqual(result.items.map((v: any) => v.id), ['v2']);
		assert.equal(result.indexComplete, true);
	});
});

describe('admin lists never wait for an index pass', () => {
	it('answers at once from the indexed rows, flagged incomplete, and passes the index after the response', async () => {
		const { db, env, app } = await setup({
			profiles: { [OWNER]: profile(OWNER) },
			channels: { ch1: channel('ch1', { name: 'Tafsir Circle', handle: 'tafsir' }) },
		});
		// The profile index is incomplete (QA, 2026-11-11: 22k profiles, a pass restarted by any failed write)
		db.db.prepare("DELETE FROM search_meta WHERE key LIKE 'ownership:complete:%profile'").run();
		const later: Promise<unknown>[] = [];
		const ctx = { waitUntil: (p: Promise<unknown>) => { later.push(p); }, passThroughOnException: () => {}, props: {} };
		const list = async () => {
			const res = await app.request('/internal/admin/channels?q=circle', { headers: { 'X-Admin-Actor': 'usr_admin' } }, env, ctx as never);
			return ((await res.json()) as any).result;
		};
		const first = await list();
		assert.deepEqual(first.items.map((c: any) => c.id), ['ch1'], 'listed from the rows already indexed');
		assert.equal(first.indexComplete, false);
		assert.ok(later.length > 0, 'the index pass runs after the response');
		await Promise.all(later.splice(0));
		assert.equal((await list()).indexComplete, true);
	});
});

describe('channel actions', () => {
	it('suspend hides the channel and its videos from the public; the owner still lists it; unsuspend restores', async () => {
		const { env, call, jobOf } = await setup();
		const visitor = publicApp(env, null);
		const owner = publicApp(env, OWNER);
		assert.equal((await visitor('GET', '/api/channels/ch1')).status, 200);
		assert.equal((await visitor('GET', '/api/videos/v1')).status, 200);

		const suspended = await call('POST', '/channels/ch1/suspend', { reason: 'Copyright' });
		assert.equal(suspended.status, 200);
		assert.equal(suspended.body.result.job.kind, 'channel.sync-holds');
		assert.equal(suspended.body.result.job.status, 'queued', 'the request only queues the cascade');
		const job = await jobOf(suspended);
		assert.equal(job.status, 'succeeded');
		assert.equal(job.result.videos, 2);
		assert.equal(job.actorId, 'usr_admin');
		assert.equal((await visitor('GET', '/api/channels/ch1')).status, 404);
		assert.equal((await visitor('GET', '/api/videos/v1')).status, 404);
		const mine = (await (await owner('GET', '/api/channels')).json()) as any;
		assert.equal(mine.data.length, 1, 'the owner still sees the suspended channel');
		assert.equal(mine.data[0].isSuspended, true);
		assert.equal(mine.data[0].suspension.reason, 'Copyright');
		assert.equal(mine.data[0].suspension.by, undefined, 'the admin id is not shown');

		const detail = (await call('GET', '/channels/ch1')).body.result;
		assert.equal(detail.isSuspended, true);
		assert.equal(detail.suspension.by, 'usr_admin');

		await call('POST', '/channels/ch1/unsuspend');
		assert.equal((await visitor('GET', '/api/channels/ch1')).status, 200);
		assert.equal((await visitor('GET', '/api/videos/v1')).status, 200);
		assert.equal((await visitor('GET', '/api/videos/v2')).status, 404, 'moderation-hidden video stays hidden');
	});

	it('a suspended channel publishes nothing new; its owner can still watch, like and delete', async () => {
		const { env, call } = await setup();
		const app = new Hono();
		app.onError(errorHandler);
		app.use('*', async (c, next) => {
			c.set('auth' as never, { userId: OWNER, email: `${OWNER}@example.com`, payload: {} } as never);
			c.set('userId' as never, OWNER as never);
			await next();
		});
		app.use('/api/*', channelIdMiddleware);
		app.patch('/api/live-streams/:id', (c) => c.json({ success: true }));
		const router = fromHono(app);
		router.post('/api/community/channels/:channelId/posts', CreateCommunityPost);
		for (const [method, path] of [['POST', '/api/videos/upload/initiate'], ['POST', '/api/videos/v1/watch-time'], ['DELETE', '/api/videos/v1']]) {
			app.on(method, path, (c) => c.json({ success: true }));
		}
		const asChannel = (method: string, path: string, body?: unknown) =>
			app.request(path, { method, headers: { 'Content-Type': 'application/json', channelId: 'ch1' }, ...(body ? { body: JSON.stringify(body) } : {}) }, env as never);

		assert.equal((await asChannel('POST', '/api/videos/upload/initiate')).status, 200);
		await (env as any).videos.put('livestream:ls1', JSON.stringify({ id: 'ls1', channelId: 'ch1', userId: OWNER, title: 'Live dars', status: 'live', isPrivate: false }));
		let liveRequest: (method: string, path: string, body: unknown) => Promise<Response> = async () => new Response(null, { status: 500 });
		const liveApp = (userId: string | null) => {
			const live = new Hono();
			live.use('*', async (c, next) => {
				if (userId) c.set('auth' as never, { userId, payload: {} } as never);
				await next();
			});
			const liveRouter = fromHono(live);
			liveRouter.get('/api/live-streams', LiveStreamsList);
			liveRouter.patch('/api/live-streams/:id', LiveStreamUpdate);
			liveRequest = (method, path, body) => live.request(path, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }, env as never);
			return async () => (await live.request('/api/live-streams', {}, env as never)).json();
		};
		const liveIds = async (userId: string | null) => JSON.stringify(await liveApp(userId)());
		assert.match(await liveIds(null), /ls1/);
		await call('POST', '/channels/ch1/suspend', { reason: 'Copyright' });
		assert.doesNotMatch(await liveIds(null), /ls1/, 'the suspended channel\'s live stream is hidden from the public');
		assert.match(await liveIds(OWNER), /ls1/, 'its owner still sees it');
		assert.equal((await asChannel('PATCH', '/api/live-streams/ls1')).status, 403);
		liveApp(OWNER);
		const direct = await liveRequest('PATCH', '/api/live-streams/ls1', { status: 'live' });
		assert.equal(direct.status, 403, 'going live is refused without the channel header too');
		assert.equal(((await direct.json()) as any).code, 'channel_suspended');

		const upload = await asChannel('POST', '/api/videos/upload/initiate');
		assert.equal(upload.status, 403);
		assert.equal(((await upload.json()) as any).code, 'channel_suspended');
		const post = await asChannel('POST', '/api/community/channels/ch1/posts', { type: 'text', content: 'hello' });
		assert.equal(post.status, 403);
		assert.equal(((await post.json()) as any).code, 'channel_suspended');
		assert.equal((await asChannel('POST', '/api/videos/v1/watch-time')).status, 200, 'watching still works');
		assert.equal((await asChannel('DELETE', '/api/videos/v1')).status, 200, 'deleting their own video still works');

		await call('POST', '/channels/ch1/unsuspend');
		assert.equal((await asChannel('POST', '/api/videos/upload/initiate')).status, 200);
		assert.match(await liveIds(null), /ls1/, 'unsuspend restores the live stream');
	});

	it('which channel requests count as publishing', () => {
		for (const [method, path] of [['POST', '/api/videos'], ['POST', '/api/videos/upload'], ['POST', '/api/videos/upload/batch/initiate'], ['POST', '/api/videos/tus'], ['PATCH', '/api/videos/tus/abc'], ['POST', '/api/videos/v1/publish-now'], ['PATCH', '/api/videos/v1/schedule'], ['POST', '/api/live-streams'], ['PATCH', '/api/live-streams/ls1'], ['POST', '/api/playlists'], ['POST', '/api/community/media/upload/images']]) {
			assert.equal(channelRefusesWrite(method, path), true, `${method} ${path}`);
		}
		for (const [method, path] of [['GET', '/api/videos'], ['DELETE', '/api/videos/v1'], ['POST', '/api/videos/v1/likes'], ['POST', '/api/videos/v1/comments'], ['PUT', '/api/videos/v1'], ['POST', '/api/watch-history']]) {
			assert.equal(channelRefusesWrite(method, path), false, `${method} ${path}`);
		}
	});

	it('edits name, handle and description, and refuses a taken handle', async () => {
		const { raw, call } = await setup({
			channels: { ch1: channel('ch1'), ch2: channel('ch2', { userId: OTHER, handle: 'taken', isMain: true }) },
		});
		await raw.channel_tabs.put('channel-handles/taken', JSON.stringify({ handle: 'taken', channelId: 'ch2', userId: OTHER }));
		const edited = await call('PATCH', '/channels/ch1', { name: 'New name', handle: 'newhandle', description: 'About' });
		assert.equal(edited.status, 200);
		const stored = JSON.parse(raw.channels.store.get('ch1')!);
		assert.deepEqual([stored.name, stored.handle, stored.description], ['New name', 'newhandle', 'About']);
		assert.ok(raw.channel_tabs.store.has('channel-handles/newhandle'));
		const refused = await call('PATCH', '/channels/ch1', { handle: 'taken' });
		assert.equal(refused.status, 409);
		assert.equal(refused.body.code, 'handle_unavailable');
		assert.equal((await call('PATCH', '/channels/ch1', { isVerified: true })).status, 400, 'unknown fields are refused');
	});

	it('transfers a channel with its videos to another videos user', async () => {
		const { raw, call, jobOf } = await setup();
		const res = await call('POST', '/channels/ch1/transfer', { newOwnerId: OTHER });
		assert.equal(res.status, 200);
		const job = await jobOf(res);
		assert.equal(job.status, 'succeeded');
		assert.equal(job.result.previousOwnerId, OWNER);
		assert.equal(job.result.videos, 2);
		assert.equal(JSON.parse(raw.channels.store.get('ch1')!).userId, OTHER);
		assert.equal(JSON.parse(raw.videos.store.get('v1')!).userId, OTHER);
		assert.deepEqual(JSON.parse(raw.profiles.store.get(OTHER)!).channels, ['ch1']);
		assert.deepEqual(JSON.parse(raw.profiles.store.get(OWNER)!).channels, []);
		assert.equal((await call('POST', '/channels/ch1/transfer', { newOwnerId: 'usr_nobody' })).status, 404);
		assert.equal((await call('POST', '/channels/ch1/transfer', { newOwnerId: OTHER })).body.code, 'already_owner');
	});

	it('transfer takes a user id only and refuses missing, deleted and banned users', async () => {
		const { call, raw } = await setup({
			profiles: {
				[OWNER]: profile(OWNER, { channels: ['ch1'] }),
				[OTHER]: profile(OTHER),
				usr_gone: profile('usr_gone', { isDeleted: true }),
				usr_banned: profile('usr_banned'),
			},
		});
		const byEmail = await call('POST', '/channels/ch1/transfer', { newOwnerId: `${OTHER}@example.com` });
		assert.equal(byEmail.status, 400);
		assert.equal(byEmail.body.code, 'invalid_new_owner', 'an email is not an owner id');
		assert.equal((await call('POST', '/channels/ch1/transfer', { newOwnerId: '@handle' })).body.code, 'invalid_new_owner');
		assert.equal((await call('POST', '/channels/ch1/transfer', { newOwnerId: '' })).status, 400);
		assert.equal((await call('POST', '/channels/ch1/transfer', { newOwnerId: 'usr_gone' })).body.code, 'new_owner_not_found');
		await call('POST', '/users/usr_banned/ban', { reason: 'Abuse' });
		const banned = await call('POST', '/channels/ch1/transfer', { newOwnerId: 'usr_banned' });
		assert.equal(banned.status, 409);
		assert.equal(banned.body.code, 'new_owner_banned');
		assert.equal(JSON.parse(raw.channels.store.get('ch1')!).userId, OWNER, 'nothing moved');
		const trimmed = await call('POST', '/channels/ch1/transfer', { newOwnerId: ` ${OTHER} ` });
		assert.equal(trimmed.status, 200);
		assert.equal(JSON.parse(raw.channels.store.get('ch1')!).userId, OTHER);
	});

	it('user search stays cheap: exact matches and channel handles use indexes, never a full scan (TRANSFER-01)', async () => {
		const { db, call } = await setup();
		const plan = (sql: string) => (db.db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all() as Array<{ detail: string }>).map((r) => r.detail).join(' | ');
		const bound = (sql: string, values: string[]) => values.reduce((q, v, i) => q.replaceAll(`?${i + 1}`, v), sql);
		const exact = plan(bound(PROFILE_EXACT_SQL, ["'usr_x'", "'x@example.com'", '5']));
		assert.match(exact, /idx_content_ownership_email_lower/, exact);
		assert.match(exact, /idx_content_ownership_handle_lower/, exact);
		assert.doesNotMatch(exact, /SCAN (content_ownership|p)\b/, exact);
		const handles = plan(bound(CHANNEL_HANDLE_PREFIX_SQL, ["'ab'", '5']));
		assert.match(handles, /idx_content_ownership_handle_lower/, handles);
		// Behaviour the picker relies on: an exact email answers alone; a soft-deleted user is never offered
		assert.deepEqual((await call('GET', `/users/search?q=${encodeURIComponent(`${OTHER}@example.com`)}`)).body.result.items.map((u: { id: string }) => u.id), [OTHER]);
		await call('POST', `/users/${OTHER}/delete-data`, {});
		assert.deepEqual((await call('GET', `/users/search?q=${encodeURIComponent(`${OTHER}@example.com`)}`)).body.result.items, []);
	});

	it('user search finds users by email, name, @handle, channel @handle and id, without the excluded owner', async () => {
		const { call } = await setup({
			profiles: {
				[OWNER]: profile(OWNER, { channels: ['ch1', 'ch2'], email: 'owner@example.com', displayName: 'Owner Person' }),
				usr_amina: profile('usr_amina', { email: 'amina@example.com', displayName: 'Amina Yusuf', userName: 'aminay' }),
				usr_bilal: profile('usr_bilal', { email: 'bilal@example.com', displayName: 'Bilal Ahmed', userName: 'bilal', channels: ['ch3'] }),
			},
			channels: {
				ch1: channel('ch1', { handle: 'owners-main' }),
				ch2: channel('ch2', { handle: 'owners-second', isMain: false }),
				ch3: channel('ch3', { userId: 'usr_bilal', handle: 'nasheeds', members: [{ userId: 'usr_amina', role: 'editor' }] }),
			},
			videos: {},
		});
		const search = async (q: string, extra = '') => (await call('GET', `/users/search?q=${encodeURIComponent(q)}${extra}`)).body.result.items as any[];
		assert.deepEqual((await search('amina@example.com')).map((u) => u.id), ['usr_amina'], 'by email');
		assert.deepEqual((await search('Bilal')).map((u) => u.id), ['usr_bilal'], 'by name');
		assert.deepEqual((await search('@aminay')).map((u) => u.id), ['usr_amina'], 'by user @handle');
		assert.deepEqual((await search('@nasheeds')).map((u) => u.id), ['usr_bilal'], 'by channel @handle');
		assert.deepEqual((await search('usr_bilal')).map((u) => u.id), ['usr_bilal'], 'by id');
		assert.deepEqual(await search('a'), [], 'one character finds nothing');
		assert.deepEqual(await search('@'), []);
		const all = await search('example.com', `&exclude=${OWNER}&channelId=ch3`);
		assert.deepEqual(all.map((u) => u.id).sort(), ['usr_amina', 'usr_bilal'], 'the excluded owner is left out');
		const amina = all.find((u) => u.id === 'usr_amina');
		const bilal = all.find((u) => u.id === 'usr_bilal');
		assert.equal(amina.channelRole, 'editor', "the user's role on the channel");
		assert.equal(amina.channelCount, 0);
		assert.equal(bilal.channelCount, 1);
		assert.equal(bilal.email, 'bilal@example.com');
		assert.equal((await search('owner@example.com'))[0].channelCount, 2);
		const banned = await call('POST', '/users/usr_bilal/ban', {});
		assert.equal(banned.status, 200);
		assert.equal((await search('bilal@example.com'))[0].isBanned, true, 'banned users are listed as such');
	});

	it('delete soft-deletes the channel (hidden, restorable); the purge erases its videos and frees the handle', async () => {
		const { env, raw, db, call, purgeNow } = await setup();
		const visitor = publicApp(env, null);
		await raw.channel_tabs.put('channel-handles/ch1', JSON.stringify({ handle: 'ch1', channelId: 'ch1', userId: OWNER }));
		const res = await call('DELETE', '/channels/ch1', { reason: 'Spam' });
		assert.equal(res.status, 200);
		assert.equal(res.body.result.deletion.status, 'deleted');
		assert.equal(res.body.result.deletion.reason, 'Spam');
		const stored = JSON.parse(raw.channels.store.get('ch1')!);
		assert.equal(stored.isDeleted, true);
		assert.equal(stored.deletedBy, 'usr_admin');
		assert.equal(raw.videos.store.has('v1'), true, 'nothing erased at delete time');
		assert.equal(raw.channel_tabs.store.has('channel-handles/ch1'), true, 'the handle stays reserved while restorable');
		assert.equal((await visitor('GET', '/api/channels/ch1')).status, 404);
		assert.equal((await visitor('GET', '/api/videos/v1')).status, 404, 'its videos are hidden with it');
		assert.equal(bunny.calls.length, 0);

		const job = await purgeNow('channel', 'ch1');
		assert.equal(job.kind, 'channel.purge');
		assert.equal(job.status, 'succeeded');
		assert.equal(raw.channels.store.has('ch1'), false, 'the record itself is purged');
		assert.equal(raw.videos.store.has('v1'), false);
		assert.equal(raw.videos.store.has('v2'), false);
		assert.equal(raw.channel_tabs.store.has('channel-handles/ch1'), false);
		assert.equal((db.db.prepare("SELECT COUNT(*) AS n FROM content_ownership WHERE kind = 'video' AND channel_id = 'ch1'").get() as any).n, 0);
		assert.equal((await call('GET', '/channels')).body.result.total, 0);
		assert.equal(raw.queue.messages.filter((m: any) => m.type === MessageType.VideoDelete).length, 2, 'one VideoDelete per erased video');
		assert.ok(bunny.calls.includes('DELETE /library/7/videos/v1') && bunny.calls.includes('DELETE /library/7/videos/v2'), 'media erased from Bunny');
	});
	it('purge scans the playlists in bounded steps and removes only the channel\'s, however many there are', async () => {
		// 1,200 playlists (more than two scan steps), three of them ch1's, spread across the steps
		const playlists: Record<string, unknown> = {};
		for (let i = 0; i < 1200; i++) {
			const id = `pl${String(i).padStart(4, '0')}`;
			playlists[id] = { id, title: id, userId: OTHER, channelId: [5, 600, 1199].includes(i) ? 'ch1' : 'ch-other', videos: [] };
		}
		const { raw, call, purgeNow } = await setup({ playlists });
		const res = await call('DELETE', '/channels/ch1');
		assert.equal(res.status, 200);
		await purgeNow('channel', 'ch1');
		const jobs = (await call('GET', '/jobs?targetId=ch1')).body.result.items;
		const purge = jobs.find((j: any) => j.kind === 'channel.purge');
		assert.equal(purge.status, 'succeeded');
		assert.equal(purge.result.playlists, 3);
		assert.equal(purge.result.scanned, 1200, 'every playlist object scanned, none cut off');
		for (const id of ['pl0005', 'pl0600', 'pl1199']) assert.equal(raw.playlists.store.has(id), false, id);
		assert.equal(JSON.parse(raw.playlists.store.get('pl0006')!).isDeleted, undefined, 'other channels\' playlists untouched');
		assert.equal(raw.queue.messages.filter((m: any) => m.type === MessageType.ChannelDelete).length, 1, 'ChannelDelete sent once, at the end');
	});

	it('a failed playlist write retries its own step, then the purge finishes', async () => {
		const playlists: Record<string, unknown> = { a: { id: 'a', title: 'a', channelId: 'ch1', videos: [] }, b: { id: 'b', title: 'b', channelId: 'ch1', videos: [] } };
		const { raw, call, purgeNow } = await setup({ playlists });
		const remove = raw.playlists.delete.bind(raw.playlists);
		let failOnce = true;
		raw.playlists.delete = (async (keys: string | string[]) => {
			if (keys === 'b' && failOnce) { failOnce = false; throw new Error('R2 delete failed'); }
			return remove(keys);
		}) as any;
		await call('DELETE', '/channels/ch1');
		await purgeNow('channel', 'ch1');
		const purge = (await call('GET', '/jobs?targetId=ch1')).body.result.items.find((j: any) => j.kind === 'channel.purge');
		assert.equal(purge.status, 'succeeded');
		assert.ok(purge.attempts >= 2, 'the failed step was retried');
		assert.equal(raw.playlists.store.has('a'), false);
		assert.equal(raw.playlists.store.has('b'), false);
	});
});

describe('video actions', () => {
	it('edit, move, unpublish/republish and delete', async () => {
		const { env, raw, call, purgeNow } = await setup({
			channels: { ch1: channel('ch1'), ch2: channel('ch2', { userId: OTHER, isMain: true }) },
		});
		const visitor = publicApp(env, null);
		assert.equal((await call('PATCH', '/videos/v1', { title: 'Renamed', isPublic: false })).status, 200);
		let v1 = JSON.parse(raw.videos.store.get('v1')!);
		assert.deepEqual([v1.title, v1.isPublic], ['Renamed', false]);

		await call('POST', '/videos/legacy/move', { channelId: 'ch2' });
		const legacy = JSON.parse(raw.videos.store.get('legacy')!);
		assert.deepEqual([legacy.channelId, legacy.userId], ['ch2', OTHER]);
		assert.equal((await call('GET', '/videos?channelId=ch2')).body.result.total, 1);

		await call('PATCH', '/videos/v1', { isPublic: true });
		await call('POST', '/videos/v1/unpublish');
		assert.equal((await visitor('GET', '/api/videos/v1')).status, 404);
		await call('POST', '/videos/v1/republish');
		assert.equal((await visitor('GET', '/api/videos/v1')).status, 200);

		assert.equal((await call('DELETE', '/videos/v1')).status, 200);
		assert.equal(JSON.parse(raw.videos.store.get('v1')!).isDeleted, true, 'soft: kept until the cleanup');
		assert.equal((await call('GET', '/videos/v1')).body.result.isDeleted, true, 'the admin detail shows it as deleted');
		assert.equal((await visitor('GET', '/api/videos/v1')).status, 404);
		assert.equal((await purgeNow('video', 'v1')).status, 'succeeded');
		assert.equal(raw.videos.store.has('v1'), false);
		v1 = null;
	});
});

describe('comments index', () => {
	it('mirrors video comments for the global list, and admin deletes them', async () => {
		const { env, call } = await setup();
		const withComments = videoFixture({
			id: 'v1', userId: OWNER, channelId: 'ch1',
			comments: [commentFixture('c1', { text: 'JazakAllah khair', userId: OTHER, replies: [commentFixture('r1', { text: 'Ameen', parentCommentId: 'c1' })] })],
		});
		await env.videos.put('v1', JSON.stringify(withComments));
		const listed = (await call('GET', '/comments?q=jazak')).body.result;
		assert.deepEqual(listed.items.map((c: any) => [c.id, c.videoId, c.userId, c.videoTitle]), [['c1', 'v1', OTHER, 'Video']]);
		assert.equal((await call('GET', '/comments?videoId=v1')).body.result.total, 2);
		assert.equal((await call('DELETE', '/videos/v1/comments/r1')).status, 200);
		assert.equal((await call('GET', '/comments?videoId=v1')).body.result.total, 1);
		assert.equal((await call('DELETE', '/videos/v1/comments/r1')).status, 404);
	});

	it('signature changes only when comments change', () => {
		const a = projectComments(videoFixture({ comments: [commentFixture('c1')] }));
		const b = projectComments(videoFixture({ comments: [commentFixture('c1')], views: 99 }));
		const c = projectComments(videoFixture({ comments: [commentFixture('c1', { text: 'edited' })] }));
		assert.equal(commentSignature(a), commentSignature(b));
		assert.notEqual(commentSignature(a), commentSignature(c));
	});
});

describe('videos bans (users)', () => {
	it('a user\'s page answers from the ownership index while a pass rebuilds it, never scanning the buckets (INV-01)', async () => {
		const { db, raw, call } = await setup();
		// The state QA was in on 2026-11-11 (#860): the video and channel passes not marked complete
		for (const kind of ['video', 'channel'] as const) db.db.prepare('DELETE FROM search_meta WHERE key = ?').run(ownershipCompleteKey(kind));
		let listed = 0;
		for (const bucket of [raw.videos, raw.channels]) {
			const list = bucket.list.bind(bucket);
			bucket.list = (async (...args: Parameters<typeof list>) => {
				listed += 1;
				return list(...args);
			}) as typeof bucket.list;
		}
		const res = await call('GET', `/users/${OWNER}`);
		assert.equal(res.status, 200, JSON.stringify(res.body));
		const detail = res.body.result;
		assert.deepEqual(detail.channels.map((c: { id: string }) => c.id), ['ch1'], 'the owned channel, from the index');
		assert.equal(detail.counts.videos, 2, 'video count, from the index');
		assert.equal(listed, 0, 'no full listing of the videos or channels bucket on a read');
	});

	it('blocks a banned user\'s writes and profile, keeps public reads, and hides their content', async () => {
		const { env, raw, call, jobOf } = await setup();
		const banned = publicApp(env, OWNER);
		const visitor = publicApp(env, null);
		const res = await call('POST', `/users/${OWNER}/ban`, { reason: 'Abuse' });
		assert.equal(res.status, 200);
		assert.equal(res.body.result.ban.reason, 'Abuse');
		const job = await jobOf(res);
		assert.equal(job.kind, 'user.sync-holds');
		assert.equal(job.result.channels, 1);
		forgetCachedBan(OWNER);

		const comment = await banned('POST', '/api/videos/legacy/comments', { text: 'hi' }, { channelId: 'ch1' });
		assert.equal(comment.status, 403);
		assert.equal(((await comment.json()) as any).code, VIDEOS_BANNED_CODE);
		const me = await banned('GET', '/api/profile');
		assert.equal(me.status, 403);
		assert.equal(((await me.json()) as any).ban.reason, 'Abuse');
		assert.equal((await banned('GET', '/api/videos/legacy')).status, 200, 'public reads still work');
		assert.equal((await visitor('GET', '/api/channels/ch1')).status, 404, 'their channel is hidden');
		assert.equal((await visitor('GET', '/api/videos/v1')).status, 404, 'their videos are hidden');

		const detail = (await call('GET', `/users/${OWNER}`)).body.result;
		assert.equal(detail.isBanned, true);
		assert.equal(detail.ban.bannedBy, 'usr_admin');
		assert.equal(detail.channels.length, 1);

		await call('POST', `/users/${OWNER}/unban`);
		forgetCachedBan(OWNER);
		assert.equal((await banned('GET', '/api/profile')).status, 200);
		assert.equal((await visitor('GET', '/api/channels/ch1')).status, 200);
		assert.equal(JSON.parse(raw.videos.store.get('v2')!).isHidden, true, 'moderation hide kept');
	});

	it('deleting a user\'s videos data removes it; they start fresh unless banned, and the ban survives', async () => {
		const { env, raw, call, jobOf, purgeNow } = await setup();
		const erased = await call('POST', `/users/${OTHER}/delete-data`, {});
		assert.equal(erased.status, 200);
		assert.equal((await jobOf(erased)).kind, 'user.sync-holds', 'soft: their content is only hidden');
		assert.equal(raw.profiles.store.has(OTHER), true);
		assert.equal((await call('GET', `/users?q=${OTHER}@`)).body.result.total, 0, 'listed under Recently deleted instead');
		assert.equal((await purgeNow('user', OTHER)).status, 'succeeded');
		assert.equal(raw.profiles.store.has(OTHER), false);
		const fresh = publicApp(env, OTHER);
		assert.equal((await fresh('GET', '/api/profile')).status, 404, 'no profile: the web app offers to create one');
		const created = await fresh('POST', '/api/profiles', { email: `${OTHER}@example.com`, userName: 'again', displayName: 'Again', timezone: 'UTC' });
		assert.ok(created.status < 300, `a fresh profile can be created (${created.status})`);

		await call('POST', `/users/${OWNER}/ban`, { reason: 'Spam' });
		await call('POST', `/users/${OWNER}/delete-data`, {});
		const erasedOwner = await purgeNow('user', OWNER);
		assert.equal(erasedOwner.status, 'succeeded');
		assert.equal(erasedOwner.result.deletedVideos, 2);
		assert.equal(raw.profiles.store.has(OWNER), false);
		assert.equal(raw.videos.store.has('v1'), false);
		forgetCachedBan(OWNER);
		const comeback = publicApp(env, OWNER);
		const retry = await comeback('POST', '/api/profiles', { email: `${OWNER}@example.com`, userName: 'back', displayName: 'Back', timezone: 'UTC' });
		assert.equal(retry.status, 403, 'a deleted and banned user cannot come back');
		const users = (await call('GET', '/users?banned=yes')).body.result.items;
		assert.deepEqual(users.map((u: any) => [u.id, u.isBanned, u.profileDeleted]), [[OWNER, true, true]]);
		assert.equal((await call('GET', `/users/${OWNER}`)).body.result.ban.reason, 'Spam');
	});

	it('which requests a banned user may still make', () => {
		assert.equal(isBlockedForBannedUser('GET', '/api/videos/v1'), false);
		assert.equal(isBlockedForBannedUser('GET', '/api/profile'), true);
		assert.equal(isBlockedForBannedUser('DELETE', '/api/privacy/data'), false);
		assert.equal(isBlockedForBannedUser('POST', '/api/videos/upload/initiate'), true);
		assert.equal(isBlockedForBannedUser('PUT', '/api/channels/ch1'), true);
	});
});

describe('users list', () => {
	it('searches videos profiles by name, user name and email', async () => {
		const { call } = await setup();
		assert.deepEqual((await call('GET', `/users?q=${OTHER}@`)).body.result.items.map((u: any) => u.id), [OTHER]);
		assert.equal((await call('GET', '/users')).body.result.total, 2);
		assert.equal((await call('PATCH', `/users/${OTHER}`, { displayName: 'Renamed' })).status, 200);
		assert.deepEqual((await call('GET', '/users?q=renamed')).body.result.items.map((u: any) => u.id), [OTHER]);
	});
});

describe('admin jobs (queue, retry, DLQ)', () => {
	it('a failing job retries with backoff, then fails, dead-letters and flags the admin; Retry finishes it', async () => {
		const { raw, call, jobs, cleanup, db } = await setup();
		bunny.status = 500;
		try {
			const res = await call('DELETE', '/videos/v1');
			assert.equal(res.status, 200);
			assert.equal((await call('GET', '/videos/v1')).body.result.isDeleted, true, 'marked deleted at once');
			await call('POST', '/deletions/video/v1/purge');
			const runs = await cleanup();
			assert.equal(runs.second.failed, 1, 'the cleanup sees the failed purge job and retries it next run');
			const failed = (await call('GET', '/jobs?targetKind=video&targetId=v1')).body.result.items[0];
			assert.equal(failed.status, 'failed');
			assert.equal(failed.attempts, MAX_RETRIES + 1);
			assert.match(failed.lastError, /Bunny Stream delete failed/);
			assert.deepEqual(jobs.delays, [10, 20, 40, 80, 160, 300], 'exponential backoff, capped');
			assert.equal(jobs.dlq.length, 1, 'the last delivery goes to the DLQ');
			assert.equal((jobs.dlq[0] as any).type, MessageType.AdminJob);
			assert.deepEqual((await call('GET', '/jobs/counts')).body.result, { failed: 1, retrying: 0 });
			assert.deepEqual((await call('GET', '/jobs?status=failed')).body.result.items.map((j: any) => j.id), [failed.id]);
			assert.deepEqual((await call('GET', '/jobs?targetKind=video&targetId=v1')).body.result.items.map((j: any) => j.status), ['failed']);
		} finally {
			bunny.status = 200;
		}
		const failedId = (await call('GET', '/jobs?status=failed')).body.result.items[0].id;
		const retried = await call('POST', `/jobs/${failedId}/retry`);
		assert.equal(retried.status, 200);
		const done = (await call('GET', `/jobs/${failedId}`)).body.result;
		assert.equal(done.status, 'succeeded');
		assert.equal(done.lastError, null);
		assert.equal(raw.videos.store.has('v1'), false);
		await cleanup();
		assert.ok((db.db.prepare("SELECT purged_at FROM admin_deletions WHERE kind = 'video' AND target_id = 'v1'").get() as any).purged_at, 'the cleanup records the purge');
		assert.equal((await call('POST', `/jobs/${failedId}/retry`)).body.code, 'job_not_failed', 'only failed jobs retry');
		assert.equal((await call('GET', '/jobs/nope')).status, 404);
	});

	it('a video already gone from Bunny counts as erased', async () => {
		const { call, purgeNow } = await setup();
		bunny.status = 404;
		try {
			await call('DELETE', '/videos/v1');
			assert.equal((await purgeNow('video', 'v1')).status, 'succeeded');
		} finally {
			bunny.status = 200;
		}
	});

	it('when the queue refuses, the job is failed at once (visible, retryable)', async () => {
		const { env, call, jobs } = await setup();
		jobs.refuse = true;
		const res = await call('POST', '/channels/ch1/suspend', { reason: 'x' });
		assert.equal(res.status, 200);
		assert.equal(res.body.result.job.status, 'failed');
		assert.match(res.body.result.job.lastError, /Could not queue the job/);
		jobs.refuse = false;
		const visitor = publicApp(env, null);
		assert.equal((await visitor('GET', '/api/videos/v1')).status, 200, 'the cascade has not run');
		await call('POST', `/jobs/${res.body.result.job.id}/retry`);
		assert.equal((await visitor('GET', '/api/videos/v1')).status, 404, 'Retry runs it');
	});

	it('suspend then unsuspend converge whatever order their jobs run in', async () => {
		const { env, call, jobs } = await setup();
		const visitor = publicApp(env, null);
		await call('POST', '/channels/ch1/suspend', { reason: 'x' }, { hold: true });
		await call('POST', '/channels/ch1/unsuspend', undefined, { hold: true });
		await jobs.drain(env, { reverse: true });
		assert.equal((await visitor('GET', '/api/videos/v1')).status, 200);
		assert.equal((await visitor('GET', '/api/channels/ch1')).status, 200);
	});

	it('a resumable job queues its next step with the new params and keeps its result', async () => {
		const { env, jobs, call } = await setup();
		const steps: unknown[] = [];
		const created = await createJob(env as never, { kind: 'user.delete-data', targetKind: 'user', targetId: OTHER, actorId: 'usr_admin' });
		const id = created.id;
		jobs.pending.splice(0);
		await jobs.send({ id: 'm', type: MessageType.AdminJob, payload: { jobId: id }, timestamp: 0 });
		const handlers = {
			'user.delete-data': async (_env: unknown, job: any) => {
				steps.push(job.params.resumeToken ?? null);
				const n = Number(job.result?.n ?? 0) + 1;
				return n < 3 ? { done: false as const, params: { resumeToken: `t${n}` }, result: { n } } : { done: true as const, result: { n } };
			},
		};
		for (let i = 0; i < 5 && jobs.pending.length; i++) {
			const d = jobs.pending.shift()!;
			await handleAdminJobBatch({ messages: [{ body: d.body, attempts: 1, ack() {}, retry() {} }] }, env as never, handlers);
		}
		assert.deepEqual(steps, [null, 't1', 't2']);
		const job = (await call('GET', `/jobs/${id}`)).body.result;
		assert.equal(job.status, 'succeeded');
		assert.deepEqual(job.result, { n: 3 });
	});

	it('backoff doubles from 10s and caps at 5 minutes', () => {
		assert.deepEqual([1, 2, 3, 4, 5, 6, 9].map(backoffSeconds), [10, 20, 40, 80, 160, 300, 300]);
	});
});

describe('soft deletes (Recently deleted, restore, cleanup)', () => {
	const DAY = 86_400_000;

	it('helpers: purge is due after 30 days or once queued; days left count down', () => {
		const deletedAt = '2026-11-01T00:00:00.000Z';
		const at = Date.parse(deletedAt);
		assert.equal(purgeAfterOf(deletedAt), '2026-12-01T00:00:00.000Z');
		assert.equal(deletionDaysLeft({ deletedAt }, at), 30);
		assert.equal(deletionDaysLeft({ deletedAt }, at + 29.5 * DAY), 1);
		assert.equal(deletionDaysLeft({ deletedAt }, at + 31 * DAY), 0);
		assert.equal(isPurgeDue({ deletedAt, purgeRequestedAt: null, purgedAt: null }, at + 29 * DAY), false);
		assert.equal(isPurgeDue({ deletedAt, purgeRequestedAt: null, purgedAt: null }, at + 30 * DAY), true);
		assert.equal(isPurgeDue({ deletedAt, purgeRequestedAt: deletedAt, purgedAt: null }, at), true, 'queued: due now');
		assert.equal(isPurgeDue({ deletedAt, purgeRequestedAt: deletedAt, purgedAt: deletedAt }, at + 99 * DAY), false, 'purged: never again');
		assert.equal(deletionStatusOf({ purgeRequestedAt: null, purgeStartedAt: null, purgedAt: null }), 'deleted');
		assert.equal(deletionStatusOf({ purgeRequestedAt: 'x', purgeStartedAt: null, purgedAt: null }), 'queued');
		assert.equal(deletionStatusOf({ purgeRequestedAt: 'x', purgeStartedAt: 'x', purgedAt: null }), 'purging');
	});

	it('the cleanup purges a video only after its 30 days, once, and Recently deleted lists it until then', async () => {
		const { raw, call, cleanup } = await setup();
		await call('DELETE', '/videos/v1', { reason: 'Copyright' });
		const listed = (await call('GET', '/deletions?kind=video')).body.result;
		assert.deepEqual(listed.items.map((d: any) => [d.id, d.status, d.deletedBy, d.reason]), [['v1', 'deleted', 'usr_admin', 'Copyright']]);
		assert.equal((await call('GET', '/deletions?kind=channel')).body.result.items.length, 0);

		const early = await cleanup(Date.now() + 29 * DAY);
		assert.equal(early.first.due, 0, 'not due before 30 days');
		assert.equal(raw.videos.store.has('v1'), true);

		const late = await cleanup(Date.now() + 31 * DAY);
		assert.deepEqual([late.first.started, late.second.purged], [1, 1]);
		assert.equal(raw.videos.store.has('v1'), false);
		assert.equal((await call('GET', '/deletions')).body.result.items.length, 0, 'purged items leave the list');
		assert.ok((await call('GET', '/deletions')).body.result.lastRun.at, 'the last run is shown');

		const again = await cleanup(Date.now() + 40 * DAY);
		assert.equal(again.first.due, 0, 'idempotent: nothing left to do');
	});

	it('restore brings a video back everywhere; a second restore is 404', async () => {
		const { env, raw, call } = await setup();
		const visitor = publicApp(env, null);
		await call('DELETE', '/videos/v1');
		assert.equal((await visitor('GET', '/api/videos/v1')).status, 404);
		assert.equal((await call('GET', '/videos?q=tafsir')).body.result.total, 0, 'not in admin lists');
		const restored = await call('POST', '/deletions/video/v1/restore');
		assert.equal(restored.status, 200);
		assert.equal((await visitor('GET', '/api/videos/v1')).status, 200);
		const v1 = JSON.parse(raw.videos.store.get('v1')!);
		assert.deepEqual([v1.isDeleted, v1.isHidden, v1.adminDeletion, v1.suspensionHolds], [false, false, undefined, undefined]);
		assert.equal((await call('GET', '/videos?q=tafsir')).body.result.total, 1);
		assert.equal((await call('POST', '/deletions/video/v1/restore')).status, 404);
	});

	it('a moderation-hidden video stays hidden after delete and restore', async () => {
		const { raw, call } = await setup();
		await call('DELETE', '/videos/v2');
		await call('POST', '/deletions/video/v2/restore');
		assert.equal(JSON.parse(raw.videos.store.get('v2')!).isHidden, true);
	});

	it('"Delete permanently now" only queues it: still restorable until the cleanup starts the purge', async () => {
		const { raw, call, cleanup, jobs, env } = await setup();
		await call('DELETE', '/videos/v1');
		const queued = await call('POST', '/deletions/video/v1/purge');
		assert.equal(queued.body.result.deletion.status, 'queued');
		assert.equal(queued.body.result.deletion.purgeRequestedBy, 'usr_admin');
		assert.equal(raw.videos.store.has('v1'), true, 'nothing erased by the request itself');
		assert.equal((await call('POST', '/deletions/video/v1/restore')).status, 200, 'restorable while queued');
		assert.equal((await cleanup()).first.due, 0, 'a restored item is not purged');
		assert.equal(raw.videos.store.has('v1'), true);

		// Once a run has started the purge, restore is refused
		await call('DELETE', '/videos/v1');
		await call('POST', '/deletions/video/v1/purge');
		await runDeletionCleanup(env as never, (d) => purgeDeletion(env as never, d));
		const refused = await call('POST', '/deletions/video/v1/restore', undefined, { hold: true });
		assert.equal(refused.status, 409);
		assert.equal(refused.body.code, 'purge_in_progress');
		await jobs.drain(env);
		assert.equal(raw.videos.store.has('v1'), false);
	});

	it('a failed inline purge is counted and retried next run', async () => {
		const { raw, call, cleanup, db } = await setup({ playlists: { pl1: { id: 'pl1', title: 'Lessons', userId: OWNER, channelId: 'ch1', videos: [] } } });
		await call('DELETE', '/playlists/pl1');
		await call('POST', '/deletions/playlist/pl1/purge');
		const remove = raw.playlists.delete.bind(raw.playlists);
		raw.playlists.delete = (async () => { throw new Error('R2 delete failed'); }) as any;
		assert.equal((await cleanup()).first.failed, 1);
		const row = db.db.prepare("SELECT attempts, last_error, purged_at FROM admin_deletions WHERE kind = 'playlist'").get() as any;
		assert.deepEqual([row.attempts >= 1, /R2 delete failed/.test(row.last_error), row.purged_at], [true, true, null]);
		raw.playlists.delete = remove as any;
		assert.equal((await cleanup()).first.purged, 1);
		assert.equal(raw.playlists.store.has('pl1'), false);
	});

	it('comments: hidden at once, restorable, removed by the purge', async () => {
		const { env, raw, call, purgeNow } = await setup();
		await env.videos.put('v1', JSON.stringify(videoFixture({ id: 'v1', userId: OWNER, channelId: 'ch1', comments: [commentFixture('c1', { text: 'Salam', userId: OTHER })] })));
		await call('DELETE', '/videos/v1/comments/c1', { reason: 'Abuse' });
		let stored = JSON.parse(raw.videos.store.get('v1')!).comments[0];
		assert.deepEqual([stored.id, stored.isDeleted, stored.adminDeletion.reason], ['c1', true, 'Abuse']);
		assert.equal((await call('GET', '/comments?videoId=v1')).body.result.total, 0);
		const [row] = (await call('GET', '/deletions?kind=comment')).body.result.items;
		assert.deepEqual([row.id, row.parentId, row.title], ['c1', 'v1', 'Salam']);
		await call('POST', '/deletions/comment/c1/restore');
		stored = JSON.parse(raw.videos.store.get('v1')!).comments[0];
		assert.deepEqual([stored.isDeleted, stored.adminDeletion], [false, undefined]);
		assert.equal((await call('GET', '/comments?videoId=v1')).body.result.total, 1);
		await call('DELETE', '/videos/v1/comments/c1');
		await purgeNow('comment', 'c1');
		assert.equal(JSON.parse(raw.videos.store.get('v1')!).comments.length, 0);
	});

	it('playlists: hidden and off the channel, back on restore, gone after the purge', async () => {
		const { raw, call, purgeNow } = await setup({
			channels: { ch1: channel('ch1', { playlists: ['pl1'] }) },
			playlists: { pl1: { id: 'pl1', title: 'Lessons', userId: OWNER, channelId: 'ch1', videos: [] } },
		});
		await call('DELETE', '/playlists/pl1');
		assert.equal(canViewPlaylist(JSON.parse(raw.playlists.store.get('pl1')!), OWNER), false);
		assert.deepEqual(JSON.parse(raw.channels.store.get('ch1')!).playlists, []);
		assert.equal((await call('GET', '/playlists')).body.result.items.length, 0);
		await call('POST', '/deletions/playlist/pl1/restore');
		assert.equal(canViewPlaylist(JSON.parse(raw.playlists.store.get('pl1')!), OWNER), true);
		assert.deepEqual(JSON.parse(raw.channels.store.get('ch1')!).playlists, ['pl1']);
		await call('DELETE', '/playlists/pl1');
		await purgeNow('playlist', 'pl1');
		assert.equal(raw.playlists.store.has('pl1'), false);
	});

	it('community posts: restored in date order in the channel index; the purge removes the object', async () => {
		const { raw, call, purgeNow } = await setup();
		const post = (id: string, day: number) => ({ id, channelId: 'ch1', userId: OWNER, type: 'text', content: id, status: 'published', createdAt: `2026-03-0${day}T00:00:00.000Z` });
		for (const [id, day] of [['p1', 1], ['p2', 2], ['p3', 3]] as const) await raw.community_posts.put(`posts/ch1/${id}.json`, JSON.stringify(post(id, day)));
		await raw.community_posts.put('posts/ch1/index.json', JSON.stringify({ postIds: ['p3', 'p2', 'p1'], lastUpdated: 'x' }));
		await call('DELETE', '/posts/ch1/p2');
		assert.deepEqual(JSON.parse(raw.community_posts.store.get('posts/ch1/index.json')!).postIds, ['p3', 'p1']);
		assert.equal(JSON.parse(raw.community_posts.store.get('posts/ch1/p2.json')!).status, 'deleted');
		await call('POST', '/deletions/post/p2/restore');
		assert.deepEqual(JSON.parse(raw.community_posts.store.get('posts/ch1/index.json')!).postIds, ['p3', 'p2', 'p1']);
		assert.equal(JSON.parse(raw.community_posts.store.get('posts/ch1/p2.json')!).status, 'published');
		await call('DELETE', '/posts/ch1/p2');
		await purgeNow('post', 'p2');
		assert.equal(raw.community_posts.store.has('posts/ch1/p2.json'), false);
	});

	it('channels: restore puts it back on the profile as main, with its videos and playlists visible', async () => {
		const { env, raw, call } = await setup({
			channels: { ch1: channel('ch1', { playlists: ['pl1'] }) },
			playlists: { pl1: { id: 'pl1', title: 'Lessons', userId: OWNER, channelId: 'ch1', videos: [] } },
		});
		const visitor = publicApp(env, null);
		await call('DELETE', '/channels/ch1');
		assert.deepEqual(JSON.parse(raw.profiles.store.get(OWNER)!).channels, []);
		assert.equal(canViewPlaylist(JSON.parse(raw.playlists.store.get('pl1')!), OWNER), false, 'its playlists are hidden with it');
		assert.equal((await call('POST', '/deletions/channel/ch1/restore')).status, 200);
		assert.equal((await visitor('GET', '/api/channels/ch1')).status, 200);
		assert.equal((await visitor('GET', '/api/videos/v1')).status, 200);
		assert.equal((await visitor('GET', '/api/videos/v2')).status, 404, 'moderation-hidden video stays hidden');
		assert.deepEqual(JSON.parse(raw.profiles.store.get(OWNER)!).channels, ['ch1']);
		assert.equal(JSON.parse(raw.channels.store.get('ch1')!).isMain, true, 'main again: the owner has no other');
		assert.equal(canViewPlaylist(JSON.parse(raw.playlists.store.get('pl1')!), OWNER), true);
	});

	it('a suspended channel stays suspended through delete and restore', async () => {
		const { env, call } = await setup();
		const visitor = publicApp(env, null);
		await call('POST', '/channels/ch1/suspend', { reason: 'x' });
		await call('DELETE', '/channels/ch1');
		await call('POST', '/deletions/channel/ch1/restore');
		assert.equal((await visitor('GET', '/api/videos/v1')).status, 404, 'still held by the suspension');
		await call('POST', '/channels/ch1/unsuspend');
		assert.equal((await visitor('GET', '/api/videos/v1')).status, 200);
	});

	it('users: content hidden while deleted, back on restore; a second delete is refused', async () => {
		const { env, call } = await setup();
		const visitor = publicApp(env, null);
		await call('POST', `/users/${OWNER}/delete-data`, { reason: 'Request' });
		assert.equal((await call('POST', `/users/${OWNER}/delete-data`, {})).status, 409);
		assert.equal((await visitor('GET', '/api/channels/ch1')).status, 404);
		assert.equal((await visitor('GET', '/api/videos/v1')).status, 404);
		assert.equal((await call('POST', `/deletions/user/${OWNER}/restore`)).status, 200);
		assert.equal((await visitor('GET', '/api/channels/ch1')).status, 200);
		assert.equal((await visitor('GET', '/api/videos/v1')).status, 200);
		assert.equal((await call('GET', `/users?q=${OWNER}`)).body.result.total, 1);
	});

	it('Recently deleted pages with a cursor and rejects unknown kinds', async () => {
		const { call } = await setup();
		await call('DELETE', '/videos/v1');
		await call('DELETE', '/videos/legacy');
		const first = (await call('GET', '/deletions?pageSize=1')).body.result;
		assert.equal(first.items.length, 1);
		const second = (await call('GET', `/deletions?pageSize=1&cursor=${encodeURIComponent(first.nextCursor)}`)).body.result;
		assert.equal(second.items.length, 1);
		assert.notEqual(second.items[0].id, first.items[0].id);
		assert.equal(second.nextCursor, null);
		assert.equal((await call('GET', '/deletions?kind=bogus')).status, 400);
		assert.equal((await call('POST', '/deletions/bogus/x/restore')).status, 404);
	});
});
