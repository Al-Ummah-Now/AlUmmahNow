/** The Studio Videos tab: one status per video, and the list and counts from the index (docs/specs/CREATOR-STUDIO.md §4.4.1). */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { projectOwnership, studioVideoStatus, syncOwnership, ownershipCompleteKey } from '@al-ummah/shared-types';
import { ChannelContentList, ChannelContentSummary } from '../src/endpoints/channel/channelContent';
import { MemoryBucket, buildApp, videoFixture } from './helpers';
import { SqliteD1 } from './search-sqlite-d1';

describe('studioVideoStatus: exactly one status, first match wins', () => {
	const cases: Array<[Record<string, unknown>, string]> = [
		[{}, 'published'],
		[{ uploadStatus: 'ready', processingStatus: 'completed' }, 'published'],
		[{ scheduledPublishStatus: 'published' }, 'published'],
		[{ scheduledPublishStatus: 'cancelled' }, 'published'],
		[{ isDraft: true }, 'drafts'],
		[{ isDraft: true, scheduledPublishStatus: 'cancelled' }, 'drafts'],
		[{ scheduledPublishStatus: 'scheduled' }, 'scheduled'],
		[{ scheduledPublishStatus: 'publishing' }, 'scheduled'],
		[{ isDraft: true, scheduledPublishStatus: 'scheduled' }, 'scheduled'],
		...['initiated', 'uploading', 'processing'].map((uploadStatus): [Record<string, unknown>, string] => [{ uploadStatus }, 'processing']),
		...['pending', 'processing', 'transcoding'].map((processingStatus): [Record<string, unknown>, string] => [{ processingStatus }, 'processing']),
		[{ uploadStatus: 'processing', scheduledPublishStatus: 'scheduled', isDraft: true }, 'processing'],
		[{ uploadStatus: 'failed' }, 'failed'],
		[{ processingStatus: 'failed' }, 'failed'],
		[{ scheduledPublishStatus: 'failed' }, 'failed'],
		[{ uploadStatus: 'failed', scheduledPublishStatus: 'scheduled', isDraft: true }, 'failed'],
		[{ uploadStatus: 'ready', processingStatus: 'failed' }, 'failed'],
	];
	for (const [video, expected] of cases) {
		it(`${JSON.stringify(video)} is ${expected}`, () => assert.equal(studioVideoStatus(video), expected));
	}
});

describe('projectOwnership', () => {
	it('stores what the Videos tab filters on', () => {
		const row = projectOwnership('video', 'v1', { id: 'v1', title: 'Hello World', category: 'tafsir', language: 'ar', isDraft: true });
		assert.equal(row?.studioStatus, 'drafts');
		assert.equal(row?.title, 'Hello World');
		assert.equal(row?.category, 'tafsir');
		assert.equal(row?.language, 'ar');
	});
});

const OWNER = { userId: 'owner' };

function routes(r: any) {
	r.get('/api/channels/:id/content/summary', ChannelContentSummary);
	r.get('/api/channels/:id/content', ChannelContentList);
}

async function setup(videos: Array<Record<string, unknown>>, complete = true) {
	const db = new SqliteD1();
	const stored: Record<string, unknown> = {};
	for (const v of videos) {
		const video = videoFixture({ channelId: 'c1', userId: 'owner', ...v });
		stored[video.id as string] = video;
		await syncOwnership(db as never, 'video', video.id as string, video);
	}
	if (complete) await db.prepare('INSERT INTO search_meta (key, value, updated_at) VALUES (?, ?, ?)').bind(ownershipCompleteKey('video'), '1', 1).run();
	return {
		SEARCH_DB: db,
		videos: new MemoryBucket(stored),
		channels: new MemoryBucket({ c1: { id: 'c1', userId: 'owner', name: 'C' }, gone: { id: 'gone', userId: 'owner', isDeleted: true } }),
	};
}

async function list(env: unknown, query = '', auth: { userId: string } | null = OWNER, channel = 'c1') {
	return buildApp(routes, auth).request(`/api/channels/${channel}/content${query}`, {}, env as never);
}

const ids = async (res: Response) => ((await res.json()) as any).result.items.map((v: any) => v.id);

const SAMPLE = [
	{ id: 'pub1', title: 'Alpha lecture', views: 5, duration: 600, dateCreated: '2026-01-01T00:00:00.000Z' },
	{ id: 'pub2', title: 'Beta talk', views: 50, duration: 30, format: 'short', dateCreated: '2026-02-01T00:00:00.000Z', isPublic: false },
	{ id: 'draft', title: 'Draft', isDraft: true },
	{ id: 'sched', title: 'Soon', scheduledPublishStatus: 'scheduled' },
	{ id: 'proc', title: 'Busy', uploadStatus: 'processing' },
	{ id: 'bad', title: 'Broken', uploadStatus: 'failed' },
	{ id: 'other', title: 'Other channel', channelId: 'c2' },
	{ id: 'del', title: 'Deleted', isDeleted: true },
];

describe('GET /api/channels/:id/content', () => {
	it('lists one status, published by default, private included', async () => {
		const res = await list(await setup(SAMPLE));
		assert.equal(res.status, 200, await res.clone().text());
		assert.deepEqual(await ids(res), ['pub2', 'pub1']);
	});

	it('tells the status of each video and hides other channels and deleted ones', async () => {
		const env = await setup(SAMPLE);
		for (const [status, id] of [['drafts', 'draft'], ['scheduled', 'sched'], ['processing', 'proc'], ['failed', 'bad']]) {
			const res = await list(env, `?status=${status}`);
			const body = (await res.json()) as any;
			assert.deepEqual(body.result.items.map((v: any) => v.id), [id]);
			assert.equal(body.result.items[0].studioStatus, status);
		}
	});

	it('filters by search, visibility, type and duration', async () => {
		const env = await setup(SAMPLE);
		assert.deepEqual(await ids(await list(env, '?q=ALPHA')), ['pub1']);
		assert.deepEqual(await ids(await list(env, '?visibility=private')), ['pub2']);
		assert.deepEqual(await ids(await list(env, '?type=shorts')), ['pub2']);
		assert.deepEqual(await ids(await list(env, '?type=videos')), ['pub1']);
		assert.deepEqual(await ids(await list(env, '?duration=medium')), ['pub1']);
		assert.deepEqual(await ids(await list(env, '?duration=short')), ['pub2']);
	});

	it('reports where the time goes (Server-Timing: access, heal, index, r2)', async () => {
		const env = await setup(SAMPLE);
		const res = await list(env, '');
		const timing = res.headers.get('server-timing') ?? '';
		for (const span of ['access;dur=', 'heal;dur=', 'index;dur=', 'r2;dur=']) assert.ok(timing.includes(span), timing);
		assert.equal(res.headers.get('timing-allow-origin'), '*');
	});

	it('sorts', async () => {
		const env = await setup(SAMPLE);
		assert.deepEqual(await ids(await list(env, '?sort=oldest')), ['pub1', 'pub2']);
		assert.deepEqual(await ids(await list(env, '?sort=views')), ['pub2', 'pub1']);
		assert.deepEqual(await ids(await list(env, '?sort=title')), ['pub1', 'pub2']);
	});

	it('pages with a cursor', async () => {
		const env = await setup(SAMPLE);
		const first = (await (await list(env, '?limit=1')).json()) as any;
		assert.equal(first.result.items.length, 1);
		assert.ok(first.result.cursor);
		const second = (await (await list(env, `?limit=1&cursor=${first.result.cursor}`)).json()) as any;
		assert.deepEqual(second.result.items.map((v: any) => v.id), ['pub1']);
		assert.equal(second.result.cursor, null);
	});

	it('keeps a search for quotes and percent signs literal', async () => {
		const env = await setup([{ id: 'a', title: "100% it's" }, { id: 'b', title: 'plain' }]);
		assert.deepEqual(await ids(await list(env, `?q=${encodeURIComponent("% it'")}`)), ['a']);
	});

	it('refuses a site admin who has no role on the channel', async () => {
		const res = await buildApp(routes, { userId: 'staff', roles: ['Super Admin'] }).request('/api/channels/c1/content', {}, (await setup(SAMPLE)) as never);
		assert.equal(res.status, 403);
	});

	it('refuses others, and gives 404 for a missing channel', async () => {
		const env = await setup(SAMPLE);
		assert.equal((await list(env, '', { userId: 'someone' })).status, 403);
		assert.equal((await list(env, '', OWNER, 'nope')).status, 404);
		assert.equal((await list(env, '', OWNER, 'gone')).status, 404);
	});

	it('answers from the index while it is rebuilding, flagged incomplete (#859: it was a 503 for every channel)', async () => {
		const res = await list(await setup(SAMPLE, false));
		assert.equal(res.status, 200, await res.clone().text());
		const body = (await res.json()) as any;
		assert.equal(body.result.indexComplete, false);
		assert.deepEqual(body.result.items.map((v: any) => v.id), ['pub2', 'pub1']);
		const summary = (await (await buildApp(routes, OWNER).request('/api/channels/c1/content/summary', {}, (await setup(SAMPLE, false)) as never)).json()) as any;
		assert.equal(summary.result.indexComplete, false);
		assert.equal(summary.result.counts.published, 2);
	});

	it('says complete when the index is', async () => {
		assert.equal(((await (await list(await setup(SAMPLE))).json()) as any).result.indexComplete, true);
	});

	it('answers 503 only when the index cannot be read at all', async () => {
		const env = await setup(SAMPLE);
		env.SEARCH_DB.db.exec('DROP TABLE content_ownership');
		assert.equal((await list(env)).status, 503);
	});
});

describe('rows written before the columns existed', () => {
	async function legacyEnv() {
		const env = await setup([{ id: 'old', title: 'Old', isDraft: true }, { id: 'gone', title: 'Gone' }]);
		env.SEARCH_DB.db.exec(`UPDATE content_ownership SET studio_status = NULL, title = NULL`);
		env.videos.store.delete('gone');
		return env;
	}

	it('are filled on read, with no 503 and the index still trusted', async () => {
		const env = await legacyEnv();
		const res = await list(env, '?status=drafts');
		assert.equal(res.status, 200, await res.clone().text());
		assert.deepEqual(await ids(res), ['old']);
		const meta = env.SEARCH_DB.db.prepare('SELECT COUNT(*) AS n FROM search_meta WHERE key = ?').get(ownershipCompleteKey('video')) as { n: number };
		assert.equal(meta.n, 1);
		const left = env.SEARCH_DB.db.prepare('SELECT COUNT(*) AS n FROM content_ownership WHERE studio_status IS NULL').get() as { n: number };
		assert.equal(left.n, 0);
	});

	it('count correctly in the summary', async () => {
		const res = await buildApp(routes, OWNER).request('/api/channels/c1/content/summary', {}, (await legacyEnv()) as never);
		assert.equal(((await res.json()) as any).result.counts.drafts, 1);
	});
});

describe('GET /api/channels/:id/content/summary', () => {
	it('counts each status, with zeros', async () => {
		const res = await buildApp(routes, OWNER).request('/api/channels/c1/content/summary', {}, (await setup(SAMPLE.slice(0, 3))) as never);
		assert.equal(res.status, 200, await res.clone().text());
		assert.deepEqual(((await res.json()) as any).result.counts, { published: 2, scheduled: 0, drafts: 1, processing: 0, failed: 0 });
	});
});
