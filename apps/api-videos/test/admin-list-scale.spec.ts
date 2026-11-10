import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
	ADMIN_TOTAL_CAP,
	ownershipCompleteKey,
	ownershipUpsertStatement,
	projectOwnership,
	syncOwnership,
	syncVideoViews,
	type OwnershipKind,
} from '@al-ummah/shared-types';
import { channelVideoStats, listChannels, listComments, listPlaylistsFromIndex, listUsers, listVideos } from '../src/lib/admin/directory';
import { listJobsPage } from '../src/lib/admin/jobs';
import { commentIndexStatements } from '../src/lib/admin/commentIndex';
import { createProcessingInternalRouter } from '../src/endpoints/video/processingInternal';
import { MemoryBucket, videoFixture } from './helpers';
import { SqliteD1 } from './search-sqlite-d1';
import { assertNoTableWalk, assertSeeks } from './plan-assert';

/**
 * Admin lists on a large synthetic catalogue (30k videos, 300 channels and
 * profiles): every page is a keyset seek of an index, reads no R2 object for
 * rows that carry the list columns, and costs the same however deep it is;
 * paging never repeats or skips a row while rows are added and removed;
 * searches read their matches by rowid; channel totals, comment search and
 * the processing lists come from trigger-kept or partial indexes.
 */

const N = 30_000;
const CHANNELS = 300;
const START = Date.parse('2024-01-01T00:00:00.000Z');

const video = (i: number, overrides: Record<string, unknown> = {}) =>
	videoFixture({
		id: `v${String(i).padStart(6, '0')}`,
		title: `Lecture ${i} on ${i % 2 ? 'seerah' : 'fiqh'}`,
		channelId: `ch${String(i % CHANNELS).padStart(3, '0')}`,
		userId: `u${String(i % CHANNELS).padStart(3, '0')}`,
		// Every 50th shares its minute with the previous video (ties on the sort key)
		dateCreated: new Date(START + (i - (i % 50 === 0 && i ? 1 : 0)) * 60_000).toISOString(),
		views: (i * 7919) % 100_000,
		thumbnailUrl: `https://img.example/${i}.jpg`,
		...(i % 97 === 5 ? { uploadStatus: 'processing' } : {}),
		...(i % 211 === 7 ? { uploadStatus: 'failed' } : {}),
		...(i % 401 === 9 ? { processingIssue: { kind: 'stalled', reason: 'no result', at: new Date(START + i * 1000).toISOString() } } : {}),
		...(i % 503 === 11 ? { uploadStatus: 'uploading', abandoned: { at: new Date(START).toISOString() } } : {}),
		...overrides,
	});

const channel = (c: number) => ({
	id: `ch${String(c).padStart(3, '0')}`,
	name: c === 42 ? 'Masjid an-Nur Lectures' : `Channel ${c}`,
	handle: `handle${c}`,
	userId: `u${String(c).padStart(3, '0')}`,
	avatarUrl: `https://img.example/ch${c}.jpg`,
	dateCreated: new Date(START + c * 3_600_000).toISOString(),
	isVerified: c % 7 === 0,
});

const profile = (c: number) => ({
	id: `u${String(c).padStart(3, '0')}`,
	displayName: `User ${c}`,
	userName: `user${c}`,
	email: c === 17 ? 'imam.ahmad@example.org' : `user${c}@example.com`,
	dateCreated: new Date(START + c * 7_200_000).toISOString(),
});

async function writeRows(db: SqliteD1, kind: OwnershipKind, objects: Array<{ id: string }>) {
	const now = Date.now();
	const statements = objects.map((o) => ownershipUpsertStatement(db as never, projectOwnership(kind, o.id, o)!, now, now));
	for (let i = 0; i < statements.length; i += 500) await db.batch(statements.slice(i, i + 500) as never);
	db.db.prepare('INSERT OR REPLACE INTO search_meta (key, value, updated_at) VALUES (?, ?, ?)').run(ownershipCompleteKey(kind), '1', now);
}

async function seed(n = N) {
	const db = new SqliteD1();
	const videos: Record<string, unknown> = {};
	for (let i = 0; i < n; i++) videos[video(i).id] = video(i);
	const channels: Record<string, unknown> = {};
	const profiles: Record<string, unknown> = {};
	for (let c = 0; c < CHANNELS; c++) {
		channels[channel(c).id] = channel(c);
		profiles[profile(c).id] = profile(c);
	}
	await writeRows(db, 'video', Object.values(videos) as never);
	await writeRows(db, 'channel', Object.values(channels) as never);
	await writeRows(db, 'profile', Object.values(profiles) as never);
	const env = {
		SEARCH_DB: db,
		videos: new MemoryBucket(videos),
		channels: new MemoryBucket(channels),
		profiles: new MemoryBucket(profiles),
		playlists: new MemoryBucket(),
		community_posts: new MemoryBucket(),
	};
	return { db, env: env as any, videos: videos as Record<string, any>, channels: channels as Record<string, any> };
}

const r2Calls = (env: any) => env.videos.calls + env.channels.calls + env.profiles.calls + env.playlists.calls;

/** Not deleted videos, newest first, id descending on ties (the admin list order). */
function newestIds(videos: Record<string, any>): string[] {
	return Object.values(videos)
		.filter((v) => !v.isDeleted)
		.sort((a, b) => Date.parse(b.dateCreated) - Date.parse(a.dateCreated) || (a.id < b.id ? 1 : -1))
		.map((v) => v.id);
}

describe('admin videos list on a 30k-video catalogue', () => {
	it('pages newest first with keyset cursors: no R2 reads, bounded D1 work, same cost deep in the list', async () => {
		const { db, env, videos } = await seed();
		const expected = newestIds(videos);
		const seen: string[] = [];
		let cursor: string | undefined;
		for (let p = 0; p < 120; p++) {
			db.trace = p === 0 || p === 119 ? [] : null;
			const before = r2Calls(env);
			const queries = db.queries;
			const page = await listVideos(env, { pageSize: 100, cursor });
			assert.equal(r2Calls(env) - before, 0, 'list fields come from the index row');
			assert.ok(db.queries - queries <= 6, `page ${p}: ${db.queries - queries} D1 statements`);
			if (p === 0) {
				assert.equal(page.total, ADMIN_TOTAL_CAP);
				assert.equal(page.totalCapped, true);
				assertSeeks(db, db.trace!, { alias: 'v' });
			}
			if (p === 119) assertSeeks(db, db.trace!, { alias: 'v', continued: true });
			seen.push(...page.items.map((v) => v.id));
			assert.ok(page.cursor, 'more pages');
			cursor = page.cursor;
		}
		assert.deepEqual(seen, expected.slice(0, 12_000), 'newest first, nothing repeated or skipped');
		const first = await listVideos(env, { pageSize: 3 });
		assert.equal(first.items[0].thumbnailUrl, videos[expected[0]].thumbnailUrl);
		assert.equal(first.items[0].channelName, `Channel ${Number(videos[expected[0]].channelId.slice(2))}`);
	});

	it('every order and filter seeks its index on a deep page', async () => {
		const { db, env } = await seed();
		const cases: Array<Record<string, unknown>> = [
			{ sort: 'views' },
			{ sort: 'title' },
			{ sort: 'oldest' },
			{ channelId: 'ch007' },
			{ channelId: 'ch007', sort: 'views' },
			{ channelId: 'ch007', sort: 'title' },
			{ ownerId: 'u009' },
			{ status: 'processing' },
		];
		for (const query of cases) {
			let cursor: string | undefined;
			for (let p = 0; p < 3; p++) {
				db.trace = [];
				const page = await listVideos(env, { ...query, pageSize: 25, cursor } as never);
				if (p === 2) assertSeeks(db, db.trace, { alias: 'v', continued: true });
				assert.ok(page.cursor, `${JSON.stringify(query)}: page ${p} has a next page`);
				cursor = page.cursor;
			}
		}
	});

	it('pages with no duplicates or gaps while videos are added and removed meanwhile', async () => {
		const { db, env, videos } = await seed(3000);
		const original = newestIds(videos);
		const removed = new Set<string>();
		const seen: string[] = [];
		let cursor: string | undefined;
		let added = 0;
		for (let p = 0; p < 200; p++) {
			const page = await listVideos(env, { pageSize: 40, cursor });
			seen.push(...page.items.map((v) => v.id));
			// Meanwhile: a new upload (newest, before the position) and one removal ahead of the position
			const fresh = video(100_000 + added++, { dateCreated: new Date(Date.now() + added * 1000).toISOString() });
			await syncOwnership(db as never, 'video', fresh.id, fresh);
			const ahead = original[original.indexOf(seen[seen.length - 1]) + 50];
			if (ahead && !removed.has(ahead)) {
				removed.add(ahead);
				await syncOwnership(db as never, 'video', ahead, null);
			}
			if (!page.cursor) break;
			cursor = page.cursor;
		}
		assert.equal(new Set(seen).size, seen.length, 'no duplicates');
		assert.deepEqual(seen, original.filter((id) => !removed.has(id)), 'every remaining original video, in order; new uploads before the position are not inserted mid-way');
	});

	it('a title search reads its matches by rowid (trigram index), however large the catalogue', async () => {
		const { db, env, videos } = await seed();
		db.trace = [];
		const page = await listVideos(env, { q: 'Lecture 2999 ', pageSize: 20 });
		assert.deepEqual(
			page.items.map((v) => v.id),
			newestIds(videos).filter((id) => videos[id].title.toLowerCase().includes('lecture 2999')).slice(0, 20),
		);
		assertNoTableWalk(db, db.trace, 'v');
		// Below 3 characters: a title prefix or an exact id, also without a walk
		db.trace = [];
		const exact = await listVideos(env, { q: 'v001234', pageSize: 20 });
		assert.deepEqual(exact.items.map((v) => v.id), ['v001234']);
		assertNoTableWalk(db, db.trace, 'v');
		const short = await listVideos(env, { q: 'Le', pageSize: 5 });
		assert.equal(short.items.length, 5);
	});

	it('legacy numbered pages still answer (within the count cap)', async () => {
		const { env, videos } = await seed(3000);
		const page = await listVideos(env, { page: 3, pageSize: 20 });
		assert.deepEqual(page.items.map((v) => v.id), newestIds(videos).slice(40, 60));
		assert.deepEqual((await listVideos(env, { page: 60, pageSize: 20 })).items, [], 'past the cap: empty');
	});

	it('rows written before the media columns read their object (only those)', async () => {
		const { db, env, videos } = await seed(500);
		const id = newestIds(videos)[1];
		db.db.prepare(`UPDATE content_ownership SET admin_cols = 2, image_url = NULL WHERE kind = 'video' AND id = ?`).run(id);
		const before = env.videos.calls;
		const page = await listVideos(env, { pageSize: 5 });
		assert.equal(env.videos.calls - before, 1, 'one get, for the old row');
		assert.equal(page.items[1].thumbnailUrl, videos[id].thumbnailUrl);
	});
});

describe('admin channels and users', () => {
	it('sorts channels by views from channel_totals, kept by triggers as views and videos change', async () => {
		const { db, env, videos } = await seed();
		const sums = new Map<string, number>();
		for (const v of Object.values(videos)) sums.set(v.channelId, (sums.get(v.channelId) ?? 0) + v.views);
		const expected = [...sums.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? 1 : -1)).map(([id]) => id);
		const seen: string[] = [];
		let cursor: string | undefined;
		for (let p = 0; p < 20; p++) {
			db.trace = [];
			const page = await listChannels(env, { sort: 'views', pageSize: 50, cursor });
			if (p === 1) assertSeeks(db, db.trace, { table: 'channel_totals', alias: 't', continued: true });
			seen.push(...page.items.map((c) => c.id));
			for (const c of page.items) assert.equal(c.views, sums.get(c.id));
			if (!page.cursor) break;
			cursor = page.cursor;
		}
		assert.deepEqual(seen, expected);
		assert.equal(env.channels.calls, 0, 'names, avatars and totals from the index');

		// Views rise (view counter), a video moves channel, one is deleted: totals follow
		const [a, b, c] = Object.values(videos).filter((v) => v.channelId === 'ch010').slice(0, 3);
		await syncVideoViews(db as never, a.id, a.views + 1000);
		await syncOwnership(db as never, 'video', b.id, { ...b, channelId: 'ch011' }, Date.now(), Date.now() + 1);
		await syncOwnership(db as never, 'video', c.id, null, Date.now(), Date.now() + 2);
		for (const id of ['ch010', 'ch011']) {
			const row = db.db
				.prepare(`SELECT COUNT(*) AS videos, COALESCE(SUM(views), 0) AS views FROM content_ownership WHERE kind = 'video' AND channel_id = ? AND is_deleted = 0`)
				.get(id) as any;
			assert.deepEqual(await channelVideoStats(db as never, id), { videos: Number(row.videos), views: Number(row.views) }, id);
		}
	});

	it('channel search matches name, handle and the owner email by substring', async () => {
		const { db, env } = await seed();
		db.trace = [];
		assert.deepEqual((await listChannels(env, { q: 'an-Nur' })).items.map((c) => c.id), ['ch042']);
		assertNoTableWalk(db, db.trace, 'c');
		assert.deepEqual((await listChannels(env, { q: 'imam.ahmad' })).items.map((c) => c.id), ['ch017']);
		assert.deepEqual((await listChannels(env, { q: 'handle123' })).items.map((c) => c.id), ['ch123']);
		db.trace = [];
		assert.deepEqual((await listChannels(env, { q: 'an-Nur', sort: 'views' })).items.map((c) => c.id), ['ch042']);
		assertNoTableWalk(db, db.trace, 'c');
	});

	it('users page profiles and banned users without a profile together, newest first, without gaps', async () => {
		const { db, env } = await seed(10);
		const now = Date.now();
		// Bans whose profile was erased (the ban outlives the data), interleaved in time with profiles
		for (let i = 0; i < 25; i++) {
			db.db.prepare('INSERT INTO videos_bans (user_id, reason, banned_by, banned_at) VALUES (?, ?, ?, ?)').run(`gone${i}`, 'spam', 'admin', new Date(START + i * 25_000_000).toISOString());
		}
		db.db.prepare('INSERT INTO videos_bans (user_id, reason, banned_by, banned_at) VALUES (?, ?, ?, ?)').run('u005', 'spam', 'admin', new Date(now).toISOString());
		const seen: Array<{ id: string; createdAt: string | null; isBanned: boolean }> = [];
		let cursor: string | undefined;
		for (let p = 0; p < 100; p++) {
			db.trace = [];
			const page = await listUsers(env, { pageSize: 7, cursor });
			if (p === 2) {
				assertSeeks(db, db.trace.filter((q) => q.sql.includes('p.is_deleted = 0')), { alias: 'p', continued: true });
				assertSeeks(db, db.trace.filter((q) => q.sql.includes('b.user_id AS id')), { table: 'videos_bans', alias: 'b', continued: true });
			}
			seen.push(...page.items);
			if (!page.cursor) break;
			cursor = page.cursor;
		}
		assert.equal(seen.length, CHANNELS + 25);
		assert.equal(new Set(seen.map((u) => u.id)).size, seen.length, 'no duplicates');
		const times = seen.map((u) => Date.parse(u.createdAt!));
		assert.deepEqual(times, [...times].sort((x, y) => y - x), 'newest first across both sources');
		assert.equal(seen.find((u) => u.id === 'u005')!.isBanned, true);
		const banned = await listUsers(env, { banned: 'yes', pageSize: 100 });
		assert.equal(banned.items.length, 26);
	});
});

describe('admin comments: trigram search kept by triggers', () => {
	async function commentsEnv() {
		const { db, env } = await seed(2000);
		const withComments = (i: number, texts: string[]) => ({
			...video(i),
			comments: texts.map((text, k) => ({ id: `c${i}-${k}`, userId: `u${k}`, text, createdAt: new Date(START + i * 60_000 + k).toISOString(), replies: [] })),
		});
		const statements = [];
		for (let i = 0; i < 2000; i++) statements.push(...commentIndexStatements(db as never, video(i).id, withComments(i, [`comment ${i} about wudu`, `another ${i}`])));
		for (let i = 0; i < statements.length; i += 500) await db.batch(statements.slice(i, i + 500) as never);
		return { db, env, withComments };
	}

	it('pages newest first with a cursor and finds text by substring', async () => {
		const { db, env } = await commentsEnv();
		const seen: string[] = [];
		let cursor: string | undefined;
		for (let p = 0; p < 4; p++) {
			db.trace = [];
			const page = await listComments(env, { pageSize: 50, cursor });
			if (p === 3) assertSeeks(db, db.trace, { table: 'admin_comments', alias: 'c', continued: true });
			seen.push(...page.items.map((c) => c.id));
			cursor = page.cursor;
		}
		assert.equal(new Set(seen).size, 200);
		assert.deepEqual(seen.slice(0, 3), ['c1999-1', 'c1999-0', 'c1998-1']);
		db.trace = [];
		const found = await listComments(env, { q: 'comment 1234 about' });
		assert.deepEqual(found.items.map((c) => c.id), ['c1234-0']);
		assertNoTableWalk(db, db.trace, 'c', 'admin_comments');
	});

	it('re-syncing comments (edits, deletes, repeats) leaves exactly one text row per comment, recursive triggers on or off', async () => {
		for (const recursive of [false, true]) {
			const { db, withComments } = await commentsEnv();
			db.db.exec(`PRAGMA recursive_triggers = ${recursive ? 'ON' : 'OFF'}`);
			const write = async (statements: unknown[]) => db.batch(statements as never);
			await write(commentIndexStatements(db as never, video(5).id, withComments(5, ['edited text five', 'another 5'])));
			await write(commentIndexStatements(db as never, video(6).id, withComments(6, ['only one now'])));
			await write(commentIndexStatements(db as never, video(7).id, null));
			// The same comment twice in one write, and a legacy INSERT OR REPLACE writer
			await write(commentIndexStatements(db as never, video(8).id, { ...withComments(8, ['dup']), comments: [...withComments(8, ['dup a']).comments, ...withComments(8, ['dup b']).comments] }));
			db.db.prepare(`INSERT OR REPLACE INTO admin_comments (video_id, comment_id, text) VALUES (?, ?, ?)`).run(video(9).id, 'c9-0', 'replaced nine');
			const rows = Number((db.db.prepare('SELECT COUNT(*) AS n FROM admin_comments').get() as any).n);
			const textRows = Number((db.db.prepare('SELECT COUNT(*) AS n FROM admin_comments_fts').get() as any).n);
			const keys = Number((db.db.prepare('SELECT COUNT(*) AS n FROM admin_comment_keys').get() as any).n);
			assert.equal(textRows, rows, `recursive ${recursive}: one text row per comment`);
			assert.equal(keys, rows, `recursive ${recursive}: one key per comment`);
			const match = (q: string) => (db.db.prepare('SELECT rowid FROM admin_comments_fts WHERE admin_comments_fts MATCH ?').all(`"${q}"`) as any[]).length;
			assert.equal(match('comment 5 about'), 0, 'edited text gone');
			assert.equal(match('edited text five'), 1);
			assert.equal(match('comment 7 about'), 0, 'deleted video gone');
			assert.equal(match('comment 9 about'), 0, 'replaced text gone');
			assert.equal(match('replaced nine'), 1);
			assert.equal(match('dup b'), 1);
		}
	});

	it('the title index stays exact through renames and removals (no orphan text rows)', async () => {
		const { db } = await seed(200);
		const v = video(3);
		await syncOwnership(db as never, 'video', v.id, { ...v, title: 'Renamed talk about zakat' }, Date.now(), Date.now() + 1);
		await syncOwnership(db as never, 'video', video(4).id, null, Date.now(), Date.now() + 1);
		const match = (q: string) =>
			(db.db.prepare(`SELECT c.id FROM content_ownership_fts f JOIN content_ownership c ON c.rowid = f.rowid WHERE content_ownership_fts MATCH ?`).all(`"${q}"`) as any[]).map((r) => r.id);
		const orphans = (q: string) =>
			(db.db.prepare(`SELECT f.rowid FROM content_ownership_fts f WHERE content_ownership_fts MATCH ? AND f.rowid NOT IN (SELECT rowid FROM content_ownership)`).all(`"${q}"`) as any[]).length;
		assert.deepEqual(match('about zakat'), [v.id]);
		assert.deepEqual(match('Lecture 3 on'), []);
		assert.equal(orphans('Lecture 3 on'), 0);
		assert.equal(orphans('Lecture 4 on'), 0);
		db.db.exec(`INSERT INTO content_ownership_fts (content_ownership_fts) VALUES ('integrity-check')`);
	});
});

describe('admin playlists, jobs and processing lists', () => {
	it('playlists come from the ownership index with a keyset cursor', async () => {
		const { db, env } = await seed(10);
		const playlists = Array.from({ length: 450 }, (_, i) => ({
			id: `pl${String(i).padStart(4, '0')}`,
			name: `Playlist ${i}`,
			channelId: `ch${String(i % 30).padStart(3, '0')}`,
			userId: `u${String(i % 30).padStart(3, '0')}`,
			videos: Array.from({ length: i % 9 }, (_, k) => `v${k}`),
			dateCreated: new Date(START + i * 60_000).toISOString(),
		}));
		await writeRows(db, 'playlist', playlists);
		const seen: string[] = [];
		let cursor: string | null = null;
		for (let p = 0; p < 30; p++) {
			db.trace = [];
			const page = await listPlaylistsFromIndex(env, { pageSize: 20, cursor });
			assert.ok(page);
			if (p === 5) assertSeeks(db, db.trace, { alias: 'p', continued: true });
			seen.push(...page.items.map((x) => x.id));
			if (p === 0) assert.equal(page.items[0].videoCount, 449 % 9);
			if (!page.nextCursor) break;
			cursor = page.nextCursor;
		}
		assert.deepEqual(seen, playlists.map((p) => p.id).reverse());
		assert.equal(env.playlists.calls, 0);
	});

	it('jobs page past 100 with a cursor, newest first, by status', async () => {
		const db = new SqliteD1();
		const insert = db.db.prepare(
			`INSERT INTO admin_jobs (id, kind, target_kind, target_id, params, status, attempts, actor_id, created_at, updated_at) VALUES (?, 'channel.delete', 'channel', ?, '{}', ?, 0, 'admin', ?, ?)`,
		);
		for (let i = 0; i < 260; i++) {
			const at = new Date(START + Math.floor(i / 2) * 1000).toISOString();
			insert.run(`job${String(i).padStart(4, '0')}`, `ch${i}`, i % 3 ? 'succeeded' : 'failed', at, at);
		}
		const env = { SEARCH_DB: db } as any;
		for (const status of [undefined, 'failed']) {
			const seen: string[] = [];
			let cursor: string | undefined;
			for (let p = 0; p < 10; p++) {
				db.trace = [];
				const page = await listJobsPage(env, { status, limit: 100, cursor });
				if (p === 1) assertSeeks(db, db.trace, { table: 'admin_jobs', continued: true });
				seen.push(...page.items.map((j) => j.id));
				if (!page.cursor) break;
				cursor = page.cursor;
			}
			const expected = Array.from({ length: 260 }, (_, i) => i)
				.filter((i) => !status || i % 3 === 0)
				.sort((a, b) => Math.floor(b / 2) - Math.floor(a / 2) || b - a)
				.map((i) => `job${String(i).padStart(4, '0')}`);
			assert.deepEqual(seen, expected, `status ${status ?? 'all'}`);
		}
	});

	it('processing and errors lists seek partial indexes of not-ready and flagged videos', async () => {
		const { db, env, videos } = await seed();
		const router = createProcessingInternalRouter();
		const all = Object.values(videos);
		const stuck = all
			.filter((v) => !v.abandoned && ((v.uploadStatus && v.uploadStatus !== 'ready') || v.processingIssue))
			.sort((a, b) => Date.parse(b.dateCreated) - Date.parse(a.dateCreated) || (a.id < b.id ? 1 : -1))
			.map((v) => v.id);
		const seen: string[] = [];
		let cursor = '';
		for (let p = 0; p < 50; p++) {
			db.trace = [];
			const before = env.videos.calls;
			const res = (await (await router.request(`/videos?limit=100${cursor ? `&cursor=${cursor}` : ''}`, {}, env)).json()) as any;
			assert.equal(env.videos.calls - before, res.result.items.length, 'one get per video shown');
			const plans = db.trace.filter((q) => q.sql.includes('ORDER BY')).map((q) => db.plan(q).join(' | ')).join('\n');
			assert.match(plans, /idx_content_ownership_stuck/, plans);
			if (p === 1) assertSeeks(db, db.trace, { alias: 'v', continued: true });
			seen.push(...res.result.items.map((v: any) => v.id));
			if (!res.result.cursor) break;
			cursor = res.result.cursor;
		}
		assert.deepEqual(seen, stuck);

		db.trace = [];
		const errors = (await (await router.request('/errors?limit=50', {}, env)).json()) as any;
		const plans = db.trace.filter((q) => q.sql.includes('ORDER BY') && q.sql.includes('content_ownership')).map((q) => db.plan(q).join(' | ')).join('\n');
		assert.match(plans, /idx_content_ownership_errors/, plans);
		const failedOrFlagged = all.filter((v) => v.uploadStatus === 'failed' || v.processingIssue);
		assert.equal(errors.result.videos.length, 50);
		for (const v of errors.result.videos) assert.ok(failedOrFlagged.some((x) => x.id === v.id));
		assert.ok(errors.result.videosCursor, 'more failed or flagged videos than one page');
		const stalled = (await (await router.request('/videos?status=stalled&limit=500', {}, env)).json()) as any;
		assert.deepEqual(
			stalled.result.items.map((v: any) => v.id).sort(),
			all.filter((v) => v.processingIssue?.kind === 'stalled' && !v.abandoned).map((v) => v.id).sort(),
		);
	});
});
