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
import { withSearchSync } from '../src/lib/search/sync';
import { MemoryBucket, buildApp, videoFixture } from './helpers';
import { SqliteD1, type TracedQuery } from './search-sqlite-d1';

/**
 * Public lists on a large synthetic catalogue (one channel with 30k videos):
 * each request is one keyset seek in the ownership index plus one R2 get per
 * item shown, whatever the catalogue size or the page depth; paging never
 * repeats or skips an item while videos are added and removed; playlists and
 * live streams come from the index too. (The home feed and trending are
 * discovery's, lib/ranking, and tested there.)
 */

const N = 30_000;
/** Distinct uploaders (channel members) of the big channel */
const CHANNELS = 300;
const START = Date.parse('2024-01-01T00:00:00.000Z');
/** The channel that holds the whole catalogue */
const BIG = 'ch-big';

function video(i: number, overrides: Record<string, unknown> = {}) {
	return videoFixture({
		id: `v${String(i).padStart(6, '0')}`,
		title: `Video ${i}`,
		channelId: BIG,
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

/**
 * Plans of the traced reads of content_ownership: each must seek an index,
 * never sort the table. A continued page (`continued`) must also seek to the
 * cursor's position: every index search ends on a range of the sort key, and
 * one of them reaches the id. A plan that seeks only the equalities
 * (`kind=?`) walks every row before the position, so a deep page would cost
 * as much as the catalogue.
 */
function assertSeeks(db: SqliteD1, traced: TracedQuery[], options: { continued?: boolean; table?: string } = {}) {
	const table = options.table ?? 'content_ownership';
	const reads = traced.filter((q) => /^\s*SELECT/i.test(q.sql) && q.sql.includes(table) && /ORDER BY/i.test(q.sql));
	assert.ok(reads.length > 0, 'the request read the index');
	let continuedReads = 0;
	for (const q of reads) {
		const steps = db.plan(q);
		const plan = steps.join(' | ');
		assert.match(plan, /USING (COVERING )?INDEX/, `${q.sql}\n${plan}`);
		assert.doesNotMatch(plan, /TEMP B-TREE FOR ORDER BY/, `sorts instead of seeking:\n${q.sql}\n${plan}`);
		if (!options.continued) continue;
		const searches = steps.filter((s) => s.startsWith(`SEARCH ${table} `));
		if (!searches.length) continue;
		continuedReads++;
		for (const s of searches) {
			const constraints = /\(([^()]*(?:\([^()]*\)[^()]*)*)\)\s*$/.exec(s)?.[1] ?? '';
			assert.match(constraints, /[<>]\?$|[<>]\(\?/, `seeks the equalities only, not the position:\n${q.sql}\n${plan}`);
		}
		assert.ok(searches.some((s) => /\bid[<>]\?/.test(s)), `no arm seeks to the cursor's id:\n${q.sql}\n${plan}`);
	}
	if (options.continued) assert.ok(continuedReads > 0, 'a continued page read the index from its position');
}

describe('a channel with 30k videos', () => {
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
			const result = await page(app, `/api/videos?channelId=${BIG}&limit=24${cursor ? `&cursor=${cursor}` : ''}`, env);
			assert.equal(videos.calls - callsBefore, 24, `page ${p}: one get per video shown`);
			assert.ok(db.queries - queriesBefore <= 3, `page ${p}: ${db.queries - queriesBefore} D1 queries`);
			if (p === 0 || p === 39) assertSeeks(db, db.trace, { continued: p > 0 });
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
		for (let p = 0; p < 130; p++) cursor = (await page(app, `/api/videos?channelId=${BIG}&limit=100${cursor ? `&cursor=${cursor}` : ''}`, env)).cursor;
		db.trace = [];
		const before = videos.calls;
		const deep = await page(app, `/api/videos?channelId=${BIG}&limit=24&cursor=${cursor}`, env);
		assert.equal(videos.calls - before, 24);
		assert.deepEqual(deep.ids, expected.slice(13_000, 13_024));
		assertSeeks(db, db.trace, { continued: true });
	});

	it('deep pages of the popular and date orders seek to the cursor too', async () => {
		const { db, env } = await seed();
		const app = buildApp((r) => r.get('/api/videos', VideosList), null);
		for (const url of [`/api/videos?channelId=${BIG}&sort=views&limit=50`, `/api/videos?channelId=${BIG}&sort=date&limit=10`]) {
			let cursor = '';
			for (let p = 0; p < 6; p++) {
				db.trace = [];
				const result = await page(app, `${url}${cursor ? `&cursor=${cursor}` : ''}`, env);
				if (p === 5) assertSeeks(db, db.trace, { continued: true });
				cursor = result.cursor;
				assert.ok(cursor, `${url}: page ${p} has a next cursor`);
			}
		}
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
			const result = await page(app, `/api/videos?channelId=${BIG}&limit=25${cursor ? `&cursor=${cursor}` : ''}`, env);
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
				const result = await page(app, `/api/videos?channelId=${BIG}&limit=100${cursor ? `&cursor=${cursor}` : ''}`, env);
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
			if (p <= 1) assertSeeks(db, db.trace, { continued: p > 0 });
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
			db.trace = [];
			const result = await page(app, `/api/live?status=ended&limit=20${cursor ? `&cursor=${cursor}` : ''}`, env);
			if (p === 5) assertSeeks(db, db.trace, { continued: true });
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

describe('view counts in the indexes', () => {
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

	it('view counts rise in both indexes (with popularity) and never go down', async () => {
		const { db } = await searchEnv(3);
		const v = video(1, { isPublic: true, views: 10 });
		db.db.prepare('UPDATE search_videos SET views = 10 WHERE id = ?').run(v.id);
		await syncOwnership(db as never, 'video', v.id, v, Date.now(), Date.now());
		const row = () => db.db.prepare('SELECT views, popularity, json_extract(payload, \'$.views\') AS pv FROM search_videos WHERE id = ?').get(v.id) as any;
		const own = () => Number((db.db.prepare(`SELECT views FROM content_ownership WHERE kind = 'video' AND id = ?`).get(v.id) as any).views);
		const before = row();
		await syncVideoViews(db as never, v.id, 5000);
		const raised = row();
		assert.equal(raised.views, 5000);
		assert.equal(raised.pv, 5000);
		assert.ok(raised.popularity > before.popularity);
		assert.equal(own(), 5000);
		await syncVideoViews(db as never, v.id, 40);
		assert.equal(row().views, 5000, 'a late sync never lowers it');
		assert.equal(own(), 5000);
		// An edit of the video read before the flush landed (views 10): the index keeps the higher count
		await syncOwnership(db as never, 'video', v.id, { ...v, title: 'Edited' }, Date.now(), Date.now() + 10);
		assert.equal(own(), 5000);
	});
});
