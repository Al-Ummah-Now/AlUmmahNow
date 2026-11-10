import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
	ownershipCompleteKey,
	ownershipUpsertStatement,
	projectOwnership,
	projectVideo,
	syncOwnership,
	syncVideoViews,
	upsertSearchRow,
} from '@al-ummah/shared-types';
import { VideosList } from '../src/endpoints/video/videoList';
import { PlaylistsList } from '../src/endpoints/playlist/playlistsList';
import { ChannelPlaylistsList } from '../src/endpoints/channel/channelPlaylistsList';
import { LiveStreamsList } from '../src/endpoints/live/liveStreamsList';
import { runOwnershipPass } from '../src/lib/search/ownership';
import { sectionFromIndex, TRENDING_CANDIDATES } from '../src/lib/sections/sectionIndex';
import { withSearchSync } from '../src/lib/search/sync';
import { MemoryBucket, buildApp, videoFixture } from './helpers';
import { SqliteD1, type TracedQuery } from './search-sqlite-d1';

/**
 * Public lists on a large synthetic catalogue (30k videos): each request is
 * one keyset seek in the ownership index plus one R2 get per item shown,
 * whatever the catalogue size or the page depth; paging never repeats or
 * skips an item while videos are added and removed; playlists, live streams
 * and trending come from the indexes too.
 */

const N = 30_000;
const CHANNELS = 300;
const START = Date.parse('2024-01-01T00:00:00.000Z');

function video(i: number, overrides: Record<string, unknown> = {}) {
	return videoFixture({
		id: `v${String(i).padStart(6, '0')}`,
		title: `Video ${i}`,
		channelId: `ch${i % CHANNELS}`,
		userId: `u${i % CHANNELS}`,
		// One per minute; every 50th shares its minute with the previous video (ties on the sort key)
		dateCreated: new Date(START + (i - (i % 50 === 0 && i ? 1 : 0)) * 60_000).toISOString(),
		views: (i * 7919) % 100_000,
		category: i % 3 === 0 ? 'fiqh' : 'seerah',
		isPublic: i % 10 !== 3,
		...(i % 97 === 5 ? { uploadStatus: 'processing' } : {}),
		...overrides,
	});
}

/** The catalogue in R2 and in a complete ownership index (rows written as the write path does). */
async function seed(n = N) {
	const db = new SqliteD1();
	const objects: Record<string, unknown> = {};
	for (let i = 0; i < n; i++) objects[video(i).id] = video(i);
	const videos = new MemoryBucket(objects);
	const now = Date.now();
	const statements = Object.values(objects).map((v: any) => ownershipUpsertStatement(db as never, projectOwnership('video', v.id, v)!, now, now));
	for (let i = 0; i < statements.length; i += 500) await db.batch(statements.slice(i, i + 500) as never);
	db.db.prepare('INSERT INTO search_meta (key, value, updated_at) VALUES (?, ?, ?)').run(ownershipCompleteKey('video'), '1', now);
	return { db, videos, objects, env: { SEARCH_DB: db, videos, channels: new MemoryBucket() } };
}

/** What a visitor may see, newest first (lib/visibility.ts isVideoPubliclyVisible). */
function publicIds(objects: Record<string, any>): string[] {
	return Object.values(objects)
		.filter((v) => v.isPublic !== false && !v.isDeleted && !v.isHidden && (!v.uploadStatus || v.uploadStatus === 'ready'))
		.sort((a, b) => Date.parse(b.dateCreated) - Date.parse(a.dateCreated) || (a.id < b.id ? 1 : -1))
		.map((v) => v.id);
}

async function page(app: ReturnType<typeof buildApp>, url: string, env: unknown) {
	const res = await app.request(url, {}, env as never);
	assert.equal(res.status, 200, url);
	const body = (await res.json()) as any;
	const result = body.result ?? body;
	return { ids: (result.data as Array<{ id: string }>).map((v) => v.id), cursor: result.cursor as string };
}

/** Plans of the traced reads of content_ownership: each must seek an index, never sort the table. */
function assertSeeks(db: SqliteD1, traced: TracedQuery[], table = 'content_ownership') {
	const reads = traced.filter((q) => /^\s*SELECT/i.test(q.sql) && q.sql.includes(table) && /ORDER BY/i.test(q.sql));
	assert.ok(reads.length > 0, 'the request read the index');
	for (const q of reads) {
		const plan = db.plan(q).join(' | ');
		assert.match(plan, /USING (COVERING )?INDEX/, `${q.sql}\n${plan}`);
		assert.doesNotMatch(plan, /TEMP B-TREE FOR ORDER BY/, `sorts instead of seeking:\n${q.sql}\n${plan}`);
	}
}

describe('home feed on a 30k-video catalogue', () => {
	it('every page, however deep, is one index seek and one R2 get per video shown', async () => {
		const { db, videos, objects, env } = await seed();
		const app = buildApp((r) => r.get('/api/videos', VideosList), null);
		const expected = publicIds(objects);
		const seen: string[] = [];
		let cursor = '';
		for (let p = 0; p < 40; p++) {
			db.trace = [];
			const callsBefore = videos.calls;
			const queriesBefore = db.queries;
			const result = await page(app, `/api/videos?limit=24${cursor ? `&cursor=${cursor}` : ''}`, env);
			assert.equal(videos.calls - callsBefore, 24, `page ${p}: one get per video shown`);
			assert.ok(db.queries - queriesBefore <= 3, `page ${p}: ${db.queries - queriesBefore} D1 queries`);
			if (p === 0 || p === 39) assertSeeks(db, db.trace);
			seen.push(...result.ids);
			cursor = result.cursor;
		}
		assert.deepEqual(seen, expected.slice(0, seen.length), 'newest first, nothing skipped or repeated');
	});

	it('a deep cursor costs the same as the first page', async () => {
		const { db, videos, objects, env } = await seed();
		const app = buildApp((r) => r.get('/api/videos', VideosList), null);
		const expected = publicIds(objects);
		// Walk to the middle of the catalogue with big pages, then measure one small page there
		let cursor = '';
		for (let p = 0; p < 130; p++) cursor = (await page(app, `/api/videos?limit=100${cursor ? `&cursor=${cursor}` : ''}`, env)).cursor;
		db.trace = [];
		const before = videos.calls;
		const deep = await page(app, `/api/videos?limit=24&cursor=${cursor}`, env);
		assert.equal(videos.calls - before, 24);
		assert.deepEqual(deep.ids, expected.slice(13_000, 13_024));
		assertSeeks(db, db.trace);
	});

	it('pages with no duplicates or gaps while videos are added and removed meanwhile', async () => {
		const { db, videos, objects, env } = await seed(3000);
		const synced = withSearchSync(env as never, { waitUntil: () => {} }) as any;
		const app = buildApp((r) => r.get('/api/videos', VideosList), null);
		const original = new Set(publicIds(objects));
		const removed = new Set<string>();
		const addedOld: string[] = [];
		const seen: string[] = [];
		let cursor = '';
		for (let p = 0; p < 200 && (p === 0 || cursor); p++) {
			const result = await page(app, `/api/videos?limit=25${cursor ? `&cursor=${cursor}` : ''}`, env);
			seen.push(...result.ids);
			cursor = result.cursor;
			if (!cursor) break;
			// Meanwhile: a new upload (newest: before the cursor), an old import (after it), a delete of something not shown yet
			const fresh = video(100_000 + p, { dateCreated: new Date(Date.now() + p * 1000).toISOString() });
			await synced.videos.put(fresh.id, JSON.stringify(fresh));
			const old = video(200_000 + p, { dateCreated: new Date(START - (p + 1) * 3600_000).toISOString(), isPublic: true });
			delete (old as any).uploadStatus;
			await synced.videos.put(old.id, JSON.stringify(old));
			addedOld.push(old.id);
			const unseen = [...original].find((id) => !seen.includes(id) && !removed.has(id) && Number(id.slice(1)) % 7 === 0);
			if (unseen) {
				await synced.videos.delete(unseen);
				removed.add(unseen);
			}
		}
		assert.equal(cursor, '', 'reached the end');
		assert.equal(new Set(seen).size, seen.length, 'no video twice');
		for (const id of original) if (!removed.has(id)) assert.ok(seen.includes(id), `${id} was not skipped`);
		for (const id of removed) assert.ok(!seen.includes(id), `${id} removed before its page`);
		for (const id of addedOld) assert.ok(seen.includes(id), `${id} added after the cursor is listed once`);
		assert.ok(db.count('content_ownership') > 3000);
		assert.ok(videos.calls > 0);
	});

	it('the owner also sees their own private and processing videos; nobody else does', async () => {
		const { objects, env } = await seed(3000);
		const owner = buildApp((r) => r.get('/api/videos', VideosList), { userId: 'u3' });
		const visitor = buildApp((r) => r.get('/api/videos', VideosList), null);
		const mine = Object.values(objects).filter((v: any) => v.userId === 'u3' && (v.isPublic === false || v.uploadStatus === 'processing')).map((v: any) => v.id);
		assert.ok(mine.length > 0);
		const ownerSeen: string[] = [];
		const visitorSeen: string[] = [];
		for (const [app, seen] of [[owner, ownerSeen], [visitor, visitorSeen]] as const) {
			let cursor = '';
			for (let p = 0; p < 100 && (p === 0 || cursor); p++) {
				const result = await page(app, `/api/videos?limit=100${cursor ? `&cursor=${cursor}` : ''}`, env);
				seen.push(...result.ids);
				cursor = result.cursor;
			}
		}
		for (const id of mine) {
			assert.ok(ownerSeen.includes(id), `owner sees ${id}`);
			assert.ok(!visitorSeen.includes(id), `visitor does not see ${id}`);
		}
		assert.deepEqual(visitorSeen, publicIds(objects));
	});

	it('the category filter waits for rows written with the category column, then seeks its index', async () => {
		const { db, objects, env } = await seed(3000);
		const app = buildApp((r) => r.get('/api/videos', VideosList), null);
		// A row from before migration 0013 (columns version 1): the index cannot filter by category yet.
		// Its stored version is ahead of R2's `uploaded` (a write path with a later clock), so the
		// pass's upsert keeps it; the pass must still fill the columns it lacks.
		db.db.prepare(`UPDATE content_ownership SET admin_cols = 1, video_category = NULL, source_version = ? WHERE kind = 'video' AND id = 'v000003'`).run(Date.now() + 86_400_000);
		db.db.prepare(`UPDATE content_ownership SET admin_cols = 1, video_category = NULL WHERE kind = 'video' AND id = 'v000000'`).run();
		const fallback = await page(app, '/api/videos?limit=10&category=fiqh', env);
		assert.match(fallback.cursor, /^scan:/, 'bucket fallback until the pass rewrites the rows');
		await runOwnershipPass(env as never, 'video', { maxPages: 100, pageSize: 1000 });
		db.trace = [];
		const indexed = await page(app, '/api/videos?limit=10&category=fiqh', env);
		assert.deepEqual(indexed.ids, publicIds(objects).filter((id) => (objects[id] as any).category === 'fiqh').slice(0, 10));
		assertSeeks(db, db.trace);
		const upgraded = db.db.prepare(`SELECT admin_cols, video_category, is_public FROM content_ownership WHERE kind = 'video' AND id = 'v000003'`).get() as any;
		assert.deepEqual({ ...upgraded }, { admin_cols: 2, video_category: 'fiqh', is_public: 0 }, 'columns filled, visibility kept');
	});
});

describe('playlists and live streams from the ownership index', () => {
	function playlist(i: number, overrides: Record<string, unknown> = {}) {
		return {
			id: `pl${String(i).padStart(5, '0')}`,
			name: `Playlist ${i}`,
			userId: `u${i % 100}`,
			channelId: `ch${i % 100}`,
			isPublic: i % 9 !== 4,
			videoIds: [],
			dateCreated: new Date(START + i * 60_000).toISOString(),
			dateModified: new Date(START + i * 60_000).toISOString(),
			...overrides,
		};
	}

	async function playlistsEnv() {
		const objects: Record<string, unknown> = {};
		for (let i = 0; i < 5000; i++) objects[playlist(i).id] = playlist(i);
		// A Watch later playlist of the channel: listed in the Library only
		objects['watch-later-u7'] = playlist(5001, { id: 'watch-later-u7', channelId: 'ch7', systemType: 'watch_later' });
		const db = new SqliteD1();
		const env = {
			SEARCH_DB: db,
			playlists: new MemoryBucket(objects),
			videos: new MemoryBucket(),
			channels: new MemoryBucket({ ch7: { id: 'ch7', name: 'Seven', userId: 'u7' } }),
			channel_access: new MemoryBucket(),
		};
		const pass = await runOwnershipPass(env as never, 'playlist', { maxPages: 100, pageSize: 1000 });
		assert.equal(pass.complete, true);
		return { env, objects, db };
	}

	it('GET /api/playlists?channelId= finds every playlist of the channel across the bucket, in pages', async () => {
		const { env, objects, db } = await playlistsEnv();
		const app = buildApp((r) => r.get('/api/playlists', PlaylistsList), null);
		const expected = Object.values(objects)
			.filter((p: any) => p.channelId === 'ch7' && p.isPublic !== false && !p.systemType)
			.sort((a: any, b: any) => b.dateModified.localeCompare(a.dateModified) || (a.id < b.id ? 1 : -1))
			.map((p: any) => p.id);
		const seen: string[] = [];
		let cursor = '';
		for (let p = 0; p < 20 && (p === 0 || cursor); p++) {
			db.trace = [];
			const before = env.playlists.calls;
			const result = await page(app, `/api/playlists?channelId=ch7&limit=12${cursor ? `&cursor=${cursor}` : ''}`, env);
			assert.ok(env.playlists.calls - before <= 12, `one get per playlist (${env.playlists.calls - before})`);
			if (p === 0) assertSeeks(db, db.trace);
			seen.push(...result.ids);
			cursor = result.cursor;
		}
		assert.deepEqual(seen, expected);
	});

	it('the channel Playlists tab pages the channel newest first; the owner also sees private ones', async () => {
		const { env, objects } = await playlistsEnv();
		const visitor = buildApp((r) => r.get('/api/channels/:id/playlists', ChannelPlaylistsList), null);
		const owner = buildApp((r) => r.get('/api/channels/:id/playlists', ChannelPlaylistsList), { userId: 'u7' });
		const all = Object.values(objects).filter((p: any) => p.channelId === 'ch7' && !p.systemType)
			.sort((a: any, b: any) => b.dateCreated.localeCompare(a.dateCreated) || (a.id < b.id ? 1 : -1));
		for (const [app, expected] of [[visitor, all.filter((p: any) => p.isPublic !== false)], [owner, all]] as const) {
			const seen: string[] = [];
			let cursor = '';
			for (let p = 0; p < 20 && (p === 0 || cursor); p++) {
				const result = await page(app, `/api/channels/ch7/playlists?limit=10${cursor ? `&cursor=${cursor}` : ''}`, env);
				seen.push(...result.ids);
				cursor = result.cursor;
			}
			assert.deepEqual(seen, expected.map((p: any) => p.id));
		}
	});

	it('GET /api/live lists live streams first, filters by status without short pages, and follows writes', async () => {
		const objects: Record<string, unknown> = {};
		const statuses = ['scheduled', 'live', 'ended', 'cancelled'];
		for (let i = 0; i < 1200; i++) {
			const id = `st${String(i).padStart(5, '0')}`;
			objects[`livestream:${id}`] = {
				id, title: `Stream ${i}`, userId: `u${i % 40}`, channelId: `ch${i % 40}`, status: statuses[i % 4],
				isPrivate: i % 11 === 0, dateCreated: new Date(START + i * 60_000).toISOString(), dateModified: new Date(START + i * 60_000).toISOString(),
				likes: [], dislikes: [], comments: [], tags: [], views: 0, currentViewers: 0, peakViewers: 0, allowChat: true,
			};
		}
		for (let i = 0; i < 500; i++) objects[`v${i}`] = videoFixture({ id: `v${i}` });
		const db = new SqliteD1();
		const env: any = { SEARCH_DB: db, videos: new MemoryBucket(objects), channels: new MemoryBucket() };
		assert.equal((await runOwnershipPass(env, 'stream', { maxPages: 100, pageSize: 1000 })).complete, true);
		await runOwnershipPass(env, 'video', { maxPages: 100, pageSize: 1000 });
		assert.equal(Number((db.db.prepare(`SELECT COUNT(*) AS n FROM content_ownership WHERE kind = 'stream'`).get() as any).n), 1200);
		assert.equal(Number((db.db.prepare(`SELECT COUNT(*) AS n FROM content_ownership WHERE kind = 'video'`).get() as any).n), 500, 'streams are not videos');

		const app = buildApp((r) => r.get('/api/live', LiveStreamsList), null);
		const first = await page(app, '/api/live?limit=9', env);
		assert.equal(first.ids.length, 9);
		for (const id of first.ids) assert.equal((objects[`livestream:${id}`] as any).status, 'live', 'live streams first');
		const live: string[] = [];
		let cursor = '';
		for (let p = 0; p < 100 && (p === 0 || cursor); p++) {
			const result = await page(app, `/api/live?status=ended&limit=20${cursor ? `&cursor=${cursor}` : ''}`, env);
			if (cursor) assert.ok(result.ids.length === 20 || !result.cursor, 'full pages until the last');
			live.push(...result.ids);
			cursor = result.cursor;
		}
		const ended = Object.values(objects).filter((s: any) => s.status === 'ended' && !s.isPrivate).map((s: any) => s.id).sort().reverse();
		assert.deepEqual(live, ended);

		// A new stream written through api-videos appears at once
		const synced = withSearchSync(env, { waitUntil: () => {} }) as any;
		await synced.videos.put('livestream:new', JSON.stringify({ ...(objects['livestream:st00001'] as object), id: 'new', status: 'live', isPrivate: false, dateCreated: new Date().toISOString() }));
		assert.equal((await page(app, '/api/live?limit=1', env)).ids[0], 'new');
		await synced.videos.delete('livestream:new');
		assert.notEqual((await page(app, '/api/live?limit=1', env)).ids[0], 'new');
	});
});

describe('trending and view counts from the indexes', () => {
	async function searchEnv(n: number) {
		const db = new SqliteD1();
		const objects: Record<string, unknown> = {};
		for (let i = 0; i < n; i++) {
			const v = video(i, { isPublic: true, uploadStatus: 'ready' });
			objects[v.id] = v;
			await upsertSearchRow(db as never, projectVideo(v)!, { now: Date.now(), version: Date.now() });
		}
		return { db, objects, env: { SEARCH_DB: db, videos: new MemoryBucket(objects) } };
	}

	it('an old video being watched now becomes a trending candidate, and candidates come from index seeks', async () => {
		const { db, objects, env } = await searchEnv(1500);
		const old = 'v000010';
		// Not among the newest 200 nor the 200 most viewed
		(objects[old] as any).views = 3;
		db.db.prepare('UPDATE search_videos SET views = 3 WHERE id = ?').run(old);
		// Every scored candidate fits on this page (3 × 200 at most)
		const all = { sort: 'trending' as const, limit: 50, offset: 0 };
		const scored = async () => {
			const ids = new Set<string>();
			for (let offset = 0; offset < 600; offset += 50) {
				const p = await sectionFromIndex(env as never, { ...all, offset });
				for (const id of p!.trending!.keys()) ids.add(id);
				if (p!.nextOffset === undefined) break;
			}
			return ids;
		};
		assert.ok(!(await scored()).has(old), 'neither new nor among the most viewed: not a candidate');
		// Views well below the 200 most viewed (those have ~87k+), raised by the view counter now
		await syncVideoViews(db as never, old, 50_000);
		(objects[old] as any).views = 50_000;
		db.trace = [];
		assert.ok((await scored()).has(old), 'a candidate now: among the recently active videos');
		const candidates = db.trace.find((q) => /UNION/.test(q.sql))!;
		const plan = db.plan(candidates).join(' | ');
		assert.doesNotMatch(plan, /SCAN search_videos(?! USING)/, plan);
		assert.ok(TRENDING_CANDIDATES * 3 >= 600);
	});

	it('recent and popular pages count matches on the first page only, capped', async () => {
		const { db, env } = await searchEnv(300);
		db.trace = [];
		const first = await sectionFromIndex(env as never, { sort: 'recent', limit: 20, offset: 0 });
		assert.equal(first!.total, 300);
		assert.equal(first!.nextOffset, 20);
		db.trace = [];
		const second = await sectionFromIndex(env as never, { sort: 'popular', limit: 20, offset: 20 });
		assert.equal(second!.total, undefined);
		assert.ok(!db.trace.some((q) => /COUNT\(\*\)/.test(q.sql)), 'no count on later pages');
		const last = await sectionFromIndex(env as never, { sort: 'recent', limit: 20, offset: 280 });
		assert.equal(last!.nextOffset, undefined);
	});

	it('view counts rise in both indexes (popularity, activity) and never go down', async () => {
		const { db } = await searchEnv(3);
		const v = video(1, { isPublic: true, views: 10 });
		db.db.prepare('UPDATE search_videos SET views = 10 WHERE id = ?').run(v.id);
		await syncOwnership(db as never, 'video', v.id, v, Date.now(), Date.now());
		const row = () => db.db.prepare('SELECT views, popularity, activity_at, json_extract(payload, \'$.views\') AS pv FROM search_videos WHERE id = ?').get(v.id) as any;
		const own = () => Number((db.db.prepare(`SELECT views FROM content_ownership WHERE kind = 'video' AND id = ?`).get(v.id) as any).views);
		const before = row();
		await syncVideoViews(db as never, v.id, 5000, 123);
		const raised = row();
		assert.equal(raised.views, 5000);
		assert.equal(raised.pv, 5000);
		assert.equal(raised.activity_at, 123);
		assert.ok(raised.popularity > before.popularity);
		assert.equal(own(), 5000);
		await syncVideoViews(db as never, v.id, 40, 456);
		assert.equal(row().views, 5000, 'a late sync never lowers it');
		assert.equal(own(), 5000);
		// An edit of the video read before the flush landed (views 10): the index keeps the higher count
		await syncOwnership(db as never, 'video', v.id, { ...v, title: 'Edited' }, Date.now(), Date.now() + 10);
		assert.equal(own(), 5000);
	});
});
