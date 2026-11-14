/**
 * On-demand transcription jobs (AUN-CAPTIONS §5.1; search migration 0033): one
 * active job per video and language, minutes reserved at request and given
 * back on cancel or failure, audio from the review or extracted, admin flagged
 * on platform failures and its Retry free of charge.
 */
import { afterEach, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { MessageType, captionDraftKey, type VideoObject } from '@al-ummah/shared-types';
import { assignTier, saveTier } from '../src/lib/creatorTiers';
import { cancelJob, finishJob, listJobs, onAudioReport, onProgress, readCaptionSettings, requestCaptionJob, retryJob, type CaptionJobsEnv } from '../src/lib/captions/jobs';
import { captionSubject, readUsage } from '../src/lib/captions/minutes';
import { SqliteD1 } from './search-sqlite-d1';

const NOV = new Date('2026-11-14T12:00:00.000Z');

function bucket(objects: Record<string, string> = {}) {
	return {
		objects,
		async get(key: string) {
			return key in objects ? { text: async () => objects[key] } : null;
		},
		async head(key: string) {
			return key in objects ? {} : null;
		},
		async list({ prefix }: { prefix: string }) {
			return { objects: Object.keys(objects).filter((k) => k.startsWith(prefix)).map((key) => ({ key })), truncated: false };
		},
		async delete(keys: string | string[]) {
			for (const k of [keys].flat()) delete objects[k];
		},
	};
}
function queue() {
	const sent: unknown[] = [];
	return { sent, fail: false, async send(m: unknown) { if (this.fail) throw new Error('queue down'); sent.push(m); } };
}

const video = (over: Partial<VideoObject> = {}): VideoObject =>
	({ id: 'v1', userId: 'alice', channelId: 'c1', title: 'A talk', duration: 125, uploadStatus: 'ready', ...over }) as VideoObject;

let reports: Array<{ events?: Array<{ action?: { key?: string } }>; resolved?: Array<{ key: string }> }> = [];
const realFetch = globalThis.fetch;
beforeEach(() => {
	reports = [];
	globalThis.fetch = (async (_url: unknown, init?: { body?: string }) => {
		reports.push(JSON.parse(String(init?.body ?? '{}')));
		return new Response('{}');
	}) as typeof fetch;
});
afterEach(() => {
	globalThis.fetch = realFetch;
});

async function setup(minutes = 10) {
	const db = new SqliteD1();
	const d1 = db as unknown as D1Database;
	await saveTier(d1, 'captions', { name: 'Captions', perHour: 5, perDay: 10, maxConcurrent: 2, maxChannels: 1, captionMinutesMonth: minutes }, 'admin-1', { create: true });
	await assignTier(d1, 'alice', 'captions', 'admin-1');
	const env = {
		SEARCH_DB: d1,
		MEDIA_PRIVATE: bucket(),
		subtitles: bucket(),
		global_settings: bucket(),
		queue: queue(),
		TRANSCODE_QUEUE: queue(),
		ERRORS_INGEST_URL: 'https://admin.example/internal/errors',
		INTERNAL_API_KEY: 'k',
	};
	const remaining = async () => (await readUsage(d1, await captionSubject(d1, { userId: 'alice' }), NOV)).remaining;
	return { env, d1, remaining, asEnv: env as unknown as CaptionJobsEnv };
}

const ask = (env: CaptionJobsEnv, over: Partial<{ video: VideoObject; replace: boolean; language: string; userId: string }> = {}) =>
	requestCaptionJob(env, { video: over.video ?? video(), userId: over.userId ?? 'alice', language: over.language ?? 'ar', replace: over.replace ?? false }, NOV);

describe('caption jobs', () => {
	it('settings default per environment and take a valid override', async () => {
		const { env, asEnv } = await setup();
		assert.equal((await readCaptionSettings(asEnv)).monthlyBudgetUsd, 5);
		assert.equal((await readCaptionSettings({ ...asEnv, ENVIRONMENT: 'production' })).monthlyBudgetUsd, 100);
		env.global_settings.objects['captions/settings.json'] = JSON.stringify({ monthlyBudgetUsd: 40, model: 'not a model' });
		assert.deepEqual(await readCaptionSettings(asEnv), { monthlyBudgetUsd: 40, model: '@cf/openai/whisper-large-v3-turbo' });
	});

	it('extracts the audio when the review has none, reserving started minutes', async () => {
		const { env, asEnv, remaining } = await setup(10);
		const out = await ask(asEnv);
		assert.ok('job' in out && !out.existing);
		assert.equal(out.job.status, 'extracting');
		assert.equal(out.job.minutesReserved, 3, '125 s = 3 started minutes');
		assert.equal(await remaining(), 7);
		assert.deepEqual(env.TRANSCODE_QUEUE.sent[0], { kind: 'caption_audio', jobId: out.job.id, videoId: 'v1', out: `captions-work/${out.job.id}/`, queuedAt: NOV.toISOString() });
		assert.equal(env.queue.sent.length, 0);
	});

	it('uses the review audio when the review media still hold it', async () => {
		const { env, asEnv } = await setup();
		env.MEDIA_PRIVATE.objects['review/v1/3/manifest.json'] = '{}';
		const out = await ask(asEnv, { video: video({ review: { manifestKey: 'review/v1/3/manifest.json' } } as never) });
		assert.ok('job' in out);
		assert.equal(out.job.status, 'queued');
		const msg = env.queue.sent[0] as { type: MessageType; payload: { audioManifestKey: string; nextChunk: number; prompt: string } };
		assert.equal(msg.type, MessageType.CaptionJob);
		assert.equal(msg.payload.audioManifestKey, 'review/v1/3/manifest.json');
		assert.equal(msg.payload.nextChunk, 0);
		assert.equal(msg.payload.prompt, 'A talk');
	});

	it('the same request while a job runs returns that job and reserves nothing more', async () => {
		const { asEnv, remaining } = await setup(10);
		const first = await ask(asEnv);
		const again = await ask(asEnv);
		assert.ok('job' in first && 'job' in again);
		assert.equal(again.existing, true);
		assert.equal(again.job.id, first.job.id);
		assert.equal(await remaining(), 7);
		const other = await ask(asEnv, { language: 'en' });
		assert.ok('job' in other && other.job.id !== first.job.id, 'another language is another job');
	});

	it('starts with too few minutes and goes negative; refuses once the balance is 0 or below', async () => {
		const { asEnv, remaining } = await setup(2);
		const started = await ask(asEnv);
		assert.ok('job' in started, 'a balance above 0 starts a job that costs more');
		assert.equal(await remaining(), -1);
		const refused = await ask(asEnv, { language: 'en' });
		assert.ok('refused' in refused);
		assert.equal(refused.minutes, 3);
		assert.equal(refused.usage.remaining, -1);
		assert.equal(refused.usage.overdraft, 1);
		assert.equal((await listJobs(asEnv, 'v1')).length, 1);
		// The started job runs to the end and is charged in full
		await finishJob(asEnv, started.job.id, { outcome: 'ready', minutesUsed: 3 }, undefined, NOV);
		assert.equal((await listJobs(asEnv, 'v1'))[0].minutesCharged, 3);
		assert.equal(await remaining(), -1);
	});

	it('keeps an existing draft unless replace', async () => {
		const { env, asEnv } = await setup(10);
		env.subtitles.objects[captionDraftKey('v1', 'ar')] = '{}';
		await assert.rejects(ask(asEnv, { video: video({ duration: 30 }) }), /draft_exists/);
		const replaced = await ask(asEnv, { video: video({ duration: 30 }), replace: true });
		assert.ok('job' in replaced && replaced.job.replace);
	});

	it('refuses a video that is not ready', async () => {
		const { asEnv } = await setup();
		await assert.rejects(ask(asEnv, { video: video({ uploadStatus: 'processing' } as never) }), /video_not_ready/);
		await assert.rejects(ask(asEnv, { video: video({ duration: 0 }) }), /video_not_ready/);
	});

	it('a job that cannot be sent is failed and charges nothing', async () => {
		const { env, asEnv, remaining } = await setup(10);
		env.TRANSCODE_QUEUE.fail = true;
		await assert.rejects(ask(asEnv), /queue_unavailable/);
		assert.equal(await remaining(), 10);
		assert.equal((await listJobs(asEnv, 'v1'))[0].status, 'failed');
	});

	it('cancel charges only what was transcribed; the rest comes back', async () => {
		const { asEnv, remaining } = await setup(10);
		const out = await ask(asEnv, { video: video({ duration: 8 * 60 }) });
		assert.ok('job' in out);
		assert.equal(await remaining(), 2, 'the estimate counts from the start');
		await onProgress(asEnv, out.job.id, { status: 'transcribing', done: 1, total: 4 }, NOV);
		const cancelled = await cancelJob(asEnv, 'v1', out.job.id, NOV);
		assert.equal(cancelled.minutesCharged, 2, 'a quarter of 8 minutes');
		assert.equal(await remaining(), 8);
		await cancelJob(asEnv, 'v1', out.job.id, NOV);
		assert.equal(await remaining(), 8, 'cancelling again changes nothing');
	});

	it('cancel gives the minutes back and stops progress', async () => {
		const { asEnv, remaining } = await setup(10);
		const out = await ask(asEnv);
		assert.ok('job' in out);
		const cancelled = await cancelJob(asEnv, 'v1', out.job.id, NOV);
		assert.equal(cancelled.status, 'cancelled');
		assert.equal(await remaining(), 10);
		assert.equal(await onProgress(asEnv, out.job.id, { status: 'transcribing', done: 1, total: 2 }, NOV), false);
		await assert.rejects(finishJob(asEnv, out.job.id, { outcome: 'ready', minutesUsed: 3 }, undefined, NOV), /job_cancelled/);
		await assert.rejects(cancelJob(asEnv, 'other-video', out.job.id, NOV), /job_not_found/);
	});

	it('audio report → transcription message; progress; ready commits what was used', async () => {
		const { env, asEnv, remaining } = await setup(10);
		const out = await ask(asEnv);
		assert.ok('job' in out);
		const id = out.job.id;
		await onAudioReport(asEnv, id, { ok: true, manifestKey: `captions-work/${id}/manifest.json` }, 'A talk', undefined, NOV);
		assert.equal((env.queue.sent[0] as { payload: { audioManifestKey: string } }).payload.audioManifestKey, `captions-work/${id}/manifest.json`);
		await assert.rejects(onAudioReport(asEnv, id, { ok: true, manifestKey: 'x' }, 'A talk', undefined, NOV), /job_not_extracting/);
		assert.equal(await onProgress(asEnv, id, { status: 'transcribing', done: 1, total: 1 }, NOV), true);
		const ready = await finishJob(asEnv, id, { outcome: 'ready', minutesUsed: 2 }, undefined, NOV);
		assert.equal(ready.status, 'ready');
		assert.equal(ready.minutesCharged, 2);
		assert.equal(await remaining(), 8, 'the unused reserved minute came back');
		assert.ok(reports.some((r) => r.resolved?.some((x) => x.key === `caption-job:${id}`)));
	});

	it('deletes the job work when it ends, never the review media; the message carries the daily budget', async () => {
		const { env, asEnv } = await setup(10);
		env.global_settings.objects['captions/settings.json'] = JSON.stringify({ monthlyBudgetUsd: 30 });
		env.MEDIA_PRIVATE.objects['review/v1/3/manifest.json'] = '{}';
		const out = await ask(asEnv);
		assert.ok('job' in out);
		const id = out.job.id;
		env.MEDIA_PRIVATE.objects[`captions-work/${id}/manifest.json`] = '{}';
		env.MEDIA_PRIVATE.objects[`captions-work/${id}/a0.mp3`] = 'x';
		env.MEDIA_PRIVATE.objects['captions-work/other-job/a0.mp3'] = 'x';
		await onAudioReport(asEnv, id, { ok: true, manifestKey: `captions-work/${id}/manifest.json` }, 'A talk', undefined, NOV);
		assert.equal((env.queue.sent[0] as { payload: { dailyBudgetUsd: number } }).payload.dailyBudgetUsd, 1);
		await finishJob(asEnv, id, { outcome: 'ready', minutesUsed: 3 }, undefined, NOV);
		assert.deepEqual(Object.keys(env.MEDIA_PRIVATE.objects).sort(), ['captions-work/other-job/a0.mp3', 'review/v1/3/manifest.json']);

		const late = await ask(asEnv);
		assert.ok('job' in late);
		await cancelJob(asEnv, 'v1', late.job.id, NOV);
		env.MEDIA_PRIVATE.objects[`captions-work/${late.job.id}/a0.mp3`] = 'x';
		await assert.rejects(onAudioReport(asEnv, late.job.id, { ok: true, manifestKey: `captions-work/${late.job.id}/manifest.json` }, 'A talk', undefined, NOV), /job_not_extracting/);
		assert.equal(`captions-work/${late.job.id}/a0.mp3` in env.MEDIA_PRIVATE.objects, false, 'what a late extraction wrote is deleted');
	});

	it('an audio failure refunds and flags the admin, except a video with no audio track', async () => {
		const { asEnv, remaining } = await setup(10);
		const out = await ask(asEnv);
		assert.ok('job' in out);
		const failed = await onAudioReport(asEnv, out.job.id, { ok: false, error: 'ffmpeg exited 1', retryable: false }, 'A talk', undefined, NOV);
		assert.equal(failed.status, 'failed');
		assert.equal(failed.error, 'audio_unavailable');
		assert.equal(await remaining(), 10);
		assert.ok(reports.some((r) => r.events?.some((e) => e.action?.key === `caption-job:${out.job.id}`)));

		reports = [];
		const silent = await ask(asEnv);
		assert.ok('job' in silent);
		await onAudioReport(asEnv, silent.job.id, { ok: false, error: 'no_audio', retryable: false }, 'A talk', undefined, NOV);
		assert.equal(reports.length, 0, 'no audio track is not a platform fault');
	});

	it("the admin's retry runs a failed job again free of charge, never beside a newer active one", async () => {
		const { env, asEnv, remaining } = await setup(10);
		const out = await ask(asEnv);
		assert.ok('job' in out);
		await finishJob(asEnv, out.job.id, { outcome: 'failed', error: 'transcription_failed' }, undefined, NOV);
		assert.equal(await remaining(), 10);
		const retried = await retryJob(asEnv, out.job.id, video(), NOV);
		assert.equal(retried.status, 'extracting');
		assert.equal(retried.waived, true);
		assert.equal(env.TRANSCODE_QUEUE.sent.length, 2);
		const ready = await finishJob(asEnv, out.job.id, { outcome: 'ready', minutesUsed: 3 }, undefined, NOV);
		assert.equal(ready.minutesCharged, 0);
		assert.equal(await remaining(), 10, 'a waived job charges nothing');

		const second = await ask(asEnv);
		assert.ok('job' in second);
		await finishJob(asEnv, second.job.id, { outcome: 'failed', error: 'failed' }, undefined, NOV);
		await ask(asEnv);
		await assert.rejects(retryJob(asEnv, second.job.id, video(), NOV), /newer_job_active/);
		await assert.rejects(retryJob(asEnv, second.job.id, null, NOV), /video_gone|newer_job_active/);
	});
});

describe('caption jobs: erase', () => {
	it("erasing a user deletes the jobs they requested or paid for", async () => {
		const { asEnv, d1 } = await setup(10);
		const out = await ask(asEnv);
		assert.ok('job' in out);
		const { eraseCaptionMinutes } = await import('../src/lib/captions/minutes');
		await eraseCaptionMinutes(d1, 'alice');
		assert.equal((await listJobs(asEnv, 'v1')).length, 0);
	});

	it("erasing an editor keeps the owner's job record, cancels a running one and gives the owner the minutes back", async () => {
		const { asEnv, d1, remaining } = await setup(10);
		const out = await ask(asEnv, { userId: 'editor' });
		assert.ok('job' in out);
		assert.equal(await remaining(), 7, "the owner's minutes pay for the editor's job");
		const { eraseCaptionMinutes } = await import('../src/lib/captions/minutes');
		await eraseCaptionMinutes(d1, 'editor', NOV);
		const [job] = await listJobs(asEnv, 'v1');
		assert.equal(job.status, 'cancelled');
		assert.equal(job.requestedBy, 'erased-user');
		assert.equal(await remaining(), 10);
	});

	it('a job writing its draft can no longer be cancelled (no free draft)', async () => {
		const { asEnv, remaining } = await setup(10);
		const out = await ask(asEnv);
		assert.ok('job' in out);
		assert.equal(await onProgress(asEnv, out.job.id, { status: 'postprocessing', done: 1, total: 1 }, NOV), true);
		await assert.rejects(cancelJob(asEnv, 'v1', out.job.id, NOV), /job_finishing/);
		assert.equal((await finishJob(asEnv, out.job.id, { outcome: 'ready', minutesUsed: 3 }, undefined, NOV)).minutesCharged, 3);
		assert.equal(await remaining(), 7);
	});

	it('a job stuck writing its draft may be cancelled once stale; progress never moves it back', async () => {
		const { asEnv, remaining } = await setup(10);
		const out = await ask(asEnv);
		assert.ok('job' in out);
		await onProgress(asEnv, out.job.id, { status: 'postprocessing', done: 1, total: 1 }, NOV);
		assert.equal(await onProgress(asEnv, out.job.id, { status: 'transcribing', done: 0, total: 1 }, NOV), false);
		const later = new Date(NOV.getTime() + 91 * 60_000);
		assert.equal((await cancelJob(asEnv, 'v1', out.job.id, later)).status, 'cancelled');
		assert.equal(await remaining(), 10);
		assert.equal(await onProgress(asEnv, out.job.id, { status: 'postprocessing', done: 1, total: 1 }, later), false, 'a late retry stops before writing');
	});
});

describe('caption jobs: internal routes', () => {
	const videos = (objects: Record<string, unknown>) => ({ async get(key: string) { return key in objects ? { json: async () => objects[key] } : null; } });
	const post = (app: { request: (p: string, i: RequestInit, e: unknown) => Response | Promise<Response> }, path: string, body: unknown, env: unknown) =>
		app.request(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }, env);

	it('validates reports, stops a cancelled job, and answers 404 to a retry with nothing left to do', async () => {
		const { createCaptionJobsInternalRouter } = await import('../src/endpoints/captions/captionJobsInternal');
		const app = createCaptionJobsInternalRouter();
		const { env, asEnv } = await setup(10);
		const routeEnv = { ...env, videos: videos({ v1: video() }) };
		const out = await ask(asEnv);
		assert.ok('job' in out);
		const id = out.job.id;

		assert.equal((await post(app, `/jobs/${id}/finish`, { outcome: 'ready', minutesUsed: -1 }, routeEnv)).status, 400);
		assert.equal((await post(app, `/jobs/${id}/audio`, {}, routeEnv)).status, 400);
		assert.equal((await post(app, `/jobs/${id}/progress`, { status: 'ready' }, routeEnv)).status, 400);
		assert.equal((await post(app, `/jobs/missing/finish`, { outcome: 'failed', error: 'failed' }, routeEnv)).status, 404);

		await cancelJob(asEnv, 'v1', id, NOV);
		assert.equal((await post(app, `/jobs/${id}/progress`, { status: 'transcribing', done: 1, total: 2 }, routeEnv)).status, 409);
		assert.equal((await post(app, `/jobs/${id}/finish`, { outcome: 'ready', minutesUsed: 1 }, routeEnv)).status, 409);

		const next = await ask(asEnv);
		assert.ok('job' in next);
		await finishJob(asEnv, next.job.id, { outcome: 'failed', error: 'failed' }, undefined, NOV);
		const gone = await post(app, '/jobs/retry', { jobId: next.job.id }, { ...env, videos: videos({}) });
		assert.equal(gone.status, 404);
		const again = await post(app, '/jobs/retry', { jobId: next.job.id }, routeEnv);
		assert.equal(again.status, 200);
		assert.equal(((await again.json()) as { result: { status: string } }).result.status, 'extracting');
	});
});
