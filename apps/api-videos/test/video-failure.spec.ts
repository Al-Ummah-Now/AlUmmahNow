/** Why videos failed and what to do (shared-types video-failure.ts, lib/media/failures.ts), and the lists that show them. */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { explainTranscodeFailure, explainVideoFailure, ownershipCompleteKey, syncOwnership, TRANSCODE_REASONS, VIDEO_FAILURE_REASONS, VIDEO_FAILURES_MAX, type TranscodeReason } from '@al-ummah/shared-types';
import { pageOfVideos, readVideoFailures, videoStatesSql } from '../src/lib/media/failures';
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
		// An HDR format we cannot convert (some Dolby Vision): the same file fails again; exported as SDR it plays
		assert.deepEqual(of(job('colour_unsupported', source({ streams: [{ kind: 'video', codec: 'hevc' }] }))), ['colour_unsupported', 'file', 'send_sdr']);
		assert.deepEqual(of(explainTranscodeFailure({ reason: 'colour_unsupported', source: null }, 'colour_unsupported')), ['colour_unsupported', 'file', 'send_sdr']);
		assert.deepEqual((({ where, reason, step }) => [where, reason, step])(explainVideoFailure({ uploadStatus: 'failed', issue: { kind: 'encode_failed', code: 'colour_unsupported' }, r2Decides: true })!), ['r2', 'colour_unsupported', 'send_sdr']);
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

	it('R2’s own failure is never Bunny’s: nothing while it is transcoded again, R2’s when that was cancelled', () => {
		const v = (status: string, issue: object = { kind: 'encode_failed', code: 'audio_only' }) => explainVideoFailure({ uploadStatus: 'failed', issue: issue as never, r2: { status }, r2Decides: true });
		for (const status of ['queued', 'transcoding']) assert.equal(v(status), null, status);
		assert.deepEqual([v('cancelled')!.where, v('cancelled')!.reason], ['r2', 'audio_only']);
		assert.deepEqual([v('cancelled', { kind: 'encode_failed' })!.where, v('cancelled', { kind: 'encode_failed' })!.reason], ['r2', 'encode_failed']);
		assert.equal(v('queued', { kind: 'needs_reupload', code: 'source_changed' })!.reason, 'source_changed');
		// Bunny decides: its failure stays Bunny's
		assert.equal(explainVideoFailure({ uploadStatus: 'failed', issue: { kind: 'encode_failed' }, r2: { status: 'queued' } })!.where, 'bunny');
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

	it('an index that is not complete answers too: a list never reads the bucket', async () => {
		const { env, db, bucket } = await setup();
		db.db.prepare('DELETE FROM search_meta').run();
		(bucket as any).list = async () => { throw new Error('listed'); };
		const res = (await (await createProcessingInternalRouter().request('/videos?status=r2_failed', {}, env)).json()) as any;
		assert.deepEqual(res.result.items.map((v: any) => v.id), [id(2)]);
	});

	it('the whole queries read the rows in those states only', async () => {
		const { env, db } = await setup();
		const plans = async (run: () => Promise<unknown>) => {
			const sqls: string[] = [];
			const prepare = db.prepare.bind(db);
			(db as any).prepare = (sql: string) => { sqls.push(sql); return prepare(sql); };
			try { await run(); } finally { (db as any).prepare = prepare; }
			const own = sqls.filter((q) => /content_ownership/.test(q) && /upload_status|media_jobs/.test(q));
			assert.ok(own.length > 0, sqls.join('; '));
			return own.map((q) => (db.db.prepare(`EXPLAIN QUERY PLAN ${q}`).all() as Array<{ detail: string }>).map((r) => r.detail).join(' | '));
		};
		const app = createProcessingInternalRouter();
		for (const plan of [
			...(await plans(() => listVideos(env, { status: 'failed' } as never))),
			...(await plans(() => listVideos(env, { status: 'failed', noTotal: true, page: 3 } as never))),
			...(await plans(() => listVideos(env, { status: 'processing' } as never))),
			...(await plans(() => listVideos(env, { status: 'initiated' } as never))),
			...(await plans(async () => { for (const s of ['stuck', 'processing', 'failed', 'r2_failed', 'stalled', 'needs_reupload']) await app.request(`/videos?status=${s}`, {}, env); })),
			...(await plans(async () => app.request('/errors', {}, env))),
		]) {
			assert.doesNotMatch(plan, /SCAN (content_ownership|media_jobs|v|j)\b|idx_content_ownership_created/, plan);
			assert.match(plan, /idx_content_ownership_unfinished \(upload_status=\?\)|idx_media_jobs_status \(status=\?\)/, plan);
		}
		// Every video: a page of the newest, in the index's order
		const all = (db.db.prepare(`EXPLAIN QUERY PLAN ${videoStatesSql({ states: [], all: true })}`).all() as Array<{ detail: string }>).map((r) => r.detail).join(' | ');
		assert.doesNotMatch(all, /SCAN|TEMP B-TREE/, all);
	});

	it('pages: nothing dropped, nothing twice, and uploads never push a failure out', async () => {
		const { env, db, bucket } = await setup();
		const vid = (n: number) => `10000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
		for (let n = 0; n < 400; n++) {
			const failed = n % 2 === 0;
			const record = videoFixture({ id: vid(n), title: `U ${n}`, channelId: 'c1', userId: 'u1', uploadStatus: failed ? 'failed' : 'initiated', dateCreated: new Date(Date.UTC(2026, 6, 1) + (failed ? 0 : 86400_000) + n * 1000).toISOString() });
			await (bucket as any).put(vid(n), JSON.stringify(record));
			await syncOwnership(db as never, 'video', vid(n), record as never);
		}
		const app = createProcessingInternalRouter();
		const walk = async (status: string, limit: number) => {
			const ids: string[] = [];
			let at: number | null = 0;
			let pages = 0;
			while (at !== null && pages++ < 60) {
				const r: any = ((await (await app.request(`/videos?status=${status}&limit=${limit}&offset=${at}`, {}, env)).json()) as any).result;
				assert.ok(r.items.length <= limit);
				ids.push(...r.items.map((v: any) => v.id));
				at = r.nextOffset;
			}
			assert.equal(at, null);
			assert.equal(new Set(ids).size, ids.length, 'once each');
			return ids;
		};
		const failed = await walk('failed', 70);
		assert.equal(failed.length, 202);
		assert.equal(failed[0], vid(398), 'newest first');
		assert.equal((await walk('stuck', 100)).length, 403);
		assert.equal((await walk('r2_failed', 1)).length, 1);
		// One page looks through so many records and no more; the next goes on from there
		const stuck = { states: ['initiated', 'uploading', 'processing', 'failed'] as const, r2Failed: true };
		const none = await pageOfVideos<any>(env, stuck as never, { from: 0, limit: 10, wanted: () => false });
		assert.deepEqual([none!.items, none!.next], [[], 300]);
		const rest = await pageOfVideos<any>(env, stuck as never, { from: 300, limit: 10, wanted: () => false });
		assert.deepEqual([rest!.items, rest!.next], [[], null]);
		const errors = ((await (await app.request('/errors?limit=50', {}, env)).json()) as any).result;
		assert.deepEqual([errors.videos.length, errors.moreVideos, errors.videos.every((v: any) => v.uploadStatus === 'failed')], [50, true, true]);
	});

	it('file names are names, not paths', async () => {
		const { env, bucket } = await setup();
		for (const path of ['C:\\Users\\someone\\Talks\\talk.mov', '/home/someone/talk.mov']) {
			const record = JSON.parse(await (await (bucket as any).get(id(2))).text());
			await (bucket as any).put(id(2), JSON.stringify({ ...record, originalFilename: path }));
			assert.equal((await readVideoFailures(env, [id(2)]))[0].fileName, 'talk.mov');
		}
	});

	it('the troubleshooting panel leaves deleted videos out, their names and jobs', async () => {
		const { env, db } = await setup();
		const now = Date.parse('2026-05-10T00:00:00.000Z');
		assert.equal((await readTroubleshootJobs(env, now, id(2))).items.length, 1);
		db.db.prepare("UPDATE content_ownership SET is_deleted = 1 WHERE kind = 'video' AND id = ?").run(id(2));
		assert.deepEqual((await readTroubleshootJobs(env, now, id(2))).items, []);
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
