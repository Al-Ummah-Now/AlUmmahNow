import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { API_ERROR_CATALOGUE, buildErrorEnvelope, ownershipCompleteKey, ownershipUpsertStatement, projectOwnership, projectVideo, upsertSearchRow } from '@al-ummah/shared-types';
import { VideosList } from '../src/endpoints/video/videoList';
import R2Repository from '../src/lib/r2Repo';
import { MemoryBucket, buildApp, videoFixture } from './helpers';
import { SqliteD1 } from './search-sqlite-d1';

/**
 * GET /api/videos with a category or a title and no channel read the videos bucket (up to 300 objects a
 * request) though the indexes can answer: the category is a column, a title is a search.
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
function plans(db: SqliteD1) {
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

describe('a category keeps what the unfiltered list keeps', () => {
	it('the caller’s own scheduled, reviewed, premiere, private and processing videos; nobody else sees them', async () => {
		const { db, bucket, env } = await seed();
		const states: Record<string, Record<string, unknown>> = {
			sched: { scheduledPublishStatus: 'scheduled' },
			publishing: { scheduledPublishStatus: 'publishing' },
			checking: { review: { status: 'checking' } },
			inreview: { review: { status: 'in_review' } },
			rejected: { review: { status: 'rejected' } },
			appealed: { review: { status: 'appealed' } },
			premiere: { premiereHold: true },
			priv: { isPublic: false },
			processing: { uploadStatus: 'processing' },
			plain: {},
		};
		let n = 0;
		for (const [id, state] of Object.entries(states)) {
			const video = videoFixture({ id: `s-${id}`, title: 'Mine', userId: 'me', channelId: null, category: 'fiqh', isPublic: true, uploadStatus: 'ready', dateCreated: `2026-07-01T00:00:${String(n++).padStart(2, '0')}.000Z`, ...state });
			await bucket.put(video.id, JSON.stringify(video));
			await ownershipUpsertStatement(db as never, projectOwnership('video', video.id, video as never)!, Date.now(), Date.now()).run();
		}
		for (const user of ['me', 'someone', null]) {
			const mine = (page: { data: Array<{ id: string }> }) => page.data.map((v) => v.id).filter((id) => id.startsWith('s-'));
			const all = mine(await list(env, 'limit=40', user));
			assert.deepEqual(mine(await list(env, 'limit=40&category=fiqh', user)), all, `${user}`);
			assert.equal(all.length, user === 'me' ? Object.keys(states).length : 1, `${user}`);
		}
	});
});

describe('GET /api/videos by title, without a channel: a search of public videos', () => {
	it('comes from the search index: every word, the last by its start, any language, newest first', async () => {
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

	it('pages without repeating or skipping, sorts, and combines with a category, a format and a filter', async () => {
		const { env, videos } = await seed();
		const first = await list(env, 'q=tafsir&limit=2');
		const second = await list(env, `q=tafsir&limit=2&cursor=${first.cursor}`);
		assert.deepEqual([...first.data, ...second.data].map((v) => v.id), [1607, 1207, 807, 407].map(pad));
		const views = (await list(env, 'q=tafsir&limit=9&sort=views')).data.map((v) => videos.find((x) => x.id === v.id).views);
		assert.deepEqual(views, [...views].sort((a, b) => b - a));
		assert.deepEqual((await list(env, 'q=tafsir&limit=2&sort=title')).data.map((v) => v.id), [1207, 1607].map(pad));
		assert.deepEqual((await list(env, 'q=tafsir&category=fiqh&limit=9')).data, []);
		assert.deepEqual((await list(env, 'q=tafsir&format=short&limit=9')).data, []);
		assert.deepEqual((await list(env, 'q=tafsir&filter=private&limit=9', 'me')).data, []);
	});

	it('lists public videos only, the caller’s own included', async () => {
		const { env } = await seed();
		const page = await list(env, 'q=tafsir&limit=20', 'me');
		assert.ok(page.data.length > 0 && page.data.every((v) => !v.id.endsWith('-priv')));
	});

	it('reads at most 200 matches however many there are, and the cursor ends there', async () => {
		const { bucket, env } = await seed();
		const before = bucket.calls;
		const last = await list(env, 'q=lesson&limit=50&cursor=idx:150');
		assert.equal(last.data.length, 50);
		assert.equal(last.cursor, '');
		assert.equal(bucket.calls - before, 50);
		for (const sort of ['date', 'views', 'title', 'likes']) {
			const calls = bucket.calls;
			for (const offset of [200, 100_000]) {
				const page = await list(env, `q=lesson&limit=50&sort=${sort}&cursor=idx:${offset}`);
				assert.deepEqual([page.data, page.cursor], [[], ''], `${sort} ${offset}`);
			}
			assert.equal(bucket.calls, calls, `${sort}: a cursor past the end reads nothing`);
		}
	});

	it('never reads the bucket: text without words, one character, or no usable index', async () => {
		const { bucket, env } = await seed();
		const app = buildApp((r) => r.get('/api/videos', VideosList), null);
		const before = bucket.calls;
		assert.deepEqual((await list(env, `q=${encodeURIComponent('"*()')}&limit=9`)).data, []);
		const short = await app.request('/api/videos?q=a', {}, env as never);
		assert.equal(short.status, 400);
		const body = (await short.json()) as { code: string };
		assert.equal(body.code, 'query_too_short');
		for (const lang of ['en', 'ar'] as const) assert.equal(buildErrorEnvelope(body, { status: 400, lang }).message, API_ERROR_CATALOGUE.query_too_short[lang]);
		for (const SEARCH_DB of [undefined, { prepare: () => { throw new Error('D1 is down'); } }]) {
			const res = await app.request('/api/videos?q=tafsir', {}, { ...env, SEARCH_DB } as never);
			assert.equal(res.status, 503);
			assert.equal(((await res.json()) as { error: string }).error !== undefined, true);
		}
		assert.equal(bucket.calls, before);
	});

	it('shares the search rate limit, only without a channel', () => {
		const index = readFileSync(new URL('../src/index.ts', import.meta.url), 'utf8');
		assert.match(index, /c\.req\.query\('q'\)\?\.trim\(\) && !c\.req\.query\('channelId'\) && !c\.req\.header\('channelId'\) \? searchLimit/);
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
