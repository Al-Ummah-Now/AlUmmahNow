/** Why videos failed and what to do (shared-types video-failure.ts, lib/media/failures.ts), and the lists that show them. */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { explainTranscodeFailure, explainVideoFailure, ownershipCompleteKey, syncOwnership, TRANSCODE_REASONS, VIDEO_FAILURE_REASONS, VIDEO_FAILURES_MAX, type TranscodeReason } from '@al-ummah/shared-types';
import { FAILED_VIDEO_IDS_SQL, readVideoFailures, UNFINISHED_VIDEO_IDS_SQL, unfinishedVideoIds } from '../src/lib/media/failures';
import { listVideos } from '../src/lib/admin/directory';
import { readTroubleshootJobs } from '../src/lib/media/troubleshoot';
import { createProcessingInternalRouter } from '../src/endpoints/video/processingInternal';
import { createMediaInternalRouter } from '../src/endpoints/media/mediaInternal';
import { MemoryBucket, videoFixture } from './helpers';
import { SqliteD1 } from './search-sqlite-d1';

const facts = (over: object = {}) => ({ bytes: 10, container: 'mp4', zeroStartPercent: 0, zeroEndPercent: 0, sha256: 'a'.repeat(64), streams: [{ kind: 'audio', codec: 'aac' }], ...over });
const source = (over: object = {}) => facts(over) as never;
const job = (reason: TranscodeReason | null, s: unknown = null) => explainTranscodeFailure({ reason, source: s as never });

describe('why a transcode failed', () => {
	it('the file decides: no picture, half written, unreadable, changed', () => {
		const of = (f: ReturnType<typeof job>) => [f.reason, f.cause, f.step];
		assert.deepEqual(of(job('no_video_stream', source())), ['audio_only', 'file', 'send_with_picture']);
		assert.deepEqual(of(job('encode_failed', source({ container: 'zeros' }))), ['half_written', 'file', 'send_again']);
		assert.deepEqual(of(job('encode_failed', source({ streams: undefined }))), ['unreadable', 'file', 'send_original']);
		assert.deepEqual(of(job('source_changed', source())), ['source_changed', 'file', 'send_original']);
		assert.deepEqual(of(job('source_missing')), ['source_missing', 'file', 'send_again']);
		// The record's own code, when the job kept no facts
		assert.deepEqual(of(explainTranscodeFailure({ reason: 'no_video_stream', source: null }, 'audio_only')), ['audio_only', 'file', 'send_with_picture']);
	});

	it('an older failure without facts is retried once to learn what the file is', () => {
		assert.deepEqual([job('no_video_stream').cause, job('no_video_stream').step], ['unknown', 'retry_to_learn']);
		assert.equal(job('no_video_stream', source({ streams: [{ kind: 'video', codec: 'h264' }] })).step, 'retry_then_send');
	});

	it('our side: retry, whatever the file is', () => {
		for (const reason of ['container_start_failed', 'capacity_full', 'attempt_timeout', 'container_silent', 'upload_failed', 'launch_lost', 'source_not_ready'] as const) {
			assert.deepEqual([job(reason).cause, job(reason).step, job(reason, source()).cause], ['ours', 'retry', 'ours'], reason);
		}
	});

	it('every reason has an answer, and one the pages know', () => {
		for (const reason of [...TRANSCODE_REASONS, null]) {
			const f = job(reason);
			assert.ok((VIDEO_FAILURE_REASONS as readonly string[]).includes(f.reason), String(reason));
			assert.equal(f.cause === 'file', /^send_/.test(f.step), String(reason));
		}
	});
});

describe('why a video failed', () => {
	it('an R2 failure counts while Bunny’s copy plays; Bunny’s and the upload’s own failures too', () => {
		const why = (v: Parameters<typeof explainVideoFailure>[0]) => {
			const f = explainVideoFailure(v);
			return f && [f.where, f.reason, f.step];
		};
		assert.equal(why({ uploadStatus: 'ready', r2: { status: 'ready' } }), null);
		assert.equal(why({ uploadStatus: 'ready', r2: { status: 'cancelled' } }), null);
		assert.deepEqual(why({ uploadStatus: 'ready', r2: { status: 'failed', error: 'container_silent' } }), ['r2', 'container_silent', 'retry']);
		assert.deepEqual(why({ uploadStatus: 'processing', issue: { kind: 'stalled' } }), ['bunny', 'stalled', 'retry']);
		assert.deepEqual(why({ uploadStatus: 'failed', issue: { kind: 'encode_failed' } }), ['bunny', 'bunny_failed', 'retry_then_send']);
		assert.deepEqual(why({ uploadStatus: 'failed', issue: { kind: 'needs_reupload' } }), ['upload', 'upload_missing', 'send_again']);
		assert.deepEqual(why({ uploadStatus: 'failed', issue: { kind: 'needs_reupload', code: 'source_changed' } }), ['upload', 'source_changed', 'send_original']);
		assert.deepEqual(why({ uploadStatus: 'failed' }), ['upload', 'unknown', 'retry_then_send']);
		assert.deepEqual(why({ uploadStatus: 'failed', issue: { kind: 'encode_failed', code: 'not-ours' } }), ['bunny', 'bunny_failed', 'retry_then_send']);
	});
});

const id = (n: number) => `00000000-0000-4000-8000-00000000000${n}`;

async function setup() {
	const db = new SqliteD1();
	const v = (n: number, over: object = {}) => videoFixture({ id: id(n), title: `Talk ${n}`, channelId: 'c1', userId: 'u1', uploadStatus: 'ready', isPublic: true, dateCreated: `2026-05-0${n}T00:00:00.000Z`, ...over });
	const r2 = (n: number, status: string, error?: string) => ({ status, jobId: `job-${n}`, rev: 'r', access: 'pub', attempts: 1, queuedAt: '2026-05-01T00:00:00.000Z', ...(error ? { error, failedAt: '2026-05-09T00:00:00.000Z' } : {}) });
	const records = {
		1: v(1, { r2: r2(1, 'ready') }),
		// Failed on R2, plays from Bunny
		2: v(2, { r2: r2(2, 'failed', 'no_video_stream'), originalFilename: 'talk two.mov' }),
		3: v(3, { uploadStatus: 'failed', processingIssue: { kind: 'needs_reupload', reason: 'raw', at: '2026-05-08T00:00:00.000Z' } }),
		4: v(4, { uploadStatus: 'processing' }),
		5: v(5, { uploadStatus: 'failed', isDeleted: true }),
	};
	const bucket = new MemoryBucket(Object.fromEntries(Object.values(records).map((r: any) => [r.id, r])));
	for (const r of Object.values(records) as any[]) await syncOwnership(db as never, 'video', r.id, r);
	await db.prepare('INSERT INTO search_meta (key, value, updated_at) VALUES (?, ?, ?)').bind(ownershipCompleteKey('video'), '1', 1).run();
	const jobRow = (n: number, status: string, error: string | null, source_facts: string | null, at: string) =>
		db.db.prepare(`INSERT INTO media_jobs (video_id, job_id, status, access, attempts, queued_at, failed_at, error, updated_at, source_facts) VALUES (?, ?, ?, 'pub', 1, ?, ?, ?, ?, ?)`).run(id(n), `job-${n}`, status, at, at, error, at, source_facts);
	jobRow(1, 'ready', null, null, '2026-05-01T00:00:00.000Z');
	jobRow(2, 'failed', 'no_video_stream: https://x.example/a?token=secret', JSON.stringify(facts()), '2026-05-09T00:00:00.000Z');
	const env = { SEARCH_DB: db, videos: bucket, channels: new MemoryBucket(), profiles: new MemoryBucket(), global_settings: new MemoryBucket() } as never;
	return { db, env, bucket };
}

describe('readVideoFailures', () => {
	it('explains the failed ones among the ids, without the hash or a query string', async () => {
		const { env } = await setup();
		const items = await readVideoFailures(env, [1, 2, 3, 4, 5].map(id));
		assert.deepEqual(items.map((f) => [f.videoId, f.where, f.reason, f.cause, f.plays, f.fileName]), [
			[id(2), 'r2', 'audio_only', 'file', true, 'talk two.mov'],
			[id(3), 'upload', 'upload_missing', 'file', false, null],
		]);
		assert.equal(items[0].jobId, 'job-2');
		assert.equal(items[0].failedAt, '2026-05-09T00:00:00.000Z');
		assert.doesNotMatch(JSON.stringify(items), /secret|sha256|aaaa/);
	});

	it('facts of an earlier job are not this one’s', async () => {
		const { env, db } = await setup();
		db.db.prepare("UPDATE media_jobs SET job_id = 'older' WHERE video_id = ?").run(id(2));
		const [f] = await readVideoFailures(env, [id(2)]);
		assert.deepEqual([f.reason, f.step, f.source], ['no_video_stream', 'retry_to_learn', null]);
	});

	it('the route takes ids only, as many as one read', async () => {
		const { env } = await setup();
		const app = createMediaInternalRouter();
		const get = async (q: string) => app.request(`/failures?ids=${q}`, {}, env);
		assert.equal((await get('')).status, 400);
		assert.equal((await get('../x')).status, 400);
		assert.equal((await get(Array(VIDEO_FAILURES_MAX + 1).fill(id(1)).join(','))).status, 400);
		assert.deepEqual(((await (await get(id(2))).json()) as any).result.items.map((f: any) => f.reason), ['audio_only']);
	});
});

describe('the lists of failed videos include R2-only failures, from the index', () => {
	it('Videos list: status failed', async () => {
		const { env } = await setup();
		const failed = await listVideos(env, { status: 'failed' } as never);
		assert.deepEqual(failed.items.map((v) => v.id), [id(3), id(2)]);
		assert.equal(failed.total, 2);
		assert.deepEqual((await listVideos(env, { status: 'ready' } as never)).items.map((v) => v.id), [id(2), id(1)]);
	});

	it('Processing: every unfinished or failed video, reading only those', async () => {
		const { env, bucket } = await setup();
		const app = createProcessingInternalRouter();
		const list = async (status: string) => ((await (await app.request(`/videos?status=${status}`, {}, env)).json()) as any).result.items.map((v: any) => [v.id, v.r2Status]);
		let lists = 0;
		(bucket as any).list = async () => { lists++; return { objects: [], truncated: false }; };
		assert.deepEqual(await list('stuck'), [[id(4), null], [id(3), null], [id(2), 'failed']]);
		assert.deepEqual(await list('failed'), [[id(3), null], [id(2), 'failed']]);
		assert.deepEqual(await list('r2_failed'), [[id(2), 'failed']]);
		assert.deepEqual(await list('processing'), [[id(4), null]]);
		const errors = ((await (await app.request('/errors', {}, env)).json()) as any).result.videos.map((v: any) => v.id);
		assert.deepEqual(errors.sort(), [id(2), id(3)]);
		assert.equal(lists, 0);
	});

	it('an index that is not complete falls back to the bucket', async () => {
		const { env, db } = await setup();
		db.db.prepare('DELETE FROM search_meta').run();
		assert.equal(await unfinishedVideoIds(env, 10), null);
		const app = createProcessingInternalRouter();
		const res = (await (await app.request('/videos?status=r2_failed', {}, env)).json()) as any;
		assert.deepEqual(res.result.items.map((v: any) => v.id), [id(2)]);
	});

	it('by index seeks', async () => {
		const { db } = await setup();
		for (const sql of [FAILED_VIDEO_IDS_SQL, UNFINISHED_VIDEO_IDS_SQL]) {
			const plan = (db.db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all() as Array<{ detail: string }>).map((r) => r.detail).join(' | ');
			assert.match(plan, /idx_content_ownership_upload \(kind=\? AND upload_status=\?\)/, plan);
			assert.match(plan, /idx_media_jobs_status \(status=\?\)/, plan);
			assert.doesNotMatch(plan, /SCAN/, plan);
		}
	});

	it('the troubleshooting link finds its video’s job however old', async () => {
		const { env } = await setup();
		const now = Date.parse('2026-11-25T00:00:00.000Z');
		assert.deepEqual((await readTroubleshootJobs(env, now)).items, []);
		const [job] = (await readTroubleshootJobs(env, now, id(2))).items;
		assert.deepEqual([job.videoId, job.state, job.reason], [id(2), 'failed', 'no_video_stream']);
		assert.equal((await readTroubleshootJobs(env, Date.parse('2026-05-10T00:00:00.000Z'), id(2))).items.length, 1, 'once');
	});
});
