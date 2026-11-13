/** Public MP4 backfill (#1182): remux-only jobs for renditions made before the MP4 (#1181). */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { classifyForMp4, handleMp4BackfillMessage, JOB_SPACING_SECONDS, mp4RungOf, runMp4Page, type Mp4BackfillRun } from '../src/lib/media/mp4-backfill';
import { applyMp4Event, publicMp4Url } from '../src/lib/media/r2-delivery';
import { MemoryBucket } from './helpers';
import { SqliteD1 } from './search-sqlite-d1';

const HOST = 'media.alummahnow.net';
const rung = (name: string, width: number, height: number) => ({ name, width, height, maxrate: 1, bandwidth: 1, bytes: 1, segments: 1 });
const r2 = (over: Record<string, unknown> = {}) => ({
	status: 'ready',
	jobId: 'j',
	rev: 'e29db4ad6918a943',
	access: 'pub',
	attempts: 1,
	queuedAt: '2026-11-12T00:00:00.000Z',
	result: { rungs: [rung('360p', 640, 360), rung('480p', 854, 480), rung('720p', 1280, 720)], objects: 1, bytes: 1, durationSeconds: 60, source: {}, timings: {}, thumbnail: 'thumb.jpg' },
	...over,
});
const id = (n: number) => `0000000${n}-aaaa-bbbb-cccc-dddddddddddd`;

class Queue {
	sent: { body: any; delaySeconds?: number }[] = [];
	async send(body: unknown, opts?: { delaySeconds?: number }) {
		this.sent.push({ body, delaySeconds: opts?.delaySeconds });
	}
}

async function makeEnv(videos: Record<string, unknown>, jobIds: string[]) {
	const db = new SqliteD1();
	for (const v of jobIds) {
		await db
			.prepare("INSERT INTO media_jobs (video_id, job_id, status, access, attempts, queued_at, updated_at) VALUES (?, 'j', 'ready', 'pub', 1, 't', 't')")
			.bind(v)
			.run();
	}
	return {
		videos: new MemoryBucket(videos),
		global_settings: new MemoryBucket(),
		SEARCH_DB: db,
		TRANSCODE_QUEUE: new Queue(),
		PROCESSING_CHECK_QUEUE: new Queue(),
		MEDIA_PUBLIC_HOST: HOST,
	} as any;
}

const message = (over: Record<string, unknown> = {}) => {
	const acked: string[] = [];
	return {
		acked,
		msg: { body: { kind: 'mp4-backfill', runId: 'mp4-test-0001', page: 0, cursor: null, ...over }, attempts: 1, ack: () => acked.push('ack'), retry: () => acked.push('retry') },
	};
};

describe('mp4RungOf', () => {
	it('picks 480p, else 360p, else the first rung (as the transcoder does)', () => {
		assert.equal(mp4RungOf(['360p', '480p', '720p']), '480p');
		assert.equal(mp4RungOf(['360p']), '360p');
		assert.equal(mp4RungOf(['720p']), '720p');
		assert.equal(mp4RungOf([]), null);
	});
});

describe('classifyForMp4', () => {
	it('makes a public ready rendition without an MP4 a public candidate', () => {
		const item = classifyForMp4({ MEDIA_PUBLIC_HOST: HOST }, 'v', { id: 'v', title: 'T', isPublic: true, r2: r2() as never });
		assert.equal(item.state, 'candidate');
		assert.equal(item.public, true);
		assert.equal(item.mp4Rung, '480p');
	});
	it('makes private and unlisted renditions candidates too, never public', () => {
		assert.deepEqual(
			[classifyForMp4({ MEDIA_PUBLIC_HOST: HOST }, 'v', { id: 'v', isPublic: false, r2: r2({ access: 'priv' }) as never })].map((i) => [i.state, i.public]),
			[['candidate', false]],
		);
	});
	it('skips videos that already have it, are not ready, are deleted or are gone', () => {
		assert.equal(classifyForMp4({}, 'v', { id: 'v', r2: r2({ result: { ...r2().result, mp4: { file: 'video.mp4', rung: '480p', width: 854, height: 480, bytes: 5 } } }) as never }).state, 'has-mp4');
		assert.equal(classifyForMp4({}, 'v', { id: 'v', r2: r2({ status: 'transcoding' }) as never }).state, 'not-ready');
		assert.equal(classifyForMp4({}, 'v', { id: 'v', r2: undefined }).state, 'not-ready');
		assert.equal(classifyForMp4({}, 'v', { id: 'v', isDeleted: true, r2: r2() as never }).state, 'deleted');
		assert.equal(classifyForMp4({}, 'v', null).state, 'missing');
	});
});

describe('runMp4Page', () => {
	const videos = {
		[id(1)]: { id: id(1), title: 'Public', isPublic: true, r2: r2() },
		[id(2)]: { id: id(2), title: 'Private', isPublic: false, r2: r2({ access: 'priv', rev: 'aaaabbbbcccc1111', result: { ...r2().result, rungs: [rung('360p', 320, 180)] } }) },
		[id(3)]: { id: id(3), title: 'Done', r2: r2({ result: { ...r2().result, mp4: { file: 'video.mp4', rung: '480p', width: 854, height: 480, bytes: 9 } } }) },
	};

	it('dry run: lists every candidate and queues nothing', async () => {
		const env = await makeEnv(videos, [id(1), id(2), id(3), id(4)]);
		const page = await runMp4Page(env, { runId: 'r', cursor: null, dryRun: true });
		assert.equal(env.TRANSCODE_QUEUE.sent.length, 0);
		assert.deepEqual(page.items.map((i) => [i.id, i.state, i.action, i.public]), [
			[id(1), 'candidate', 'would-queue', true],
			[id(2), 'candidate', 'would-queue', false],
			[id(3), 'has-mp4', 'skip', true],
			[id(4), 'missing', 'skip', false],
		]);
		assert.equal(page.counts.candidate, 2);
		assert.equal(page.counts.candidatePublic, 1);
		assert.equal(page.nextCursor, null);
	});

	it('apply: one remux-only job per candidate on its own rendition, spaced out', async () => {
		const env = await makeEnv(videos, [id(1), id(2), id(3)]);
		const page = await runMp4Page(env, { runId: 'r', cursor: null, dryRun: false });
		assert.equal(page.counts.queued, 2);
		const [first, second] = env.TRANSCODE_QUEUE.sent;
		assert.equal(first.body.kind, 'mp4');
		assert.equal(first.body.videoId, id(1));
		assert.equal(first.body.rev, 'e29db4ad6918a943');
		assert.equal(first.body.access, 'pub');
		assert.deepEqual(first.body.rungs.map((r: { name: string }) => r.name), ['360p', '480p', '720p']);
		assert.equal(first.delaySeconds, undefined);
		assert.equal(second.body.access, 'priv');
		assert.equal(second.delaySeconds, JOB_SPACING_SECONDS);
		// The record is not touched: playback never notices
		assert.equal((await env.videos.get(id(1))).etag, env.videos.etag(id(1)));
	});

	it('pages by primary key with a cursor', async () => {
		const env = await makeEnv(videos, [id(1), id(2), id(3)]);
		const first = await runMp4Page(env, { runId: 'r', cursor: null, dryRun: true, limit: 2 });
		assert.equal(first.nextCursor, id(2));
		const second = await runMp4Page(env, { runId: 'r', cursor: first.nextCursor, dryRun: true, limit: 2 });
		assert.deepEqual(second.items.map((i) => i.id), [id(3)]);
		assert.equal(second.nextCursor, null);
	});
});

describe('handleMp4BackfillMessage', () => {
	it('records the run with its items and never queues a page twice', async () => {
		const env = await makeEnv({ [id(1)]: { id: id(1), isPublic: true, r2: r2() } }, [id(1)]);
		const one = message({ dryRun: false });
		await handleMp4BackfillMessage(env, one.msg);
		assert.deepEqual(one.acked, ['ack']);
		const run = JSON.parse(env.global_settings.store.get('ops/mp4-backfill/runs/mp4-test-0001.json')) as Mp4BackfillRun;
		assert.equal(run.status, 'done');
		assert.equal(run.dryRun, false);
		assert.equal(run.totals.queued, 1);
		assert.equal(run.items[0].action, 'queued');
		// Redelivered: acked, nothing queued again
		const again = message({ dryRun: false });
		await handleMp4BackfillMessage(env, again.msg);
		assert.equal(env.TRANSCODE_QUEUE.sent.length, 1);
	});
	it('is a dry run unless told otherwise', async () => {
		const env = await makeEnv({ [id(1)]: { id: id(1), isPublic: true, r2: r2() } }, [id(1)]);
		await handleMp4BackfillMessage(env, message().msg);
		assert.equal(env.TRANSCODE_QUEUE.sent.length, 0);
	});
});

describe('applyMp4Event', () => {
	const mp4 = { file: 'video.mp4', rung: '480p', width: 854, height: 480, bytes: 4_000_000 };
	const ev = (over: Record<string, unknown> = {}) => ({ videoId: id(1), jobId: 'm1', rev: 'e29db4ad6918a943', access: 'pub', type: 'ready', at: 't', mp4, ...over }) as never;

	it('records the MP4 on the same rendition, which then becomes the public contentUrl', async () => {
		const env = { videos: new MemoryBucket({ [id(1)]: { id: id(1), isPublic: true, r2: r2() } }) } as any;
		assert.deepEqual(await applyMp4Event(env, ev()), { applied: true });
		const video = JSON.parse(env.videos.store.get(id(1)));
		assert.deepEqual(video.r2.result.mp4, mp4);
		assert.equal(video.r2.status, 'ready');
		assert.equal(publicMp4Url({ MEDIA_PUBLIC_HOST: HOST }, video), `https://${HOST}/pub/${id(1)}/e29db4ad6918a943/video.mp4`);
	});
	it('ignores a stale rendition (re-transcoded or moved), an existing MP4, a failure and a bad result', async () => {
		const env = { videos: new MemoryBucket({ [id(1)]: { id: id(1), isPublic: true, r2: r2() } }) } as any;
		assert.equal((await applyMp4Event(env, ev({ rev: 'ffffffff00000000' }))).why, 'stale rendition');
		assert.equal((await applyMp4Event(env, ev({ access: 'priv' }))).why, 'stale rendition');
		assert.equal((await applyMp4Event(env, ev({ type: 'failed', mp4: undefined, error: 'x' }))).applied, false);
		assert.equal((await applyMp4Event(env, ev({ mp4: { ...mp4, file: '../x.mp4' } }))).why, 'bad result');
		await applyMp4Event(env, ev());
		assert.equal((await applyMp4Event(env, ev({ mp4: { ...mp4, bytes: 1 } }))).why, 'already has an MP4');
		assert.equal((await applyMp4Event({ videos: new MemoryBucket() } as any, ev())).why, 'video not found');
	});
});
