/**
 * Platform content management (/internal/admin/*, lib/admin/*) and videos bans
 * (middleware/videos-ban.ts) over in-memory R2 and a real SQLite search DB.
 */
import { after, afterEach, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { fromHono } from 'chanfana';
import { API_ERROR_CATALOGUE, applySuspensionHold, deletionDaysLeft, deletionStatusOf, isPurgeDue, liftSuspensionHold, MessageType, purgeAfterOf, VIDEOS_ACCOUNT_PENDING_DELETION_CODE, VIDEOS_ACCOUNT_PENDING_DELETION_MESSAGE, VIDEOS_BANNED_CODE } from '@al-ummah/shared-types';
import { canViewPlaylist } from '../src/lib/playlists';
import { ownershipCompleteKey } from '@al-ummah/shared-types';
import { CHANNEL_HANDLE_PREFIX_SQL, LIVE_PROFILE_IDS_SQL, PROFILE_BY_EMAIL_SQL, PROFILE_BY_HANDLE_SQL, PROFILE_BY_ID_SQL } from '../src/lib/admin/userSearch';
import adminRouter from '../src/routers/admin.router';
import { withSearchSync } from '../src/lib/search/sync';
import { runOwnershipPass } from '../src/lib/search/ownership';
import { videosBanMiddleware, isBlockedForBannedUser } from '../src/middleware/videos-ban';
import { forgetCachedBan } from '../src/lib/admin/bans';
import { videosPendingDeletionMiddleware, isBlockedForPendingDeletion } from '../src/middleware/videos-pending-deletion';
import { cachedPendingUserDeletion, NOT_PENDING_CACHE_MS } from '../src/lib/admin/pendingUserDeletion';
import { handleCreatorAccess } from '../src/endpoints/creator/creatorAccess';
import { projectComments, commentSignature } from '../src/lib/admin/commentIndex';
import { ChannelFetch } from '../src/endpoints/channel/channelFetch';
import { ChannelsList } from '../src/endpoints/channel/channelList';
import { VideoFetch } from '../src/endpoints/video/videoFetch';
import { ProfileCreate } from '../src/endpoints/profile/profileCreate';
import { ProfileCurrentFetch } from '../src/endpoints/profile/profileCurrentFetch';
import { CommentCreate } from '../src/endpoints/video/commentCreate';
import { errorHandler } from '../src/middleware/error-handler';
import { ChannelMoveOfferCreate, ChannelMoveReceivers, ChannelMoveStateFetch, MOVE_ROUTE_CODES, MoveOfferAccept, MoveOfferCancel, MoveOfferDecline, MoveOfferFetch, MyMoveOffers } from '../src/endpoints/channel/channelMoveOffers';
import { authMiddleware, channelIdMiddleware, channelRefusesWrite } from '../src/middleware/auth';
import { errorEnvelope } from '../src/middleware/error-envelope';
import { __resetClientForTests } from '../src/lib/openauth-client';
import { clearRevocationCache } from '../src/lib/token-revocation';
import scholarsInternal from '../src/routers/scholars-internal.router';
import { SignJWT, exportJWK, generateKeyPair } from 'jose';
import { CreateCommunityPost } from '../src/endpoints/community/create-post';
import { LiveStreamsList } from '../src/endpoints/live/liveStreamsList';
import { LiveStreamUpdate } from '../src/endpoints/live/liveStreamUpdate';
import { MemoryBucket, MemoryQueue, buildApp, commentFixture, videoFixture } from './helpers';
import { LiveStreamStart } from '../src/endpoints/live/liveSession';
import { backoffSeconds, handleAdminJobBatch, retryJob, type JobMessage } from '../src/lib/admin/jobs';
import { ADMIN_JOB_HANDLERS, openTransferJob, purgeDeletion, REVERIFY_SQL, reverifyRecentTransfers, STARTED_JOB_SQL, TRANSFER_LOCK_SQL } from '../src/lib/admin/service';
import { createJob, getJob } from '../src/lib/admin/jobs';
import { runDeletionCleanup } from '../src/lib/admin/deletions';
import { SqliteD1 } from './search-sqlite-d1';
import { AuthDb } from './auth-db';
import { eraseMoveOffers, exportMoveOffers, RECEIVED_OFFERS_SQL, RUNNING_OFFERS_SQL } from '../src/lib/channelMoveData';
import { collectUserData, eraseUserData } from '../src/lib/privacy/user-data';
import { toPublicChannels } from '../src/lib/public-views';
import { ChannelOwnerFetch } from '../src/endpoints/channel/channelOwnerFetch';
import { ChannelUpdate } from '../src/endpoints/channel/channelUpdate';
import handleChannelAvatarUpdate from '../src/endpoints/channel/channelAvatarUpdate';
import handleChannelCoverUpdate from '../src/endpoints/channel/channelCoverUpdate';
import { footprintCompleteKey } from '../src/lib/privacy/footprints';
import { OperationBudget } from '../src/lib/privacy/scan';
import { channelMoveState, LAST_MOVE_SQL, offerViews, OPEN_OFFER_SQL, readOfferView } from '../src/lib/channelMoveViews';
import { memberMayActAs } from '../src/lib/channelAccess';
import { acceptMoveOffer, cancelMoveOffer, createMoveOffer, declineMoveOffer, moveReceivers, MoveError, myMoveOffers, stopMoveOffer, MOVE_OFFERS_PAGE, MY_OFFERS_SQL } from '../src/lib/channelMoves';
import { createSqliteD1 } from './sqlite-d1';
import { scheduleKey } from '../src/lib/videoSideRecords';

const OWNER = 'usr_owner';

/** Bunny Stream API stand-in: records calls; `bunny.status` makes deletes fail. */
const bunny = { calls: [] as string[], status: 200 };
const realFetch = globalThis.fetch;
before(() => {
	globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
		const url = String(input instanceof Request ? input.url : input);
		if (url.startsWith('https://admin.test/internal/channel-reports/')) return Response.json({ success: true, result: { underReview: false } });
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
async function setup(seed: { profiles?: Record<string, unknown>; channels?: Record<string, unknown>; videos?: Record<string, unknown>; playlists?: Record<string, unknown>; auth?: Record<string, string> } = {}) {
	const db = new SqliteD1();
	const profiles = seed.profiles ?? { [OWNER]: profile(OWNER, { channels: ['ch1'] }), [OTHER]: profile(OTHER) };
	const pending: Promise<unknown>[] = [];
	const raw = {
		SEARCH_DB: db,
		profiles: new MemoryBucket(profiles),
		// The accounts: each profile's own email unless the test gives others
		AUTH_DB: new AuthDb(seed.auth ?? Object.fromEntries(Object.entries(profiles).flatMap(([id, p]) => ((p as { email?: string }).email ? [[id, (p as { email: string }).email]] : [])))),
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
		// Owner moves ask admin-api about reports (lib/channelReportStatus.ts); the fetch stub above answers
		ADMIN_API_URL: 'https://admin.test',
		INTERNAL_API_KEY: 'k',
	};
	for (const kind of ['video', 'channel', 'profile', 'playlist'] as const) await runOwnershipPass(raw as never, kind, { maxPages: 10 });
	// Every seeded account may own channels (a move refuses a receiver with no room, CC-D12)
	for (const id of raw.profiles.store.keys()) {
		db.db.prepare(`INSERT OR IGNORE INTO creator_tier_assignments (user_id, tier_id, source, assigned_by, assigned_at) VALUES (?, 'unlimited', 'admin', 'test', '2026-01-01T00:00:00.000Z')`).run(id);
	}
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
	app.use('/api/*', videosPendingDeletionMiddleware);
	app.get('/api/me/creator', handleCreatorAccess);
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

	it('rows written before the admin columns: the list queues a rebuild (never in the request) and the public marker stays', async () => {
		const { db, call } = await setup();
		db.db.prepare("UPDATE content_ownership SET admin_title = NULL, admin_cols = 0 WHERE kind = 'video'").run();
		const first = (await call('GET', '/videos?q=seerah', undefined, { hold: true })).body.result;
		assert.equal(first.indexComplete, false);
		assert.ok(db.db.prepare("SELECT 1 FROM search_meta WHERE key = 'ownership:complete:v2:video'").get(), 'public readers keep the index');
		// The queued rebuild runs (call() drains the jobs queue), then the list is complete
		await call('GET', '/jobs?limit=1');
		const result = (await call('GET', '/videos?q=seerah')).body.result;
		assert.deepEqual(result.items.map((v: any) => v.id), ['v2']);
		assert.equal(result.indexComplete, true);
	});
});

describe('admin lists never wait for an index pass', () => {
	it('answers at once from the indexed rows, flagged incomplete, and queues the index rebuild job', async () => {
		const { db, env, app, jobs } = await setup({
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
		assert.ok(jobs.pending.length > 0, 'the rebuild job is queued; no pass runs in or after the request');
		await Promise.all(later.splice(0));
		await jobs.drain(env);
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

	it('moves every playlist of the channel, found by channel id; counts them the same way', async () => {
		const pl = (id: string, overrides: Record<string, unknown> = {}) => ({ id, title: id, userId: OWNER, channelId: 'ch1', videos: [], ...overrides });
		const { raw, db, call, jobOf } = await setup({
			playlists: {
				'pl-public': pl('pl-public'),
				'pl-private': pl('pl-private', { isPublic: false }),
				'pl-deleted': pl('pl-deleted', { isDeleted: true }),
				'pl-elsewhere': pl('pl-elsewhere', { channelId: 'ch9' }),
				'pl-personal': pl('pl-personal', { channelId: '' }),
				'watch-later-x': pl('watch-later-x', { systemType: 'watch_later' }),
			},
		});
		assert.equal((await call('GET', '/channels/ch1')).body.result.stats.playlists, 2);
		assert.equal((await call('GET', `/users/${OWNER}`)).body.result.counts.playlists, 2);
		const job = await jobOf(await call('POST', '/channels/ch1/transfer', { newOwnerId: OTHER }));
		assert.equal(job.status, 'succeeded', JSON.stringify(job));
		assert.equal(job.result.playlists, 3);
		const owner = (id: string) => JSON.parse(raw.playlists.store.get(id)!).userId;
		for (const id of ['pl-public', 'pl-private', 'pl-deleted']) assert.equal(owner(id), OTHER, id);
		for (const id of ['pl-elsewhere', 'pl-personal', 'watch-later-x']) assert.equal(owner(id), OWNER, id);
		assert.equal((await call('GET', `/users/${OTHER}`)).body.result.counts.playlists, 2);
		assert.equal(Number((db.db.prepare('SELECT COUNT(*) AS n FROM channel_transfer_locks').get() as { n: number }).n), 0);
	});

	it('a move waits for a rebuilding playlist index, which heals by itself, and misses nothing', async () => {
		const { raw, db, env, call, jobs, jobOf } = await setup({ playlists: { pl1: { id: 'pl1', title: 'x', userId: OWNER, channelId: 'ch1', videos: [] } } });
		db.db.prepare('DELETE FROM search_meta WHERE key = ?').run(ownershipCompleteKey('playlist'));
		const res = await call('POST', '/channels/ch1/transfer', { newOwnerId: OTHER }, { hold: true });
		await assert.rejects(Promise.resolve(ADMIN_JOB_HANDLERS['channel.transfer']!(env as never, res.body.result.job)), /index is being rebuilt/);
		assert.equal(JSON.parse(raw.channels.store.get('ch1')!).userId, OWNER, 'nothing moved yet');
		await jobs.drain(env);
		assert.equal((await jobOf(res)).status, 'succeeded', 'the rebuild was queued, and the retry went through');
		assert.equal(JSON.parse(raw.playlists.store.get('pl1')!).userId, OTHER);
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
		// Both owners are told once, in their language, without the admin's name (AUN-CHANNEL-CLAIM CC-2)
		const notices = raw.queue.messages.map((m: any) => m.payload ?? m.body?.payload ?? m).filter((p: any) => typeof p?.notificationKey === 'string' && p.notificationKey.startsWith('channelMoved'));
		assert.deepEqual(notices.map((n: any) => `${n.notificationKey}:${n.recipientUserId}`).sort(), [`channelMovedIn:${OTHER}`, `channelMovedOutByTeam:${OWNER}`]);
		for (const n of notices) {
			assert.equal(n.params.channel, 'Channel ch1');
			assert.equal(n.dedupeKey, `move:${job.id}:${n.notificationKey === 'channelMovedIn' ? 'in' : 'out'}`);
			assert.ok(!JSON.stringify(n.params).includes('usr_admin'), 'the acting admin is never named');
		}
		assert.equal((await call('POST', '/channels/ch1/transfer', { newOwnerId: 'usr_nobody' })).status, 404);
		assert.equal((await call('POST', '/channels/ch1/transfer', { newOwnerId: OTHER })).body.code, 'already_owner');
	});

	it('a move takes every record that names the owner: deleted videos, handle, posts, schedules, live streams and emails (AUN-CHANNEL-CLAIM CC-1)', async () => {
		const { raw, env, call, jobOf, db } = await setup({
			channels: { ch1: channel('ch1', { contactEmail: 'public@example.com' }) },
			videos: {
				v1: videoFixture({ id: 'v1', title: 'Tafsir lesson', userId: OWNER, channelId: 'ch1' }),
				gone: videoFixture({ id: 'gone', title: 'In the trash', userId: OWNER, channelId: 'ch1', isDeleted: true }),
				later: videoFixture({ id: 'later', title: 'Next week', userId: OWNER, channelId: 'ch1', isPublic: false, scheduledPublishStatus: 'scheduled', scheduledPublishDate: '2030-01-02T03:00:00.000Z' }),
				odd: videoFixture({ id: 'odd', title: 'Someone else', userId: 'usr_stray', channelId: 'ch1' }),
				'livestream:ls1': { id: 'ls1', title: 'Friday', userId: OWNER, channelId: 'ch1', status: 'scheduled', sessionId: 'sess1' },
			},
		});
		const scheduled = new MemoryBucket({ '2030-01-02/03/later.json': { videoId: 'later', userId: OWNER, channelId: 'ch1' } });
		(env as Record<string, unknown>).SCHEDULED_VIDEOS = scheduled;
		await raw.channel_tabs.put('channel-handles/ch1', JSON.stringify({ handle: 'ch1', channelId: 'ch1', userId: OWNER }));
		await raw.community_posts.put('posts/ch1/p1.json', JSON.stringify({ id: 'p1', channelId: 'ch1', userId: OWNER, authorId: 'usr_editor' }));
		await raw.community_posts.put('posts/ch1/index.json', JSON.stringify({ posts: ['p1'] }));
		db.db.prepare(`INSERT INTO live_sessions (id, stream_id, channel_id, provider, status, reason, created_at) VALUES ('sess1', 'ls1', 'ch1', 'selfhosted', 'provisioned', 'test', 1)`).run();

		const res = await call('POST', '/channels/ch1/transfer', { newOwnerId: OTHER });
		const job = await jobOf(res);
		assert.equal(job.status, 'succeeded', JSON.stringify(job));
		const read = (bucket: MemoryBucket, key: string) => JSON.parse(bucket.store.get(key)!);
		const moved = read(raw.channels, 'ch1');
		assert.equal('email' in moved, false, "the previous owner's email goes, and no other is copied");
		assert.equal(moved.contactEmail, undefined, "the previous owner's public contact is cleared");
		assert.ok(moved.transferredAt);
		assert.equal(read(raw.videos, 'gone').userId, OTHER, 'a soft-deleted video moves too');
		assert.equal(read(raw.videos, 'odd').userId, 'usr_stray', 'a record on someone else is left alone');
		assert.equal(job.result.anomalies, 1);
		assert.equal(read(raw.channel_tabs, 'channel-handles/ch1').userId, OTHER);
		const post = read(raw.community_posts, 'posts/ch1/p1.json');
		assert.deepEqual([post.userId, post.authorId], [OTHER, 'usr_editor'], 'the writer stays the writer');
		assert.deepEqual(read(raw.community_posts, 'posts/ch1/index.json'), { posts: ['p1'] });
		assert.equal(read(scheduled, '2030-01-02/03/later.json').userId, OTHER);
		assert.equal(read(raw.videos, 'livestream:ls1').userId, OTHER);
		const session = db.db.prepare(`SELECT status, end_reason FROM live_sessions WHERE id = 'sess1'`).get() as { status: string; end_reason: string };
		assert.deepEqual([session.status, session.end_reason], ['ended', 'channel_transferred'], 'the ingest key the previous owner knows stops working');
		assert.equal(job.result.liveSessionsEnded, 1);
	});

	it("a move takes the channel's own subscriptions and bells, and closes invitations to the new owner (CC-1b)", async () => {
		const { env, call, jobOf, db } = await setup();
		const notifications = createSqliteD1();
		(env as Record<string, unknown>).NOTIFICATIONS_DB = notifications;
		const n = notifications.raw;
		// ch1 (owned by OWNER) subscribes to chX; OWNER also subscribes to chY as themselves
		n.prepare(`INSERT INTO channel_subscriptions (channel_id, subscriber_channel_id, user_id, id, created_at) VALUES ('chX', 'ch1', ?, 's1', 1), ('chY', 'user:${OWNER}', ?, 's2', 1)`).run(OWNER, OWNER);
		n.prepare(`INSERT INTO channel_subscribers (channel_id, user_id, bell, created_at, updated_at) VALUES ('chX', ?, 'all', 1, 1), ('chY', ?, 'highlights', 1, 1)`).run(OWNER, OWNER);
		const when = new Date(Date.now() + 86_400_000).toISOString();
		db.db.prepare(`INSERT INTO channel_invites (id, channel_id, role, invitee_user_id, invitee_email, by_email, invited_by, status, created_at, expires_at) VALUES
			('i1', 'ch1', 'editor', ?, NULL, 0, ?, 'pending', '2026-01-01', ?),
			('i2', 'ch1', 'admin', NULL, ?, 1, ?, 'pending', '2026-01-01', ?),
			('i3', 'ch1', 'editor', 'usr_someone', NULL, 0, ?, 'pending', '2026-01-01', ?)`).run(OTHER, OWNER, when, `${OTHER}@example.com`, OWNER, when, OWNER, when);

		const job = await jobOf(await call('POST', '/channels/ch1/transfer', { newOwnerId: OTHER }));
		assert.equal(job.status, 'succeeded', JSON.stringify(job));
		assert.equal(job.result.subscriptions, 1);
		assert.equal((n.prepare(`SELECT user_id FROM channel_subscriptions WHERE subscriber_channel_id = 'ch1'`).get() as { user_id: string }).user_id, OTHER);
		assert.equal((n.prepare(`SELECT user_id FROM channel_subscriptions WHERE channel_id = 'chY'`).get() as { user_id: string }).user_id, OWNER, "the previous owner's own subscriptions stay theirs");
		const bells = n.prepare(`SELECT channel_id, user_id, bell FROM channel_subscribers ORDER BY channel_id, user_id`).all();
		assert.deepEqual(bells.map((b: any) => `${b.channel_id}:${b.user_id}:${b.bell}`), [`chX:${OTHER}:all`, `chY:${OWNER}:highlights`]);
		const invites = db.db.prepare(`SELECT id, status FROM channel_invites ORDER BY id`).all();
		assert.deepEqual(invites.map((i: any) => `${i.id}:${i.status}`), ['i1:cancelled', 'i2:cancelled', 'i3:pending']);
		assert.equal(job.result.invitesCancelled, 2);
	});

	it('subscriptions move with their bells in atomic chunks: a crash between batches loses nothing on the retry (Gemini review)', async () => {
		const { env, call, jobOf, jobs } = await setup();
		const notifications = createSqliteD1();
		(env as Record<string, unknown>).NOTIFICATIONS_DB = notifications;
		const n = notifications.raw;
		// 35 channels the channel subscribes to: two batches of 30 and 5
		for (let i = 0; i < 35; i++) {
			n.prepare(`INSERT INTO channel_subscriptions (channel_id, subscriber_channel_id, user_id, id, created_at) VALUES (?, 'ch1', ?, ?, 1)`).run(`t${i}`, OWNER, `s${i}`);
			n.prepare(`INSERT INTO channel_subscribers (channel_id, user_id, bell, created_at, updated_at) VALUES (?, ?, 'all', 1, 1)`).run(`t${i}`, OWNER);
		}
		const batch = notifications.batch.bind(notifications);
		let calls = 0;
		notifications.batch = (async (statements: unknown[]) => {
			calls++;
			if (calls === 2) throw new Error('worker restarted');
			return batch(statements as never);
		}) as typeof notifications.batch;
		const res = await call('POST', '/channels/ch1/transfer', { newOwnerId: OTHER });
		const count = (user: string) => (n.prepare(`SELECT COUNT(*) AS c FROM channel_subscriptions WHERE subscriber_channel_id = 'ch1' AND user_id = ?`).get(user) as { c: number }).c;
		const bells = (user: string) => (n.prepare(`SELECT COUNT(*) AS c FROM channel_subscribers WHERE user_id = ?`).get(user) as { c: number }).c;
		for (let i = 0; i < 10 && (await jobOf(res)).status !== 'succeeded'; i++) {
			jobs.pending.forEach((p: any) => { delete p.delaySeconds; });
			await jobs.drain(env);
		}
		assert.equal((await jobOf(res)).status, 'succeeded');
		assert.ok(calls >= 3, 'the failed batch was retried');
		assert.deepEqual([count(OTHER), count(OWNER)], [35, 0]);
		assert.deepEqual([bells(OTHER), bells(OWNER)], [35, 0], 'every bell moved, none dropped by the crash');
	});

	it('verify re-reads every kind of record that moves: a post or stream write that did not land fails the job (Gemini review)', async () => {
		const { raw, call, jobOf } = await setup({
			videos: {
				v1: videoFixture({ id: 'v1', title: 'Tafsir lesson', userId: OWNER, channelId: 'ch1' }),
				'livestream:ls': { id: 'ls', title: 'Friday', userId: OWNER, channelId: 'ch1', status: 'ended' },
			},
		});
		await raw.community_posts.put('posts/ch1/p1.json', JSON.stringify({ id: 'p1', channelId: 'ch1', userId: OWNER }));
		// The post's write "succeeds" without storing anything (a lost write)
		const put = raw.community_posts.put.bind(raw.community_posts);
		let lost = true;
		raw.community_posts.put = (async (key: string, value: unknown, opts?: unknown) => {
			if (lost && key === 'posts/ch1/p1.json') return { key, etag: 'x', uploaded: new Date() } as never;
			return put(key, value as never, opts as never);
		}) as typeof raw.community_posts.put;
		const res = await call('POST', '/channels/ch1/transfer', { newOwnerId: OTHER });
		const job = await jobOf(res);
		assert.notEqual(job.status, 'succeeded');
		assert.match(String(job.lastError), /posts:1/);
		lost = false;
		await call('POST', `/jobs/${job.id}/retry`, {});
		assert.equal((await jobOf(res)).status, 'succeeded');
		assert.equal(JSON.parse(raw.community_posts.store.get('posts/ch1/p1.json')!).userId, OTHER);
		assert.equal(JSON.parse(raw.videos.store.get('livestream:ls')!).userId, OTHER);
	});

	it('says on every exit whether the channel changed hands', async () => {
		const changed = (j: any) => j.result?.changedHands;
		{
			const { call, jobOf } = await setup();
			assert.equal(changed(await jobOf(await call('POST', '/channels/ch1/transfer', { newOwnerId: OTHER }))), true, 'finished');
		}
		for (const [name, store, expected] of [['deleted before it ran', { isDeleted: true }, false], ['deleted after it changed hands', { isDeleted: true, userId: OTHER }, true], ['gone', null, null]] as const) {
			const { raw, env, call, jobs, jobOf } = await setup();
			const res = await call('POST', '/channels/ch1/transfer', { newOwnerId: OTHER }, { hold: true });
			if (store) raw.channels.store.set('ch1', JSON.stringify({ ...JSON.parse(raw.channels.store.get('ch1')!), ...store }));
			else raw.channels.store.delete('ch1');
			await jobs.drain(env);
			const job = await jobOf(res);
			assert.equal(job.status, 'succeeded', name);
			assert.equal(changed(job), expected, name);
		}
		// A failure before the change of hands, then the same job going through
		const { raw, db, env, call, jobOf } = await setup();
		const res = await call('POST', '/channels/ch1/transfer', { newOwnerId: OTHER }, { hold: true });
		const id = res.body.result.job.id;
		const stored = () => JSON.parse((db.db.prepare('SELECT result FROM admin_jobs WHERE id = ?').get(id) as any).result);
		const run = async () => ADMIN_JOB_HANDLERS['channel.transfer']!(env as never, (await getJob(env as never, id)) as never);
		db.db.prepare('DELETE FROM search_meta WHERE key = ?').run(ownershipCompleteKey('playlist'));
		await assert.rejects(run(), /index is being rebuilt/);
		assert.deepEqual(stored(), { changedHands: false });
		// The write lands but the worker never hears of it: the earlier "no" is gone
		db.db.prepare(`INSERT OR REPLACE INTO search_meta (key, value, updated_at) VALUES (?, '1', 't')`).run(ownershipCompleteKey('playlist'));
		const put = raw.channels.put.bind(raw.channels);
		raw.channels.put = (async (key: string, value: unknown, opts?: unknown) => {
			await put(key, value as never, opts as never);
			throw new Error('worker restarted');
		}) as typeof put;
		await assert.rejects(run(), /worker restarted/);
		assert.equal((db.db.prepare('SELECT result FROM admin_jobs WHERE id = ?').get(id) as any).result, null);
		raw.channels.put = put;
		assert.equal(JSON.parse(raw.channels.store.get('ch1')!).userId, OTHER);
		// A failure after it
		const list = raw.community_posts.list.bind(raw.community_posts);
		raw.community_posts.list = (async () => { throw new Error('posts unavailable'); }) as typeof list;
		await assert.rejects(run(), /posts unavailable/);
		assert.deepEqual(stored(), { changedHands: true });
		// Its channel deleted meanwhile: what it knew stays
		raw.channels.store.delete('ch1');
		const last = (await run()) as any;
		assert.deepEqual(last.result, { skipped: 'channel_not_found', changedHands: true });
		assert.ok(jobOf);
	});

	it('stops the previous owner\'s own unfinished uploads, and nobody else\'s', async () => {
		const upload = (id: string, over: Record<string, unknown> = {}) => videoFixture({ id, title: id, userId: OWNER, channelId: 'ch1', uploadStatus: 'uploading', tusUpload: { sessionId: 's', bunnyUploadUrl: 'https://b', fileSize: 10, createdAt: 'x' }, ...over });
		const seedVideos = () => ({
			mine: upload('mine'),
			started: upload('started', { uploadStatus: 'initiated' }),
			again: upload('again', { uploadStatus: 'failed', processingIssue: { kind: 'needs_reupload' } }),
			member: upload('member', { uploadedBy: 'usr_member' }),
			imported: upload('imported', { tusUpload: { sessionId: 's', bunnyUploadUrl: 'https://b', fileSize: 10, createdAt: 'x', adminImport: true } }),
			failed: upload('failed', { uploadStatus: 'failed', processingIssue: { kind: 'encode_failed' } }),
			encoding: upload('encoding', { uploadStatus: 'processing' }),
			done: upload('done', { uploadStatus: 'ready' }),
			elsewhere: upload('elsewhere', { channelId: 'ch-elsewhere' }),
		});
		const { raw, call, jobOf } = await setup({ videos: seedVideos() });
		const job = await jobOf(await call('POST', '/channels/ch1/transfer', { newOwnerId: OTHER }));
		assert.equal(job.status, 'succeeded', JSON.stringify(job));
		assert.equal(job.result.uploadsStopped, 3);
		const read = (id: string) => JSON.parse(raw.videos.store.get(id)!);
		for (const id of ['mine', 'started', 'again']) {
			const v = read(id);
			assert.deepEqual([v.isDeleted, v.uploadStatus, v.tusUpload, v.abandoned.bunnyDeleted, v.userId], [true, 'failed', undefined, true, OTHER], id);
		}
		for (const id of ['member', 'imported', 'failed', 'encoding', 'done']) assert.deepEqual([read(id).isDeleted ?? false, read(id).abandoned], [false, undefined], id);
		assert.deepEqual([read('elsewhere').userId, read('elsewhere').abandoned], [OWNER, undefined]);

		assert.deepEqual(bunny.calls.splice(0).sort(), ['again', 'mine', 'started'].map((id) => `DELETE /library/7/videos/${id}`), 'only their own bytes go');

		// Kept on as a channel admin: goes on as a member
		const kept = await setup({ videos: seedVideos() });
		const keptJob = await kept.jobOf(await kept.call('POST', '/channels/ch1/transfer', { newOwnerId: OTHER, keepPreviousOwnerAsAdmin: true }));
		assert.equal(keptJob.result.uploadsStopped, 0);
		const mine = JSON.parse(kept.raw.videos.store.get('mine')!);
		assert.deepEqual([mine.uploadedBy, mine.abandoned, mine.uploadStatus], [OWNER, undefined, 'uploading']);
	});

	it('a new owner with no email closes no email invitation (null, never an empty match) (Gemini nit)', async () => {
		const { call, jobOf, db } = await setup({
			profiles: { [OWNER]: profile(OWNER, { channels: ['ch1'] }), [OTHER]: profile(OTHER, { email: undefined }) },
		});
		const when = new Date(Date.now() + 86_400_000).toISOString();
		db.db.prepare(`INSERT INTO channel_invites (id, channel_id, role, invitee_user_id, invitee_email, by_email, invited_by, status, created_at, expires_at) VALUES ('blank', 'ch1', 'editor', NULL, '', 1, ?, 'pending', '2026-01-01', ?)`).run(OWNER, when);
		const job = await jobOf(await call('POST', '/channels/ch1/transfer', { newOwnerId: OTHER }));
		assert.equal(job.status, 'succeeded', JSON.stringify(job));
		assert.equal(job.result.invitesCancelled, 0);
		assert.equal((db.db.prepare(`SELECT status FROM channel_invites WHERE id = 'blank'`).get() as { status: string }).status, 'pending');
	});

	it('one move notice failing does not stop the other (Gemini nit)', async () => {
		const { raw, call, jobOf } = await setup();
		const send = raw.queue.send.bind(raw.queue);
		raw.queue.send = (async (msg: any) => {
			if (msg?.payload?.notificationKey === 'channelMovedIn') throw new Error('queue down');
			return send(msg);
		}) as typeof raw.queue.send;
		const job = await jobOf(await call('POST', '/channels/ch1/transfer', { newOwnerId: OTHER }));
		assert.equal(job.status, 'succeeded');
		assert.ok(raw.queue.messages.some((m: any) => m.payload?.notificationKey === 'channelMovedOutByTeam' && m.payload.recipientUserId === OWNER));
	});

	it('verify fails the move (so it retries) while a record still names the previous owner', async () => {
		const { raw, call, jobOf } = await setup();
		// An old-owner write that lands after the video step: the video comes back on OWNER once
		let raced = false;
		const get = raw.videos.get.bind(raw.videos);
		raw.videos.get = (async (key: string) => {
			if (!raced && key === 'v1' && JSON.parse(raw.videos.store.get('v1')!).userId === OTHER) {
				raced = true;
				raw.videos.store.set('v1', JSON.stringify({ ...JSON.parse(raw.videos.store.get('v1')!), userId: OWNER }));
			}
			return get(key);
		}) as typeof raw.videos.get;
		const res = await call('POST', '/channels/ch1/transfer', { newOwnerId: OTHER });
		const job = await jobOf(res);
		assert.ok(raced, 'the race ran');
		assert.equal(job.status, 'succeeded', 'the retry moved it again');
		assert.ok(job.attempts >= 2, `retried (attempts ${job.attempts})`);
		assert.equal(JSON.parse(raw.videos.store.get('v1')!).userId, OTHER);
	});

	it('the previous owner stays on as channel admin only when the admin chose it, and the team log says so (CC-3)', async () => {
		const { raw, call, jobOf, db } = await setup();
		const job = await jobOf(await call('POST', '/channels/ch1/transfer', { newOwnerId: OTHER, keepPreviousOwnerAsAdmin: true, keepContactEmail: true }));
		assert.equal(job.status, 'succeeded', JSON.stringify(job));
		const moved = JSON.parse(raw.channels.store.get('ch1')!);
		assert.deepEqual(moved.members.map((m: any) => `${m.userId}:${m.role}:${m.addedBy}`), [`${OWNER}:admin:usr_admin`]);
		const log = db.db.prepare(`SELECT action, target_user_id, new_role FROM channel_audit WHERE channel_id = 'ch1'`).all() as any[];
		assert.deepEqual(log.map((r) => `${r.action}:${r.target_user_id}:${r.new_role}`), [`transfer_kept_old_owner:${OWNER}:admin`]);

		const second = await setup();
		await second.jobOf(await second.call('POST', '/channels/ch1/transfer', { newOwnerId: OTHER }));
		assert.deepEqual(JSON.parse(second.raw.channels.store.get('ch1')!).members ?? [], [], 'by default the previous owner loses access');
	});

	it('takes an official handle back from the channel holding it and releases handles to a default (CC-4)', async () => {
		const { raw, call } = await setup({
			channels: { ch1: channel('ch1'), ch2: channel('ch2', { userId: OTHER, handle: 'LamaHat', name: 'Early bird', isMain: true }) },
			profiles: { [OWNER]: profile(OWNER, { channels: ['ch1'] }), [OTHER]: profile(OTHER, { channels: ['ch2'] }) },
		});
		await raw.channel_tabs.put('channel-handles/ch1', JSON.stringify({ handle: 'ch1', channelId: 'ch1', userId: OWNER }));
		await raw.channel_tabs.put('channel-handles/lamahat', JSON.stringify({ handle: 'lamahat', channelId: 'ch2', userId: OTHER }));

		assert.equal((await call('POST', '/channels/ch1/handle/take', { handle: 'notofficial' })).body.code, 'not_official_handle');
		const took = await call('POST', '/channels/ch1/handle/take', { handle: 'Lamahat' });
		assert.equal(took.status, 200, JSON.stringify(took.body));
		const holderNow = JSON.parse(raw.channels.store.get('ch2')!).handle;
		assert.deepEqual(took.body.result, { handle: 'lamahat', previousHandle: 'ch1', tookFrom: 'ch2', holderHandle: holderNow, holderPreviousHandle: 'LamaHat' });
		const read = (key: string) => JSON.parse(raw.channel_tabs.store.get(key)!);
		assert.equal(read('channel-handles/lamahat').channelId, 'ch1');
		const holder = JSON.parse(raw.channels.store.get('ch2')!);
		assert.notEqual(holder.handle, 'lamahat');
		assert.equal(read(`channel-handles/${holder.handle.toLowerCase()}`).channelId, 'ch2', 'the holder got a working default handle');
		assert.ok(!raw.channel_tabs.store.has('channel-handle-history/lamahat'), 'the old name does not redirect to the holder');
		const notice = raw.queue.messages.map((m: any) => m.payload).find((p: any) => p?.notificationKey === 'channelHandleChangedByTeam');
		assert.deepEqual([notice?.recipientUserId, notice?.params?.handle], [OTHER, holder.handle], "the holder's owner is told");

		const released = await call('POST', '/channels/ch1/handle/release', {});
		assert.equal(released.status, 200);
		assert.equal(released.body.result.previousHandle, 'lamahat');
		const now = JSON.parse(raw.channels.store.get('ch1')!).handle;
		assert.equal(released.body.result.handle, now);
		assert.equal(read(`channel-handles/${now.toLowerCase()}`).channelId, 'ch1');
		assert.ok(!raw.channel_tabs.store.has('channel-handles/lamahat'), 'the official handle is free again');
	});

	it('taking back an official handle overrides the 14-day hold of a channel that gave it up (CC-4)', async () => {
		const { raw, call } = await setup();
		await raw.channel_tabs.put('channel-handles/ch1', JSON.stringify({ handle: 'ch1', channelId: 'ch1', userId: OWNER }));
		await raw.channel_tabs.put('channel-handle-history/lamahat', JSON.stringify({ handle: 'lamahat', channelId: 'ch9', dateReleased: new Date().toISOString() }));
		const took = await call('POST', '/channels/ch1/handle/take', { handle: 'lamahat' });
		assert.equal(took.status, 200, JSON.stringify(took.body));
		assert.equal(took.body.result.tookFrom, null);
		assert.equal(JSON.parse(raw.channel_tabs.store.get('channel-handles/lamahat')!).channelId, 'ch1');
		assert.ok(!raw.channel_tabs.store.has('channel-handle-history/lamahat'), 'the name no longer redirects to the channel that gave it up');
	});

	it('a plain channel edit refuses an official handle and points to the take-back tool (CC-4)', async () => {
		const { raw, call } = await setup();
		const refused = await call('PATCH', '/channels/ch1', { handle: 'Lamahat' });
		assert.equal(refused.status, 409);
		assert.equal(refused.body.code, 'official_handle_take_back');
		assert.ok(!raw.channel_tabs.store.has('channel-handles/lamahat'), 'nothing claimed');
		assert.equal((await call('PATCH', '/channels/ch1', { handle: 'plainname' })).status, 200, 'other handles still change');
	});

	it('a move lock whose worker died while starting clears by itself, and never hides a move that did start (#1935)', async () => {
		const start = async (minutes: number, job?: { status: string; minutes: number }) => {
			const t = await setup({ profiles: { [OWNER]: profile(OWNER, { channels: ['ch1'] }), [OTHER]: profile(OTHER) } });
			const ago = (m: number) => new Date(Date.now() - m * 60_000).toISOString();
			t.db.db.prepare(`INSERT INTO channel_transfer_locks (channel_id, job_id, created_at) VALUES ('ch1', '', ?)`).run(ago(minutes));
			if (job) t.db.db.prepare(`INSERT INTO admin_jobs (id, kind, target_kind, target_id, actor_id, status, params, created_at, updated_at) VALUES ('job-started', 'channel.transfer', 'channel', 'ch1', 'usr_admin', ?, '{}', ?, ?)`).run(job.status, ago(job.minutes), ago(job.minutes));
			return t;
		};
		const move = (t: Awaited<ReturnType<typeof setup>>) => t.call('POST', '/channels/ch1/transfer', { newOwnerId: OTHER });
		// No job was ever created: a moment's lock holds, an old one is stale
		const young = await start(5);
		assert.equal(await openTransferJob(young.env as never, 'ch1'), 'starting');
		assert.equal((await move(young)).body.code, 'transfer_in_progress');
		const old = await start(11);
		assert.equal(await openTransferJob(old.env as never, 'ch1'), null, 'Go live and handle edits work again');
		const moved = await old.jobOf(await move(old));
		assert.equal(moved.status, 'succeeded');
		assert.equal(old.db.db.prepare(`SELECT 1 FROM channel_transfer_locks WHERE channel_id = 'ch1'`).get(), undefined);
		// The worker died after creating the job, before naming it on the lock: the job decides, however old the lock
		for (const [status, code] of [['queued', 'transfer_in_progress'], ['retrying', 'transfer_in_progress'], ['failed', 'transfer_unfinished']]) {
			const t = await start(60, { status, minutes: 59 });
			assert.equal(await openTransferJob(t.env as never, 'ch1'), 'job-started', status);
			assert.equal((await move(t)).body.code, code, status);
		}
		const done = await start(60, { status: 'succeeded', minutes: 59 });
		assert.equal(await openTransferJob(done.env as never, 'ch1'), null);
		assert.equal((await done.jobOf(await move(done))).status, 'succeeded');
		// A move that is over while the lock is young: it may be an earlier one's, so the lock holds
		const fast = await start(1, { status: 'succeeded', minutes: 0 });
		assert.equal(await openTransferJob(fast.env as never, 'ch1'), 'starting');
		assert.equal((await move(fast)).body.code, 'transfer_in_progress');
		// A move its offer no longer stands for never holds the lock it started under
		const stopped = await start(60, { status: 'failed', minutes: 59 });
		stopped.db.db.prepare(`INSERT INTO channel_move_offers (id, channel_id, from_user_id, to_user_id, status, created_at, expires_at, updated_at) VALUES ('o1', 'ch1', ?, ?, 'cancelled', '2026', '2099', '2026')`).run(OWNER, OTHER);
		stopped.db.db.prepare(`UPDATE admin_jobs SET params = '{"offerId":"o1"}' WHERE id = 'job-started'`).run();
		assert.equal(await openTransferJob(stopped.env as never, 'ch1'), null);
		assert.equal((await stopped.jobOf(await move(stopped))).status, 'succeeded');
		// A job from before the lock is not this lock's
		const earlier = await start(11, { status: 'failed', minutes: 30 });
		assert.equal(await openTransferJob(earlier.env as never, 'ch1'), null);
		const plan = (old.db.db.prepare(`EXPLAIN QUERY PLAN ${STARTED_JOB_SQL}`).all('ch1', '2026') as Array<{ detail: string }>).map((r) => r.detail).join(' | ');
		assert.match(plan, /SEARCH j USING INDEX idx_admin_jobs_target \(target_kind=\? AND target_id=\? AND created_at>\?\)/, plan);
		assert.match(plan, /SEARCH o USING INDEX sqlite_autoindex_channel_move_offers_1 \(id=\?\)/, plan);
	});

	it('two requests taking over a stale lock start one move, and a finished job never releases the next one’s lock (#1935)', async () => {
		const { raw, env, db, call, jobOf } = await setup({ profiles: { [OWNER]: profile(OWNER, { channels: ['ch1'] }), [OTHER]: profile(OTHER), usr_third: profile('usr_third') } });
		const lock = (at: string) => db.db.prepare(`INSERT OR REPLACE INTO channel_transfer_locks (channel_id, job_id, created_at) VALUES ('ch1', '', ?)`).run(at);
		lock(new Date(Date.now() - 11 * 60_000).toISOString());
		// The first request reads the stale lock; the second takes it over and is starting; the first goes on
		const prepare = db.prepare.bind(db);
		let second: Promise<{ status: number; body: any }> | undefined;
		db.prepare = ((sql: string) => {
			const statement = prepare(sql);
			if (second || !/^DELETE FROM channel_transfer_locks/.test(sql)) return statement;
			second = Promise.resolve({ status: 0, body: {} });
			db.db.prepare(`UPDATE channel_transfer_locks SET created_at = ? WHERE channel_id = 'ch1'`).run(new Date().toISOString());
			return statement;
		}) as typeof db.prepare;
		const first = await call('POST', '/channels/ch1/transfer', { newOwnerId: OTHER }, { hold: true });
		db.prepare = prepare as typeof db.prepare;
		assert.deepEqual([first.status, first.body.code], [409, 'transfer_in_progress'], 'the other request holds it now');
		db.db.prepare(`DELETE FROM channel_transfer_locks WHERE channel_id = 'ch1'`).run();

		// A move that finished is delivered once more while the next request is starting
		const job = await jobOf(await call('POST', '/channels/ch1/transfer', { newOwnerId: OTHER }));
		assert.equal(job.status, 'succeeded');
		lock(new Date(Date.now() + 1000).toISOString());
		await (ADMIN_JOB_HANDLERS as Record<string, (env: unknown, job: unknown) => Promise<unknown>>)['channel.transfer'](env, job);
		assert.ok(db.db.prepare(`SELECT 1 FROM channel_transfer_locks WHERE channel_id = 'ch1' AND job_id = ''`).get(), "the next request's lock stays");
		assert.equal(JSON.parse(raw.channels.store.get('ch1')!).userId, OTHER);
	});

	it('a move takes the channel from its owner at the lock, not from the one read before it', async () => {
		const { raw, call, jobOf, db } = await setup({ profiles: { [OWNER]: profile(OWNER, { channels: ['ch1'] }), [OTHER]: profile(OTHER), usr_third: profile('usr_third') } });
		const get = raw.profiles.get.bind(raw.profiles);
		// The request for `receiver` has read the channel; a whole OWNER to OTHER move runs before it goes on
		const raced = async (receiver: string) => {
			let done = false;
			raw.profiles.get = (async (key: string) => {
				if (!done && key === receiver) {
					done = true;
					assert.equal((await jobOf(await call('POST', '/channels/ch1/transfer', { newOwnerId: OTHER }))).status, 'succeeded');
				}
				return get(key);
			}) as typeof raw.profiles.get;
			const answer = await call('POST', '/channels/ch1/transfer', { newOwnerId: receiver });
			raw.profiles.get = get as typeof raw.profiles.get;
			return answer;
		};
		const job = await jobOf(await raced('usr_third'));
		assert.deepEqual([job.status, job.params.previousOwnerId, job.result.anomalies], ['succeeded', OTHER, 0]);
		assert.equal(JSON.parse(raw.videos.store.get('v1')!).userId, 'usr_third');
		assert.deepEqual([OWNER, OTHER, 'usr_third'].map((id) => JSON.parse(raw.profiles.store.get(id)!).channels), [[], [], ['ch1']]);
		// Back to the first owner, who then receives nothing new: the race made them the owner already
		assert.equal((await jobOf(await call('POST', '/channels/ch1/transfer', { newOwnerId: OWNER }))).status, 'succeeded');
		const channels = raw.channels.get.bind(raw.channels);
		let reads = 0;
		raw.channels.get = (async (...args: Parameters<typeof channels>) => {
			if (args[0] === 'ch1' && db.db.prepare(`SELECT 1 FROM channel_transfer_locks WHERE channel_id = 'ch1'`).get() && reads++ === 0) raw.channels.store.set('ch1', JSON.stringify({ ...JSON.parse(raw.channels.store.get('ch1')!), userId: OTHER }));
			return channels(...args);
		}) as typeof raw.channels.get;
		const refused = await call('POST', '/channels/ch1/transfer', { newOwnerId: OTHER });
		raw.channels.get = channels as typeof raw.channels.get;
		assert.deepEqual([refused.status, refused.body.code], [409, 'already_owner']);
		assert.equal(db.db.prepare(`SELECT 1 FROM channel_transfer_locks WHERE channel_id = 'ch1'`).get(), undefined, 'the lock is released');
	});

	it('the daily re-verify moves a record that went back to the previous owner, quietly, for 48 hours (CC-1c)', async () => {
		const { raw, env, call, jobOf, db, flush } = await setup();
		const job = await jobOf(await call('POST', '/channels/ch1/transfer', { newOwnerId: OTHER }));
		assert.equal(job.status, 'succeeded');
		// A late edit by the previous owner writes the old owner back on one video
		raw.videos.store.set('v1', JSON.stringify({ ...JSON.parse(raw.videos.store.get('v1')!), userId: OWNER }));
		const before = raw.queue.messages.length;
		const result = await reverifyRecentTransfers(env as never);
		await flush();
		assert.deepEqual(result, { checked: 1, repaired: 1, failed: 0 });
		assert.equal(JSON.parse(raw.videos.store.get('v1')!).userId, OTHER);
		assert.equal(raw.queue.messages.slice(before).filter((m: any) => m.payload?.notificationKey).length, 0, 'no second notice');
		// Clean now: checked, nothing to repair; past 48 hours it is not checked at all
		assert.deepEqual(await reverifyRecentTransfers(env as never), { checked: 1, repaired: 0, failed: 0 });
		assert.deepEqual(await reverifyRecentTransfers(env as never, Date.now() + 49 * 3600 * 1000), { checked: 0, repaired: 0, failed: 0 });
		// The whole query, cursor included, stays on the status index
		for (const cursor of [null, '2026-11-24T00:00:00.000Z']) {
			const plan = (db.db.prepare(`EXPLAIN QUERY PLAN ${REVERIFY_SQL}`).all('2026', cursor, cursor, cursor, cursor && 'job', 100) as Array<{ detail: string }>).map((r) => r.detail).join(' | ');
			assert.match(plan, /SEARCH admin_jobs USING INDEX idx_admin_jobs_status \(status=\? AND updated_at>\?\)/, plan);
		}
	});

	it("the re-verify repair finds the channel's playlists by channel id and leaves others alone (CC-1c)", async () => {
		const pl = (id: string, overrides: Record<string, unknown> = {}) => ({ id, title: id, userId: OWNER, channelId: 'ch1', videos: [], ...overrides });
		const { raw, env, db, call, jobOf, flush } = await setup({ playlists: { pl1: pl('pl1'), pl2: pl('pl2', { isPublic: false }), mine: pl('mine', { channelId: '' }), elsewhere: pl('elsewhere', { channelId: 'ch9' }) } });
		assert.equal((await jobOf(await call('POST', '/channels/ch1/transfer', { newOwnerId: OTHER }))).status, 'succeeded');
		// A late write puts two of them back; the channel record lists none
		for (const id of ['pl1', 'pl2']) raw.playlists.store.set(id, JSON.stringify(pl(id, { isPublic: id === 'pl1' })));
		raw.playlists.store.set('theirs', JSON.stringify(pl('theirs', { userId: 'usr_third' })));
		await runOwnershipPass(raw as never, 'playlist', { maxPages: 10 });
		assert.deepEqual(JSON.parse(raw.channels.store.get('ch1')!).playlists, []);
		assert.deepEqual(await reverifyRecentTransfers(env as never), { checked: 1, repaired: 1, failed: 0 });
		await flush();
		const owner = (id: string) => JSON.parse(raw.playlists.store.get(id)!).userId;
		assert.deepEqual(['pl1', 'pl2', 'theirs', 'mine', 'elsewhere'].map(owner), [OTHER, OTHER, 'usr_third', OWNER, OWNER]);
		assert.deepEqual(await reverifyRecentTransfers(env as never), { checked: 1, repaired: 0, failed: 0 });
		// While the index is rebuilt it reports instead of passing a channel it could not check
		db.db.prepare('DELETE FROM search_meta WHERE key = ?').run(ownershipCompleteKey('playlist'));
		assert.deepEqual(await reverifyRecentTransfers(env as never), { checked: 1, repaired: 0, failed: 1 });
		assert.equal(Number((db.db.prepare('SELECT COUNT(*) AS n FROM channel_transfer_locks').get() as { n: number }).n), 0);
	});

	it("the re-verify repair moves only records back on the previous owner and leaves the new owner's changes alone (CC-1c)", async () => {
		const { raw, env, call, jobOf, db, flush } = await setup({
			channels: { ch1: channel('ch1'), ch2: channel('ch2', { isMain: false }), ch3: channel('ch3', { isMain: false }) },
			profiles: { [OWNER]: profile(OWNER, { channels: ['ch1', 'ch2', 'ch3'] }), [OTHER]: profile(OTHER) },
		});
		assert.equal((await jobOf(await call('POST', '/channels/ch1/transfer', { newOwnerId: OTHER }))).status, 'succeeded');
		// Since the move: the previous owner picks ch3 as main, the new owner renames ch1 and goes live on it
		const edit = (bucket: any, key: string, change: Record<string, unknown>) => bucket.store.set(key, JSON.stringify({ ...JSON.parse(bucket.store.get(key)!), ...change }));
		edit(raw.channels, 'ch2', { isMain: false });
		edit(raw.channels, 'ch3', { isMain: true });
		edit(raw.channels, 'ch1', { handle: 'newname' });
		await raw.channel_tabs.put('channel-handles/newname', JSON.stringify({ handle: 'newname', channelId: 'ch1', userId: OTHER }));
		await raw.videos.put('livestream:mine', JSON.stringify({ id: 'mine', title: 'Mine', userId: OTHER, channelId: 'ch1', status: 'live' }));
		db.db.prepare(`INSERT INTO live_sessions (id, stream_id, channel_id, provider, status, reason, created_at) VALUES ('s-mine', 'mine', 'ch1', 'selfhosted', 'live', 'test', 1)`).run();
		// and a late write of the previous owner puts a video and a stream back on them
		edit(raw.videos, 'v1', { userId: OWNER });
		await raw.videos.put('livestream:old', JSON.stringify({ id: 'old', title: 'Old', userId: OWNER, channelId: 'ch1', status: 'offline' }));
		db.db.prepare(`INSERT INTO live_sessions (id, stream_id, channel_id, provider, status, reason, created_at) VALUES ('s-old', 'old', 'ch1', 'selfhosted', 'provisioned', 'test', 2)`).run();

		assert.deepEqual(await reverifyRecentTransfers(env as never), { checked: 1, repaired: 1, failed: 0 });
		await flush();
		const read = (bucket: any, key: string) => JSON.parse(bucket.store.get(key)!);
		assert.equal(read(raw.videos, 'v1').userId, OTHER);
		assert.equal(read(raw.videos, 'livestream:old').userId, OTHER);
		const status = (id: string) => (db.db.prepare('SELECT status FROM live_sessions WHERE id = ?').get(id) as { status: string }).status;
		assert.equal(status('s-old'), 'ended', "the stream the previous owner held has its session ended");
		assert.equal(status('s-mine'), 'live', "the new owner's broadcast goes on");
		assert.equal(read(raw.videos, 'livestream:mine').userId, OTHER);
		assert.equal(read(raw.channels, 'ch1').handle, 'newname');
		assert.deepEqual([read(raw.channels, 'ch2').isMain, read(raw.channels, 'ch3').isMain], [false, true], "the previous owner's main channel is theirs to pick");
	});

	it('the re-verify checks only the latest move of a live channel, a page at a time (CC-1c)', async () => {
		const { raw, env, call, jobOf, db } = await setup({
			profiles: { [OWNER]: profile(OWNER, { channels: ['ch1'] }), [OTHER]: profile(OTHER), usr_third: profile('usr_third') },
		});
		const first = await jobOf(await call('POST', '/channels/ch1/transfer', { newOwnerId: OTHER }));
		assert.equal(first.status, 'succeeded');
		assert.equal((await jobOf(await call('POST', '/channels/ch1/transfer', { newOwnerId: 'usr_third' }))).status, 'succeeded');
		db.db.prepare('UPDATE admin_jobs SET updated_at = ? WHERE id = ?').run(new Date(Date.now() - 60_000).toISOString(), first.id);
		// A video back on the first move's previous owner is not the second move's business
		raw.videos.store.set('v1', JSON.stringify({ ...JSON.parse(raw.videos.store.get('v1')!), userId: OWNER }));
		// More moves of other (since deleted) channels than one page holds
		const at = new Date().toISOString();
		for (let i = 0; i < 150; i++) {
			db.db.prepare(`INSERT INTO admin_jobs (id, kind, target_kind, target_id, actor_id, status, params, created_at, updated_at) VALUES (?, 'channel.transfer', 'channel', ?, 'usr_admin', 'succeeded', ?, ?, ?)`)
				.run(`old-${i}`, `gone-${i}`, JSON.stringify({ newOwnerId: OTHER, previousOwnerId: OWNER }), at, at);
		}
		assert.deepEqual(await reverifyRecentTransfers(env as never), { checked: 1, repaired: 0, failed: 0 });
		assert.equal(JSON.parse(raw.videos.store.get('v1')!).userId, OWNER, 'left as it is');
		// Deleted: not checked at all
		raw.channels.store.set('ch1', JSON.stringify({ ...JSON.parse(raw.channels.store.get('ch1')!), isDeleted: true }));
		assert.deepEqual(await reverifyRecentTransfers(env as never), { checked: 0, repaired: 0, failed: 0 });
	});

	it('the re-verify closes a late invitation to the new owner and leaves a kept previous owner their own subscriptions as the channel (CC-1c)', async () => {
		const { raw, env, call, jobOf, db } = await setup();
		const notifications = createSqliteD1();
		(env as Record<string, unknown>).NOTIFICATIONS_DB = notifications;
		const n = notifications.raw;
		assert.equal((await jobOf(await call('POST', '/channels/ch1/transfer', { newOwnerId: OTHER, keepPreviousOwnerAsAdmin: true }))).status, 'succeeded');
		assert.ok(JSON.parse(raw.channels.store.get('ch1')!).members.some((m: { userId: string }) => m.userId === OWNER), 'kept as an admin');
		// Since the move, the previous owner (an admin now) subscribes as the channel
		n.prepare(`INSERT INTO channel_subscriptions (channel_id, subscriber_channel_id, user_id, id, created_at) VALUES ('chX', 'ch1', ?, 's1', 1)`).run(OWNER);
		assert.deepEqual(await reverifyRecentTransfers(env as never), { checked: 1, repaired: 0, failed: 0 });
		const subscriber = () => (n.prepare(`SELECT user_id FROM channel_subscriptions WHERE subscriber_channel_id = 'ch1'`).get() as { user_id: string }).user_id;
		assert.equal(subscriber(), OWNER, 'a member subscribed as the channel: not left behind by the move');
		// An invitation to the new owner that was written as the channel flipped
		db.db.prepare(`INSERT INTO channel_invites (id, channel_id, role, invitee_user_id, invitee_email, by_email, invited_by, status, created_at, expires_at) VALUES ('late', 'ch1', 'editor', ?, NULL, 0, ?, 'pending', '2026-01-01', '2030-01-01')`).run(OTHER, OWNER);
		assert.deepEqual(await reverifyRecentTransfers(env as never), { checked: 1, repaired: 1, failed: 0 });
		assert.equal((db.db.prepare(`SELECT status FROM channel_invites WHERE id = 'late'`).get() as { status: string }).status, 'cancelled');
		assert.equal(subscriber(), OWNER, 'a repair leaves it too');
		// No longer on the team: their leftover subscription as the channel moves
		raw.channels.store.set('ch1', JSON.stringify({ ...JSON.parse(raw.channels.store.get('ch1')!), members: [] }));
		assert.deepEqual(await reverifyRecentTransfers(env as never), { checked: 1, repaired: 1, failed: 0 });
		assert.equal(subscriber(), OTHER);
	});

	it('the re-verify leaves a channel that is being moved again to that move (CC-1c)', async () => {
		const { raw, env, call, jobOf } = await setup({
			profiles: { [OWNER]: profile(OWNER, { channels: ['ch1'] }), [OTHER]: profile(OTHER), usr_third: profile('usr_third') },
		});
		assert.equal((await jobOf(await call('POST', '/channels/ch1/transfer', { newOwnerId: OTHER }))).status, 'succeeded');
		raw.videos.store.set('v1', JSON.stringify({ ...JSON.parse(raw.videos.store.get('v1')!), userId: OWNER }));
		// Queued, not run yet
		assert.equal((await call('POST', '/channels/ch1/transfer', { newOwnerId: 'usr_third' }, { hold: true })).status < 300, true);
		assert.ok(await openTransferJob(env as never, 'ch1'));
		assert.deepEqual(await reverifyRecentTransfers(env as never), { checked: 0, repaired: 0, failed: 0 });
		assert.equal(JSON.parse(raw.videos.store.get('v1')!).userId, OWNER);
	});

	/** A moved channel (OWNER to OTHER) with every kind of record left behind; `onRead` runs at each read of the channel while a repair holds the lock. */
	async function leftBehind() {
		const t = await setup({
			profiles: { [OWNER]: profile(OWNER, { channels: ['ch1'] }), [OTHER]: profile(OTHER), usr_third: profile('usr_third') },
			channels: { ch1: channel('ch1', { playlists: ['pl1'] }) },
			playlists: { pl1: { id: 'pl1', title: 'P', userId: OWNER, channelId: 'ch1', videos: [] } },
		});
		const notifications = createSqliteD1();
		(t.env as Record<string, unknown>).NOTIFICATIONS_DB = notifications;
		await t.raw.channel_tabs.put('channel-handles/ch1', JSON.stringify({ handle: 'ch1', channelId: 'ch1', userId: OWNER }));
		assert.equal((await t.jobOf(await t.call('POST', '/channels/ch1/transfer', { newOwnerId: OTHER }))).status, 'succeeded');
		const edit = (bucket: any, key: string, change: Record<string, unknown>) => bucket.store.set(key, JSON.stringify({ ...JSON.parse(bucket.store.get(key)!), ...change }));
		const read = (bucket: any, key: string) => JSON.parse(bucket.store.get(key)!);
		const when = new Date('2030-01-01T00:00:00.000Z');
		edit(t.raw.videos, 'v1', { userId: OWNER, scheduledPublishStatus: 'scheduled', scheduledPublishDate: when.toISOString() });
		const schedules = new MemoryBucket({ [scheduleKey(when, 'v1')]: { id: 'v1', userId: OWNER } });
		(t.env as Record<string, unknown>).SCHEDULED_VIDEOS = schedules;
		await t.raw.community_posts.put('posts/ch1/p1.json', JSON.stringify({ id: 'p1', channelId: 'ch1', userId: OWNER }));
		edit(t.raw.playlists, 'pl1', { userId: OWNER });
		edit(t.raw.profiles, OTHER, { channels: [] });
		edit(t.raw.profiles, OWNER, { channels: ['ch1'] });
		edit(t.raw.channel_tabs, 'channel-handles/ch1', { userId: OWNER });
		await t.raw.videos.put('livestream:old', JSON.stringify({ id: 'old', title: 'Old', userId: OWNER, channelId: 'ch1', status: 'offline' }));
		t.db.db.prepare(`INSERT INTO live_sessions (id, stream_id, channel_id, provider, status, reason, created_at, owner_id) VALUES ('s-old', 'old', 'ch1', 'selfhosted', 'provisioned', 'test', 2, ?)`).run(OWNER);
		notifications.raw.prepare(`INSERT INTO channel_subscriptions (channel_id, subscriber_channel_id, user_id, id, created_at) VALUES ('chX', 'ch1', ?, 's1', 1)`).run(OWNER);
		t.db.db.prepare(`INSERT INTO channel_invites (id, channel_id, role, invitee_user_id, invitee_email, by_email, invited_by, status, created_at, expires_at) VALUES ('late', 'ch1', 'editor', ?, NULL, 0, ?, 'pending', '2026-01-01', '2030-01-01')`).run(OTHER, OWNER);
		const locked = () => !!t.db.db.prepare(`SELECT 1 FROM channel_transfer_locks WHERE channel_id = 'ch1' AND job_id LIKE 'reverify:%'`).get();
		const get = t.raw.channels.get.bind(t.raw.channels);
		/** Runs `hook` before the nth read of the channel under the repair's lock; how many reads there were. */
		const reverify = async (hook: (n: number) => Promise<void> | void) => {
			let n = 0;
			let busy = false;
			t.raw.channels.get = (async (...args: Parameters<typeof get>) => {
				if (!busy && args[0] === 'ch1' && locked()) {
					busy = true;
					await hook(++n);
					busy = false;
				}
				return get(...args);
			}) as typeof t.raw.channels.get;
			try {
				return { result: await reverifyRecentTransfers(t.env as never), reads: n };
			} finally {
				t.raw.channels.get = get as typeof t.raw.channels.get;
				await t.flush();
			}
		};
		const invite = () => (t.db.db.prepare(`SELECT status FROM channel_invites WHERE id = 'late'`).get() as { status: string }).status;
		const session = () => (t.db.db.prepare(`SELECT status FROM live_sessions WHERE id = 's-old'`).get() as { status: string }).status;
		const subscriber = () => (notifications.raw.prepare(`SELECT user_id FROM channel_subscriptions WHERE subscriber_channel_id = 'ch1'`).get() as { user_id: string }).user_id;
		return { ...t, edit, read, locked, reverify, invite, session, subscriber, schedules, notifications };
	}

	it('no move can start while a repair writes, at any step, and one can right after (CC-1c review)', async () => {
		const t = await leftBehind();
		const refusals: string[] = [];
		const { result, reads } = await t.reverify(async () => {
			refusals.push((await t.call('POST', '/channels/ch1/transfer', { newOwnerId: 'usr_third' }, { hold: true })).body.code);
			assert.ok(await openTransferJob(t.env as never, 'ch1'), 'Go live and handle edits wait too');
		});
		assert.deepEqual(result, { checked: 1, repaired: 1, failed: 0 });
		assert.ok(reads >= 12, `${reads} checks`);
		assert.deepEqual([...new Set(refusals)], ['transfer_in_progress']);
		assert.deepEqual([t.read(t.raw.videos, 'v1').userId, t.read(t.raw.playlists, 'pl1').userId, t.read(t.raw.videos, 'livestream:old').userId, t.read(t.raw.channel_tabs, 'channel-handles/ch1').userId, t.read(t.raw.community_posts, 'posts/ch1/p1.json').userId, t.subscriber()], [OTHER, OTHER, OTHER, OTHER, OTHER, OTHER]);
		assert.ok([...t.schedules.store.values()].every((v) => JSON.parse(v as string).userId === OTHER));
		assert.deepEqual([t.read(t.raw.profiles, OTHER).channels, t.read(t.raw.profiles, OWNER).channels, t.invite(), t.session()], [['ch1'], [], 'cancelled', 'ended']);
		assert.equal(t.locked(), false, 'released');
		assert.equal((await t.jobOf(await t.call('POST', '/channels/ch1/transfer', { newOwnerId: 'usr_third' }))).status, 'succeeded');
		assert.equal(t.read(t.raw.channels, 'ch1').userId, 'usr_third');
	});

	it('a repair whose channel moved on stops before its next write, quietly, after whichever write that is (CC-1c review)', async () => {
		// Every write a repair makes, in order; the channel moves on right after each one lands
		const schedule = `schedules:${scheduleKey(new Date('2030-01-01T00:00:00.000Z'), 'v1')}`;
		const writes = ['start', 'profiles:usr_other', 'profiles:usr_owner', 'channel_tabs:channel-handles/ch1', 'videos:v1', schedule, 'videos:livestream:old', 'session', 'playlists:pl1', 'community_posts:posts/ch1/p1.json', 'subscription', 'invite'];
		for (const last of writes) {
			for (const change of [{ userId: 'usr_third' }, { isDeleted: true }]) {
				const t = await leftBehind();
				const seen: string[] = [];
				let after: string | null = null;
				const state = () => JSON.stringify([t.raw.profiles, t.raw.channel_tabs, t.raw.videos, t.raw.playlists, t.raw.community_posts, t.schedules].map((b) => [...b.store.entries()])) + [t.invite(), t.session(), t.subscriber()].join();
				// What the other move writes: the channel, the profile and the handle entry are its own now
				const moveOn = () => {
					if (after !== null) return;
					t.edit(t.raw.channels, 'ch1', change);
					t.edit(t.raw.profiles, OTHER, { channels: [] });
					t.edit(t.raw.channel_tabs, 'channel-handles/ch1', { userId: 'usr_third' });
					after = state();
				};
				for (const [name, bucket] of Object.entries({ profiles: t.raw.profiles, channel_tabs: t.raw.channel_tabs, videos: t.raw.videos, playlists: t.raw.playlists, community_posts: t.raw.community_posts, schedules: t.schedules })) {
					const put = bucket.put.bind(bucket);
					bucket.put = (async (key: string, value: unknown, opts?: unknown) => {
						const written = await put(key, value as never, opts as never);
						seen.push(`${name}:${key}`);
						if (seen[seen.length - 1] === last) moveOn();
						return written;
					}) as typeof put;
				}
				// D1 writes: a trigger fires as the row changes; the state is taken once the statement is done
				const onRow = (db: { function: (name: string, fn: () => number) => void; exec: (sql: string) => void }, trigger: string) => {
					db.function('move_on', () => {
						queueMicrotask(moveOn);
						return 1;
					});
					db.exec(`CREATE TEMP TRIGGER t_move_on ${trigger} BEGIN SELECT move_on(); END`);
				};
				if (last === 'session') onRow(t.db.db as never, `AFTER UPDATE ON live_sessions WHEN NEW.status = 'ended'`);
				if (last === 'subscription') onRow(t.notifications.raw as never, 'AFTER UPDATE ON channel_subscriptions');
				if (last === 'invite') onRow(t.db.db as never, 'AFTER UPDATE ON channel_invites');
				const { result } = await t.reverify(() => {
					if (last === 'start') moveOn();
				});
				assert.notEqual(after, null, `${last} was never written: ${seen.join(', ')}`);
				assert.deepEqual(result, { checked: 1, repaired: 0, failed: 0 }, last);
				assert.equal(state(), after, `nothing written after ${last}`);
				assert.equal(t.locked(), false);
			}
		}
	});

	it('a repair whose worker died does not hold the channel: its lock goes stale, and it never releases another holder (CC-1c review)', async () => {
		const t = await leftBehind();
		const lock = (minutes: number) => t.db.db.prepare(`INSERT OR REPLACE INTO channel_transfer_locks (channel_id, job_id, created_at) VALUES ('ch1', 'reverify:dead', ?)`).run(new Date(Date.now() - minutes * 60_000).toISOString());
		lock(5);
		assert.equal((await t.call('POST', '/channels/ch1/transfer', { newOwnerId: 'usr_third' })).body.code, 'transfer_in_progress');
		assert.deepEqual(await reverifyRecentTransfers(t.env as never), { checked: 0, repaired: 0, failed: 0 });
		lock(21);
		assert.equal(await openTransferJob(t.env as never, 'ch1'), null);
		assert.deepEqual(await reverifyRecentTransfers(t.env as never), { checked: 1, repaired: 1, failed: 0 });
		assert.equal(t.read(t.raw.videos, 'v1').userId, OTHER);
		lock(21);
		assert.equal((await t.jobOf(await t.call('POST', '/channels/ch1/transfer', { newOwnerId: 'usr_third' }))).status, 'succeeded');
	});

	it('a repair releases only its own lock, and starts no write once its lock may be stale (CC-1c review)', async () => {
		const lock = (t: Awaited<ReturnType<typeof leftBehind>>) => ({ ...(t.db.db.prepare(`SELECT job_id FROM channel_transfer_locks WHERE channel_id = 'ch1'`).get() as { job_id: string } | undefined) });
		// Another holder has the lock by the time the repair ends
		const taken = await leftBehind();
		const { result } = await taken.reverify((n) => {
			if (n === 3) taken.db.db.prepare(`UPDATE channel_transfer_locks SET job_id = 'job-other' WHERE channel_id = 'ch1'`).run();
		});
		assert.equal(result.checked, 1);
		assert.deepEqual(lock(taken), { job_id: 'job-other' }, "the other holder's lock stays");
		// A repair that hangs: past its time it writes nothing more, reports it, and gives its lock back
		const slow = await leftBehind();
		const clock = Date.now;
		try {
			const late = await slow.reverify((n) => {
				if (n !== 5) return;
				Date.now = () => clock() + 16 * 60_000;
			});
			// The read that was running may still write its own step; the next check stops it
			assert.deepEqual(late.result, { checked: 1, repaired: 0, failed: 1 });
		} finally {
			Date.now = clock;
		}
		assert.deepEqual([slow.read(slow.raw.playlists, 'pl1').userId, slow.session(), slow.subscriber(), slow.invite()], [OWNER, 'provisioned', OWNER, 'pending'], 'nothing after the deadline');
		assert.deepEqual(lock(slow), {}, 'released');
		// The next run finishes it
		assert.deepEqual(await reverifyRecentTransfers(slow.env as never), { checked: 1, repaired: 1, failed: 0 });
	});

	it('a repair never takes a handle entry back from whoever holds it now (CC-1c review)', async () => {
		const t = await leftBehind();
		const { result } = await t.reverify((n) => {
			if (n === 2) t.edit(t.raw.channel_tabs, 'channel-handles/ch1', { userId: 'usr_third' });
		});
		assert.equal(t.read(t.raw.channel_tabs, 'channel-handles/ch1').userId, 'usr_third');
		assert.deepEqual(result, { checked: 1, repaired: 0, failed: 1 }, 'the mismatch is reported');
		// An entry that names nobody is completed
		const blank = await leftBehind();
		blank.edit(blank.raw.channel_tabs, 'channel-handles/ch1', { userId: undefined });
		assert.deepEqual((await blank.reverify(() => {})).result, { checked: 1, repaired: 1, failed: 0 });
		assert.equal(blank.read(blank.raw.channel_tabs, 'channel-handles/ch1').userId, OTHER);
	});

	it("a repair of a channel with more than 100 live streams ends only the sessions left from before, never the new owner's (CC-1c review)", async () => {
		const t = await leftBehind();
		for (let i = 0; i < 130; i++) {
			const id = `st${String(i).padStart(3, '0')}`;
			await t.raw.videos.put(`livestream:${id}`, JSON.stringify({ id, title: id, userId: OWNER, channelId: 'ch1', status: 'offline' }));
			t.db.db.prepare(`INSERT INTO live_sessions (id, stream_id, channel_id, provider, status, reason, created_at, owner_id) VALUES (?, ?, 'ch1', 'selfhosted', ?, 'test', 2, ?)`)
				.run(`ses${id}`, id, i % 2 ? 'live' : 'provisioned', i % 10 === 0 ? OTHER : i % 10 === 1 ? null : OWNER);
		}
		assert.deepEqual((await t.reverify(() => {})).result, { checked: 1, repaired: 1, failed: 0 });
		const sessions = t.db.db.prepare(`SELECT status, owner_id FROM live_sessions WHERE id LIKE 'sesst%'`).all() as Array<{ status: string; owner_id: string | null }>;
		assert.equal(sessions.length, 130);
		for (const s of sessions) assert.equal(s.status === 'ended', s.owner_id !== OTHER, JSON.stringify(s));
		assert.ok([...t.raw.videos.store.entries()].filter(([k]) => k.startsWith('livestream:')).every(([, v]) => JSON.parse(v as string).userId === OTHER));
		const plan = (t.db.db.prepare(`EXPLAIN QUERY PLAN SELECT * FROM live_sessions WHERE channel_id = 'ch1' AND status IN ('provisioned', 'live') AND (owner_id IS NULL OR owner_id <> 'x') AND id > '' ORDER BY id LIMIT 100`).all() as Array<{ detail: string }>).map((r) => r.detail).join(' | ');
		assert.match(plan, /idx_live_sessions_channel/, plan);
	});

	it('a move is refused while another move of the channel is open or the channel is on air', async () => {
		const { raw, env, jobs, call } = await setup({
			profiles: { [OWNER]: profile(OWNER, { channels: ['ch1'] }), [OTHER]: profile(OTHER), usr_third: profile('usr_third') },
		});
		const first = await call('POST', '/channels/ch1/transfer', { newOwnerId: OTHER }, { hold: true });
		assert.equal(first.status, 200);
		const second = await call('POST', '/channels/ch1/transfer', { newOwnerId: 'usr_third' }, { hold: true });
		assert.equal(second.status, 409);
		assert.equal(second.body.code, 'transfer_in_progress');
		await jobs.drain(env);

		await raw.videos.put('livestream:on', JSON.stringify({ id: 'on', title: 'Now', userId: OTHER, channelId: 'ch1', status: 'live' }));
		const live = await call('POST', '/channels/ch1/transfer', { newOwnerId: 'usr_third' });
		assert.equal(live.status, 409);
		assert.equal(live.body.code, 'channel_is_live');
	});

	it('a broadcast that starts after the request holds the move until it ends; a supported channel is not moved (review fixes)', async () => {
		const { raw, env, jobs, call, jobOf, db } = await setup();
		const res = await call('POST', '/channels/ch1/transfer', { newOwnerId: OTHER }, { hold: true });
		assert.equal(res.status, 200);
		await raw.videos.put('livestream:late', JSON.stringify({ id: 'late', title: 'Started late', userId: OWNER, channelId: 'ch1', status: 'live' }));
		await jobs.drain(env);
		let job = await jobOf(res);
		assert.notEqual(job.status, 'succeeded');
		assert.equal(JSON.parse(raw.channels.store.get('ch1')!).userId, OWNER, 'not flipped during the broadcast');
		raw.videos.store.set('livestream:late', JSON.stringify({ id: 'late', title: 'Started late', userId: OWNER, channelId: 'ch1', status: 'ended' }));
		jobs.pending.forEach((p: any) => { delete p.delaySeconds; });
		await call('GET', `/jobs/${res.body.result.job.id}`);
		await jobs.drain(env);
		job = await jobOf(res);
		if (job.status !== 'succeeded') {
			// The retry is queued with a delay; run it now
			await call('POST', `/jobs/${job.id}/retry`, {});
			job = await jobOf(res);
		}
		assert.equal(job.status, 'succeeded', JSON.stringify(job));
		assert.equal(JSON.parse(raw.channels.store.get('ch1')!).userId, OTHER);

		db.db.prepare(`INSERT INTO support_pledges (id, supporter_user_id, channel_id, collector, mode, amount, currency, status, started_at, created_at, updated_at) VALUES ('pl1', 'usr_fan', 'ch1', 'paygood', 'test', 500, 'USD', 'active', '2026', '2026', '2026')`).run();
		const refused = await call('POST', '/channels/ch1/transfer', { newOwnerId: OWNER });
		assert.equal(refused.status, 409);
		assert.equal(refused.body.code, 'channel_has_support');
	});

	it('the move lock is atomic, and a failed move keeps the channel from a third account until it is finished (review fixes)', async () => {
		const { raw, env, jobs, call, jobOf } = await setup({
			profiles: { [OWNER]: profile(OWNER, { channels: ['ch1'] }), [OTHER]: profile(OTHER), usr_third: profile('usr_third') },
		});
		// Two requests at the same moment: exactly one starts a move
		const both = await Promise.all([
			call('POST', '/channels/ch1/transfer', { newOwnerId: OTHER }, { hold: true }),
			call('POST', '/channels/ch1/transfer', { newOwnerId: 'usr_third' }, { hold: true }),
		]);
		assert.deepEqual(both.map((r) => r.status).sort(), [200, 409]);
		const started = both.find((r) => r.status === 200)!;
		// The move fails part way (a video write keeps failing): the lock stays with the failed job
		const put = raw.videos.put.bind(raw.videos);
		raw.videos.put = (async (key: string, value: unknown, opts?: unknown) => {
			if (key === 'v1') throw new Error('R2 write failed');
			return put(key, value as never, opts as never);
		}) as typeof raw.videos.put;
		for (let i = 0; i < 10 && jobs.pending.length; i++) {
			jobs.pending.forEach((p: any) => { delete p.delaySeconds; });
			await jobs.drain(env);
		}
		const failedJob = await jobOf(started);
		assert.equal(failedJob.status, 'failed', JSON.stringify(failedJob));
		const third = await call('POST', '/channels/ch1/transfer', { newOwnerId: OWNER });
		assert.equal(third.status, 409);
		assert.equal(third.body.code, 'transfer_unfinished', 'no new destination while records sit on the first owner');
		assert.equal((await call('POST', `/jobs/${failedJob.id}/cancel`, {})).status >= 400, true, 'a move cannot be cancelled half way');
		// Retry once the cause is gone: the move finishes and the lock is released
		raw.videos.put = put as typeof raw.videos.put;
		await call('POST', `/jobs/${failedJob.id}/retry`, {});
		assert.equal((await jobOf(started)).status, 'succeeded');
		assert.equal((await call('POST', '/channels/ch1/transfer', { newOwnerId: 'usr_third' })).status, 200);
	});

	it('a move ends every session that is not over, on air too, and waits until the provider confirms the stop (review fixes)', async () => {
		const { raw, call, jobOf, db } = await setup({
			videos: {
				v1: videoFixture({ id: 'v1', title: 'Tafsir lesson', userId: OWNER, channelId: 'ch1' }),
				'livestream:a': { id: 'a', title: 'A', userId: OWNER, channelId: 'ch1', status: 'scheduled', sessionId: 's-bunny' },
			},
		});
		db.db.prepare(`INSERT INTO live_sessions (id, stream_id, channel_id, provider, provider_ref, status, reason, created_at) VALUES ('s-bunny', 'a', 'ch1', 'bunny', 'ref1', 'provisioned', 'test', 1)`).run();
		// A session that goes on air in the moment between the job's live check and the flip
		const putChannel = raw.channels.put.bind(raw.channels);
		raw.channels.put = (async (key: string, value: unknown, opts?: unknown) => {
			if (key === 'ch1' && typeof value === 'string' && JSON.parse(value).userId === OTHER) {
				db.db.prepare(`INSERT OR IGNORE INTO live_sessions (id, stream_id, channel_id, provider, status, reason, created_at) VALUES ('s-air', 'a', 'ch1', 'selfhosted', 'live', 'test', 2)`).run();
			}
			return putChannel(key, value as never, opts as never);
		}) as typeof raw.channels.put;
		const realFetch = globalThis.fetch;
		let bunnyUp = false;
		let stops = 0;
		globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
			const url = String(input);
			if (url.includes('/live/ref1/stop')) {
				stops++;
				return new Response(bunnyUp ? '{}' : 'down', { status: bunnyUp ? 200 : 500 });
			}
			return realFetch(input, init);
		}) as typeof fetch;
		try {
			const res = await call('POST', '/channels/ch1/transfer', { newOwnerId: OTHER });
			let job = await jobOf(res);
			assert.notEqual(job.status, 'succeeded', 'not done while the provider still accepts the old key');
			assert.ok(stops >= 1);
			bunnyUp = true;
			await call('POST', `/jobs/${job.id}/retry`, {});
			job = await jobOf(res);
			assert.equal(job.status, 'succeeded', JSON.stringify(job));
			const row = db.db.prepare(`SELECT status, error FROM live_sessions WHERE id = 's-bunny'`).get() as { status: string; error: string | null };
			assert.deepEqual([row.status, row.error], ['ended', null]);
			assert.equal((db.db.prepare(`SELECT status FROM live_sessions WHERE id = 's-air'`).get() as { status: string }).status, 'ended');
		} finally {
			globalThis.fetch = realFetch;
		}
	});

	it('live checks see sessions on air and indexed streams; a move started a moment ago still blocks Go live; support set up later holds the job (Gemini review)', async () => {
		const { raw, env, jobs, call, jobOf, db } = await setup({
			videos: {
				v1: videoFixture({ id: 'v1', title: 'Tafsir lesson', userId: OWNER, channelId: 'ch1' }),
				'livestream:idx': { id: 'idx', title: 'Indexed', userId: OWNER, channelId: 'ch1', status: 'scheduled' },
			},
		});
		// The stream index is complete: the move takes the channel's streams from it
		await runOwnershipPass(raw as never, 'stream', { maxPages: 10 });
		// A session receiving video, while the stream record still says scheduled
		db.db.prepare(`INSERT INTO live_sessions (id, stream_id, channel_id, provider, status, reason, created_at) VALUES ('s-on', 'idx', 'ch1', 'selfhosted', 'live', 'test', 1)`).run();
		const live = await call('POST', '/channels/ch1/transfer', { newOwnerId: OTHER });
		assert.equal(live.body.code, 'channel_is_live');
		db.db.prepare(`UPDATE live_sessions SET status = 'ended' WHERE id = 's-on'`).run();

		// Between taking the lock and creating the job, the channel already counts as being moved
		db.db.prepare(`INSERT INTO channel_transfer_locks (channel_id, job_id, created_at) VALUES ('ch1', '', ?)`).run(new Date().toISOString());
		assert.equal(await openTransferJob(env as never, 'ch1'), 'starting');
		db.db.prepare(`DELETE FROM channel_transfer_locks WHERE channel_id = 'ch1'`).run();
		assert.equal(await openTransferJob(env as never, 'ch1'), null);

		// Support set up after the request: the job does not flip the owner
		const res = await call('POST', '/channels/ch1/transfer', { newOwnerId: OTHER }, { hold: true });
		assert.equal(res.status, 200);
		db.db.prepare(`INSERT INTO support_pledges (id, supporter_user_id, channel_id, collector, mode, amount, currency, status, started_at, created_at, updated_at) VALUES ('pl2', 'usr_fan', 'ch1', 'paygood', 'test', 500, 'USD', 'active', '2026', '2026', '2026')`).run();
		await jobs.drain(env);
		assert.notEqual((await jobOf(res)).status, 'succeeded');
		assert.equal(JSON.parse(raw.channels.store.get('ch1')!).userId, OWNER);
		// Once support is gone the move finishes, and the indexed stream moved with it
		db.db.prepare(`DELETE FROM support_pledges WHERE id = 'pl2'`).run();
		await call('POST', `/jobs/${res.body.result.job.id}/retry`, {});
		assert.equal((await jobOf(res)).status, 'succeeded');
		assert.equal(JSON.parse(raw.videos.store.get('livestream:idx')!).userId, OTHER);
	});

	it('Go live answers 409 transfer_in_progress while a move of the channel is open, from its first moment (Gemini review)', async () => {
		const { raw, env, db, call } = await setup({
			videos: {
				v1: videoFixture({ id: 'v1', title: 'Tafsir lesson', userId: OWNER, channelId: 'ch1' }),
				'livestream:go': { id: 'go', title: 'Friday', userId: OWNER, channelId: 'ch1', status: 'scheduled' },
			},
		});
		const app = buildApp((r) => r.post('/api/live-streams/:id/start', LiveStreamStart), { userId: OWNER });
		const start = async () => {
			const res = await app.request('/api/live-streams/go/start', { method: 'POST' }, env);
			return { status: res.status, body: (await res.json()) as { code?: string } };
		};
		// Between taking the lock and creating the job
		db.db.prepare(`INSERT INTO channel_transfer_locks (channel_id, job_id, created_at) VALUES ('ch1', '', ?)`).run(new Date().toISOString());
		assert.deepEqual(await start(), { status: 409, body: { success: false, code: 'transfer_in_progress', error: 'This channel is being moved to another account. Try again shortly.' } });
		db.db.prepare(`DELETE FROM channel_transfer_locks WHERE channel_id = 'ch1'`).run();
		// While the move's job is queued
		assert.equal((await call('POST', '/channels/ch1/transfer', { newOwnerId: OTHER }, { hold: true })).status, 200);
		assert.equal((await start()).body.code, 'transfer_in_progress');
		void raw;
	});

	it('a creator balance left on the channel counts as money attached, even with the payee closed (Gemini review)', async () => {
		const { raw, call, db } = await setup();
		const ledger = (id: string, account: string, amount: number) =>
			db.db.prepare(`INSERT INTO support_ledger (id, entry_id, entry_key, account, amount, currency, kind, channel_id, created_by, created_at) VALUES (?, ?, ?, ?, ?, 'USD', 'adjustment', 'ch1', 'test', '2026')`).run(id, `e-${id}`, `k-${id}`, account, amount);
		// Balanced to zero: no money attached
		ledger('l1', 'creator:ch1:available', -500);
		ledger('l2', 'creator:ch1:available', 500);
		ledger('l3', 'org:float', -500);
		const plan = (db.db.prepare(`EXPLAIN QUERY PLAN SELECT SUM(amount) FROM support_ledger WHERE channel_id = 'ch1' AND account >= 'creator:' AND account < 'creator;' GROUP BY account, currency`).all() as Array<{ detail: string }>).map((r) => r.detail).join(' | ');
		assert.match(plan, /idx_support_ledger_channel/, plan);
		// A leftover balance, payee or not
		ledger('l4', 'creator:ch1:available', -250);
		const refused = await call('POST', '/channels/ch1/transfer', { newOwnerId: OTHER });
		assert.equal(refused.body.code, 'channel_has_support');
		assert.equal(JSON.parse(raw.channels.store.get('ch1')!).userId, OWNER);
	});

	it("a move is refused when the receiver's tier has no room for another channel, admin moves too (CC-D12)", async () => {
		const { raw, call, db } = await setup({
			profiles: { [OWNER]: profile(OWNER, { channels: ['ch1'] }), [OTHER]: profile(OTHER, { channels: ['ch2'] }) },
			channels: { ch1: channel('ch1'), ch2: channel('ch2', { userId: OTHER }) },
		});
		db.db.prepare(`UPDATE creator_tiers SET max_channels = 1 WHERE id = 'creator'`).run();
		db.db.prepare(`UPDATE creator_tier_assignments SET tier_id = 'creator' WHERE user_id = ?`).run(OTHER);
		const refused = await call('POST', '/channels/ch1/transfer', { newOwnerId: OTHER });
		assert.equal(refused.status, 409);
		assert.equal(refused.body.code, 'new_owner_channel_limit');
		assert.equal(JSON.parse(raw.channels.store.get('ch1')!).userId, OWNER);
	});

	it('a move to a super admin goes through and leaves their automatic Unlimited tier in place (Gemini review)', async () => {
		const { raw, call, jobOf, db } = await setup();
		db.db.prepare(`UPDATE creator_tier_assignments SET tier_id = 'unlimited', assigned_by = 'system:super-admin' WHERE user_id = ?`).run(OTHER);
		const job = await jobOf(await call('POST', '/channels/ch1/transfer', { newOwnerId: OTHER }));
		assert.equal(job.status, 'succeeded', JSON.stringify(job));
		assert.equal(JSON.parse(raw.channels.store.get('ch1')!).userId, OTHER);
		const row = db.db.prepare('SELECT tier_id, assigned_by FROM creator_tier_assignments WHERE user_id = ?').get(OTHER) as { tier_id: string; assigned_by: string } | undefined;
		assert.deepEqual(row && [row.tier_id, row.assigned_by], ['unlimited', 'system:super-admin'], 'the check wrote nothing');
	});

	it("the previous owner's notice carries the admin's reason (CC-D11)", async () => {
		const { raw, call, jobOf } = await setup();
		const job = await jobOf(await call('POST', '/channels/ch1/transfer', { newOwnerId: OTHER, reason: 'Requested by the scholar' }));
		assert.equal(job.status, 'succeeded');
		const out = raw.queue.messages.map((m: any) => m.payload).find((p: any) => p?.recipientUserId === OWNER && String(p?.notificationKey).startsWith('channelMovedOut'));
		assert.deepEqual([out?.notificationKey, out?.params?.reason], ['channelMovedOutByTeamWithReason', 'Requested by the scholar']);
	});

	it('an owner moves a channel only to one of its admins, who accepts; the move runs at once (CC-6)', async () => {
		const { raw, env, jobs, db } = await setup({
			profiles: { [OWNER]: profile(OWNER, { channels: ['ch1'] }), [OTHER]: profile(OTHER, { displayName: 'Amina' }), usr_viewer: profile('usr_viewer') },
			channels: { ch1: channel('ch1', { members: [{ userId: OTHER, role: 'admin', addedBy: OWNER, addedAt: '2026' }, { userId: 'usr_viewer', role: 'editor', addedBy: OWNER, addedAt: '2026' }] }) },
		});
		const fresh = Math.floor(Date.now() / 1000);
		const refused = async (p: Promise<unknown>, code: string) => {
			await assert.rejects(p, (e: unknown) => e instanceof MoveError && e.code === code, code);
		};
		// Only the owner, only to an admin, with a recent sign-in and the handle typed
		assert.deepEqual((await moveReceivers(env as never, 'ch1', OWNER, 'ami')).map((r) => r.userId), [OTHER]);
		assert.deepEqual(await moveReceivers(env as never, 'ch1', OWNER, 'usr_viewer'), [], 'an editor is not offered');
		assert.deepEqual(await moveReceivers(env as never, 'ch1', OWNER, `${OTHER}@example.com`), [], 'never matched by an email');
		await refused(moveReceivers(env as never, 'ch1', OTHER, ''), 'not_owner');
		await refused(createMoveOffer(env as never, { channelId: 'ch1', ownerId: OWNER, toUserId: 'usr_viewer', typed: '@ch1', authTime: fresh }), 'receiver_not_channel_admin');
		await refused(createMoveOffer(env as never, { channelId: 'ch1', ownerId: OWNER, toUserId: OTHER, typed: '@ch1', authTime: fresh - 3600 }), 'reauth_required');
		await refused(createMoveOffer(env as never, { channelId: 'ch1', ownerId: OWNER, toUserId: OTHER, typed: '@wrong', authTime: fresh }), 'confirm_mismatch');
		const offer = await createMoveOffer(env as never, { channelId: 'ch1', ownerId: OWNER, toUserId: OTHER, typed: '@CH1', authTime: fresh });
		await refused(createMoveOffer(env as never, { channelId: 'ch1', ownerId: OWNER, toUserId: OTHER, typed: 'ch1', authTime: fresh }), 'offer_open');
		const offered = raw.queue.messages.map((m: any) => m.payload).find((p: any) => p?.notificationKey === 'channelMoveOffered');
		assert.deepEqual([offered?.recipientUserId, offered?.params?.channel], [OTHER, 'Channel ch1']);
		assert.equal((await myMoveOffers(env as never, OTHER, 'received')).offers.length, 1);
		// Someone else can't accept it; the admin does, and the move runs at once
		await refused(acceptMoveOffer(env as never, offer.id, 'usr_viewer'), 'offer_not_found');
		const { jobId } = await acceptMoveOffer(env as never, offer.id, OTHER);
		await jobs.drain(env);
		const moved = JSON.parse(raw.channels.store.get('ch1')!);
		assert.equal(moved.userId, OTHER);
		assert.ok(!(moved.members ?? []).some((m: any) => m.userId === OWNER), 'the previous owner keeps no access (CC-D4)');
		assert.ok(!(moved.members ?? []).some((m: any) => m.userId === OTHER), 'the new owner holds no member role');
		const row = db.db.prepare('SELECT status, job_id FROM channel_move_offers WHERE id = ?').get(offer.id) as { status: string; job_id: string };
		assert.deepEqual([row.status, row.job_id], ['moved', jobId]);
		const accepted = raw.queue.messages.map((m: any) => m.payload).find((p: any) => p?.notificationKey === 'channelMoveAccepted');
		assert.deepEqual([accepted?.recipientUserId, accepted?.params?.member], [OWNER, 'Amina']);
		// 30 days before the next move by an owner
		moved.members = [{ userId: OWNER, role: 'admin', addedBy: OTHER, addedAt: '2026' }];
		raw.channels.store.set('ch1', JSON.stringify(moved));
		await refused(createMoveOffer(env as never, { channelId: 'ch1', ownerId: OTHER, toUserId: OWNER, typed: '@ch1', authTime: fresh }), 'moved_recently');
	});

	it('offers can be declined, withdrawn or stopped by the team, and a paid channel is refused until admin approval exists (CC-6)', async () => {
		const { raw, env, db } = await setup({
			profiles: { [OWNER]: profile(OWNER, { channels: ['ch1'] }), [OTHER]: profile(OTHER) },
			channels: { ch1: channel('ch1', { members: [{ userId: OTHER, role: 'admin', addedBy: OWNER, addedAt: '2026' }] }) },
		});
		const fresh = Math.floor(Date.now() / 1000);
		const make = () => createMoveOffer(env as never, { channelId: 'ch1', ownerId: OWNER, toUserId: OTHER, typed: '@ch1', authTime: fresh });
		const keys = () => raw.queue.messages.map((m: any) => m.payload?.notificationKey).filter(Boolean);
		await declineMoveOffer(env as never, (await make()).id, OTHER);
		assert.ok(keys().includes('channelMoveDeclined'));
		await cancelMoveOffer(env as never, (await make()).id, OWNER);
		assert.ok(keys().includes('channelMoveCancelled'));
		const stopped = await stopMoveOffer(env as never, 'ch1', (await make()).id);
		assert.equal(stopped.status, 'stopped');
		const others = await make();
		await assert.rejects(stopMoveOffer(env as never, 'ch2', others.id), (e: unknown) => e instanceof MoveError && e.code === 'offer_not_found', 'another channel’s offer');
		await cancelMoveOffer(env as never, others.id, OWNER);
		assert.equal(keys().filter((k: string) => k === 'channelMoveStopped').length, 2, 'both sides are told');
		// An expired offer can't be accepted
		const old = await make();
		db.db.prepare(`UPDATE channel_move_offers SET expires_at = '2020-01-01T00:00:00.000Z' WHERE id = ?`).run(old.id);
		await assert.rejects(acceptMoveOffer(env as never, old.id, OTHER), (e: unknown) => e instanceof MoveError && e.code === 'offer_not_found');
		// A channel that accepts payments: refused until moves can wait for an admin's approval
		db.db.prepare(`INSERT INTO support_pledges (id, supporter_user_id, channel_id, collector, mode, amount, currency, status, started_at, created_at, updated_at) VALUES ('pl1', 'usr_fan', 'ch1', 'paygood', 'test', 500, 'USD', 'active', '2026', '2026', '2026')`).run();
		await assert.rejects(make(), (e: unknown) => e instanceof MoveError && e.code === 'channel_has_support');
		assert.equal(JSON.parse(raw.channels.store.get('ch1')!).userId, OWNER);
	});

	it('an accept claims the offer first: a cancel, decline or stop after the claim finds nothing open and tells nobody (CC-6 review)', async () => {
		const { raw, env, db } = await setup({
			profiles: { [OWNER]: profile(OWNER, { channels: ['ch1'] }), [OTHER]: profile(OTHER) },
			channels: { ch1: channel('ch1', { members: [{ userId: OTHER, role: 'admin', addedBy: OWNER, addedAt: '2026' }] }) },
		});
		const fresh = Math.floor(Date.now() / 1000);
		const offer = await createMoveOffer(env as never, { channelId: 'ch1', ownerId: OWNER, toUserId: OTHER, typed: '@ch1', authTime: fresh });
		const notices = () => raw.queue.messages.map((m: any) => m.payload?.notificationKey).filter((k: string) => k && k !== 'channelMoveOffered');
		// The accept's claim landed; the move has not started yet
		db.db.prepare(`UPDATE channel_move_offers SET status = 'accepting' WHERE id = ?`).run(offer.id);
		for (const lose of [() => cancelMoveOffer(env as never, offer.id, OWNER), () => declineMoveOffer(env as never, offer.id, OTHER), () => stopMoveOffer(env as never, 'ch1', offer.id)]) {
			await assert.rejects(lose(), (e: unknown) => e instanceof MoveError && e.code === 'offer_not_found');
		}
		assert.deepEqual(notices(), [], 'nobody is told about a cancel that lost');
		// A cancel that won first: the accept finds nothing to claim and moves nothing
		db.db.prepare(`UPDATE channel_move_offers SET status = 'offered' WHERE id = ?`).run(offer.id);
		await cancelMoveOffer(env as never, offer.id, OWNER);
		await assert.rejects(acceptMoveOffer(env as never, offer.id, OTHER), (e: unknown) => e instanceof MoveError && e.code === 'offer_not_found');
		assert.equal(JSON.parse(raw.channels.store.get('ch1')!).userId, OWNER);
		assert.equal((db.db.prepare(`SELECT COUNT(*) AS n FROM admin_jobs WHERE kind = 'channel.transfer'`).get() as { n: number }).n, 0, 'no move job');
	});

	it('expired offers can not be withdrawn or stopped and tell nobody; suspended channels, changed owners and demoted admins are refused (CC-6 review)', async () => {
		const { raw, env, db } = await setup({
			profiles: { [OWNER]: profile(OWNER, { channels: ['ch1'] }), [OTHER]: profile(OTHER) },
			channels: { ch1: channel('ch1', { members: [{ userId: OTHER, role: 'admin', addedBy: OWNER, addedAt: '2026' }] }) },
		});
		const fresh = Math.floor(Date.now() / 1000);
		const make = () => createMoveOffer(env as never, { channelId: 'ch1', ownerId: OWNER, toUserId: OTHER, typed: '@ch1', authTime: fresh });
		const status = (id: string) => (db.db.prepare('SELECT status FROM channel_move_offers WHERE id = ?').get(id) as { status: string }).status;
		const notices = () => raw.queue.messages.map((m: any) => m.payload?.notificationKey).filter((k: string) => k && k !== 'channelMoveOffered');
		const editChannel = (change: Record<string, unknown>) => raw.channels.store.set('ch1', JSON.stringify({ ...JSON.parse(raw.channels.store.get('ch1')!), ...change }));
		const refused = (p: Promise<unknown>, code: string) => assert.rejects(p, (e: unknown) => e instanceof MoveError && e.code === code, code);

		const old = await make();
		db.db.prepare(`UPDATE channel_move_offers SET expires_at = '2020-01-01T00:00:00.000Z' WHERE id = ?`).run(old.id);
		await refused(cancelMoveOffer(env as never, old.id, OWNER), 'offer_not_found');
		await refused(stopMoveOffer(env as never, 'ch1', old.id), 'offer_not_found');
		assert.equal(status(old.id), 'expired');
		assert.deepEqual(notices(), []);

		// Suspended: no offer, and an open offer can't be accepted (it stays open for after the suspension)
		const open = await make();
		editChannel({ isSuspended: true });
		await refused(acceptMoveOffer(env as never, open.id, OTHER), 'channel_suspended');
		assert.equal(status(open.id), 'offered', 'a passing refusal puts the offer back');
		editChannel({ isSuspended: false });

		// The receiver was demoted since the offer: refused for good
		editChannel({ members: [{ userId: OTHER, role: 'editor', addedBy: OWNER, addedAt: '2026' }] });
		await refused(acceptMoveOffer(env as never, open.id, OTHER), 'receiver_not_channel_admin');
		assert.equal(status(open.id), 'refused');

		// The owner changed since the offer: refused for good
		editChannel({ members: [{ userId: OTHER, role: 'admin', addedBy: OWNER, addedAt: '2026' }] });
		const third = await make();
		editChannel({ userId: 'usr_someone' });
		await refused(acceptMoveOffer(env as never, third.id, OTHER), 'owner_changed');
		assert.equal(status(third.id), 'refused');
		editChannel({ userId: OWNER, isSuspended: true });
		await refused(make(), 'channel_suspended');
		assert.equal(JSON.parse(raw.channels.store.get('ch1')!).userId, OWNER, 'nothing moved');
	});

	it('the offer routes answer through the error catalogue and run the whole flow (CC-6 review)', async () => {
		const { raw, env, jobs } = await setup({
			profiles: { [OWNER]: profile(OWNER, { channels: ['ch1'] }), [OTHER]: profile(OTHER, { displayName: 'Amina' }) },
			channels: { ch1: channel('ch1', { members: [{ userId: OTHER, role: 'admin', addedBy: OWNER, addedAt: '2026' }] }) },
		});
		const as = (userId: string, authTime = Math.floor(Date.now() / 1000)) => {
			const app = new Hono();
			app.onError(errorHandler);
			app.use('*', async (c, next) => {
				c.set('auth' as never, { userId, email: null, payload: { authTime } } as never);
				c.set('userId' as never, userId as never);
				await next();
			});
			const router = fromHono(app);
			router.get('/api/channels/:id/move-receivers', ChannelMoveReceivers);
			router.post('/api/channels/:id/move-offers', ChannelMoveOfferCreate);
			router.get('/api/move-offers', MyMoveOffers);
			router.post('/api/move-offers/:id/accept', MoveOfferAccept);
			router.post('/api/move-offers/:id/decline', MoveOfferDecline);
			router.delete('/api/move-offers/:id', MoveOfferCancel);
			return async (method: string, path: string, body?: unknown) => {
				const res = await app.request(path, { method, headers: { 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) }, env as never);
				return { status: res.status, body: (await res.json()) as any };
			};
		};
		const owner = as(OWNER);
		const admin = as(OTHER);
		assert.deepEqual((await owner('GET', '/api/channels/ch1/move-receivers?q=ami')).body.data.items.map((i: any) => i.userId), [OTHER]);
		const stale = await as(OWNER, 1)('POST', '/api/channels/ch1/move-offers', { toUserId: OTHER, confirm: '@ch1' });
		assert.deepEqual([stale.status, stale.body.code], [403, 'reauth_required']);
		const notOwner = await admin('POST', '/api/channels/ch1/move-offers', { toUserId: OTHER, confirm: '@ch1' });
		assert.deepEqual([notOwner.status, notOwner.body.code], [403, 'move_not_owner']);
		const made = await owner('POST', '/api/channels/ch1/move-offers', { toUserId: OTHER, confirm: '@ch1' });
		assert.equal(made.status, 200, JSON.stringify(made.body));
		const again = await owner('POST', '/api/channels/ch1/move-offers', { toUserId: OTHER, confirm: '@ch1' });
		assert.deepEqual([again.status, again.body.code], [409, 'offer_open']);
		assert.equal((await admin('GET', '/api/move-offers')).body.data.received[0].id, made.body.data.id);
		const wrong = await owner('POST', `/api/move-offers/${made.body.data.id}/accept`);
		assert.deepEqual([wrong.status, wrong.body.code], [404, 'offer_not_found']);
		const accepted = await admin('POST', `/api/move-offers/${made.body.data.id}/accept`);
		assert.equal(accepted.status, 200, JSON.stringify(accepted.body));
		await jobs.drain(env);
		assert.equal(JSON.parse(raw.channels.store.get('ch1')!).userId, OTHER);
		const gone = await owner('DELETE', `/api/move-offers/${made.body.data.id}`);
		assert.deepEqual([gone.status, gone.body.code], [404, 'offer_not_found']);
		assert.equal((await admin('POST', `/api/move-offers/${made.body.data.id}/decline`)).status, 404);
	});

	it('a cancel during an accept loses, and a channel that changed owner before the move took its lock is not moved (CC-6 review)', async () => {
		const { raw, env, jobs, db } = await setup({
			profiles: { [OWNER]: profile(OWNER, { channels: ['ch1'] }), [OTHER]: profile(OTHER), usr_third: profile('usr_third') },
			channels: { ch1: channel('ch1', { members: [{ userId: OTHER, role: 'admin', addedBy: OWNER, addedAt: '2026' }] }) },
		});
		const fresh = Math.floor(Date.now() / 1000);
		const make = () => createMoveOffer(env as never, { channelId: 'ch1', ownerId: OWNER, toUserId: OTHER, typed: '@ch1', authTime: fresh });
		const status = (id: string) => (db.db.prepare('SELECT status FROM channel_move_offers WHERE id = ?').get(id) as { status: string }).status;
		const locked = () => !!db.db.prepare(`SELECT 1 FROM channel_transfer_locks WHERE channel_id = 'ch1'`).get();
		const get = raw.channels.get.bind(raw.channels);
		// Another move of the channel finished between the accept's checks and its lock
		const offer = await make();
		let cancel: Promise<unknown> | undefined;
		raw.channels.get = (async (...args: Parameters<typeof get>) => {
			cancel ??= cancelMoveOffer(env as never, offer.id, OWNER).then(() => 'cancelled', (e: MoveError) => e.code);
			if (locked()) raw.channels.store.set('ch1', JSON.stringify({ ...JSON.parse(raw.channels.store.get('ch1')!), userId: 'usr_third' }));
			return get(...args);
		}) as typeof raw.channels.get;
		await assert.rejects(acceptMoveOffer(env as never, offer.id, OTHER), (e: unknown) => e instanceof MoveError && e.code === 'owner_changed');
		raw.channels.get = get as typeof raw.channels.get;
		assert.equal(await cancel, 'offer_not_found', 'the cancel during the accept is refused');
		assert.equal(status(offer.id), 'refused');
		assert.equal(locked(), false, 'the lock is released');
		assert.equal((db.db.prepare(`SELECT COUNT(*) AS n FROM admin_jobs WHERE kind = 'channel.transfer'`).get() as { n: number }).n, 0);
		// The owner is back: the next accept moves it
		raw.channels.store.set('ch1', JSON.stringify({ ...JSON.parse(raw.channels.store.get('ch1')!), userId: OWNER }));
		const next = await make();
		await acceptMoveOffer(env as never, next.id, OTHER);
		await jobs.drain(env);
		assert.equal(status(next.id), 'moved');
		assert.equal(JSON.parse(raw.channels.store.get('ch1')!).userId, OTHER);
	});

	it('an accept that never finished stops blocking after 10 minutes, and counts as a move when its job was created (CC-6 review)', async () => {
		const { raw, env, db } = await setup({
			profiles: { [OWNER]: profile(OWNER, { channels: ['ch1'] }), [OTHER]: profile(OTHER) },
			channels: { ch1: channel('ch1', { members: [{ userId: OTHER, role: 'admin', addedBy: OWNER, addedAt: '2026' }] }) },
		});
		const fresh = Math.floor(Date.now() / 1000);
		const make = () => createMoveOffer(env as never, { channelId: 'ch1', ownerId: OWNER, toUserId: OTHER, typed: '@ch1', authTime: fresh });
		const row = (id: string) => ({ ...(db.db.prepare('SELECT status, job_id FROM channel_move_offers WHERE id = ?').get(id) as { status: string; job_id: string | null }) });
		const claim = (id: string, minutesAgo: number) => db.db.prepare(`UPDATE channel_move_offers SET status = 'accepting', updated_at = ? WHERE id = ?`).run(new Date(Date.now() - minutesAgo * 60_000).toISOString(), id);
		const first = await make();
		claim(first.id, 5);
		await assert.rejects(make(), (e: unknown) => e instanceof MoveError && e.code === 'offer_open');
		claim(first.id, 11);
		const second = await make();
		assert.deepEqual([row(first.id), row(second.id).status], [{ status: 'refused', job_id: null }, 'offered']);
		// The worker died after queuing the move: the move counts for the 30-day limit
		claim(second.id, 11);
		db.db.prepare(`INSERT INTO admin_jobs (id, kind, target_kind, target_id, actor_id, status, params, created_at, updated_at) VALUES ('job-2', 'channel.transfer', 'channel', 'ch1', ?, 'succeeded', ?, ?, ?)`)
			.run(OWNER, JSON.stringify({ newOwnerId: OTHER, previousOwnerId: OWNER }), new Date(Date.now() - 10 * 60_000).toISOString(), new Date().toISOString());
		await assert.rejects(make(), (e: unknown) => e instanceof MoveError && e.code === 'moved_recently');
		assert.deepEqual(row(second.id), { status: 'moved', job_id: 'job-2' });
		assert.ok(raw.channels.store.has('ch1'));
		const plan = (db.db.prepare(`EXPLAIN QUERY PLAN SELECT id FROM admin_jobs WHERE target_kind = 'channel' AND target_id = 'ch1' AND created_at >= '2026' AND kind = 'channel.transfer' ORDER BY created_at LIMIT 1`).all() as Array<{ detail: string }>).map((r) => r.detail).join(' | ');
		assert.match(plan, /idx_admin_jobs_target/, plan);
	});

	it('a channel with a report under review is not offered or moved, and neither is one whose reports are unknown (CC-6 review)', async () => {
		const { raw, env } = await setup({
			profiles: { [OWNER]: profile(OWNER, { channels: ['ch1'] }), [OTHER]: profile(OTHER) },
			channels: { ch1: channel('ch1', { members: [{ userId: OTHER, role: 'admin', addedBy: OWNER, addedAt: '2026' }] }) },
		});
		Object.assign(env as Record<string, unknown>, { ADMIN_API_URL: 'https://admin.test', INTERNAL_API_KEY: { get: async () => 'k' } });
		const fresh = Math.floor(Date.now() / 1000);
		const make = () => createMoveOffer(env as never, { channelId: 'ch1', ownerId: OWNER, toUserId: OTHER, typed: '@ch1', authTime: fresh });
		const refused = (p: Promise<unknown>, code: string, status: number) => assert.rejects(p, (e: unknown) => e instanceof MoveError && e.code === code && e.status === status, code);
		const realFetch = globalThis.fetch;
		let answer: () => Response = () => Response.json({ success: true, result: { underReview: true } });
		const asked: Array<[string, string | null]> = [];
		globalThis.fetch = (async (input: string, init?: RequestInit) => {
			asked.push([String(input), new Headers(init?.headers).get('X-API-Key')]);
			return answer();
		}) as typeof fetch;
		try {
			await refused(make(), 'channel_under_review', 409);
			assert.deepEqual(asked, [['https://admin.test/internal/channel-reports/ch1', 'k']]);
			answer = () => new Response('down', { status: 502 });
			await refused(make(), 'move_check_unavailable', 503);
			answer = () => { throw new Error('unreachable'); };
			await refused(make(), 'move_check_unavailable', 503);
			answer = () => Response.json({ success: true, result: {} });
			await refused(make(), 'move_check_unavailable', 503);
			// Not configured: refused too, never skipped
			answer = () => Response.json({ success: true, result: { underReview: false } });
			Object.assign(env as Record<string, unknown>, { ADMIN_API_URL: '' });
			await refused(make(), 'move_check_unavailable', 503);
			Object.assign(env as Record<string, unknown>, { ADMIN_API_URL: undefined });
			await refused(make(), 'move_check_unavailable', 503);
			Object.assign(env as Record<string, unknown>, { ADMIN_API_URL: 'https://admin.test' });
			answer = () => Response.json({ success: true, result: { underReview: false } });
			const offer = await make();
			answer = () => Response.json({ success: true, result: { underReview: true } });
			await refused(acceptMoveOffer(env as never, offer.id, OTHER), 'channel_under_review', 409);
			answer = () => Response.json({ success: true, result: { underReview: false } });
			await acceptMoveOffer(env as never, offer.id, OTHER);
		} finally {
			globalThis.fetch = realFetch;
		}
		assert.ok(raw.channels.store.has('ch1'));
	});

	it("an erased account's offers close and no longer name it; its export lists them (CC-6)", async () => {
		const { env, db } = await setup({
			profiles: { [OWNER]: profile(OWNER, { channels: ['ch1'] }), [OTHER]: profile(OTHER) },
			channels: { ch1: channel('ch1', { members: [{ userId: OTHER, role: 'admin', addedBy: OWNER, addedAt: '2026' }] }) },
		});
		const fresh = Math.floor(Date.now() / 1000);
		const make = () => createMoveOffer(env as never, { channelId: 'ch1', ownerId: OWNER, toUserId: OTHER, typed: '@ch1', authTime: fresh });
		await declineMoveOffer(env as never, (await make()).id, OTHER);
		await make();
		const sdb = (env as { SEARCH_DB: D1Database }).SEARCH_DB;
		assert.deepEqual((await exportMoveOffers(sdb, OTHER)).map((o) => [o.direction, o.channelId, o.otherUserId, o.status]).sort(), [['received', 'ch1', OWNER, 'declined'], ['received', 'ch1', OWNER, 'offered']]);
		assert.equal((await exportMoveOffers(sdb, OWNER))[0].direction, 'sent');
		assert.deepEqual(await eraseMoveOffers(env as never, OTHER, 'deleted'), { closed: 1, received: [], flippedAt: 0 });
		const rows = (db.db.prepare('SELECT from_user_id, to_user_id, status FROM channel_move_offers ORDER BY status').all() as any[]).map((r) => ({ ...r }));
		assert.deepEqual(rows, [{ from_user_id: OWNER, to_user_id: 'deleted', status: 'cancelled' }, { from_user_id: OWNER, to_user_id: 'deleted', status: 'declined' }]);
		assert.deepEqual(await eraseMoveOffers(env as never, OWNER, 'deleted'), { closed: 0, received: [], flippedAt: 0 });
		assert.equal((db.db.prepare('SELECT COUNT(*) AS n FROM channel_move_offers WHERE from_user_id = ?').get(OWNER) as { n: number }).n, 0);
	});

	it('making an offer needs a fresh sign-in: auth_time counts, a refresh does not, and no auth_time is refused (CC-6 review)', async () => {
		const { env } = await setup({
			profiles: { [OWNER]: profile(OWNER, { channels: ['ch1'] }), [OTHER]: profile(OTHER) },
			channels: { ch1: channel('ch1', { members: [{ userId: OTHER, role: 'admin', addedBy: OWNER, addedAt: '2026' }] }) },
		});
		const ISSUER = 'https://auth.test.example';
		const { publicKey, privateKey } = await generateKeyPair('ES256');
		const jwk = { ...(await exportJWK(publicKey)), kid: 'k1', alg: 'ES256', use: 'sig' };
		const realFetch = globalThis.fetch;
		globalThis.fetch = (async (input: RequestInfo | URL) => {
			const { pathname } = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
			if (pathname === '/.well-known/oauth-authorization-server') return Response.json({ issuer: ISSUER, jwks_uri: `${ISSUER}/.well-known/jwks.json` });
			if (pathname === '/.well-known/jwks.json') return Response.json({ keys: [jwk] });
			return realFetch(input);
		}) as typeof fetch;
		__resetClientForTests();
		clearRevocationCache();
		try {
			const app = new Hono();
			app.onError(errorHandler);
			app.use('*', errorEnvelope);
			app.use('*', authMiddleware as never);
			fromHono(app).post('/api/channels/:id/move-offers', ChannelMoveOfferCreate);
			Object.assign(env as Record<string, unknown>, { Issuer: ISSUER, ClientId: 'client-1', ENVIRONMENT: 'production' });
			const now = Math.floor(Date.now() / 1000);
			// Every token is issued now (a refresh renews iat); only auth_time says when the person signed in
			const offer = async (authTime: number | undefined, lang = 'en') => {
				const token = await new SignJWT({ mode: 'access', type: 'user', properties: { id: OWNER, email: 'o@example.com' }, ...(authTime === undefined ? {} : { auth_time: authTime }) })
					.setProtectedHeader({ alg: 'ES256', kid: 'k1' }).setIssuer(ISSUER).setAudience('client-1').setSubject('user:o').setIssuedAt().setExpirationTime('15m').sign(privateKey);
				const res = await app.request('/api/channels/ch1/move-offers', { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'X-App-Locale': lang }, body: JSON.stringify({ toUserId: OTHER, confirm: '@ch1' }) }, env as never);
				return { status: res.status, body: (await res.json()) as any };
			};
			for (const stale of [now - 3600, now - 601 - 5, undefined]) {
				for (const [lang, text] of [['en', 'Sign in again to continue.'], ['ar', 'سجّل الدخول مرة أخرى للمتابعة.']]) {
					const { status, body } = await offer(stale, lang);
					assert.deepEqual([status, body.code, body.action, body.message], [403, 'reauth_required', 'sign_in', text], `auth_time ${stale}`);
				}
			}
			const fresh = await offer(now - 60);
			assert.equal(fresh.status, 200, JSON.stringify(fresh.body));
		} finally {
			globalThis.fetch = realFetch;
			__resetClientForTests();
			clearRevocationCache();
		}
	});

	it('the move routes answer their own texts and the other routes keep theirs, in both languages (CC-6 review)', async () => {
		const { raw, env, db } = await setup({
			profiles: { [OWNER]: profile(OWNER, { channels: ['ch1'] }), [OTHER]: profile(OTHER) },
			channels: { ch1: channel('ch1', { members: [{ userId: OTHER, role: 'admin', addedBy: OWNER, addedAt: '2026' }] }) },
			videos: { 'livestream:go': { id: 'go', title: 'Friday', userId: OWNER, channelId: 'ch1', status: 'scheduled' } },
		});
		const as = (userId: string) => {
			const app = new Hono();
			app.onError(errorHandler);
			app.use('*', errorEnvelope);
			app.use('*', async (c, next) => {
				c.set('auth' as never, { userId, email: null, payload: { authTime: Math.floor(Date.now() / 1000) } } as never);
				c.set('userId' as never, userId as never);
				await next();
			});
			app.use('/api/videos/*', channelIdMiddleware as never);
			app.post('/api/videos/upload', (c) => c.json({ ok: true }));
			app.route('/internal/scholars', scholarsInternal as never);
			const router = fromHono(app);
			router.post('/api/channels/:id/move-offers', ChannelMoveOfferCreate);
			router.post('/api/live-streams/:id/start', LiveStreamStart);
			return async (path: string, lang: string, body?: unknown, headers: Record<string, string> = {}, method = 'POST') => {
				const res = await app.request(path, { method, headers: { 'Content-Type': 'application/json', 'X-App-Locale': lang, ...headers }, ...(body ? { body: JSON.stringify(body) } : {}) }, env as never);
				return { status: res.status, body: (await res.json()) as any };
			};
		};
		const edit = (change: Record<string, unknown>) => raw.channels.store.set('ch1', JSON.stringify({ ...JSON.parse(raw.channels.store.get('ch1')!), ...change }));
		const move = async (code: string, texts: Record<'en' | 'ar', string>, opts: { userId?: string; confirm?: string; toUserId?: string } = {}) => {
			for (const lang of ['en', 'ar'] as const) {
				const { body } = await as(opts.userId ?? OWNER)('/api/channels/ch1/move-offers', lang, { toUserId: opts.toUserId ?? OTHER, confirm: opts.confirm ?? '@ch1' });
				assert.deepEqual([body.code, body.message, body.lang], [code, texts[lang], lang]);
			}
		};
		const other = async (what: string, run: (lang: string) => Promise<{ status: number; body: any }>, code: string, error: string, texts: Record<'en' | 'ar', string>) => {
			for (const lang of ['en', 'ar'] as const) {
				const { body } = await run(lang);
				assert.deepEqual([body.code, body.error, body.message], [code, error, texts[lang]], `${what} ${lang}`);
			}
		};
		const FORBIDDEN = { en: 'You don’t have permission to do this.', ar: 'ليست لديك صلاحية للقيام بهذا.' };
		const CONFLICT = { en: 'This changed while you were working on it. Reload and try again.', ar: 'تغيّر هذا أثناء عملك عليه. أعد التحميل وحاول مرة أخرى.' };

		await move('move_not_owner', { en: 'Only the channel owner can move it.', ar: 'لا ينقل القناة إلا مالكها.' }, { userId: OTHER });
		await move('move_confirm_mismatch', { en: 'Type the channel’s @handle to confirm.', ar: 'اكتب معرّف القناة لتأكيد النقل.' }, { confirm: '@nope' });
		await move('move_already_owner', { en: 'That account already owns this channel.', ar: 'هذا الحساب يملك القناة بالفعل.' }, { toUserId: OWNER });

		// Suspended: the move says so; uploading as the channel keeps its own answer
		edit({ isSuspended: true });
		await move('move_channel_suspended', { en: 'This channel is suspended, so it can’t be moved.', ar: 'هذه القناة موقوفة، فلا يمكن نقلها.' });
		await other('upload', (lang) => as(OWNER)('/api/videos/upload', lang, {}, { channelId: 'ch1' }), 'channel_suspended', 'This channel is suspended on Al Ummah Now videos', FORBIDDEN);
		edit({ isSuspended: false });

		// Being moved: Go live keeps its own answer
		db.db.prepare(`INSERT INTO channel_transfer_locks (channel_id, job_id, created_at) VALUES ('ch1', '', ?)`).run(new Date().toISOString());
		await move('move_in_progress', { en: 'This channel is already being moved. Try again once that finishes.', ar: 'يجري نقل هذه القناة بالفعل. حاول مرة أخرى بعد انتهائه.' });
		await other('go live', (lang) => as(OWNER)('/api/live-streams/go/start', lang), 'transfer_in_progress', 'This channel is being moved to another account. Try again shortly.', CONFLICT);
		db.db.prepare(`DELETE FROM channel_transfer_locks WHERE channel_id = 'ch1'`).run();

		// The report check can't be made: refused in words the owner can act on
		Object.assign(env as Record<string, unknown>, { ADMIN_API_URL: '' });
		await move('move_check_unavailable', { en: 'We couldn’t check this channel just now, so it wasn’t moved. Please try again shortly.', ar: 'تعذّر فحص هذه القناة الآن، فلم تُنقل. يُرجى المحاولة بعد قليل.' });
		Object.assign(env as Record<string, unknown>, { ADMIN_API_URL: 'https://admin.test' });

		// Scholar posts keep not_owner
		await other('scholar post', (lang) => as(OWNER)(`/internal/scholars/${OTHER}/articles/cms-1`, lang, { channelId: 'ch1', title: 'T', url: 'https://www.test/en/articles/t/', locale: 'en' }, {}, 'PUT'), 'not_owner', 'not_owner', FORBIDDEN);

		// A code other routes use never gets a catalogue text because of moves
		for (const [code, routeCode] of Object.entries(MOVE_ROUTE_CODES)) {
			assert.ok(!(code in API_ERROR_CATALOGUE), `${code} belongs to other routes`);
			assert.ok(routeCode in API_ERROR_CATALOGUE, routeCode);
		}
	});

	/**
	 * Erasing the sender or the receiver at each point of an accept: whichever comes first decides.
	 * Before the channel changes hands the move stops; after, it is the receiver's channel.
	 */
	for (const erased of ['receiver', 'sender'] as const) {
		const points: Array<[string, { answers: boolean; flipped: boolean }]> = [
			['the accept claimed the offer', { answers: false, flipped: false }],
			['before the move lock', { answers: false, flipped: false }],
			['under the lock, before the offer is confirmed', { answers: false, flipped: false }],
			['after the offer is confirmed', { answers: false, flipped: false }],
			['the job was made, the accept has not finished', { answers: false, flipped: false }],
			['the accept finished, the job has not run', { answers: true, flipped: false }],
			['the job runs, before the channel changes hands', { answers: true, flipped: false }],
			['the job checked the channel, and has not changed its owner', { answers: true, flipped: false }],
			['the channel changed hands, the accept has not finished', { answers: true, flipped: true }],
			['the job failed before the channel changed hands', { answers: true, flipped: false }],
			['the job failed before the channel changed hands, and an admin retries it', { answers: true, flipped: false }],
			['the job was made but not queued, the accept has not finished', { answers: false, flipped: false }],
			['the accept finished, then Auth is down', { answers: true, flipped: false }],
			['the channel changed hands, the job is not done', { answers: true, flipped: true }],
			['the move is done', { answers: true, flipped: true }],
		];
		for (const [point, { answers, flipped }] of points) {
			it(`erasing the ${erased} when ${point}: one rule (CC-6 review)`, async () => {
				const { raw, env, db, jobs, flush } = await setup({
					profiles: { [OWNER]: profile(OWNER, { channels: ['ch1'] }), [OTHER]: profile(OTHER) },
					channels: { ch1: channel('ch1', { members: [{ userId: OTHER, role: 'admin', addedBy: OWNER, addedAt: '2026' }] }) },
				});
				const offer = await createMoveOffer(env as never, { channelId: 'ch1', ownerId: OWNER, toUserId: OTHER, typed: '@ch1', authTime: Math.floor(Date.now() / 1000) });
				const gone = erased === 'receiver' ? OTHER : OWNER;
				let ran = 0;
				let busy = false;
				const erase = async () => {
					if (ran || busy) return;
					busy = true;
					ran++;
					const summary = await eraseUserData(env as never, gone, new OperationBudget(5000));
					assert.equal(summary.complete, true);
					busy = false;
				};
				// Where the erasure starts
				const channelsGet = raw.channels.get.bind(raw.channels);
				const channelsPut = raw.channels.put.bind(raw.channels);
				const profilesGet = raw.profiles.get.bind(raw.profiles);
				const prepare = db.prepare.bind(db);
				const send = jobs.send.bind(jobs);
				const locked = () => !!db.db.prepare(`SELECT 1 FROM channel_transfer_locks WHERE channel_id = 'ch1'`).get();
				let draining = false;
				raw.channels.get = (async (...args: Parameters<typeof channelsGet>) => {
					if (!busy && args[0] === 'ch1') {
						if (point === 'the accept claimed the offer') await erase();
						if (point === 'under the lock, before the offer is confirmed' && locked() && !draining) await erase();
						if (point === 'the job runs, before the channel changes hands' && draining) await erase();
						if (point === 'the job checked the channel, and has not changed its owner' && draining && ++jobReads === 2) await erase();
					}
					return channelsGet(...args);
				}) as typeof raw.channels.get;
				raw.channels.put = (async (...args: Parameters<typeof channelsPut>) => {
					const written = await channelsPut(...args);
					if (!busy && point === 'the channel changed hands, the job is not done' && args[0] === 'ch1' && JSON.parse(String(args[1])).userId === OTHER) await erase();
					return written;
				}) as typeof raw.channels.put;
				let jobReads = 0;
				let receiverReads = 0;
				raw.profiles.get = (async (...args: Parameters<typeof profilesGet>) => {
					if (!busy && point === 'before the move lock' && args[0] === OTHER && ++receiverReads === 1) await erase();
					return profilesGet(...args);
				}) as typeof raw.profiles.get;
				let offerReads = 0;
				db.prepare = ((sql: string) => {
					const statement = prepare(sql);
					if (busy || point !== 'after the offer is confirmed' || sql !== 'SELECT * FROM channel_move_offers WHERE id = ?' || !locked()) return statement;
					if (++offerReads !== 1) return statement;
					return { bind: (...args: unknown[]) => ({ first: async () => { const row = await (statement as any).bind(...args).first(); await erase(); return row; } }) };
				}) as typeof db.prepare;
				jobs.send = (async (...args: Parameters<typeof send>) => {
					if (!busy && point === 'the job was made but not queued, the accept has not finished') {
						await erase();
						throw new Error('queue down');
					}
					await send(...args);
					if (!busy && point === 'the job was made, the accept has not finished') await erase();
					if (!busy && point === 'the channel changed hands, the accept has not finished') {
						await jobs.drain(env);
						await erase();
					}
				}) as typeof jobs.send;

				const answer = await acceptMoveOffer(env as never, offer.id, OTHER).then(() => 'moved', (e: MoveError) => e.code);
				if (point === 'the accept finished, the job has not run' || point === 'the accept finished, then Auth is down') await erase();
				// A stopped move never ends as a failed job: it stops before anything that can fail
				if (point === 'the accept finished, then Auth is down') raw.AUTH_DB.fail = true;
				if (point.startsWith('the job failed')) {
					raw.AUTH_DB.fail = true;
					for (let i = 0; i < 10 && jobs.pending.length; i++) {
						jobs.pending.forEach((p: any) => { delete p.delaySeconds; });
						await jobs.drain(env);
					}
					assert.equal((db.db.prepare(`SELECT status FROM admin_jobs WHERE kind = 'channel.transfer'`).get() as { status: string }).status, 'failed');
					raw.AUTH_DB.fail = false;
					await erase();
					assert.equal(locked(), false, 'the lock goes with the move, not with an admin');
					if (point.endsWith('an admin retries it')) {
						const job = db.db.prepare(`SELECT id FROM admin_jobs WHERE kind = 'channel.transfer'`).get() as { id: string };
						await retryJob(env as never, job.id);
					}
				}
				draining = true;
				for (let i = 0; i < 10 && jobs.pending.length; i++) {
					jobs.pending.forEach((p: any) => { delete p.delaySeconds; });
					await jobs.drain(env);
				}
				if (point === 'the move is done') await erase();
				raw.AUTH_DB.fail = false;
				await flush();
				for (const [bucket, fns] of [[raw.channels, { get: channelsGet, put: channelsPut }], [raw.profiles, { get: profilesGet }], [db, { prepare }], [jobs, { send }]] as const) Object.assign(bucket, fns);

				assert.equal(ran, 1, 'the erasure ran at its point');
				assert.equal(answer === 'moved', answers, answer);
				const read = (b: any, key: string) => (b.store.has(key) ? JSON.parse(b.store.get(key)!) : null);
				const ch = read(raw.channels, 'ch1');
				const v1 = read(raw.videos, 'v1');
				assert.equal(read(raw.profiles, gone), null, 'the profile is gone');
				// Whose the channel ends up: nobody erased ever owns one
				const owner = erased === 'receiver' ? (flipped ? null : OWNER) : flipped ? OTHER : null;
				assert.equal(ch?.userId ?? null, owner, 'the channel');
				if (ch) assert.equal(v1?.userId, owner, 'its videos');
				else assert.equal(v1, null, 'its videos go with it');
				if (ch) assert.ok(!(ch.members ?? []).some((m: any) => m.userId === gone), 'no role left');
				const row = db.db.prepare('SELECT status, from_user_id, to_user_id FROM channel_move_offers WHERE id = ?').get(offer.id) as any;
				assert.deepEqual([row.status, row.from_user_id === gone || row.to_user_id === gone], [flipped ? 'moved' : 'cancelled', false]);
				// A lock may stay when the accept's worker never queued its job, and it holds nothing
				assert.equal(await openTransferJob(env as never, 'ch1'), null, 'nothing holds the channel');
				if (!point.includes('not queued')) assert.equal(locked(), false, 'no lock is left');
				const job = db.db.prepare(`SELECT status FROM admin_jobs WHERE kind = 'channel.transfer'`).get() as { status: string } | undefined;
				if (point.endsWith('Auth is down')) assert.equal(job!.status, 'succeeded');
				// A move that never changed hands says so on its job, however it ended
				const ended = db.db.prepare(`SELECT result FROM admin_jobs WHERE kind = 'channel.transfer' AND status = 'succeeded'`).all() as Array<{ result: string | null }>;
				for (const { result } of ended) if (!flipped) {
					const r = JSON.parse(result ?? '{}');
					assert.match(r.skipped ?? '', /^(stopped|channel_not_found)$/);
					assert.equal(r.changedHands, r.skipped === 'stopped' ? false : null, 'a stopped move says it did not change hands');
				}
				// The cooldown counts only a move that happened
				if (ch && !flipped) {
					raw.channels.store.set('ch1', JSON.stringify({ ...ch, members: [{ userId: 'usr_new', role: 'admin', addedBy: OWNER, addedAt: '2026' }] }));
					raw.profiles.store.set('usr_new', JSON.stringify(profile('usr_new')));
					db.db.prepare(`INSERT OR IGNORE INTO creator_tier_assignments (user_id, tier_id, source, assigned_by, assigned_at) VALUES ('usr_new', 'unlimited', 'admin', 'test', '2026-01-01T00:00:00.000Z')`).run();
					const next = await createMoveOffer(env as never, { channelId: 'ch1', ownerId: OWNER, toUserId: 'usr_new', typed: '@ch1', authTime: Math.floor(Date.now() / 1000) });
					await acceptMoveOffer(env as never, next.id, 'usr_new');
					await jobs.drain(env);
					const after = read(raw.channels, 'ch1');
					assert.deepEqual([after.userId, after.moveStopped], ['usr_new', undefined], 'a later move is not stopped, and the mark is gone');
				}
			});
		}
	}

	/**
	 * An offer made and accepted while the erasure runs, in the moments between its own steps: at no
	 * point does an erased account end up with a channel, whatever the accept and its job do when.
	 */
	const windows = {
		receiver: ['before its first look forgets the offers', 'before its profile goes', 'before its last look forgets the offers'],
		sender: ['before its first look forgets the offers'],
	} as const;
	const progress = ['claimed, and stalls before it is confirmed', 'confirmed, and stalls before its job is made', 'finished, and its job runs after the erasure', 'finished, and its job runs at once'] as const;
	for (const erased of ['receiver', 'sender'] as const) {
		for (const at of windows[erased]) {
			for (const how of progress) {
				it(`the ${erased}'s erasure, ${at}: an accept is ${how} (CC-6 review)`, async () => {
					const { raw, env, db, jobs, flush } = await setup({
						profiles: { [OWNER]: profile(OWNER, { channels: ['ch1'] }), [OTHER]: profile(OTHER) },
						channels: { ch1: channel('ch1', { members: [{ userId: OTHER, role: 'admin', addedBy: OWNER, addedAt: '2026' }] }) },
					});
					const gone = erased === 'receiver' ? OTHER : OWNER;
					const batch = db.batch.bind(db);
					const prepare = db.prepare.bind(db);
					const remove = raw.profiles.delete.bind(raw.profiles);
					let looks = 0;
					let started = false;
					let resume = () => {};
					let accepting: Promise<string> | undefined;
					const run = async () => {
						if (started) return;
						started = true;
						const stored = JSON.parse(raw.channels.store.get('ch1')!);
						raw.channels.store.set('ch1', JSON.stringify({ ...stored, members: [{ userId: OTHER, role: 'admin', addedBy: OWNER, addedAt: '2026' }] }));
						const offer = await createMoveOffer(env as never, { channelId: 'ch1', ownerId: OWNER, toUserId: OTHER, typed: '@ch1', authTime: Math.floor(Date.now() / 1000) });
						const stalls = how.includes('stalls');
						let reached = () => {};
						const stalled = new Promise<void>((resolve) => { reached = resolve; });
						const go = new Promise<void>((resolve) => { resume = resolve; });
						db.prepare = ((sql: string) => {
							const statement = prepare(sql);
							if (!stalls || sql !== 'SELECT * FROM channel_move_offers WHERE id = ?' || !db.db.prepare(`SELECT 1 FROM channel_transfer_locks WHERE channel_id = 'ch1'`).get()) return statement;
							db.prepare = prepare as typeof db.prepare;
							return { bind: (...args: unknown[]) => ({ first: async () => {
								const row = how.startsWith('confirmed') ? await (statement as any).bind(...args).first() : null;
								reached();
								await go;
								return row ?? (await (statement as any).bind(...args).first());
							} }) };
						}) as typeof db.prepare;
						accepting = acceptMoveOffer(env as never, offer.id, OTHER).then(() => 'moved', (e: MoveError) => e.code);
						await (stalls ? Promise.race([stalled, accepting]) : accepting);
						if (how.endsWith('at once')) await jobs.drain(env);
					};
					db.batch = (async (statements: any[]) => {
						if (statements.some((s) => /UPDATE channel_move_offers SET to_user_id/.test(s.sql))) {
							looks++;
							const last = !raw.profiles.store.has(gone);
							if ((at.startsWith('before its first') && looks === 1) || (at.startsWith('before its last') && last)) {
								// An accept reads the receiver's profile first: one this late read it before it went
								const put = last && !started ? JSON.stringify(profile(gone)) : null;
								if (put) raw.profiles.store.set(gone, put);
								await run();
								if (put) raw.profiles.store.delete(gone);
							}
						}
						return batch(statements);
					}) as typeof db.batch;
					raw.profiles.delete = (async (key: string) => {
						if (at === 'before its profile goes' && [key].flat().includes(gone)) await run();
						return remove(key);
					}) as typeof remove;

					const summary = await eraseUserData(env as never, gone, new OperationBudget(5000));
					assert.equal(summary.complete, true);
					assert.equal(started, true);
					resume();
					const answer = await accepting;
					for (let i = 0; i < 10 && jobs.pending.length; i++) {
						jobs.pending.forEach((p: any) => { delete p.delaySeconds; });
						await jobs.drain(env);
					}
					await flush();
					Object.assign(db, { batch, prepare });

					const ch = raw.channels.store.has('ch1') ? JSON.parse(raw.channels.store.get('ch1')!) : null;
					const flipped = how.endsWith('at once');
					assert.equal(ch?.userId ?? null, erased === 'receiver' ? (flipped ? null : OWNER) : flipped ? OTHER : null, 'the channel');
					if (how.includes('stalls')) assert.notEqual(answer, 'moved');
					assert.equal(raw.profiles.store.has(gone), false);
					const row = db.db.prepare('SELECT status, from_user_id, to_user_id FROM channel_move_offers').get() as any;
					assert.deepEqual([row.status, row.from_user_id === gone || row.to_user_id === gone], [flipped ? 'moved' : row.status === 'refused' ? 'refused' : 'cancelled', false]);
					assert.equal(await openTransferJob(env as never, 'ch1'), null);
					assert.equal(db.db.prepare(`SELECT 1 FROM channel_transfer_locks WHERE channel_id = 'ch1'`).get(), undefined, 'no lock is left');
					assert.equal((db.db.prepare(`SELECT COUNT(*) AS n FROM admin_jobs WHERE status = 'failed'`).get() as { n: number }).n, 0);
				});
			}
		}
	}

	/** The move finished on a worker whose clock is ahead: the channel says it came after the run began. */
	for (const when of ['before the run begins', 'while the run goes on'] as const) {
		for (const index of ['the index knows it', 'the index has not followed', 'a pass dies after its first look'] as const) {
			it(`a channel moved by a fast clock ${when} is erased with its receiver: ${index} (CC-6 review)`, async () => {
				const { raw, env, db, jobs, flush } = await setup({
					profiles: { [OWNER]: profile(OWNER, { channels: ['ch1'] }), [OTHER]: profile(OTHER) },
					channels: { ch1: channel('ch1', { members: [{ userId: OTHER, role: 'admin', addedBy: OWNER, addedAt: '2026' }] }) },
				});
				if (index !== 'a pass dies after its first look') {
					// The erase finds the channels through the indexes
					db.db.prepare(`INSERT OR REPLACE INTO search_meta (key, value, updated_at) VALUES (?, '1', 1)`).run(footprintCompleteKey('channels'));
				}
				if (index === 'the index has not followed') {
					// Every index the erase reads is complete, and one row is behind
					db.db.prepare(`CREATE TRIGGER lag AFTER UPDATE OF owner_id ON content_ownership WHEN NEW.kind = 'channel' AND NEW.owner_id = '${OTHER}' BEGIN UPDATE content_ownership SET owner_id = '${OWNER}' WHERE kind = 'channel' AND id = NEW.id; END`).run();
				}
				const move = async () => {
					raw.channels.store.set('ch1', JSON.stringify({ ...JSON.parse(raw.channels.store.get('ch1')!), members: [{ userId: OTHER, role: 'admin', addedBy: OWNER, addedAt: '2026' }] }));
					const offer = await createMoveOffer(env as never, { channelId: 'ch1', ownerId: OWNER, toUserId: OTHER, typed: '@ch1', authTime: Math.floor(Date.now() / 1000) });
					await acceptMoveOffer(env as never, offer.id, OTHER);
					await jobs.drain(env);
					assert.equal((db.db.prepare(`SELECT status FROM admin_jobs WHERE kind = 'channel.transfer'`).get() as { status: string }).status, 'succeeded');
					raw.channels.store.set('ch1', JSON.stringify({ ...JSON.parse(raw.channels.store.get('ch1')!), transferredAt: new Date(Date.now() + 5000).toISOString() }));
				};
				let moved = false;
				if (when === 'before the run begins') {
					moved = true;
					await move();
				}
				let die = index === 'a pass dies after its first look';
				const list = raw.reports.list.bind(raw.reports);
				const watch = raw.watch_history.list.bind(raw.watch_history);
				raw.watch_history.list = (async (...args: Parameters<typeof watch>) => {
					if (moved && die) {
						die = false;
						throw new Error('worker gone');
					}
					return watch(...args);
				}) as typeof watch;
				raw.reports.list = (async (...args: Parameters<typeof list>) => {
					if (!moved) {
						moved = true;
						await move();
					}
					return list(...args);
				}) as typeof list;
				const erase = () => eraseUserData(env as never, OTHER, new OperationBudget(5000));
				const summary = await erase().catch((error) => {
					assert.match(String(error), /worker gone/);
					return erase();
				});
				await flush();
				assert.equal(summary.complete, true);
				assert.deepEqual([moved, die], [true, false]);
				assert.equal(raw.channels.store.has('ch1'), false, 'no channel is left to an erased account');
				assert.equal(raw.profiles.store.has(OTHER), false);
				assert.equal((db.db.prepare('SELECT COUNT(*) AS n FROM channel_move_offers WHERE to_user_id = ?').get(OTHER) as { n: number }).n, 0);
			});
		}
	}

	it('an old move whose channel went on to someone else only loses the id, and one that came back is erased (CC-6 review)', async () => {
		const { raw, env, db } = await setup({
			profiles: { [OWNER]: profile(OWNER), [OTHER]: profile(OTHER) },
			channels: { ch1: channel('ch1'), ch2: channel('ch2', { userId: OTHER, transferredAt: '2026-03-01T00:00:00.000Z' }) },
		});
		const ins = db.db.prepare(`INSERT INTO channel_move_offers (id, channel_id, from_user_id, to_user_id, status, job_id, created_at, expires_at, updated_at) VALUES (?, ?, 'usr_x', ?, 'moved', NULL, '2026', '2099', '2026')`);
		ins.run('went-on', 'ch1', OTHER);
		ins.run('kept', 'ch2', OTHER);
		ins.run('gone', 'ch3', OTHER);
		raw.channels.store.set('ch4', '{');
		ins.run('unreadable', 'ch4', OTHER);
		assert.deepEqual(await eraseMoveOffers(env as never, OTHER, 'deleted'), { closed: 0, received: ['ch2'], flippedAt: Date.parse('2026-03-01T00:00:00.000Z') });
		assert.deepEqual(db.db.prepare('SELECT id, to_user_id, status FROM channel_move_offers ORDER BY id').all().map((r) => Object.values(r as object)), [['gone', 'deleted', 'moved'], ['kept', OTHER, 'moved'], ['unreadable', 'deleted', 'moved'], ['went-on', 'deleted', 'moved']]);
		assert.equal('moveStopped' in JSON.parse(raw.channels.store.get('ch1')!), false);
		assert.equal((await eraseUserData(env as never, OTHER, new OperationBudget(5000))).complete, true);
		assert.deepEqual([...raw.channels.store.keys()], ['ch1', 'ch4']);
		const plan = (db.db.prepare(`EXPLAIN QUERY PLAN ${RECEIVED_OFFERS_SQL}`).all('x') as Array<{ detail: string }>).map((r) => r.detail).join(' | ');
		assert.match(plan, /SEARCH channel_move_offers USING INDEX idx_channel_move_offers_to \(to_user_id=\? AND status=\?\)/, plan);
	});

	it('an erasure leaves locks that are not the stopped move’s (CC-6 review)', async () => {
		const { raw, env, db, jobs } = await setup({
			profiles: { [OWNER]: profile(OWNER, { channels: ['ch1'] }), [OTHER]: profile(OTHER) },
			channels: { ch1: channel('ch1', { members: [{ userId: OTHER, role: 'admin', addedBy: OWNER, addedAt: '2026' }] }) },
		});
		const offer = await createMoveOffer(env as never, { channelId: 'ch1', ownerId: OWNER, toUserId: OTHER, typed: '@ch1', authTime: Math.floor(Date.now() / 1000) });
		await acceptMoveOffer(env as never, offer.id, OTHER);
		// A later request is starting (its lock names no job yet)
		const later = new Date(Date.now() + 60_000).toISOString();
		db.db.prepare(`UPDATE channel_transfer_locks SET job_id = '', created_at = ? WHERE channel_id = 'ch1'`).run(later);
		await eraseUserData(env as never, OTHER, new OperationBudget(5000));
		for (let i = 0; i < 3; i++) await jobs.drain(env);
		assert.equal(JSON.parse(raw.channels.store.get('ch1')!).userId, OWNER);
		assert.deepEqual({ ...(db.db.prepare('SELECT job_id, created_at FROM channel_transfer_locks').get() as object) }, { job_id: '', created_at: later });
		db.db.prepare(`DELETE FROM channel_transfer_locks`).run();
		const plan = (db.db.prepare(`EXPLAIN QUERY PLAN ${TRANSFER_LOCK_SQL}`).all('x') as Array<{ detail: string }>).map((r) => r.detail);
		assert.equal(plan.some((d) => /^SCAN/.test(d)), false, plan.join(' | '));
	});

	it('a lock update that fails once the move is queued does not answer as a refusal (CC-6 review)', async () => {
		const { raw, env, db, jobs } = await setup({
			profiles: { [OWNER]: profile(OWNER, { channels: ['ch1'] }), [OTHER]: profile(OTHER) },
			channels: { ch1: channel('ch1', { members: [{ userId: OTHER, role: 'admin', addedBy: OWNER, addedAt: '2026' }] }) },
		});
		const offer = await createMoveOffer(env as never, { channelId: 'ch1', ownerId: OWNER, toUserId: OTHER, typed: '@ch1', authTime: Math.floor(Date.now() / 1000) });
		const prepare = db.prepare.bind(db);
		db.prepare = ((sql: string) => {
			if (/^UPDATE channel_transfer_locks/.test(sql)) throw new Error('D1 down');
			return prepare(sql);
		}) as typeof db.prepare;
		await acceptMoveOffer(env as never, offer.id, OTHER);
		db.prepare = prepare as typeof db.prepare;
		assert.equal((db.db.prepare('SELECT status FROM channel_move_offers').get() as { status: string }).status, 'moved');
		await jobs.drain(env);
		assert.equal(JSON.parse(raw.channels.store.get('ch1')!).userId, OTHER);
		assert.equal(db.db.prepare('SELECT 1 FROM channel_transfer_locks').get(), undefined);
	});

	it('a move names itself only on its own lock, and only while its offer is between the same two people (CC-6 review)', async () => {
		const { raw, env, db, jobs } = await setup({
			profiles: { [OWNER]: profile(OWNER, { channels: ['ch1'] }), [OTHER]: profile(OTHER) },
			channels: { ch1: channel('ch1', { members: [{ userId: OTHER, role: 'admin', addedBy: OWNER, addedAt: '2026' }] }) },
		});
		const make = () => createMoveOffer(env as never, { channelId: 'ch1', ownerId: OWNER, toUserId: OTHER, typed: '@ch1', authTime: Math.floor(Date.now() / 1000) });
		const prepare = db.prepare.bind(db);
		// The row no longer names the receiver, then the sender, by the time it is confirmed
		for (const side of ['to_user_id', 'from_user_id']) {
			const offer = await make();
			let changed = false;
			db.prepare = ((sql: string) => {
				if (!changed && /^INSERT OR IGNORE INTO channel_transfer_locks/.test(sql)) {
					changed = true;
					db.db.prepare(`UPDATE channel_move_offers SET ${side} = 'deleted-user' WHERE id = ?`).run(offer.id);
				}
				return prepare(sql);
			}) as typeof db.prepare;
			await assert.rejects(acceptMoveOffer(env as never, offer.id, OTHER), (e: unknown) => e instanceof MoveError && e.code === 'offer_not_found');
			db.prepare = prepare as typeof db.prepare;
			assert.equal((db.db.prepare('SELECT COUNT(*) AS n FROM admin_jobs').get() as { n: number }).n, 0);
			assert.equal(db.db.prepare('SELECT 1 FROM channel_transfer_locks').get(), undefined);
			db.db.prepare(`UPDATE channel_move_offers SET status = 'refused' WHERE id = ?`).run(offer.id);
		}
		// The job ran and another request is starting before the first names its lock
		const offer = await make();
		const later = new Date(Date.now() + 60_000).toISOString();
		const send = jobs.send.bind(jobs);
		jobs.send = (async (...args: Parameters<typeof send>) => {
			await send(...args);
			await jobs.drain(env);
			db.db.prepare(`INSERT INTO channel_transfer_locks (channel_id, job_id, created_at) VALUES ('ch1', '', ?)`).run(later);
		}) as typeof jobs.send;
		await acceptMoveOffer(env as never, offer.id, OTHER);
		assert.equal(JSON.parse(raw.channels.store.get('ch1')!).userId, OTHER);
		assert.deepEqual({ ...(db.db.prepare('SELECT job_id, created_at FROM channel_transfer_locks').get() as object) }, { job_id: '', created_at: later });
	});

	for (const when of ['reads the subscriptions', 'moved them as the profile goes'] as const) {
		it(`a receiver erased while the job ${when}: no subscription names them afterwards (CC-6 review)`, async () => {
			const { raw, env, jobs, flush } = await setup({
				profiles: { [OWNER]: profile(OWNER, { channels: ['ch1'] }), [OTHER]: profile(OTHER) },
				channels: { ch1: channel('ch1', { members: [{ userId: OTHER, role: 'admin', addedBy: OWNER, addedAt: '2026' }] }) },
			});
			const notifications = createSqliteD1();
			(env as Record<string, unknown>).NOTIFICATIONS_DB = notifications;
			const subscribe = (userId: string) => notifications.raw.prepare(`INSERT INTO channel_subscriptions (channel_id, subscriber_channel_id, user_id, id, created_at) VALUES ('chX', 'ch1', ?, 's1', 1)`).run(userId);
			const offer = await createMoveOffer(env as never, { channelId: 'ch1', ownerId: OWNER, toUserId: OTHER, typed: '@ch1', authTime: Math.floor(Date.now() / 1000) });
			await acceptMoveOffer(env as never, offer.id, OTHER);
			const erase = () => eraseUserData(env as never, OTHER, new OperationBudget(5000));
			let ran = false;
			if (when === 'reads the subscriptions') {
				subscribe(OWNER);
				const prepare = notifications.prepare.bind(notifications);
				notifications.prepare = ((sql: string) => {
					const statement = prepare(sql) as any;
					if (ran || !/^SELECT channel_id FROM channel_subscriptions WHERE user_id = \? AND subscriber_channel_id/.test(sql)) return statement;
					return { bind: (...args: unknown[]) => ({ all: async () => {
						const found = await statement.bind(...args).all();
						ran = true;
						await erase();
						// The channel's rows as the job read them, whatever the erasure did with them
						notifications.raw.prepare(`DELETE FROM channel_subscriptions`).run();
						subscribe(OWNER);
						return found;
					} }) };
				}) as typeof prepare;
				for (let i = 0; i < 5 && jobs.pending.length; i++) {
					jobs.pending.forEach((p: any) => { delete p.delaySeconds; });
					await jobs.drain(env);
				}
			} else {
				await jobs.drain(env);
				const remove = raw.profiles.delete.bind(raw.profiles);
				raw.profiles.delete = (async (key: string) => {
					if (!ran) subscribe(OTHER);
					ran = true;
					return remove(key);
				}) as typeof remove;
				await erase();
			}
			await flush();
			assert.equal(ran, true);
			assert.equal((notifications.raw.prepare('SELECT COUNT(*) AS n FROM channel_subscriptions WHERE user_id = ?').get(OTHER) as { n: number }).n, 0);
			assert.equal(await openTransferJob(env as never, 'ch1'), null);
		});
	}

	it('an owner’s move never takes a channel from anyone but that owner (CC-6 review)', async () => {
		const { raw, env, db, jobs } = await setup({
			profiles: { [OWNER]: profile(OWNER, { channels: ['ch1'] }), [OTHER]: profile(OTHER), usr_third: profile('usr_third') },
			channels: { ch1: channel('ch1', { members: [{ userId: OTHER, role: 'admin', addedBy: OWNER, addedAt: '2026' }] }) },
		});
		const offer = await createMoveOffer(env as never, { channelId: 'ch1', ownerId: OWNER, toUserId: OTHER, typed: '@ch1', authTime: Math.floor(Date.now() / 1000) });
		await acceptMoveOffer(env as never, offer.id, OTHER);
		raw.channels.store.set('ch1', JSON.stringify({ ...JSON.parse(raw.channels.store.get('ch1')!), userId: 'usr_third' }));
		await jobs.drain(env);
		assert.equal(JSON.parse(raw.channels.store.get('ch1')!).userId, 'usr_third');
		assert.equal(db.db.prepare('SELECT 1 FROM channel_transfer_locks').get(), undefined);
	});

	it('a stopped move does not hide the move before it from the daily re-verify (CC-6 review)', async () => {
		const { raw, env, db, call, jobOf, jobs } = await setup({ profiles: { [OWNER]: profile(OWNER, { channels: ['ch1'] }), [OTHER]: profile(OTHER), usr_third: profile('usr_third') } });
		assert.equal((await jobOf(await call('POST', '/channels/ch1/transfer', { newOwnerId: OTHER }))).status, 'succeeded');
		raw.channels.store.set('ch1', JSON.stringify({ ...JSON.parse(raw.channels.store.get('ch1')!), members: [{ userId: 'usr_third', role: 'admin', addedBy: OTHER, addedAt: '2026' }] }));
		const offer = await createMoveOffer(env as never, { channelId: 'ch1', ownerId: OTHER, toUserId: 'usr_third', typed: '@ch1', authTime: Math.floor(Date.now() / 1000) });
		await acceptMoveOffer(env as never, offer.id, 'usr_third');
		await eraseUserData(env as never, 'usr_third', new OperationBudget(5000));
		db.db.prepare(`UPDATE admin_jobs SET updated_at = '2099-01-01T00:00:00.000Z' WHERE status = 'queued'`).run();
		await jobs.drain(env);
		raw.videos.store.set('v1', JSON.stringify({ ...JSON.parse(raw.videos.store.get('v1')!), userId: OWNER }));
		assert.deepEqual(await reverifyRecentTransfers(env as never), { checked: 1, repaired: 1, failed: 0 });
		assert.equal(JSON.parse(raw.videos.store.get('v1')!).userId, OTHER);
	});

	it('a move whose retry found the channel deleted still counts once the channel is back (CC-6 review)', async () => {
		const { raw, env, db, call, jobOf } = await setup();
		assert.equal((await jobOf(await call('POST', '/channels/ch1/transfer', { newOwnerId: OTHER }))).status, 'succeeded');
		db.db.prepare(`UPDATE admin_jobs SET result = '{"skipped":"channel_deleted"}' WHERE kind = 'channel.transfer'`).run();
		raw.videos.store.set('v1', JSON.stringify({ ...JSON.parse(raw.videos.store.get('v1')!), userId: OWNER }));
		assert.deepEqual(await reverifyRecentTransfers(env as never), { checked: 1, repaired: 1, failed: 0 });
		assert.equal(JSON.parse(raw.videos.store.get('v1')!).userId, OTHER);
	});

	it('the stop mark is in no view and no export (CC-6 review)', async () => {
		const { raw, env } = await setup({
			profiles: { [OWNER]: profile(OWNER, { channels: ['ch1'] }) },
			channels: { ch1: channel('ch1', { moveStopped: 'offer-1' }) },
		});
		const stored = JSON.parse(raw.channels.store.get('ch1')!);
		const [view] = await toPublicChannels(undefined as never, [stored], env as never);
		const exported = await collectUserData(env as never, OWNER, new OperationBudget(5000));
		assert.equal(exported.channels.length, 1);
		const app = buildApp((router) => {
			router.get('/channels/:id/owner', ChannelOwnerFetch);
			router.put('/channels/:id', ChannelUpdate);
		}, { userId: OWNER });
		app.put('/channels/:id/avatar', handleChannelAvatarUpdate as never);
		app.put('/channels/:id/cover', handleChannelCoverUpdate as never);
		const answers: Record<string, string> = { public: JSON.stringify(view), export: JSON.stringify(exported) };
		const image = () => {
			const form = new FormData();
			form.set('photo', new File([new Uint8Array([1])], 'a.png', { type: 'image/png' }));
			return { body: form };
		};
		const realFetch = globalThis.fetch;
		globalThis.fetch = (async () => new Response('{}', { status: 201 })) as typeof fetch;
		try {
			const full = Object.assign(env as object, { image_storage_key: 'k', ZONE: 'zone' });
			for (const [method, path, init] of [['GET', '/owner', {}], ['PUT', '', { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'New name' }) }], ['PUT', '/avatar', image()], ['PUT', '/cover', image()]] as const) {
				const res = await app.request(`/channels/ch1${path}`, { method, ...init }, full as never);
				answers[`${method} ${path}`] = `${res.status} ${await res.text()}`;
				assert.equal(res.status, 200, `${method} ${path}: ${answers[`${method} ${path}`]}`);
			}
		} finally {
			globalThis.fetch = realFetch;
		}
		for (const [what, text] of Object.entries(answers)) assert.equal(text.includes('moveStopped'), false, what);
		assert.equal(JSON.parse(raw.channels.store.get('ch1')!).moveStopped, 'offer-1', 'the record keeps it');
	});

	it('a stopped move stays stopped when its job runs again after another move took the mark (CC-6 review)', async () => {
		const { raw, env, db, jobs, flush } = await setup({
			profiles: { [OWNER]: profile(OWNER, { channels: ['ch1'] }), [OTHER]: profile(OTHER) },
			channels: { ch1: channel('ch1', { members: [{ userId: OTHER, role: 'admin', addedBy: OWNER, addedAt: '2026' }] }) },
		});
		const offer = await createMoveOffer(env as never, { channelId: 'ch1', ownerId: OWNER, toUserId: OTHER, typed: '@ch1', authTime: Math.floor(Date.now() / 1000) });
		await acceptMoveOffer(env as never, offer.id, OTHER);
		await eraseUserData(env as never, OTHER, new OperationBudget(5000));
		const stored = JSON.parse(raw.channels.store.get('ch1')!);
		assert.equal(stored.moveStopped, offer.id);
		raw.channels.store.set('ch1', JSON.stringify({ ...stored, moveStopped: 'another-offer' }));
		for (let i = 0; i < 3; i++) await jobs.drain(env);
		await flush();
		assert.equal(JSON.parse(raw.channels.store.get('ch1')!).userId, OWNER);
		assert.equal((db.db.prepare(`SELECT status FROM channel_move_offers WHERE id = ?`).get(offer.id) as { status: string }).status, 'cancelled');
	});

	it('an offer accepted while its receiver is being erased starts the run over, so its channel goes too (CC-6 review)', async () => {
		const { raw, env, db, jobs, flush } = await setup({
			profiles: { [OWNER]: profile(OWNER, { channels: ['ch1'] }), [OTHER]: profile(OTHER) },
			channels: { ch1: channel('ch1', { members: [{ userId: OTHER, role: 'admin', addedBy: OWNER, addedAt: '2026' }] }) },
		});
		// Offered and accepted after the first phase, done before the last one
		const reports = raw.reports.list.bind(raw.reports);
		let made = false;
		raw.reports.list = (async (...args: Parameters<typeof reports>) => {
			if (!made) {
				made = true;
				const offer = await createMoveOffer(env as never, { channelId: 'ch1', ownerId: OWNER, toUserId: OTHER, typed: '@ch1', authTime: Math.floor(Date.now() / 1000) });
				// The run has taken their role already; they are an admin again by the time they accept
				await acceptMoveOffer(env as never, offer.id, OTHER);
				await jobs.drain(env);
				assert.equal(JSON.parse(raw.channels.store.get('ch1')!).userId, OTHER);
			}
			return reports(...args);
		}) as typeof reports;
		const members = [{ userId: OTHER, role: 'admin', addedBy: OWNER, addedAt: '2026' }];
		const put = raw.channels.put.bind(raw.channels);
		raw.channels.put = (async (key: string, value: unknown, opts?: unknown) => {
			const record = JSON.parse(String(value));
			return put(key, made || record.userId !== OWNER ? (value as never) : (JSON.stringify({ ...record, members }) as never), opts as never);
		}) as typeof put;
		const summary = await eraseUserData(env as never, OTHER, new OperationBudget(5000));
		await flush();
		assert.equal(summary.complete, true);
		assert.equal(made, true);
		assert.equal(raw.channels.store.has('ch1'), false, 'it was theirs, so it goes');
		assert.equal(raw.profiles.store.has(OTHER), false);
		assert.equal((db.db.prepare(`SELECT COUNT(*) AS n FROM channel_move_offers WHERE to_user_id = ?`).get(OTHER) as { n: number }).n, 0);
		for (const sql of RUNNING_OFFERS_SQL) {
			const plan = (db.db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all('x') as Array<{ detail: string }>).map((r) => r.detail).join(' | ');
			assert.match(plan, /SEARCH o USING INDEX idx_channel_move_offers_(to|from) \((to|from)_user_id=\?/, plan);
			assert.match(plan, /SEARCH j USING (COVERING )?INDEX sqlite_autoindex_admin_jobs_1 \(id=\?\)/, plan);
		}
	});

	it('only the two people of an offer and the channel’s owner can read it, by name; 404 for anyone else (CC-7)', async () => {
		const { raw, env, db, jobs } = await setup({
			profiles: {
				[OWNER]: profile(OWNER, { channels: ['ch1'], displayName: 'Bilal Ahmed', displayNameLocalized: { ar: 'بلال أحمد' } }),
				[OTHER]: profile(OTHER, { displayName: undefined, firstName: 'Amina', lastName: 'Yusuf', avatarUrl: 'https://cdn.test/a.jpg', email: 'amina@example.com' }),
				usr_editor: profile('usr_editor'),
				usr_stranger: profile('usr_stranger', { channels: [] }),
			},
			channels: { ch1: channel('ch1', { handle: 'morning', nameLocalized: { ar: 'أذكار الصباح' }, members: [{ userId: OTHER, role: 'admin', addedBy: OWNER, addedAt: '2026' }, { userId: 'usr_editor', role: 'editor', addedBy: OWNER, addedAt: '2026' }] }) },
		});
		const as = (userId: string) => {
			const app = new Hono();
			app.onError(errorHandler);
			app.use('*', async (c, next) => {
				c.set('auth' as never, { userId, email: null, payload: { authTime: Math.floor(Date.now() / 1000) } } as never);
				c.set('userId' as never, userId as never);
				await next();
			});
			const router = fromHono(app);
			router.get('/api/channels/:id/move-offers', ChannelMoveStateFetch);
			router.get('/api/move-offers', MyMoveOffers);
			router.get('/api/move-offers/:id', MoveOfferFetch);
			return async (path: string) => {
				const res = await app.request(path, {}, env as never);
				return { status: res.status, body: (await res.json()) as any, cache: res.headers.get('Cache-Control') };
			};
		};
		const offer = await createMoveOffer(env as never, { channelId: 'ch1', ownerId: OWNER, toUserId: OTHER, typed: '@morning', authTime: Math.floor(Date.now() / 1000), keepContactEmail: true });
		const path = `/api/move-offers/${offer.id}`;
		const seen = await as(OTHER)(path);
		assert.equal(seen.status, 200);
		assert.match(seen.cache ?? '', /no-store/);
		assert.deepEqual(seen.body.data, {
			id: offer.id, status: 'offered', createdAt: offer.created_at, expiresAt: offer.expires_at, respondedAt: null, keepContactEmail: true,
			channel: { id: 'ch1', name: 'Channel ch1', nameLocalized: { ar: 'أذكار الصباح' }, handle: 'morning', avatarUrl: null },
			from: { name: 'Bilal Ahmed', nameLocalized: { en: 'Bilal Ahmed', ar: 'بلال أحمد' }, avatarUrl: null },
			to: { name: 'Amina Yusuf', avatarUrl: 'https://cdn.test/a.jpg' },
			viewerRole: 'to',
		});
		assert.ok(!JSON.stringify(seen.body).includes('@example.com'), 'no email');
		assert.ok(!JSON.stringify(seen.body).includes('usr_'), 'no account id');
		assert.equal((await as(OWNER)(path)).body.data.viewerRole, 'from');
		for (const id of ['usr_stranger', 'usr_editor']) {
			for (const p of [path, '/api/channels/ch1/move-offers']) {
				const refused = await as(id)(p);
				assert.equal(refused.status, 404, `${id} ${p}`);
				assert.deepEqual(Object.keys(refused.body).sort(), ['code', 'success']);
			}
			assert.deepEqual((await as(id)('/api/move-offers')).body.data, { received: [], sent: [], receivedCursor: null, sentCursor: null });
		}
		assert.equal((await as(OTHER)('/api/channels/ch1/move-offers')).status, 404, 'channel settings: the owner only');
		assert.equal((await as(OWNER)('/api/move-offers/nope')).status, 404);
		assert.equal((await as(OWNER)('/api/channels/nope/move-offers')).status, 404);
		// Lists and the channel's settings
		assert.deepEqual([(await as(OTHER)('/api/move-offers')).body.data.received.map((o: any) => o.id), (await as(OWNER)('/api/move-offers')).body.data.sent.map((o: any) => o.channel.name)], [[offer.id], ['Channel ch1']]);
		const state = await as(OWNER)('/api/channels/ch1/move-offers');
		assert.deepEqual([state.body.data.offer.id, state.body.data.offer.to.name, state.body.data.movableAt], [offer.id, 'Amina Yusuf', null]);
		// Moved: both still read what happened; the new owner sees when the channel can move again
		await acceptMoveOffer(env as never, offer.id, OTHER);
		await jobs.drain(env);
		assert.deepEqual([(await as(OWNER)(path)).body.data.status, (await as(OTHER)(path)).body.data.status], ['moved', 'moved']);
		assert.equal((await as(OWNER)('/api/channels/ch1/move-offers')).status, 404, 'no longer the owner');
		const after = (await as(OTHER)('/api/channels/ch1/move-offers')).body.data;
		assert.equal(after.offer, null);
		assert.ok(Math.abs(Date.parse(after.movableAt) - (Date.now() + 30 * 86_400_000)) < 60_000);
		// An admin moved it on: the owner now reads the channel's earlier offer too
		raw.channels.store.set('ch1', JSON.stringify({ ...JSON.parse(raw.channels.store.get('ch1')!), userId: 'usr_stranger' }));
		assert.equal((await as('usr_stranger')(path)).body.data.viewerRole, 'owner');
		// A gone channel or person has no name, and their record shows nothing
		raw.channels.store.set('ch1', JSON.stringify({ ...JSON.parse(raw.channels.store.get('ch1')!), isDeleted: true }));
		raw.profiles.store.delete(OWNER);
		const gone = (await as(OTHER)(path)).body.data;
		assert.deepEqual([gone.channel, gone.from], [{ id: 'ch1', name: null, handle: null, avatarUrl: null }, { name: null, avatarUrl: null }]);
		assert.equal((await as('usr_stranger')(path)).status, 404, 'the owner of a deleted channel reads nothing');
		// Every read through an index
		for (const [sql, index] of [[MY_OFFERS_SQL.to_user_id, 'idx_channel_move_offers_to'], [MY_OFFERS_SQL.from_user_id, 'idx_channel_move_offers_from'], [OPEN_OFFER_SQL, 'idx_channel_move_offers'], [LAST_MOVE_SQL, 'idx_channel_move_offers_channel'], ['SELECT * FROM channel_move_offers WHERE id = ?', 'sqlite_autoindex_channel_move_offers_1']]) {
			const plan = (db.db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all('x') as Array<{ detail: string }>).map((r) => r.detail).join(' | ');
			assert.match(plan, new RegExp(`SEARCH channel_move_offers USING (COVERING )?INDEX ${index}`), plan);
			assert.ok(!/SCAN|TEMP B-TREE/.test(plan), plan);
		}
	});

	it('my offers: accepting ones are open, pages are bounded and lose nothing, and expired ones end the list (CC-7)', async () => {
		const { raw, env, db } = await setup({ profiles: { [OWNER]: profile(OWNER), [OTHER]: profile(OTHER) } });
		const at = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString();
		const later = new Date(Date.now() + 86_400_000).toISOString();
		const add = (n: number, status: string, over: { expires?: string; updated?: string } = {}) => {
			raw.channels.store.set(`c${n}`, JSON.stringify(channel(`c${n}`)));
			db.db.prepare(`INSERT INTO channel_move_offers (id, channel_id, from_user_id, to_user_id, status, created_at, expires_at, updated_at) VALUES (?, ?, ?, ?, ?, '2026', ?, ?)`).run(`o${n}`, `c${n}`, OWNER, OTHER, status, over.expires ?? later, over.updated ?? at(1));
		};
		// Oldest first: 15 that expired unsaid, then 24 open ones (every fourth being accepted), one accept that never finished, and closed ones
		for (let n = 100; n < 115; n++) add(n, 'offered', { expires: at(1) });
		for (let n = 3; n < 27; n++) add(n, n % 4 === 0 ? 'accepting' : 'offered');
		add(27, 'accepting', { updated: at(11) });
		for (const [i, status] of ['declined', 'moved', 'cancelled'].entries()) add(28 + i, status);
		for (const [side, userId] of [['received', OTHER], ['sent', OWNER]] as const) {
			const seen: string[] = [];
			let cursor: string | null = null;
			let pages = 0;
			do {
				const page: { offers: Array<{ id: string }>; cursor: string | null } = await myMoveOffers(env as never, userId, side, cursor);
				assert.ok(page.offers.length <= MOVE_OFFERS_PAGE);
				seen.push(...page.offers.map((o) => o.id));
				cursor = page.cursor;
				pages++;
			} while (cursor && pages < 10);
			assert.deepEqual(seen, Array.from({ length: 24 }, (_, i) => `o${26 - i}`), side);
			assert.equal(pages, 3);
		}
		// One request reads each record once: at most a channel and a person per offer of a page, and the reader
		const reads: string[] = [];
		for (const name of ['channels', 'profiles'] as const) {
			const get = raw[name].get.bind(raw[name]);
			raw[name].get = (async (key: string) => { reads.push(`${name}/${key}`); return get(key); }) as typeof get;
		}
		const page = await myMoveOffers(env as never, OTHER, 'received');
		const views = await offerViews(env as never, page.offers, OTHER);
		assert.equal(views.length, page.offers.length);
		assert.equal(new Set(reads).size, reads.length, 'no record twice');
		assert.equal(reads.length, page.offers.length + 2);
		// One row past the page is read, and no more
		db.trace = [];
		await myMoveOffers(env as never, OTHER, 'received');
		assert.deepEqual(db.trace.map((q) => q.params.at(-1)), [MOVE_OFFERS_PAGE + 1]);
		db.trace = null;
		const plan = (db.db.prepare(`EXPLAIN QUERY PLAN ${MY_OFFERS_SQL.to_user_id}`).all('x', 1, 1) as Array<{ detail: string }>).map((r) => r.detail).join(' | ');
		assert.match(plan, /MERGE \(UNION ALL\)/, plan);
		assert.equal((plan.match(/to_user_id=\? AND status=\? AND rowid<\?/g) ?? []).length, 2, plan);
	});

	it('a person without a name is never shown by id, handle or email; receivers are found by name in any language (CC-7)', async () => {
		const { raw, env } = await setup({
			profiles: {
				[OWNER]: profile(OWNER, { channels: ['ch1'], displayName: '', userName: 'ownerhandle' }),
				[OTHER]: profile(OTHER, { displayName: '', userName: 'otherhandle' }),
				usr_named: profile('usr_named', { displayName: 'Amina', displayNameLocalized: { ar: 'أمينة' }, userName: 'zzz' }),
				usr_going: profile('usr_going', { displayName: 'Going', adminDeletion: { at: '2026', by: 'usr_admin' } }),
			},
			channels: { ch1: channel('ch1', { members: [OTHER, 'usr_named', 'usr_going'].map((userId) => ({ userId, role: 'admin', addedBy: OWNER, addedAt: '2026' })) }) },
		});
		const names = async (q: string) => (await moveReceivers(env as never, 'ch1', OWNER, q)).map((r) => [r.userId, r.name]);
		assert.deepEqual(await names(''), [[OTHER, null], ['usr_named', 'Amina']], 'nobody whose data is being deleted');
		assert.deepEqual(await names('أمين'), [['usr_named', 'Amina']]);
		assert.deepEqual([await names('zzz'), await names('otherhandle')], [[], []], 'a user has no handle');
		const offer = await createMoveOffer(env as never, { channelId: 'ch1', ownerId: OWNER, toUserId: OTHER, typed: '@ch1', authTime: Math.floor(Date.now() / 1000) });
		await declineMoveOffer(env as never, offer.id, OTHER);
		const params = raw.queue.messages.map((m: any) => m.payload).filter((p: any) => /^channelMove(Offered|Declined)$/.test(p?.notificationKey ?? '')).map((p: any) => p.params);
		assert.deepEqual([params[0].owner, params[0].owner_ar, params[1].member, params[1].member_ar], ['Someone', 'أحد الأشخاص', 'Someone', 'أحد الأشخاص']);
		assert.ok(!/usr_|handle|@example/.test(JSON.stringify([params[0].owner, params[1].member])));
		assert.deepEqual((await readOfferView(env as never, offer.id, OTHER))!.from, { name: null, avatarUrl: null });
	});

	it('a channel hidden with its owner’s account is not moved (CC-7)', async () => {
		const { raw, env } = await setup({
			profiles: { [OWNER]: profile(OWNER, { channels: ['ch1'] }), [OTHER]: profile(OTHER) },
			channels: { ch1: channel('ch1', { members: [{ userId: OTHER, role: 'admin', addedBy: OWNER, addedAt: '2026' }] }) },
		});
		const offer = await createMoveOffer(env as never, { channelId: 'ch1', ownerId: OWNER, toUserId: OTHER, typed: '@ch1', authTime: Math.floor(Date.now() / 1000) });
		const stored = raw.channels.store.get('ch1')!;
		raw.channels.store.set('ch1', JSON.stringify({ ...JSON.parse(stored), isHidden: true, suspensionHolds: [`user:${OWNER}`] }));
		await assert.rejects(acceptMoveOffer(env as never, offer.id, OTHER), (e: unknown) => e instanceof MoveError && e.code === 'channel_suspended');
		raw.channels.store.set('ch1', JSON.stringify({ ...JSON.parse(stored), suspensionHolds: [] }));
		await acceptMoveOffer(env as never, offer.id, OTHER);
	});

	it('channel settings show an offer only while it is open (CC-7)', async () => {
		const { env, db } = await setup({
			profiles: { [OWNER]: profile(OWNER, { channels: ['ch1'] }), [OTHER]: profile(OTHER) },
			channels: { ch1: channel('ch1', { members: [{ userId: OTHER, role: 'admin', addedBy: OWNER, addedAt: '2026' }] }) },
		});
		const offer = await createMoveOffer(env as never, { channelId: 'ch1', ownerId: OWNER, toUserId: OTHER, typed: '@ch1', authTime: Math.floor(Date.now() / 1000) });
		const set = (sql: string, ...args: string[]) => db.db.prepare(`UPDATE channel_move_offers SET ${sql} WHERE id = ?`).run(...args, offer.id);
		const status = async () => (await channelMoveState(env as never, 'ch1', OWNER))!.offer?.status ?? null;
		const ago = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString();
		assert.equal(await status(), 'offered');
		set(`status = 'accepting', updated_at = ?`, ago(1));
		assert.equal(await status(), 'accepting');
		set(`updated_at = ?`, ago(11));
		assert.equal(await status(), null, 'an accept that never finished');
		set(`status = 'offered', expires_at = ?`, ago(1));
		assert.equal(await status(), null, 'expired');
		assert.equal((await readOfferView(env as never, offer.id, OTHER))!.status, 'expired', 'before the row says so too');
		for (const closed of ['declined', 'cancelled', 'stopped', 'refused']) {
			set(`status = ?`, closed);
			assert.equal(await status(), null, closed);
			assert.equal((await readOfferView(env as never, offer.id, OWNER))!.status, closed);
		}
		set(`options_json = 'broken'`);
		assert.equal((await readOfferView(env as never, offer.id, OWNER))!.keepContactEmail, false);
	});

	it('an offer’s notices open its page and carry names in both languages; members answer offers while acting as a channel (CC-7)', async () => {
		const { raw, env } = await setup({
			profiles: { [OWNER]: profile(OWNER, { channels: ['ch1'], displayName: 'Bilal Ahmed', displayNameLocalized: { ar: 'بلال أحمد' } }), [OTHER]: profile(OTHER) },
			channels: { ch1: channel('ch1', { members: [{ userId: OTHER, role: 'admin', addedBy: OWNER, addedAt: '2026' }] }) },
		});
		const make = () => createMoveOffer(env as never, { channelId: 'ch1', ownerId: OWNER, toUserId: OTHER, typed: '@ch1', authTime: Math.floor(Date.now() / 1000) });
		const declined = await make();
		await declineMoveOffer(env as never, declined.id, OTHER);
		const withdrawn = await make();
		await cancelMoveOffer(env as never, withdrawn.id, OWNER);
		const stopped = await make();
		await stopMoveOffer(env as never, 'ch1', stopped.id);
		const moved = await make();
		await acceptMoveOffer(env as never, moved.id, OTHER);
		const notices = raw.queue.messages.map((m: any) => m.payload).filter((p: any) => /^channelMove(Offered|Accepted|Declined|Cancelled|Stopped)$/.test(p?.notificationKey ?? ''));
		const byKey = Object.fromEntries(notices.map((p: any) => [p.notificationKey, p.actionUrl]));
		assert.deepEqual(byKey, { channelMoveOffered: `/channel-moves/${moved.id}`, channelMoveDeclined: `/channel-moves/${declined.id}`, channelMoveCancelled: `/channel-moves/${withdrawn.id}`, channelMoveStopped: `/channel-moves/${stopped.id}`, channelMoveAccepted: `/channel-moves/${moved.id}` });
		const offered = notices.find((p: any) => p.notificationKey === 'channelMoveOffered')!.params;
		assert.deepEqual([offered.owner, offered.owner_ar], ['Bilal Ahmed', 'بلال أحمد']);
		// The web app sends the active channel with every request: an admin acting as it still answers
		for (const role of ['admin', 'editor', 'moderator'] as const) {
			for (const [method, path] of [['POST', '/api/move-offers/x/accept'], ['POST', '/api/move-offers/x/decline'], ['DELETE', '/api/move-offers/x'], ['POST', '/api/channels/ch9/move-offers'], ['GET', '/api/move-offers/x'], ['GET', '/api/channels/ch9/move-receivers']]) {
				assert.equal(memberMayActAs(role, method, path), true, `${role} ${method} ${path}`);
			}
		}
		assert.equal(memberMayActAs(null, 'POST', '/api/move-offers/x/accept'), false);
		assert.equal(memberMayActAs('admin', 'PUT', '/api/move-offers/x'), false);
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
		const plans = [
			plan(bound(PROFILE_BY_ID_SQL, ["'usr_x'", '5'])),
			plan(bound(PROFILE_BY_EMAIL_SQL, ["'x@example.com'", '5'])),
			plan(bound(PROFILE_BY_HANDLE_SQL, ["'x'", '5'])),
			plan(bound(LIVE_PROFILE_IDS_SQL, [`'["usr_x"]'`])),
			plan(bound(CHANNEL_HANDLE_PREFIX_SQL, ["'ab'", '5'])),
		];
		for (const p of plans) assert.doesNotMatch(p, /\bSCAN (content_ownership|p)\b/, p);
		assert.match(plans[0], /\(kind=\? AND id=\?\)/, plans[0]);
		assert.match(plans[1], /idx_content_ownership_email_lower \(kind=\? AND <expr>=\?\)/, plans[1]);
		assert.match(plans[2], /idx_content_ownership_handle_lower \(kind=\? AND <expr>=\?\)/, plans[2]);
		assert.match(plans[4], /idx_content_ownership_handle_lower \(kind=\? AND <expr>>\? AND <expr><\?\)/, plans[4]);
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
		// Nothing typed (the transfer picker opening): the channel's team, without the owner being replaced
		const team = await search('', `&exclude=${OWNER}&channelId=ch3`);
		assert.deepEqual(team.map((u) => u.id), ['usr_amina'], "the channel's members first");
		assert.equal(team[0].channelRole, 'editor');
		assert.deepEqual(await search(''), [], 'no channel, nothing typed: nothing');
		const banned = await call('POST', '/users/usr_bilal/ban', {});
		assert.equal(banned.status, 200);
		assert.equal((await search('bilal@example.com'))[0].isBanned, true, 'banned users are listed as such');
	});

	it('user search shows and ranks by the account email; a profile whose copy differs is never that email\'s user', async () => {
		const { call, raw } = await setup({
			profiles: {
				usr_amina: profile('usr_amina', { email: 'old-amina@example.com', displayName: 'Amina Yusuf' }),
				usr_copy: profile('usr_copy', { email: 'amina@example.com', displayName: 'Someone' }),
				usr_noacct: profile('usr_noacct', { email: 'noacct@example.com', displayName: 'No Account' }),
			},
			channels: {},
			videos: {},
			auth: { usr_amina: 'amina@example.com', usr_copy: 'copy@example.com' },
		});
		const search = async (q: string) => (await call('GET', `/users/search?q=${encodeURIComponent(q)}`)).body.result.items as any[];
		const byEmail = await search('Amina@Example.com');
		assert.deepEqual(byEmail.map((u) => [u.id, u.email]), [['usr_amina', 'amina@example.com'], ['usr_copy', 'copy@example.com']]);
		assert.deepEqual((await search('usr_noacct')).map((u) => u.email), [null], 'no account: no email');
		assert.ok(raw.AUTH_DB.queries.length > 0);
		assert.deepEqual(raw.AUTH_DB.plans().filter((p) => p.startsWith('SCAN')), []);
		assert.ok(raw.AUTH_DB.plans().some((p) => p.includes('idx_users_email_lower')), 'the email lookup uses its index');
		// Auth unreadable: the search still works, without emails
		raw.AUTH_DB.fail = true;
		assert.deepEqual((await search('Amina Yusuf')).map((u) => [u.id, u.email]), [['usr_amina', null]]);
	});

	it('user detail carries the account email and where it is from; a differing profile copy is only shown', async () => {
		const { call, raw } = await setup({
			profiles: { usr_same: profile('usr_same', { email: 'same@example.com' }), usr_differs: profile('usr_differs', { email: 'copy@example.com' }), usr_noacct: profile('usr_noacct', { email: 'copy2@example.com' }) },
			channels: {},
			videos: {},
			auth: { usr_same: 'Same@Example.com', usr_differs: 'account@example.com' },
		});
		const detail = async (id: string) => {
			const { email, emailSource, profileEmail } = (await call('GET', `/users/${id}`)).body.result;
			return { email, emailSource, profileEmail };
		};
		assert.deepEqual(await detail('usr_same'), { email: 'same@example.com', emailSource: 'auth', profileEmail: undefined });
		assert.deepEqual(await detail('usr_differs'), { email: 'account@example.com', emailSource: 'auth', profileEmail: 'copy@example.com' });
		assert.deepEqual(await detail('usr_noacct'), { email: null, emailSource: 'none', profileEmail: 'copy2@example.com' });
		raw.AUTH_DB.fail = true;
		assert.deepEqual(await detail('usr_same'), { email: null, emailSource: 'unavailable', profileEmail: 'same@example.com' });
	});

	it("a move closes the invitations to the new owner's account email", async () => {
		const { call, db } = await setup({
			profiles: { [OWNER]: profile(OWNER, { channels: ['ch1'] }), [OTHER]: profile(OTHER, { email: 'third@example.com' }) },
			auth: { [OTHER]: 'other@example.com' },
		});
		const when = new Date(Date.now() + 864e5).toISOString();
		const invite = db.db.prepare(`INSERT INTO channel_invites (id, channel_id, role, invitee_email, by_email, invited_by, status, created_at, expires_at) VALUES (?, 'ch1', 'editor', ?, 1, ?, 'pending', '2026-01-01', ?)`);
		invite.run('account', 'other@example.com', OWNER, when);
		invite.run('copy', 'third@example.com', OWNER, when);
		const res = await call('POST', '/channels/ch1/transfer', { newOwnerId: OTHER });
		const job = (await call('GET', `/jobs/${res.body.result.job.id}`)).body.result;
		assert.equal(job.status, 'succeeded', JSON.stringify(job));
		const status = (id: string) => (db.db.prepare('SELECT status FROM channel_invites WHERE id = ?').get(id) as { status: string }).status;
		assert.equal(status('account'), 'cancelled');
		assert.equal(status('copy'), 'pending', "someone else's invitation stays open");
	});

	it('a move waits (retries) while Auth cannot be read, and a new owner with no account yet is fine', async () => {
		const down = await setup();
		down.raw.AUTH_DB.fail = true;
		const refused = await down.call('POST', '/channels/ch1/transfer', { newOwnerId: OTHER });
		assert.equal((await down.call('GET', `/jobs/${refused.body.result.job.id}`)).body.result.status, 'failed');
		assert.equal(JSON.parse(down.raw.channels.store.get('ch1')!).userId, OWNER, 'nothing moved');

		const none = await setup({ auth: {} });
		const res = await none.call('POST', '/channels/ch1/transfer', { newOwnerId: OTHER });
		assert.equal((await none.call('GET', `/jobs/${res.body.result.job.id}`)).body.result.status, 'succeeded');
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
		for (const path of ['/api/move-offers', '/api/move-offers/x', '/api/channels/ch1/move-offers', '/api/channels/ch1/move-receivers']) {
			assert.equal(isBlockedForBannedUser('GET', path), true, path);
			assert.equal(isBlockedForPendingDeletion('GET', path), true, path);
		}
		assert.equal(isBlockedForBannedUser('GET', '/api/channels/ch1'), false);
		assert.equal(isBlockedForBannedUser('DELETE', '/api/privacy/data'), false);
		assert.equal(isBlockedForBannedUser('POST', '/api/videos/upload/initiate'), true);
		assert.equal(isBlockedForBannedUser('PUT', '/api/channels/ch1'), true);
	});
});

describe('pending "Delete videos data" (#701): sign in and read, no writes', () => {
	const json = async (res: Response) => (await res.json()) as any;
	const comment = (as: ReturnType<typeof publicApp>) => as('POST', '/api/videos/legacy/comments', { text: 'salam' }, { channelId: 'ch1' });
	// Bans are cached per isolate (module), and earlier tests banned these users
	beforeEach(() => [OWNER, OTHER].forEach(forgetCachedBan));
	afterEach(() => [OWNER, OTHER].forEach(forgetCachedBan));

	it('refuses every write with the typed code while pending, keeps reads, and a restore lifts it at once', async () => {
		const { env, call } = await setup();
		const user = publicApp(env, OWNER);
		const other = publicApp(env, OTHER);
		// A write before the delete leaves a "not pending" answer in this isolate's cache
		assert.ok((await comment(user)).status < 300, 'writes work before the delete');
		assert.equal((await call('POST', `/users/${OWNER}/delete-data`, { reason: 'Requested' })).status, 200);

		const refused = await comment(user);
		assert.equal(refused.status, 403, 'blocked at once, despite the cached answer');
		assert.equal(refused.headers.get('Cache-Control'), 'private, no-store');
		const body = await json(refused);
		assert.equal(body.code, VIDEOS_ACCOUNT_PENDING_DELETION_CODE);
		assert.equal(body.error, VIDEOS_ACCOUNT_PENDING_DELETION_MESSAGE);
		assert.equal(body.deletion.purgeAfter, purgeAfterOf(body.deletion.deletedAt));
		const create = await user('POST', '/api/profiles', { email: `${OWNER}@example.com`, userName: 'again', displayName: 'Again', timezone: 'UTC' });
		assert.equal(create.status, 403, 'no new profile over the hidden one');
		const me = await user('GET', '/api/profile');
		assert.equal(me.status, 403);
		assert.equal((await json(me)).code, VIDEOS_ACCOUNT_PENDING_DELETION_CODE, 'the profile answers the state, not "create one"');
		const creator = (await json(await user('GET', '/api/me/creator'))).result;
		assert.deepEqual([creator.canUpload, creator.canCreateChannel, creator.pendingDeletion], [false, false, true]);

		assert.equal((await user('GET', '/api/videos/legacy')).status, 200, 'reads still work');
		assert.equal((await user('GET', '/api/channels')).status, 200);
		assert.ok((await comment(other)).status < 300, 'other users are not affected');

		assert.equal((await call('POST', `/deletions/user/${OWNER}/restore`)).status, 200);
		assert.ok((await comment(user)).status < 300, 'a restore lifts the block at once (no cache to wait out)');
		assert.equal((await user('GET', '/api/profile')).status, 200);
		assert.equal((await json(await user('GET', '/api/me/creator'))).result.pendingDeletion, undefined);
	});

	it('after the purge the user starts fresh', async () => {
		const { env, call, purgeNow } = await setup();
		const user = publicApp(env, OTHER);
		await call('POST', `/users/${OTHER}/delete-data`, {});
		assert.equal((await user('POST', '/api/profiles', { email: `${OTHER}@example.com`, userName: 'x', displayName: 'X', timezone: 'UTC' })).status, 403);
		assert.equal((await purgeNow('user', OTHER)).status, 'succeeded');
		assert.equal((await user('GET', '/api/profile')).status, 404, 'no profile: the web app offers to create one');
		const created = await user('POST', '/api/profiles', { email: `${OTHER}@example.com`, userName: 'fresh', displayName: 'Fresh', timezone: 'UTC' });
		assert.ok(created.status < 300, `a fresh profile can be created (${created.status})`);
	});

	it('a ban wins over a pending deletion', async () => {
		const { env, call } = await setup();
		await call('POST', `/users/${OWNER}/ban`, { reason: 'Spam' });
		await call('POST', `/users/${OWNER}/delete-data`, {});
		forgetCachedBan(OWNER);
		assert.equal((await json(await comment(publicApp(env, OWNER)))).code, VIDEOS_BANNED_CODE);
	});

	it('uploads (new, resumed, retried, TUS) and every other write are refused; playback signals and privacy are not', async () => {
		const { env, call } = await setup();
		await call('POST', `/users/${OWNER}/delete-data`, {});
		// The real middleware in front of a stand-in for every route
		const app = new Hono();
		app.use('*', async (c, next) => {
			c.set('auth' as never, { userId: OWNER } as never);
			await next();
		});
		app.use('/api/*', videosPendingDeletionMiddleware);
		app.all('*', (c) => c.json({ success: true }));
		const blocked: Array<[string, string]> = [
			['POST', '/api/videos/upload/initiate'],
			['POST', '/api/videos/upload/batch/initiate'],
			['GET', '/api/videos/upload/resume/v1'],
			['POST', '/api/videos/tus'],
			['PATCH', '/api/videos/tus/abc'],
			['POST', '/api/videos/upload/complete'],
			['POST', '/api/videos/upload/failed/v1'],
			['POST', '/api/videos/v1/comments'],
			['POST', '/api/videos/v1/likes'],
			['POST', '/api/channels/ch1/subscriptions'],
			['POST', '/api/channels'],
			['PUT', '/api/channels/ch1'],
			['PATCH', '/api/videos/v1'],
			['POST', '/api/playlists'],
			['POST', '/api/community/channels/ch1/posts'],
			['PATCH', '/api/videos/bulk'],
			['POST', '/api/videos/bulk-delete'],
			['PUT', '/api/profile'],
			['POST', '/api/watch-history/v1/progress'],
		];
		for (const [method, path] of blocked) {
			const res = await app.request(path, { method }, env as never);
			assert.equal(res.status, 403, `${method} ${path}`);
			assert.equal(((await res.json()) as any).code, VIDEOS_ACCOUNT_PENDING_DELETION_CODE, `${method} ${path}`);
		}
		const allowed: Array<[string, string]> = [
			['GET', '/api/videos/v1'],
			['GET', '/api/channels/ch1'],
			['HEAD', '/api/videos/tus/abc'],
			['POST', '/api/videos/v1/view'],
			['POST', '/api/videos/v1/watch-time'],
			['POST', '/api/analytics/events'],
			['PUT', '/api/devices/install-1'],
			['GET', '/api/privacy/export'],
			['DELETE', '/api/privacy/data'],
		];
		for (const [method, path] of allowed) assert.equal((await app.request(path, { method }, env as never)).status, 200, `${method} ${path}`);
		assert.equal(isBlockedForPendingDeletion('post', '/api/videos/upload/initiate'), true, 'method case does not matter');
	});

	it('looks up with one indexed point read, and remembers only "not pending"', async () => {
		const { env, call, db } = await setup();
		const plan = db.db.prepare("EXPLAIN QUERY PLAN SELECT deleted_at FROM admin_deletions WHERE kind = 'user' AND target_id = ? AND purged_at IS NULL").all('x') as { detail: string }[];
		assert.match(plan.map((p) => p.detail).join(' '), /USING PRIMARY KEY|USING INDEX/, 'never a table scan');
		const searchDb = (env as any).SEARCH_DB;
		let reads = 0;
		const counting = { prepare: (sql: string) => { reads++; return searchDb.prepare(sql); } };
		const t0 = 1_000_000;
		assert.equal(await cachedPendingUserDeletion(counting as never, 'usr_cache', t0), null);
		assert.equal(await cachedPendingUserDeletion(counting as never, 'usr_cache', t0 + 1000), null);
		assert.equal(reads, 1, '"not pending" is remembered');
		assert.equal(await cachedPendingUserDeletion(counting as never, 'usr_cache', t0 + NOT_PENDING_CACHE_MS + 1), null);
		assert.equal(reads, 2, 'and read again after the window');
		await call('POST', `/users/${OWNER}/delete-data`, {});
		assert.ok(await cachedPendingUserDeletion(counting as never, OWNER));
		assert.ok(await cachedPendingUserDeletion(counting as never, OWNER));
		assert.equal(reads, 4, '"pending" is read every time, so a restore applies at once');
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

	it('every status change is published to admin:jobs (live admin pages)', async () => {
		const { env, jobs } = await setup();
		const published: Array<{ url: string; events: any[] }> = [];
		const realFetch = globalThis.fetch;
		globalThis.fetch = (async (url: string, init: RequestInit) => {
			const body = JSON.parse(String(init.body));
			published.push({ url, events: body.items.flatMap((i: any) => i.channel === 'admin:jobs' ? i.message.data.events : []) });
			return new Response('{}', { status: 200 });
		}) as typeof fetch;
		try {
			const liveEnv = Object.assign(env, { WEBSOCKET_URL: 'https://realtime.test', INTERNAL_API_KEY: 'k' });
			const created = await createJob(liveEnv as never, { kind: 'user.delete-data', targetKind: 'user', targetId: OTHER, actorId: 'usr_admin' });
			jobs.pending.splice(0);
			await jobs.send({ id: 'm', type: MessageType.AdminJob, payload: { jobId: created.id }, timestamp: 0 });
			const handlers = { 'user.delete-data': async () => ({ done: true as const }) };
			const d = jobs.pending.shift()!;
			await handleAdminJobBatch({ messages: [{ body: d.body, attempts: 1, ack() {}, retry() {} }] }, liveEnv as never, handlers);
		} finally {
			globalThis.fetch = realFetch;
		}
		assert.ok(published.every((p) => p.url === 'https://realtime.test/broadcast'));
		const events = published.flatMap((p) => p.events);
		assert.deepEqual(events.map((e) => e.status), ['queued', 'running', 'succeeded']);
		assert.ok(events.every((e) => e.kind === 'job' && e.key.startsWith('job:') && e.jobKind === 'user.delete-data' && e.targetId === OTHER));
	});

	it('backoff doubles from 10s and caps at 5 minutes', () => {
		assert.deepEqual([1, 2, 3, 4, 5, 6, 9].map(backoffSeconds), [10, 20, 40, 80, 160, 300, 300]);
	});
});

describe('admin jobs on the Jobs page (TA-8: attempts n/max, next retry, log, Cancel)', () => {
	/** One delivery of the oldest queued message through `handlers`; returns what the consumer did with it. */
	async function deliver(env: unknown, jobs: JobsQueue, handlers: Record<string, (env: unknown, job: any) => Promise<any>>, attempts = 1) {
		const d = jobs.pending.shift()!;
		let outcome: 'ack' | 'retry' = 'ack';
		await handleAdminJobBatch({ messages: [{ body: d.body, attempts, ack() { outcome = 'ack'; }, retry() { outcome = 'retry'; } }] }, env as never, handlers as never);
		return { outcome, body: d.body as any };
	}

	it('a failed attempt shows attempts out of max, when it runs next, and a log in events', async () => {
		const { env, jobs, call } = await setup();
		const created = await createJob(env as never, { kind: 'user.delete-data', targetKind: 'user', targetId: OTHER, actorId: 'usr_admin' });
		assert.equal(created.maxAttempts, MAX_RETRIES + 1);
		const before = Date.now();
		const first = await deliver(env, jobs as never, { 'user.delete-data': async () => { throw new Error('R2 is down'); } });
		assert.equal(first.outcome, 'retry');
		const job = (await call('GET', `/jobs/${created.id}`, undefined, { hold: true })).body.result;
		assert.equal(job.status, 'retrying');
		assert.equal(job.attempts, 1);
		assert.equal(job.maxAttempts, MAX_RETRIES + 1);
		const next = Date.parse(job.nextRunAt);
		assert.ok(next >= before + 10_000 && next <= Date.now() + 10_000, 'the next run is the backoff away');
		assert.deepEqual(job.log.map((l: any) => [l.event, l.attempt ?? null, l.error ?? null, l.delaySeconds ?? null]), [
			['queued', null, null, null],
			['started', 1, null, null],
			['failed_attempt', 1, 'R2 is down', 10],
		]);
		// The list carries the numbers but not the log
		const listed = (await call('GET', `/jobs?targetKind=user&targetId=${OTHER}`, undefined, { hold: true })).body.result.items[0];
		assert.equal(listed.nextRunAt, job.nextRunAt);
		assert.equal(listed.log, undefined);
		// The next attempt succeeds: no next run, the log ends with it
		jobs.pending.push({ body: first.body, attempts: 2 });
		await deliver(env, jobs as never, { 'user.delete-data': async () => ({ done: true }) }, 2);
		const done = (await call('GET', `/jobs/${created.id}`, undefined, { hold: true })).body.result;
		assert.equal(done.status, 'succeeded');
		assert.equal(done.nextRunAt, null);
		assert.deepEqual(done.log.slice(-2).map((l: any) => [l.event, l.attempt]), [['started', 2], ['succeeded', 2]]);
	});

	it('a step that waits shows when it runs next', async () => {
		const { env, jobs, call } = await setup();
		const created = await createJob(env as never, { kind: 'user.delete-data', targetKind: 'user', targetId: OTHER, actorId: 'usr_admin' });
		await deliver(env, jobs as never, { 'user.delete-data': async () => ({ done: false, params: { step: 2 }, delaySeconds: 300 }) });
		const job = (await call('GET', `/jobs/${created.id}`, undefined, { hold: true })).body.result;
		assert.equal(job.status, 'queued');
		assert.ok(Date.parse(job.nextRunAt) > Date.now() + 290_000);
		assert.deepEqual(job.log.at(-1), { at: job.log.at(-1).at, event: 'waiting', attempt: 1, delaySeconds: 300 });
		assert.equal(jobs.pending[0].delaySeconds, 300);
	});

	it('Cancel drops a queued delivery; Retry starts a new run and a delivery left from the old one never runs', async () => {
		const { env, jobs, call } = await setup();
		const created = await createJob(env as never, { kind: 'channel.purge', targetKind: 'channel', targetId: 'ch_cancel1', actorId: 'usr_admin' });
		// A step that waits: its delivery is still in the queue when the admin cancels
		await deliver(env, jobs as never, { 'channel.purge': async () => ({ done: false, params: { step: 2 }, delaySeconds: 300 }) });
		const cancelled = await call('POST', `/jobs/${created.id}/cancel`, undefined, { hold: true });
		assert.equal(cancelled.status, 200);
		assert.equal(cancelled.body.result.status, 'cancelled');
		assert.equal(cancelled.body.result.nextRunAt, null);
		let ran = 0;
		const handlers = { 'channel.purge': async () => { ran++; return { done: true }; } };
		const stale = jobs.pending[0];
		await deliver(env, jobs as never, handlers);
		assert.equal(ran, 0, 'a cancelled job never runs');
		assert.equal((await call('POST', `/jobs/${created.id}/cancel`, undefined, { hold: true })).body.code, 'job_finished');
		// Retry: a new run; the old delivery comes back (as a late duplicate) and is dropped
		const retried = await call('POST', `/jobs/${created.id}/retry`, undefined, { hold: true });
		assert.equal(retried.body.result.status, 'queued');
		jobs.pending.unshift(stale);
		await deliver(env, jobs as never, handlers);
		assert.equal(ran, 0, 'the delivery of the old run is dropped');
		await deliver(env, jobs as never, handlers);
		assert.equal(ran, 1, 'the new run runs once');
		const job = (await call('GET', `/jobs/${created.id}`, undefined, { hold: true })).body.result;
		assert.equal(job.status, 'succeeded');
		assert.deepEqual(job.log.map((l: any) => l.event), ['queued', 'started', 'waiting', 'cancelled', 'queued', 'started', 'succeeded']);
		assert.equal(job.log[4].retried, true);
	});

	it('Cancel while a step runs: the step finishes, nothing after it runs, no failure is raised', async () => {
		const { env, jobs, call } = await setup();
		const created = await createJob(env as never, { kind: 'channel.purge', targetKind: 'channel', targetId: 'ch_cancel1', actorId: 'usr_admin' });
		const { cancelJob } = await import('../src/lib/admin/jobs');
		await deliver(env, jobs as never, {
			'channel.purge': async () => {
				await cancelJob(env as never, created.id);
				return { done: false, params: { step: 2 } };
			},
		});
		assert.equal(jobs.pending.length, 0, 'the next step is not queued');
		assert.equal((await call('GET', `/jobs/${created.id}`, undefined, { hold: true })).body.result.status, 'cancelled');
		// The same while an attempt fails: no retry, no failed status
		const other = await createJob(env as never, { kind: 'channel.purge', targetKind: 'channel', targetId: 'ch_cancel2', actorId: 'usr_admin' });
		const out = await deliver(env, jobs as never, {
			'channel.purge': async () => {
				await cancelJob(env as never, other.id);
				throw new Error('boom');
			},
		});
		assert.equal(out.outcome, 'ack');
		const job = (await call('GET', `/jobs/${other.id}`, undefined, { hold: true })).body.result;
		assert.equal(job.status, 'cancelled');
		assert.equal(job.log.at(-1).event, 'cancelled');
	});

	it('only a failed job retries by default; Cancel refuses a finished job', async () => {
		const { env, jobs, call } = await setup();
		const created = await createJob(env as never, { kind: 'channel.purge', targetKind: 'channel', targetId: 'ch_cancel1', actorId: 'usr_admin' });
		await call('POST', `/jobs/${created.id}/cancel`, undefined, { hold: true });
		const { retryJob } = await import('../src/lib/admin/jobs');
		assert.equal((await retryJob(env as never, created.id))?.status, 'cancelled', 'other callers (Errors page, playlist) need allowCancelled');
		jobs.pending.splice(0);
		await call('POST', `/jobs/${created.id}/retry`, undefined, { hold: true });
		await deliver(env, jobs as never, { 'channel.purge': async () => ({ done: true }) });
		const res = await call('POST', `/jobs/${created.id}/cancel`, undefined, { hold: true });
		assert.equal(res.status, 409);
		assert.equal(res.body.code, 'job_finished');
		assert.equal((await call('POST', '/jobs/nope/cancel', undefined, { hold: true })).status, 404);
	});

	it('a data erasure cannot be cancelled; a cancel that lands after the job finished changes nothing', async () => {
		const { env, jobs, call, db } = await setup();
		const erase = await createJob(env as never, { kind: 'user.delete-data', targetKind: 'user', targetId: OTHER, actorId: 'usr_admin' });
		const refused = await call('POST', `/jobs/${erase.id}/cancel`, undefined, { hold: true });
		assert.equal(refused.status, 409);
		assert.equal(refused.body.code, 'job_not_cancellable');
		const { cancelJob } = await import('../src/lib/admin/jobs');
		assert.equal((await cancelJob(env as never, erase.id))?.status, 'queued');
		jobs.pending.splice(0);
		// Finished between the read and the update: the conditional update leaves it succeeded
		const purge = await createJob(env as never, { kind: 'channel.purge', targetKind: 'channel', targetId: 'ch_race', actorId: 'usr_admin' });
		const real = (env as any).SEARCH_DB.prepare.bind((env as any).SEARCH_DB);
		(env as any).SEARCH_DB.prepare = (sql: string) => {
			if (sql.includes("SET status = 'cancelled'")) db.db.prepare("UPDATE admin_jobs SET status = 'succeeded' WHERE id = ?").run(purge.id);
			return real(sql);
		};
		const late = await cancelJob(env as never, purge.id);
		(env as any).SEARCH_DB.prepare = real;
		assert.equal(late?.status, 'succeeded');
		const job = (await call('GET', `/jobs/${purge.id}`, undefined, { hold: true })).body.result;
		assert.equal(job.status, 'succeeded');
		assert.ok(!job.log.some((l: any) => l.event === 'cancelled'));
	});

	it('keeps the newest 50 log lines per job', async () => {
		const { env, jobs, call, db } = await setup();
		const created = await createJob(env as never, { kind: 'user.delete-data', targetKind: 'user', targetId: OTHER, actorId: 'usr_admin' });
		for (let i = 0; i < 30; i++) await deliver(env, jobs as never, { 'user.delete-data': async () => ({ done: false, params: { i }, delaySeconds: 60 }) });
		const log = (await call('GET', `/jobs/${created.id}`, undefined, { hold: true })).body.result.log;
		assert.equal(log.length, 50);
		assert.equal(log.at(-1).event, 'waiting');
		assert.equal((db.db.prepare('SELECT COUNT(*) AS n FROM admin_job_log WHERE job_id = ?').get(created.id) as any).n, 50, 'older lines are deleted, not just hidden');
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
			channels: { ch1: channel('ch1') },
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
