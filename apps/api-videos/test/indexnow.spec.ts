/**
 * IndexNow for the videos site (wiki AUN-SEO): which watch-page changes are queued (the D1
 * triggers on search_videos, run for real on node:sqlite with the search migrations), the URLs
 * sent, and that only production pings.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { syncSearchDocument } from '@al-ummah/shared-types';
import { flushIndexNow, indexNowUrls, INDEXNOW_ENDPOINT, INDEXNOW_KEY, INDEXNOW_MAX_URLS } from '../src/lib/indexnow';
import { SqliteD1 } from './search-sqlite-d1';
import { videoFixture } from './helpers';

const PROD = 'https://videos.alummahnow.net';

function pending(db: SqliteD1): { video_id: string; is_short: number }[] {
	return (db.db.prepare('SELECT video_id, is_short FROM indexnow_pending ORDER BY video_id').all() as any[]).map((r) => ({ video_id: r.video_id, is_short: Number(r.is_short) }));
}

function clear(db: SqliteD1) {
	db.db.exec('DELETE FROM indexnow_pending');
}

let version = 1_000;
const write = (db: SqliteD1, id: string, object: Record<string, unknown> | null) =>
	syncSearchDocument(db as never, 'video', id, object, { version: ++version });

function recorder(status = 202) {
	const calls: { url: string; body: any }[] = [];
	const fetcher = (async (url: string, init: RequestInit) => {
		calls.push({ url, body: JSON.parse(String(init.body)) });
		return new Response(null, { status });
	}) as unknown as typeof fetch;
	return { calls, fetcher };
}

describe('IndexNow trigger points (search_videos triggers)', () => {
	it('publishing a public video queues it', async () => {
		const db = new SqliteD1();
		await write(db, 'v1', videoFixture({ id: 'v1' }));
		assert.deepEqual(pending(db), [{ video_id: 'v1', is_short: 0 }]);
	});

	it('a private, unlisted, draft-in-processing or scheduled video queues nothing', async () => {
		const db = new SqliteD1();
		await write(db, 'p', videoFixture({ id: 'p', isPublic: false }));
		await write(db, 'u', videoFixture({ id: 'u', isPublic: false, isUnlisted: true }));
		await write(db, 'q', videoFixture({ id: 'q', uploadStatus: 'processing' }));
		await write(db, 's', videoFixture({ id: 's', scheduledPublishStatus: 'scheduled' }));
		assert.deepEqual(pending(db), []);
	});

	it('a scheduled video released by the scheduler (processor sync) and Unlisted -> Public queue it', async () => {
		const db = new SqliteD1();
		await write(db, 's', videoFixture({ id: 's', scheduledPublishStatus: 'scheduled' }));
		await write(db, 'u', videoFixture({ id: 'u', isPublic: false, isUnlisted: true }));
		await write(db, 's', videoFixture({ id: 's', scheduledPublishStatus: 'published' }));
		await write(db, 'u', videoFixture({ id: 'u', isPublic: true, isUnlisted: false }));
		assert.deepEqual(pending(db).map((r) => r.video_id), ['s', 'u']);
	});

	it('a title or description edit queues it; views, likes and same-content writes do not', async () => {
		const db = new SqliteD1();
		await write(db, 'v1', videoFixture({ id: 'v1' }));
		clear(db);
		await write(db, 'v1', videoFixture({ id: 'v1', views: 500, likesCount: 9 }));
		await write(db, 'v1', videoFixture({ id: 'v1', views: 500, likesCount: 9 }));
		assert.deepEqual(pending(db), []);
		await write(db, 'v1', videoFixture({ id: 'v1', title: 'New title' }));
		assert.deepEqual(pending(db).map((r) => r.video_id), ['v1']);
		clear(db);
		await write(db, 'v1', videoFixture({ id: 'v1', title: 'New title', description: 'New description' }));
		assert.deepEqual(pending(db).map((r) => r.video_id), ['v1']);
	});

	it('deleting, making private or unlisted, or hiding a public video queues it (a removed URL)', async () => {
		const db = new SqliteD1();
		for (const id of ['d', 'p', 'u', 'h']) await write(db, id, videoFixture({ id }));
		clear(db);
		await write(db, 'd', null);
		await write(db, 'p', videoFixture({ id: 'p', isPublic: false }));
		await write(db, 'u', videoFixture({ id: 'u', isPublic: false, isUnlisted: true }));
		await write(db, 'h', videoFixture({ id: 'h', isHidden: true }));
		assert.deepEqual(pending(db).map((r) => r.video_id), ['d', 'h', 'p', 'u']);
	});

	it('editing a private video queues nothing', async () => {
		const db = new SqliteD1();
		await write(db, 'p', videoFixture({ id: 'p', isPublic: false }));
		await write(db, 'p', videoFixture({ id: 'p', isPublic: false, title: 'Other' }));
		assert.deepEqual(pending(db), []);
	});

	it('a Short is queued as one, and stays one when it later becomes a video (both pages change)', async () => {
		const db = new SqliteD1();
		await write(db, 's1', videoFixture({ id: 's1', format: 'short' }));
		assert.deepEqual(pending(db), [{ video_id: 's1', is_short: 1 }]);
		await write(db, 's1', videoFixture({ id: 's1', format: 'video' }));
		assert.deepEqual(pending(db), [{ video_id: 's1', is_short: 1 }]);
	});
});

describe('IndexNow URLs', () => {
	it('builds en and ar watch pages; a Short gets /shorts and its old /video address', () => {
		assert.deepEqual(indexNowUrls(`${PROD}/`, [{ video_id: 'abc', is_short: 0 }, { video_id: 'sh', is_short: 1 }]), [
			`${PROD}/en/video/abc`,
			`${PROD}/ar/video/abc`,
			`${PROD}/en/shorts/sh`,
			`${PROD}/en/video/sh`,
			`${PROD}/ar/shorts/sh`,
			`${PROD}/ar/video/sh`,
		]);
	});

	it('skips ids that are not plain ids and never returns more than the protocol limit', () => {
		assert.deepEqual(indexNowUrls(PROD, [{ video_id: '../x', is_short: 0 }, { video_id: 'a b', is_short: 0 }]), []);
		const many = Array.from({ length: 6000 }, (_, i) => ({ video_id: `v${i}`, is_short: 1 }));
		assert.equal(indexNowUrls(PROD, many).length, INDEXNOW_MAX_URLS);
	});

	it('the web app serves the key file at /<key>.txt with the key as its body', () => {
		const file = join(__dirname, '..', '..', 'web', 'public', `${INDEXNOW_KEY}.txt`);
		assert.equal(readFileSync(file, 'utf8').trim(), INDEXNOW_KEY);
		assert.match(INDEXNOW_KEY, /^[0-9a-f]{32}$/);
	});
});

describe('IndexNow flush', () => {
	const prodEnv = (db: SqliteD1) => ({ ENVIRONMENT: 'production', CORS_ORIGINS: `${PROD},https://alummahnow.net`, SEARCH_DB: db as never });

	it('production: one POST with host, key, keyLocation and the URLs, then the queue is empty', async () => {
		const db = new SqliteD1();
		await write(db, 'v1', videoFixture({ id: 'v1' }));
		const { calls, fetcher } = recorder(202);
		const out = await flushIndexNow(prodEnv(db), fetcher);
		assert.equal(calls.length, 1);
		assert.equal(calls[0].url, INDEXNOW_ENDPOINT);
		assert.deepEqual(calls[0].body, {
			host: 'videos.alummahnow.net',
			key: INDEXNOW_KEY,
			keyLocation: `${PROD}/${INDEXNOW_KEY}.txt`,
			urlList: [`${PROD}/en/video/v1`, `${PROD}/ar/video/v1`],
		});
		assert.equal(out.sent, 2);
		assert.deepEqual(pending(db), []);
		// Nothing queued: no request at all
		await flushIndexNow(prodEnv(db), fetcher);
		assert.equal(calls.length, 1);
	});

	for (const env of ['qa', 'stage', 'development', undefined]) {
		it(`${env ?? 'no ENVIRONMENT'}: never pings, only empties the queue`, async () => {
			const db = new SqliteD1();
			await write(db, 'v1', videoFixture({ id: 'v1' }));
			const { calls, fetcher } = recorder();
			const out = await flushIndexNow({ ENVIRONMENT: env, CORS_ORIGINS: 'https://videos.qa.alummahnow.net', SEARCH_DB: db as never }, fetcher);
			assert.equal(calls.length, 0);
			assert.equal(out.cleared, 1);
			assert.deepEqual(pending(db), []);
		});
	}

	it('429, 5xx and network errors keep the rows for the next run; other 4xx drop them', async () => {
		for (const [status, kept] of [[429, 1], [503, 1], [403, 0], [422, 0]] as const) {
			const db = new SqliteD1();
			await write(db, 'v1', videoFixture({ id: 'v1' }));
			await flushIndexNow(prodEnv(db), recorder(status).fetcher);
			assert.equal(pending(db).length, kept, `status ${status}`);
		}
		const db = new SqliteD1();
		await write(db, 'v1', videoFixture({ id: 'v1' }));
		await flushIndexNow(prodEnv(db), (async () => {
			throw new Error('offline');
		}) as never);
		assert.equal(pending(db).length, 1);
	});

	it('a video queued again after the read stays queued', async () => {
		const db = new SqliteD1();
		await write(db, 'v1', videoFixture({ id: 'v1' }));
		const fetcher = (async () => {
			// Changes while the ping is in flight
			db.db.exec(`UPDATE indexnow_pending SET queued_at = queued_at + 1`);
			return new Response(null, { status: 200 });
		}) as unknown as typeof fetch;
		await flushIndexNow(prodEnv(db), fetcher);
		assert.equal(pending(db).length, 1);
	});
});
