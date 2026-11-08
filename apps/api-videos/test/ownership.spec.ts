import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { applyOwnershipModeration, invalidateOwnership, projectOwnership, syncOwnership } from '@al-ummah/shared-types';
import { withSearchSync } from '../src/lib/search/sync';
import {
	channelTotalsFromIndex,
	isOwnershipComplete,
	ownedChannelIds,
	reconcileOwnershipIndex,
	runOwnershipPass,
	scheduleOwnershipHeal,
} from '../src/lib/search/ownership';
import { ChannelsList } from '../src/endpoints/channel/channelList';
import { ChannelVideosList } from '../src/endpoints/channel/channelVideosList';
import { ChannelShortsList } from '../src/endpoints/channel/channelShortsList';
import { ChannelLiveList } from '../src/endpoints/channel/channelLiveList';
import { ChannelFetch } from '../src/endpoints/channel/channelFetch';
import { ChannelAbout } from '../src/endpoints/channel/channelHandle';
import { VideoSearch } from '../src/endpoints/video/videoSearch';
import { OwnershipBackfillPost } from '../src/endpoints/search/searchBackfill';
import { AnalyticsChannelGet, AnalyticsSummaryGet } from '../src/endpoints/analytics/analyticsOwner';
import { MemoryBucket, MemoryQueue, buildApp, videoFixture } from './helpers';
import { SqliteD1 } from './search-sqlite-d1';

const NOW = Date.parse('2026-11-06T12:00:00.000Z');

function channel(id: string, overrides: Record<string, unknown> = {}) {
	return { id, name: `Channel ${id}`, userId: 'owner', dateCreated: '2026-01-01T00:00:00.000Z', subscribers: [], ...overrides };
}

function rows(db: SqliteD1, kind: string) {
	return db.db.prepare('SELECT * FROM content_ownership WHERE kind = ? ORDER BY id').all(kind) as Array<Record<string, any>>;
}

/** Wrapped env (writes go through the R2 wrapper) over fresh in-memory buckets. */
function ownershipEnv(initial: { videos?: Record<string, unknown>; channels?: Record<string, unknown> } = {}) {
	const db = new SqliteD1();
	const pending: Promise<unknown>[] = [];
	const raw = {
		SEARCH_DB: db,
		videos: new MemoryBucket(initial.videos),
		channels: new MemoryBucket(initial.channels),
		playlists: new MemoryBucket(),
		community_posts: new MemoryBucket(),
		queue: new MemoryQueue(),
	};
	const env = withSearchSync(raw, { waitUntil: (p: Promise<unknown>) => { pending.push(p); } });
	return { db, raw, env, flush: () => Promise.all(pending) };
}

/** A channel set large enough that the R2 scan needs several pages. */
function populated() {
	const channels: Record<string, unknown> = {};
	const videos: Record<string, unknown> = {};
	for (let i = 0; i < 250; i++) {
		const id = `ch${String(i).padStart(3, '0')}`;
		channels[id] = channel(id, { userId: `user${i % 50}` });
	}
	channels.mine1 = channel('mine1');
	channels.mine2 = channel('mine2', { isPrivate: true });
	channels.mine3 = channel('mine3', { isDeleted: true });
	channels.empty = channel('empty', { userId: 'someone' });
	for (let i = 0; i < 300; i++) {
		const id = `v${String(i).padStart(3, '0')}`;
		videos[id] = videoFixture({ id, title: `Video ${i}`, channelId: `ch${String(i % 250).padStart(3, '0')}`, duration: 600, views: i });
	}
	const own = [
		videoFixture({ id: 'm-a', title: 'Tafsir one', channelId: 'mine1', duration: 900, views: 5, dateCreated: '2026-03-01T00:00:00.000Z' }),
		videoFixture({ id: 'm-b', title: 'Tafsir two', channelId: 'mine1', duration: 900, views: 50, dateCreated: '2026-02-01T00:00:00.000Z' }),
		videoFixture({ id: 'm-c', title: 'Private tafsir', channelId: 'mine1', duration: 900, views: 7, isPublic: false, dateCreated: '2026-04-01T00:00:00.000Z' }),
		videoFixture({ id: 'm-d', title: 'Short clip', channelId: 'mine1', duration: 30, views: 1000 }),
		videoFixture({ id: 'm-e', title: 'Hidden', channelId: 'mine1', duration: 900, views: 9, isHidden: true }),
		videoFixture({ id: 'm-f', title: 'Scheduled', channelId: 'mine1', duration: 900, views: 3, isPublic: false, scheduledPublishStatus: 'scheduled', dateCreated: '2026-05-01T00:00:00.000Z' }),
		videoFixture({ id: 'm-g', title: 'Processing', channelId: 'mine1', duration: 900, views: 0, uploadStatus: 'processing', dateCreated: '2026-01-15T00:00:00.000Z' }),
	];
	for (const v of own) videos[v.id] = v;
	return { channels, videos };
}

async function completeIndex(env: Record<string, unknown>) {
	await runOwnershipPass(env as never, 'channel', { maxPages: 50 });
	await runOwnershipPass(env as never, 'video', { maxPages: 50 });
}

describe('ownership projection', () => {
	it('keeps private, hidden, deleted and scheduled items with their flags', () => {
		const video = projectOwnership('video', 'v1', videoFixture({ id: 'v1', isPublic: false, isHidden: true, scheduledPublishStatus: 'scheduled', duration: '45', views: 12 }))!;
		assert.equal(video.ownerId, 'owner');
		assert.equal(video.channelId, 'owner-ch');
		assert.equal(video.isPublic, false);
		assert.equal(video.isHidden, true);
		assert.equal(video.scheduleStatus, 'scheduled');
		assert.equal(video.duration, 45);
		assert.equal(video.views, 12);
		assert.equal(video.createdAt, Date.parse('2026-01-01T00:00:00.000Z'));

		const ch = projectOwnership('channel', 'c1', channel('c1', { isPrivate: true, isDeleted: true }))!;
		assert.equal(ch.isPublic, false);
		assert.equal(ch.isDeleted, true);
		assert.equal(ch.channelId, 'c1');
	});

	it('ignores internal records and JSON that is not the keyed entity', () => {
		assert.equal(projectOwnership('video', 'index:recent-videos', { id: 'index:recent-videos' }), null);
		assert.equal(projectOwnership('video', 'v1', { id: 'other' }), null);
		assert.equal(projectOwnership('channel', 'c1', null), null);
	});
});

describe('ownership index sync on R2 writes', () => {
	it('writes rows inline (before the put resolves) for every visibility state and removes them on delete', async () => {
		const { db, env } = ownershipEnv();
		await env.channels.put('c1', JSON.stringify(channel('c1', { isPrivate: true })));
		await env.videos.put('v1', JSON.stringify(videoFixture({ id: 'v1', channelId: 'c1', isPublic: false })));
		// No flush: ownership rows must already be there.
		assert.equal(rows(db, 'channel')[0].owner_id, 'owner');
		assert.equal(rows(db, 'channel')[0].is_public, 0);
		assert.equal(rows(db, 'video')[0].channel_id, 'c1');
		assert.equal(rows(db, 'video')[0].is_public, 0);

		await env.videos.put('v1', JSON.stringify(videoFixture({ id: 'v1', channelId: 'c1', views: 42, isDeleted: true })));
		assert.equal(rows(db, 'video')[0].views, 42);
		assert.equal(rows(db, 'video')[0].is_deleted, 1);

		await env.videos.delete('v1');
		await env.channels.delete(['c1']);
		assert.equal(db.count('content_ownership'), 0);
	});

	it('ignores internal keys and nested records', async () => {
		const { db, env } = ownershipEnv();
		await env.videos.put('index:recent-videos', JSON.stringify({ id: 'index:recent-videos', items: [] }));
		await env.channels.put('subscriptions/u1', JSON.stringify({ id: 'x' }));
		assert.equal(db.count('content_ownership'), 0);
	});

	it('marks the index incomplete instead of failing the write when D1 rejects the row', async () => {
		const { db, raw, env } = ownershipEnv();
		await env.channels.put('c1', JSON.stringify(channel('c1')));
		await runOwnershipPass(raw as never, 'channel');
		assert.equal(await isOwnershipComplete(db, 'channel'), true);

		db.db.exec('DROP TABLE content_ownership');
		await env.channels.put('c2', JSON.stringify(channel('c2')));
		assert.ok(raw.channels.read('c2'), 'the R2 write still happened');
		assert.equal(await isOwnershipComplete(db, 'channel'), false);
	});
});

describe('ownership rebuild pass', () => {
	it('walks the bucket across calls, prunes rows of objects removed elsewhere and marks the kind complete', async () => {
		const { db, raw } = ownershipEnv({ channels: { a: channel('a'), b: channel('b'), c: channel('c', { userId: 'u2' }) } });
		await syncOwnership(db, 'channel', 'gone', channel('gone'), NOW - 1000);

		const first = await runOwnershipPass(raw as never, 'channel', { maxPages: 1, pageSize: 2 });
		assert.equal(first.done, false);
		assert.equal(await isOwnershipComplete(db, 'channel'), false);
		const second = await runOwnershipPass(raw as never, 'channel', { maxPages: 1, pageSize: 2 });
		assert.equal(second.done, true);
		assert.equal(second.complete, true);
		assert.deepEqual(rows(db, 'channel').map(r => r.id), ['a', 'b', 'c']);
		assert.deepEqual(await ownedChannelIds(raw as never, 'owner'), ['a', 'b']);
	});

	it('does not mark complete when a write was lost during the pass', async () => {
		const { db, raw } = ownershipEnv({ channels: { a: channel('a'), b: channel('b') } });
		await runOwnershipPass(raw as never, 'channel', { maxPages: 1, pageSize: 1 });
		await invalidateOwnership(db, 'channel', Date.now() + 1);
		const result = await runOwnershipPass(raw as never, 'channel', { maxPages: 5, pageSize: 1 });
		assert.equal(result.done, true);
		assert.equal(result.complete, false);
		// The next full pass starts after the failure and can be trusted.
		assert.equal((await runOwnershipPass(raw as never, 'channel', { maxPages: 5, now: () => Date.now() + 10 })).complete, true);
	});

	it('runs from the daily reconcile and skips a kind whose heal is in progress', async () => {
		const { db, raw } = ownershipEnv({ channels: { a: channel('a') }, videos: { v1: videoFixture({ id: 'v1' }) } });
		const summary = await reconcileOwnershipIndex(raw as never);
		assert.equal(summary.channel.complete, true);
		assert.equal(summary.video.complete, true);

		db.db.prepare("INSERT INTO search_meta (key, value, updated_at) VALUES ('ownership:heal:video', 'lease', ?)").run(Date.now());
		const busy = await reconcileOwnershipIndex(raw as never);
		assert.equal(busy.video.pages, 0);
		assert.equal(busy.channel.pages, 1);
	});

	it('self-heal holds a lease so concurrent fallbacks start one pass', async () => {
		const { db, raw } = ownershipEnv({ channels: { a: channel('a') } });
		const tasks: Promise<unknown>[] = [];
		scheduleOwnershipHeal(raw as never, p => tasks.push(p), 'channel');
		scheduleOwnershipHeal(raw as never, p => tasks.push(p), 'channel');
		await Promise.all(tasks);
		assert.equal(await isOwnershipComplete(db, 'channel'), true);
		assert.equal(raw.channels.calls, 2, 'one list + one get: the second heal found the lease taken');
	});

	it('applies moderation made outside api-videos', async () => {
		const { db } = ownershipEnv();
		await syncOwnership(db, 'video', 'v1', videoFixture({ id: 'v1' }));
		await applyOwnershipModeration(db, 'video', 'v1', { hidden: true, deleted: true });
		assert.equal(rows(db, 'video')[0].is_hidden, 1);
		assert.equal(rows(db, 'video')[0].is_deleted, 1);
	});

	it('POST /internal/search/ownership-backfill advances the pass', async () => {
		const { db, raw } = ownershipEnv({ videos: { v1: videoFixture({ id: 'v1' }) } });
		const app = buildApp(r => r.post('/internal/search/ownership-backfill', OwnershipBackfillPost));
		const res = await app.request('/internal/search/ownership-backfill?entity=video&pages=2', { method: 'POST' }, raw);
		assert.equal(res.status, 200);
		const body = await res.json() as any;
		assert.equal(body.done, true);
		assert.equal(body.complete, true);
		assert.equal(await isOwnershipComplete(db, 'video'), true);
		assert.equal((await app.request('/internal/search/ownership-backfill?entity=video', { method: 'POST' }, { ...raw, SEARCH_DB: undefined })).status, 503);
	});
});

describe('endpoints served from the ownership index', () => {
	/** Same data twice: one env without SEARCH_DB (old scan path) and one with a complete index. */
	async function pair() {
		const data = populated();
		const scan = { videos: new MemoryBucket(data.videos), channels: new MemoryBucket(data.channels), queue: new MemoryQueue() };
		const indexed = ownershipEnv(data);
		await completeIndex(indexed.raw);
		indexed.raw.videos.calls = 0;
		indexed.raw.channels.calls = 0;
		indexed.db.queries = 0;
		return { scan, indexed: indexed.raw, db: indexed.db };
	}

	it('GET /api/channels ("mine") returns the same channels with O(user channels) reads', async () => {
		const { scan, indexed, db } = await pair();
		const app = buildApp(r => r.get('/api/channels', ChannelsList), { userId: 'owner' });
		const before = await (await app.request('/api/channels?limit=100', {}, scan)).json() as any;
		const after = await (await app.request('/api/channels?limit=100', {}, indexed)).json() as any;
		assert.deepEqual(after, before);
		assert.deepEqual(after.data.map((c: any) => c.id), ['mine1', 'mine2']);
		assert.ok(scan.channels.calls > 250, `scan read ${scan.channels.calls} objects`);
		assert.equal(indexed.channels.calls, 2, 'one GET per owned, non-deleted channel; no list');
		assert.equal(db.queries, 2, 'completeness check + id lookup');
	});

	it('GET /api/channels ("mine") falls back to the scan and heals while the index is incomplete', async () => {
		const data = populated();
		const { raw, db } = ownershipEnv(data);
		const app = buildApp(r => r.get('/api/channels', ChannelsList), { userId: 'owner' });
		const background: Promise<unknown>[] = [];
		const ctx = { waitUntil: (p: Promise<unknown>) => { background.push(p); }, passThroughOnException: () => undefined };
		const res = await app.request('/api/channels?limit=100', {}, raw, ctx as never);
		assert.deepEqual(((await res.json()) as any).data.map((c: any) => c.id), ['mine1', 'mine2']);
		assert.equal(background.length, 1, 'the fallback scheduled a heal');
		await Promise.all(background);
		assert.equal(await isOwnershipComplete(db, 'channel'), true);
		assert.deepEqual(await ownedChannelIds(raw as never, 'owner'), ['mine1', 'mine2']);
	});

	it('GET /api/channels/:id/videos pages from the index with the same filters', async () => {
		const { scan, indexed } = await pair();
		const owner = buildApp(r => r.get('/api/channels/:id/videos', ChannelVideosList), { userId: 'owner' });
		const visitor = buildApp(r => r.get('/api/channels/:id/videos', ChannelVideosList), null);

		for (const sort of ['latest', 'popular', 'oldest']) {
			const before = await (await owner.request(`/api/channels/mine1/videos?limit=12&sort=${sort}`, {}, scan)).json() as any;
			const after = await (await owner.request(`/api/channels/mine1/videos?limit=12&sort=${sort}`, {}, indexed)).json() as any;
			assert.deepEqual(after.data.map((v: any) => v.id), before.data.map((v: any) => v.id), sort);
			assert.deepEqual(after.data, before.data);
		}
		const publicView = await (await visitor.request('/api/channels/mine1/videos?limit=12', {}, indexed)).json() as any;
		assert.deepEqual(publicView.data.map((v: any) => v.id), ['m-a', 'm-b', 'm-g']);

		const page1 = await (await owner.request('/api/channels/mine1/videos?limit=2', {}, indexed)).json() as any;
		assert.deepEqual(page1.data.map((v: any) => v.id), ['m-f', 'm-c']);
		assert.equal(page1.cursor, 'idx:2');
		const page2 = await (await owner.request(`/api/channels/mine1/videos?limit=2&cursor=${page1.cursor}`, {}, indexed)).json() as any;
		assert.deepEqual(page2.data.map((v: any) => v.id), ['m-a', 'm-b']);
		const page3 = await (await owner.request(`/api/channels/mine1/videos?limit=2&cursor=${page2.cursor}`, {}, indexed)).json() as any;
		assert.deepEqual(page3.data.map((v: any) => v.id), ['m-g']);
		assert.equal(page3.cursor, '');
	});

	it('GET /api/channels/:id/videos for a channel with no videos reads no video objects', async () => {
		const { indexed } = await pair();
		const app = buildApp(r => r.get('/api/channels/:id/videos', ChannelVideosList), null);
		const body = await (await app.request('/api/channels/empty/videos', {}, indexed)).json() as any;
		assert.deepEqual(body.data, []);
		assert.equal(indexed.videos.calls, 0);
	});

	/** Shorts and streams whose keys sort after the first bucket slice (the #296 repro). */
	async function lateKeys() {
		const data = populated();
		const late = [
			videoFixture({ id: 'zz-short-new', title: 'New short', channelId: 'mine1', duration: 6, views: 2, dateCreated: '2026-06-01T00:00:00.000Z' }),
			videoFixture({ id: 'zz-short-old', title: 'Old short', channelId: 'mine1', duration: 45, views: 90, dateCreated: '2026-01-02T00:00:00.000Z' }),
			videoFixture({ id: 'zz-short-private', title: 'Private short', channelId: 'mine1', duration: 20, isPublic: false }),
			videoFixture({ id: 'zz-short-hidden', title: 'Hidden short', channelId: 'mine1', duration: 20, isHidden: true }),
			videoFixture({ id: 'zz-short-live', title: 'Short live', channelId: 'mine1', duration: 20, isLive: true, dateCreated: '2026-07-01T00:00:00.000Z' }),
			videoFixture({ id: 'zz-no-duration', title: 'Unknown length', channelId: 'mine1' }),
		];
		for (const v of late) data.videos[v.id] = v;
		const scan = { videos: new MemoryBucket(data.videos), channels: new MemoryBucket(data.channels), queue: new MemoryQueue() };
		const indexed = ownershipEnv(data);
		await completeIndex(indexed.raw);
		return { scan, indexed: indexed.raw };
	}

	it('GET /api/channels/:id/shorts finds shorts outside the first bucket slice (#296)', async () => {
		const { scan, indexed } = await lateKeys();
		const visitor = buildApp(r => r.get('/api/channels/:id/shorts', ChannelShortsList), null);
		const owner = buildApp(r => r.get('/api/channels/:id/shorts', ChannelShortsList), { userId: 'owner' });

		const scanned = await (await visitor.request('/api/channels/mine1/shorts', {}, scan)).json() as any;
		assert.deepEqual(scanned.data.map((v: any) => v.id), ['m-d'], 'the old bucket slice misses the late shorts');

		const latest = await (await visitor.request('/api/channels/mine1/shorts', {}, indexed)).json() as any;
		assert.deepEqual(latest.data.map((v: any) => v.id), ['zz-short-new', 'zz-short-old', 'm-d']);
		assert.equal(latest.data[0].channelName, 'Channel mine1');
		const popular = await (await visitor.request('/api/channels/mine1/shorts?sort=popular', {}, indexed)).json() as any;
		assert.deepEqual(popular.data.map((v: any) => v.id), ['m-d', 'zz-short-old', 'zz-short-new']);
		const mine = await (await owner.request('/api/channels/mine1/shorts', {}, indexed)).json() as any;
		assert.ok(mine.data.some((v: any) => v.id === 'zz-short-private'), 'the owner sees private shorts');

		const page1 = await (await visitor.request('/api/channels/mine1/shorts?limit=2', {}, indexed)).json() as any;
		assert.deepEqual(page1.data.map((v: any) => v.id), ['zz-short-new', 'zz-short-old']);
		const page2 = await (await visitor.request(`/api/channels/mine1/shorts?limit=2&cursor=${page1.cursor}`, {}, indexed)).json() as any;
		assert.deepEqual(page2.data.map((v: any) => v.id), ['m-d']);
		assert.equal(page2.cursor, '');
	});

	it('GET /api/channels/:id/shorts and /live 404 for deleted and (to others) private channels', async () => {
		const { indexed } = await lateKeys();
		const visitor = buildApp(r => { r.get('/api/channels/:id/shorts', ChannelShortsList); r.get('/api/channels/:id/live', ChannelLiveList); }, null);
		const owner = buildApp(r => { r.get('/api/channels/:id/shorts', ChannelShortsList); r.get('/api/channels/:id/live', ChannelLiveList); }, { userId: 'owner' });
		for (const tab of ['shorts', 'live']) {
			assert.equal((await visitor.request(`/api/channels/mine3/${tab}`, {}, indexed)).status, 404, `${tab}: deleted`);
			assert.equal((await visitor.request(`/api/channels/mine2/${tab}`, {}, indexed)).status, 404, `${tab}: private`);
			assert.equal((await owner.request(`/api/channels/mine2/${tab}`, {}, indexed)).status, 200, `${tab}: private, owner`);
		}
	});

	it('GET /api/channels/:id/live finds streams outside the first bucket slice', async () => {
		const { scan, indexed } = await lateKeys();
		const app = buildApp(r => r.get('/api/channels/:id/live', ChannelLiveList), null);
		const scanned = await (await app.request('/api/channels/mine1/live', {}, scan)).json() as any;
		assert.deepEqual(scanned.data, []);
		const body = await (await app.request('/api/channels/mine1/live', {}, indexed)).json() as any;
		assert.deepEqual(body.data.map((v: any) => v.id), ['zz-short-live']);
	});

	it('GET /api/channels/:id counts videos from the index, not channel.videos', async () => {
		const { indexed } = await lateKeys();
		const app = buildApp(r => r.get('/api/channels/:id', ChannelFetch), null);
		const body = await (await app.request('/api/channels/mine1', {}, indexed)).json() as any;
		const view = body.result ?? body;
		// m-a, m-b, m-d, m-g + zz-short-new, zz-short-old, zz-short-live, zz-no-duration
		assert.equal(view.videosCount, 8);
	});

	it('GET /api/channels/:id/about totals match the scan without reading the videos bucket', async () => {
		const { scan, indexed, db } = await pair();
		const app = buildApp(r => r.get('/api/channels/:id/about', ChannelAbout), null);
		const before = await (await app.request('/api/channels/mine1/about', {}, scan)).json() as any;
		const after = await (await app.request('/api/channels/mine1/about', {}, indexed)).json() as any;
		assert.deepEqual(after, before);
		assert.equal(after.result.videosCount, 4, 'm-a, m-b, m-d (short) and m-g count; private, hidden and scheduled do not');
		assert.equal(after.result.totalViews, 1055);
		assert.equal(after.result.statsPartial, false);
		assert.equal(indexed.videos.calls, 0);
		assert.equal(db.queries, 2);
		assert.deepEqual(await channelTotalsFromIndex(indexed as never, 'nope'), { totalViews: 0, videosCount: 0, partial: false });
	});

	it('GET /api/videos/search?channelIds= loads only the channels’ videos and returns the same results', async () => {
		const { scan, indexed } = await pair();
		const app = buildApp(r => r.get('/api/videos/search', VideoSearch), { userId: 'owner' });
		for (const query of ['channelIds=mine1', 'channelIds=mine1,ch001&sort=views', 'channelIds=mine1&q=tafsir', 'channelIds=mine1&isOwner=true&scheduleFilter=scheduled', 'channelIds=empty']) {
			const before = await (await app.request(`/api/videos/search?${query}`, {}, scan)).json() as any;
			const after = await (await app.request(`/api/videos/search?${query}`, {}, indexed)).json() as any;
			delete before.searchTime;
			delete after.searchTime;
			assert.deepEqual(after, before, query);
		}
		assert.ok(indexed.videos.calls < 60, `index path read ${indexed.videos.calls} video objects`);
	});

	it('GET /api/analytics/summary and /channels/:id read only the owner’s objects and return the same totals', async () => {
		const { scan, indexed } = await pair();
		const app = buildApp(r => {
			r.get('/api/analytics/summary', AnalyticsSummaryGet);
			r.get('/api/analytics/channels/:channelId', AnalyticsChannelGet);
		}, { userId: 'owner' });
		for (const path of ['/api/analytics/summary', '/api/analytics/summary?channelId=mine1', '/api/analytics/channels/mine1']) {
			const before = await (await app.request(path, {}, scan)).json() as any;
			const after = await (await app.request(path, {}, indexed)).json() as any;
			assert.deepEqual(after, before, path);
			assert.equal(after.totalVideos, 7, `${path}: hidden, private, scheduled and processing videos count for the owner`);
		}
		assert.ok(scan.videos.calls > 300, `scan read ${scan.videos.calls} video objects`);
		assert.equal(indexed.videos.calls, 3 * 7, 'one GET per owned video per request; no list');
		assert.equal(indexed.channels.calls, 3 * 2, 'one GET per owned channel per request; no list');
	});
});
