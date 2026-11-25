import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ownershipCompleteKey, ownershipUpsertStatement, projectOwnership, projectVideo, upsertSearchRow } from '@al-ummah/shared-types';
import { VideosList } from '../src/endpoints/video/videoList';
import R2Repository from '../src/lib/r2Repo';
import { MemoryBucket, buildApp, videoFixture } from './helpers';
import { SqliteD1 } from './search-sqlite-d1';

/**
 * GET /api/videos with a category or a title and no channel read the videos bucket (up to 300 objects a
 * request) though the index can answer: the category is a column, a title is in the full-text index.
 */
const N = 2_000;
const START = Date.parse('2026-01-01T00:00:00.000Z');
const pad = (i: number) => `v${String(i).padStart(5, '0')}`;
const record = (i: number) =>
	videoFixture({
		id: pad(i),
		title: i % 400 === 7 ? `Tafsir of Surah ${i}` : `Lesson ${i}`,
		...(i % 400 === 8 ? { title: `Clip ${i}`, titleLocalized: { ar: `تفسير سورة ${i}` } } : {}),
		channelId: `ch${i % 20}`,
		userId: `u${i % 20}`,
		dateCreated: new Date(START + i * 60_000).toISOString(),
		views: (i * 7919) % 5_000,
		category: i % 100 === 0 ? 'fiqh' : 'seerah',
		...(i % 500 === 0 ? { isPublic: false } : {}),
	});

async function seed() {
	const db = new SqliteD1();
	const objects: Record<string, unknown> = {
		// What else the bucket holds: never a video, never read
		'share-cards/v3/v/a/b.jpg': 'not json',
		'index:trending-videos': { id: 'index:trending-videos' },
	};
	const videos = [...Array(N).keys()].map(record) as any[];
	videos.push(videoFixture({ id: 'mine-priv', title: 'My tafsir draft', userId: 'me', channelId: null, isPublic: false, category: 'fiqh', dateCreated: '2026-06-01T00:00:00.000Z' }));
	videos.push(videoFixture({ id: 'theirs-priv', title: 'Their tafsir draft', userId: 'other', channelId: null, isPublic: false, category: 'fiqh', dateCreated: '2026-06-02T00:00:00.000Z' }));
	for (const v of videos) objects[v.id] = v;
	const now = Date.now();
	const statements = videos.map((v) => ownershipUpsertStatement(db as never, projectOwnership('video', v.id, v)!, now, now));
	for (let i = 0; i < statements.length; i += 500) await db.batch(statements.slice(i, i + 500) as never);
	for (const v of videos) {
		const row = projectVideo(v);
		if (row) await upsertSearchRow(db as never, row, { now, version: now } as never);
	}
	for (const kind of ['video', 'channel'] as const) db.db.prepare('INSERT INTO search_meta (key, value, updated_at) VALUES (?, ?, ?)').run(ownershipCompleteKey(kind), '1', now);
	const bucket = new MemoryBucket(objects);
	return { db, bucket, env: { SEARCH_DB: db, videos: bucket, channels: new MemoryBucket() }, videos };
}

const list = async (env: unknown, query: string, user: string | null = null) => {
	const app = buildApp((r) => r.get('/api/videos', VideosList), user ? { userId: user } : null);
	const res = await app.request(`/api/videos?${query}`, {}, env as never);
	assert.equal(res.status, 200, query);
	return (await res.json()) as { data: Array<{ id: string; category?: string }>; cursor: string };
};

/** The plans of the list's own reads: an index for each, and never the whole table. */
function plans(db: SqliteD1, sorted = true) {
	const reads = db.trace!.filter((q) => /FROM content_ownership|search_videos_fts/.test(q.sql));
	assert.ok(reads.length, 'the index was read');
	for (const q of reads) {
		const steps = db.plan(q);
		for (const step of steps) assert.doesNotMatch(step, /^SCAN (content_ownership|o|d|search_videos)\b(?!.*VIRTUAL)/, `${q.sql}\n${steps.join(' | ')}`);
	}
	return reads.map((q) => db.plan(q).join(' | '));
}

describe('GET /api/videos by category, without a channel', () => {
	it('comes from the category index in order, one object per video shown, at any depth', async () => {
		const { db, bucket, env, videos } = await seed();
		const expected = videos.filter((v) => v.category === 'fiqh' && v.isPublic !== false).sort((a, b) => Date.parse(b.dateCreated) - Date.parse(a.dateCreated)).map((v) => v.id);
		const seen: string[] = [];
		let cursor = '';
		for (let i = 0; i < 4 && (i === 0 || cursor); i++) {
			db.trace = [];
			const before = bucket.calls;
			const page = await list(env, `category=fiqh&limit=5${cursor ? `&cursor=${cursor}` : ''}`);
			assert.equal(bucket.calls - before, page.data.length, 'one read per video shown, no listing');
			for (const plan of plans(db)) {
				assert.match(plan, /idx_content_ownership_category_created/);
				assert.doesNotMatch(plan, /TEMP B-TREE/);
			}
			seen.push(...page.data.map((v) => v.id));
			cursor = page.cursor;
		}
		assert.deepEqual(seen, expected.slice(0, seen.length));
		assert.ok(seen.length >= 15);
	});

	it('by views too', async () => {
		const { db, env, videos } = await seed();
		db.trace = [];
		const page = await list(env, 'category=fiqh&sort=views&limit=4');
		const expected = videos.filter((v) => v.category === 'fiqh' && v.isPublic !== false).sort((a, b) => b.views - a.views).slice(0, 4).map((v) => v.views);
		assert.deepEqual(page.data.map((v) => videos.find((x) => x.id === v.id).views), expected);
		assert.match(plans(db).join(), /idx_content_ownership_category_views/);
	});

	it('a signed-in person also sees their own private ones, nobody else’s', async () => {
		const { db, env } = await seed();
		db.trace = [];
		const page = await list(env, 'category=fiqh&limit=3', 'me');
		assert.equal(page.data[0].id, 'mine-priv');
		assert.ok(!page.data.some((v) => v.id === 'theirs-priv'));
		plans(db);
	});
});

describe('GET /api/videos by title, without a channel', () => {
	it('comes from the full-text index: a word or its start, any language, newest first', async () => {
		const { db, bucket, env } = await seed();
		db.trace = [];
		const before = bucket.calls;
		const en = await list(env, `q=${encodeURIComponent('tafs')}&limit=9`);
		assert.deepEqual(en.data.map((v) => v.id), [1607, 1207, 807, 407, 7].map(pad));
		assert.equal(bucket.calls - before, 5, 'only the matches are read');
		const ar = await list(env, `q=${encodeURIComponent('تفسير')}&limit=9`);
		assert.deepEqual(ar.data.map((v) => v.id), [1608, 1208, 808, 408, 8].map(pad));
		assert.match(plans(db).join(), /VIRTUAL TABLE INDEX/);
	});

	it('pages without repeating or skipping, and combines with a category', async () => {
		const { env } = await seed();
		const first = await list(env, 'q=tafsir&limit=2');
		const second = await list(env, `q=tafsir&limit=2&cursor=${first.cursor}`);
		assert.deepEqual([...first.data, ...second.data].map((v) => v.id), [1607, 1207, 807, 407].map(pad));
		assert.deepEqual((await list(env, 'q=tafsir&category=fiqh&limit=9')).data, []);
	});

	it('finds the caller’s own private videos, and never reads the bucket for text without words', async () => {
		const { db, bucket, env } = await seed();
		db.trace = [];
		const mine = await list(env, 'q=tafsir&limit=9', 'me');
		assert.ok(mine.data.some((v) => v.id === 'mine-priv'));
		assert.ok(!mine.data.some((v) => v.id === 'theirs-priv'));
		plans(db);
		const before = bucket.calls;
		assert.deepEqual((await list(env, `q=${encodeURIComponent('"*()')}&limit=9`)).data, []);
		assert.equal(bucket.calls - before, 0);
	});
});

describe('the bucket read (the index cannot answer)', () => {
	it('never reads a file under a path as a video', async () => {
		const { bucket, env } = await seed();
		const read: string[] = [];
		const get = bucket.get.bind(bucket);
		bucket.get = (async (key: string) => (read.push(key), get(key))) as typeof bucket.get;
		const page = await list({ ...env, SEARCH_DB: undefined }, 'category=fiqh&limit=2');
		assert.equal(page.data.length, 2);
		await new R2Repository(bucket as never).listObjects(50);
		assert.deepEqual(read.filter((key) => key.includes('/')), []);
	});
});
