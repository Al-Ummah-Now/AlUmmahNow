/**
 * Multiple audio tracks (wiki AUN-MULTI-AUDIO): the per-tier limit (MA9), adding and uploading a
 * track, the normalising and package jobs and their reports, review of a track (MA8), what viewers
 * get (VideoView.audioTracks, the package master in the playback URL), and the admin Retry.
 */
import { afterEach, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
	VIDEO_REVIEW_SETTINGS_KEY,
	audibleAudioTracks,
	audioPackageMaster,
	clearVideoReviewSettingsCache,
	isAudioPackageJobMessage,
	isAudioTrackJobMessage,
	type AudioPackageJobMessage,
	type AudioTrack,
	type AudioTrackJobMessage,
	type VideoObject,
} from '@al-ummah/shared-types';
import { assignTier, saveTier, validateTier } from '../src/lib/creatorTiers';
import {
	AudioTrackError,
	addTrack,
	completeUpload,
	deleteTrack,
	onPackageReport,
	onProbeReport,
	onRenditionReady,
	onTrackPrepared,
	requestProbe,
	retryAudio,
	studioView,
	updateTrack,
	writeChunk,
	type AudioTracksEnv,
} from '../src/lib/audio-tracks/service';
import { applyAudioTrackDecision, applyAudioTrackOutcome } from '../src/lib/review/audio-track';
import { publicVideoFields } from '../src/lib/transformations';
import { MemoryBucket } from './helpers';
import { SqliteD1 } from './search-sqlite-d1';

// Workers' FixedLengthStream, for Node (length checks are the runtime's job)
(globalThis as Record<string, unknown>).FixedLengthStream ??= class {
	constructor() {
		return new TransformStream();
	}
};

const NOW = new Date('2026-11-14T12:00:00.000Z');
const R2 = { status: 'ready', rev: 'r1', access: 'pub', result: { rungs: [{ name: '360p' }, { name: '720p' }], durationSeconds: 60 } };

/** Originals bucket that stores chunk bodies (streams) with their sizes. */
class Originals {
	objects = new Map<string, Uint8Array>();
	async put(key: string, value: ReadableStream<Uint8Array> | string) {
		const bytes = typeof value === 'string' ? new TextEncoder().encode(value) : new Uint8Array(await new Response(value).arrayBuffer());
		this.objects.set(key, bytes);
		return { key };
	}
	async list({ prefix }: { prefix: string }) {
		return { objects: [...this.objects.keys()].filter((k) => k.startsWith(prefix)).sort().map((key) => ({ key, size: this.objects.get(key)!.length })), truncated: false };
	}
	async delete(keys: string | string[]) {
		for (const k of [keys].flat()) this.objects.delete(k);
	}
}

class Queue {
	sent: unknown[] = [];
	async send(m: unknown) {
		this.sent.push(m);
	}
}

let reports: Array<{ events?: Array<{ action?: { key?: string; retry?: { path?: string; body?: unknown } } }>; resolved?: Array<{ key: string }> }> = [];
const realFetch = globalThis.fetch;
beforeEach(() => {
	reports = [];
	clearVideoReviewSettingsCache();
	globalThis.fetch = (async (_url: unknown, init?: { body?: string }) => {
		reports.push(JSON.parse(String(init?.body ?? '{}')));
		return new Response('{}');
	}) as typeof fetch;
});
afterEach(() => {
	globalThis.fetch = realFetch;
});

async function setup(opts: { tracks?: number; video?: Partial<VideoObject> & Record<string, unknown>; review?: 'enforce' } = {}) {
	const db = new SqliteD1();
	const d1 = db as unknown as D1Database;
	await saveTier(d1, 'dubs', { name: 'Dubs', perHour: 5, perDay: 10, maxConcurrent: 2, maxChannels: 1, audioTracksPerVideo: opts.tracks ?? 2 }, 'admin-1', { create: true });
	await assignTier(d1, 'alice', 'dubs', 'admin-1');
	const videos = new MemoryBucket({ v1: { id: 'v1', userId: 'alice', channelId: 'c1', title: 'A talk', language: 'ar', duration: 60, uploadStatus: 'ready', isPublic: true, r2: R2, ...(opts.video ?? {}) } });
	const settings = new MemoryBucket();
	if (opts.review) settings.store.set(VIDEO_REVIEW_SETTINGS_KEY, JSON.stringify({ mode: opts.review }));
	const env = {
		videos,
		channels: new MemoryBucket({ c1: { id: 'c1' } }),
		global_settings: settings,
		SEARCH_DB: d1,
		MEDIA_ORIGINALS: new Originals(),
		MEDIA: new MemoryBucket(),
		MEDIA_PRIVATE: new MemoryBucket(),
		TRANSCODE_QUEUE: new Queue(),
		MODERATION_QUEUE: new Queue(),
		ERRORS_INGEST_URL: 'https://admin.example/internal/errors',
		INTERNAL_API_KEY: 'k',
		...(opts.review ? { VIDEO_REVIEW_ALLOWED: 'true' } : {}),
	};
	const asEnv = env as unknown as AudioTracksEnv;
	const read = () => videos.read<VideoObject & { audioTracks?: AudioTrack[] }>('v1')!;
	const sent = <T>(kind: string) => env.TRANSCODE_QUEUE.sent.filter((m) => (m as { kind?: string }).kind === kind) as T[];
	return { env, asEnv, d1, read, sent };
}

const upload = (bytes = 10, over: Record<string, unknown> = {}) => ({ language: 'en', kind: 'dub', source: { type: 'upload' as const, bytes, fileName: 'en.mp3' }, ...over });
const stream = (text: string) => new Blob([text]).stream() as ReadableStream<Uint8Array>;

/** Add an English dub, upload its 10 bytes and complete it: the track job is queued. */
async function uploadedTrack(t: Awaited<ReturnType<typeof setup>>, over: Record<string, unknown> = {}) {
	const { track } = await addTrack(t.asEnv, undefined, { video: t.read(), userId: 'alice', body: upload(10, over) }, NOW);
	await writeChunk(t.asEnv, t.read(), track.id, 0, 10, stream('0123456789'));
	await completeUpload(t.asEnv, undefined, t.read(), track.id, NOW);
	return track;
}

/** Run the track job to the end (apps/media's report). */
async function prepared(t: Awaited<ReturnType<typeof setup>>, trackId: string, ok = true) {
	const job = t.sent<AudioTrackJobMessage>('audio_track').filter((m) => m.trackId === trackId).at(-1)!;
	return onTrackPrepared(t.asEnv, undefined, 'v1', trackId, ok ? { jobId: job.jobId, ok: true, durationSeconds: 60, ...(job.reviewPrefix ? { reviewManifestKey: `${job.reviewPrefix}manifest.json` } : {}) } : { jobId: job.jobId, ok: false, error: 'no_audio', retryable: false }, NOW);
}

/** Run the latest package job to the end. */
async function packaged(t: Awaited<ReturnType<typeof setup>>) {
	const job = t.sent<AudioPackageJobMessage>('audio_package').at(-1)!;
	return onPackageReport(t.asEnv, undefined, 'v1', { jobId: job.jobId, rev: job.rev, access: job.access, ok: true, master: `master_a${job.version}.m3u8`, trackIds: job.tracks.map((x) => x.id) }, NOW);
}

describe('tier limit (MA9)', () => {
	it('tiers default to no extra tracks; the limit is 0 to 16; unlimited tiers keep 0', () => {
		const base = { name: 'T', perHour: 1, perDay: 1, maxConcurrent: 1, maxChannels: 1 };
		assert.equal(validateTier('t', base).audioTracksPerVideo, 0);
		assert.throws(() => validateTier('t', { ...base, audioTracksPerVideo: 17 }), /audioTracksPerVideo/);
		assert.throws(() => validateTier('t', { ...base, audioTracksPerVideo: -1 }), /audioTracksPerVideo/);
		assert.equal(validateTier('t', { ...base, audioTracksPerVideo: 16 }).audioTracksPerVideo, 16);
		assert.equal(validateTier('t', { ...base, unlimited: true, audioTracksPerVideo: 5 }).audioTracksPerVideo, 0);
	});

	it('refuses a track past the tier limit with 402 and the numbers', async () => {
		const t = await setup({ tracks: 1 });
		await addTrack(t.asEnv, undefined, { video: t.read(), userId: 'alice', body: upload() }, NOW);
		await assert.rejects(addTrack(t.asEnv, undefined, { video: t.read(), userId: 'alice', body: upload(10, { language: 'ur' }) }, NOW), (e: AudioTrackError) => e.status === 402 && e.code === 'upgrade_required' && e.extra.limit === 1 && e.extra.used === 1);
	});

	it('a user on no tier (limit 0): the feature is off (404 feature_off, hidden in Studio); a super admin is unlimited', async () => {
		const t = await setup();
		await assert.rejects(addTrack(t.asEnv, undefined, { video: { ...t.read(), userId: 'bob' }, userId: 'bob', body: upload() }, NOW), (e: AudioTrackError) => e.status === 404 && e.code === 'feature_off');
		const ok = await addTrack(t.asEnv, undefined, { video: { ...t.read(), userId: 'bob' }, userId: 'root', roles: ['super_admin'], body: upload() }, NOW);
		assert.ok(ok.track.id.startsWith('t'));
	});

	it('off is checked first: no tier answers feature_off even for a video still processing or a bad request', async () => {
		const u = await setup({ video: { uploadStatus: 'processing' } as never });
		const bob = { ...u.read(), userId: 'bob' };
		await assert.rejects(addTrack(u.asEnv, undefined, { video: bob, userId: 'bob', body: upload() }, NOW), (e: AudioTrackError) => e.status === 404 && e.code === 'feature_off');
		await assert.rejects(addTrack(u.asEnv, undefined, { video: bob, userId: 'bob', body: { language: 'xx' } as never }, NOW), (e: AudioTrackError) => e.status === 404 && e.code === 'feature_off');
	});
});

describe('adding a track', () => {
	it('creates the original from the video, then the new track as uploading (not default until it can be heard)', async () => {
		const t = await setup();
		const { track, uploadId } = await addTrack(t.asEnv, undefined, { video: t.read(), userId: 'alice', body: upload(10, { isDefault: true }) }, NOW);
		assert.ok(uploadId);
		const tracks = t.read().audioTracks!;
		assert.deepEqual(tracks.map((x) => [x.id, x.kind, x.language, x.isDefault]), [['orig', 'original', 'ar', true], [track.id, 'dub', 'en', false]]);
		assert.equal(tracks[1]!.status, 'uploading');
		assert.equal(tracks[1]!.label, 'English', 'the language name is the default label');
	});

	it('refuses a second track of the same language and kind, the kind original, and unready videos', async () => {
		const t = await setup();
		await addTrack(t.asEnv, undefined, { video: t.read(), userId: 'alice', body: upload() }, NOW);
		await assert.rejects(addTrack(t.asEnv, undefined, { video: t.read(), userId: 'alice', body: upload() }, NOW), (e: AudioTrackError) => e.code === 'duplicate_track');
		await assert.rejects(addTrack(t.asEnv, undefined, { video: t.read(), userId: 'alice', body: upload(10, { language: 'ur', kind: 'original' }) }, NOW), (e: AudioTrackError) => e.code === 'invalid_track');
		const u = await setup({ video: { uploadStatus: 'processing' } as never });
		await assert.rejects(addTrack(u.asEnv, undefined, { video: u.read(), userId: 'alice', body: upload() }, NOW), (e: AudioTrackError) => e.code === 'video_not_ready');
		await assert.rejects(addTrack(t.asEnv, undefined, { video: t.read(), userId: 'alice', body: upload(10, { language: 'ur', source: { type: 'upload', bytes: 10, fileName: 'x.exe' } }) }, NOW), (e: AudioTrackError) => e.code === 'unsupported_file');
	});

	it('takes chunks in order, refuses a gap with the offset to resume from, and queues the job once whole', async () => {
		const t = await setup();
		const { track } = await addTrack(t.asEnv, undefined, { video: t.read(), userId: 'alice', body: upload(10) }, NOW);
		assert.equal(await writeChunk(t.asEnv, t.read(), track.id, 0, 4, stream('0123')), 4);
		await assert.rejects(writeChunk(t.asEnv, t.read(), track.id, 8, 2, stream('89')), (e: AudioTrackError) => e.status === 409 && e.extra.offset === 4);
		await assert.rejects(completeUpload(t.asEnv, undefined, t.read(), track.id, NOW), (e: AudioTrackError) => e.code === 'upload_incomplete');
		await assert.rejects(writeChunk(t.asEnv, t.read(), track.id, 4, 7, stream('4567890')), (e: AudioTrackError) => e.code === 'past_the_end');
		assert.equal(await writeChunk(t.asEnv, t.read(), track.id, 4, 6, stream('456789')), 10);
		await completeUpload(t.asEnv, undefined, t.read(), track.id, NOW);
		const [job] = t.sent<AudioTrackJobMessage>('audio_track');
		assert.ok(isAudioTrackJobMessage(job), 'a valid queue message');
		assert.deepEqual(job!.source, { type: 'upload', uploadId: (t.read().audioTracks![1]!.source as { uploadId: string }).uploadId, bytes: 10 });
		assert.equal(job!.durationSeconds, 60);
		assert.equal(job!.reviewPrefix, undefined, 'review off: no review audio');
		assert.equal(t.read().audioTracks![1]!.status, 'processing');
	});

	it('a track of the video file itself is queued at once from the detected streams', async () => {
		const t = await setup();
		await requestProbe(t.asEnv, t.read(), NOW);
		const probe = t.env.TRANSCODE_QUEUE.sent[0] as { jobId: string };
		await onProbeReport(t.asEnv, 'v1', { jobId: probe.jobId, ok: true, streams: [{ index: 0, language: 'ara' }, { index: 1, language: 'eng', title: 'English' }] }, NOW);
		assert.deepEqual(t.read().audioDetected!.streams.map((s) => s.index), [0, 1]);
		await assert.rejects(addTrack(t.asEnv, undefined, { video: t.read(), userId: 'alice', body: { language: 'en', kind: 'dub', source: { type: 'source_stream', streamIndex: 5 } } }, NOW), (e: AudioTrackError) => e.code === 'unknown_stream');
		await addTrack(t.asEnv, undefined, { video: t.read(), userId: 'alice', body: { language: 'en', kind: 'dub', source: { type: 'source_stream', streamIndex: 1 } } }, NOW);
		const job = t.sent<AudioTrackJobMessage>('audio_track')[0]!;
		assert.deepEqual(job.source, { type: 'source_stream', streamIndex: 1 });
	});
});

describe('jobs and the package', () => {
	it('a prepared track (review off) is ready and queues the package of the rendition, original first', async () => {
		const t = await setup();
		const track = await uploadedTrack(t, { isDefault: true });
		assert.deepEqual(await prepared(t, track.id), { applied: true });
		const tracks = t.read().audioTracks!;
		assert.equal(tracks[1]!.status, 'ready');
		assert.equal(tracks[1]!.isDefault, true, 'the pending default moves once the track can be heard');
		assert.equal(tracks[0]!.isDefault, false);
		const [pkg] = t.sent<AudioPackageJobMessage>('audio_package');
		assert.ok(isAudioPackageJobMessage(pkg));
		assert.deepEqual(pkg!.rungs, ['360p', '720p']);
		assert.deepEqual(pkg!.tracks.map((x) => x.id), ['orig', track.id]);
		assert.equal(pkg!.version, 1);
		assert.equal(t.read().audioPackage!.status, 'queued');
	});

	it('viewers get the tracks and the package master only once the package is ready', async () => {
		const t = await setup();
		const track = await uploadedTrack(t);
		await prepared(t, track.id);
		assert.deepEqual(audibleAudioTracks(t.read() as never), []);
		assert.equal(audioPackageMaster(t.read() as never), null);
		await packaged(t);
		const v = t.read();
		assert.equal(audioPackageMaster(v as never), 'master_a1.m3u8');
		const view = publicVideoFields(v as never) as { audioTracks?: unknown[]; audioPackage?: unknown };
		assert.deepEqual(view.audioTracks, [
			{ id: 'orig', language: 'ar', label: 'العربية', kind: 'original', isDefault: true },
			{ id: track.id, language: 'en', label: 'English', kind: 'dub', isDefault: false },
		]);
		assert.equal(view.audioPackage, undefined, 'package internals stay server-side');
		assert.equal(JSON.stringify(view).includes('uploadId'), false);
	});

	it('a package for an old rendition is not recorded and is built again for the current one', async () => {
		const t = await setup();
		const track = await uploadedTrack(t);
		await prepared(t, track.id);
		const job = t.sent<AudioPackageJobMessage>('audio_package')[0]!;
		await t.env.videos.put('v1', JSON.stringify({ ...t.read(), r2: { ...R2, rev: 'r2' } }));
		const out = await onPackageReport(t.asEnv, undefined, 'v1', { jobId: job.jobId, rev: 'r1', access: 'pub', ok: true, master: 'master_a1.m3u8', trackIds: ['orig', track.id] }, NOW);
		assert.equal(out.applied, false);
		assert.equal(t.read().audioPackage!.rev, 'r2');
		assert.equal(t.sent<AudioPackageJobMessage>('audio_package').at(-1)!.rev, 'r2');
	});

	it('a new rendition (re-transcode) rebuilds a ready package', async () => {
		const t = await setup();
		const track = await uploadedTrack(t);
		await prepared(t, track.id);
		await packaged(t);
		const before = t.sent<AudioPackageJobMessage>('audio_package').length;
		await onRenditionReady(t.asEnv, undefined, t.read());
		assert.equal(t.sent<AudioPackageJobMessage>('audio_package').length, before, 'same rendition: nothing to do');
		await t.env.videos.put('v1', JSON.stringify({ ...t.read(), r2: { ...R2, rev: 'r9' } }));
		await onRenditionReady(t.asEnv, undefined, t.read());
		assert.equal(t.sent<AudioPackageJobMessage>('audio_package').at(-1)!.rev, 'r9');
	});

	it('a failed track flags the admin with a Retry; Retry queues the job again', async () => {
		const t = await setup();
		const track = await uploadedTrack(t);
		await prepared(t, track.id, false);
		assert.equal(t.read().audioTracks![1]!.status, 'failed');
		assert.equal(t.read().audioTracks![1]!.error, 'unreadable_file');
		const action = reports.flatMap((r) => r.events ?? []).find((e) => e.action?.key === `audio-track:v1:${track.id}`)!.action!;
		assert.equal(action.retry!.path, '/internal/audio-tracks/retry');
		assert.deepEqual(action.retry!.body, { videoId: 'v1', trackId: track.id });
		assert.deepEqual(await retryAudio(t.asEnv, undefined, 'v1', track.id), { retried: 'track' });
		assert.equal(t.read().audioTracks![1]!.status, 'processing');
		assert.equal(t.sent<AudioTrackJobMessage>('audio_track').length, 2);
		assert.deepEqual(await retryAudio(t.asEnv, undefined, 'v1', track.id), { retried: 'nothing' }, 'nothing failed any more');
	});

	it('a failed package flags the admin; a stale report changes nothing', async () => {
		const t = await setup();
		const track = await uploadedTrack(t);
		await prepared(t, track.id);
		const job = t.sent<AudioPackageJobMessage>('audio_package')[0]!;
		assert.deepEqual(await onPackageReport(t.asEnv, undefined, 'v1', { jobId: 'other-job-id', rev: 'r1', access: 'pub', ok: true, master: 'master_a1.m3u8', trackIds: [] }, NOW), { applied: false, why: 'stale job' });
		await onPackageReport(t.asEnv, undefined, 'v1', { jobId: job.jobId, rev: 'r1', access: 'pub', ok: false, error: 'bad_master', retryable: true }, NOW);
		assert.equal(t.read().audioPackage!.status, 'failed');
		assert.ok(reports.flatMap((r) => r.events ?? []).some((e) => e.action?.key === 'audio-package:v1'));
		assert.deepEqual(await retryAudio(t.asEnv, undefined, 'v1'), { retried: 'package' });
	});

	it('editing a label or the default repackages; deleting the last extra track drops the package and its files', async () => {
		const t = await setup();
		const track = await uploadedTrack(t);
		await prepared(t, track.id);
		await packaged(t);
		t.env.MEDIA.store.set('pub/v1/r1/master_a1.m3u8', '"m"');
		t.env.MEDIA.store.set(`pub/v1/r1/a/${track.id}/index.m3u8`, '"p"');
		t.env.MEDIA.store.set('pub/v1/r1/master.m3u8', '"rendition"');
		await updateTrack(t.asEnv, undefined, t.read(), track.id, { label: 'English (UK)' }, NOW);
		assert.equal(t.sent<AudioPackageJobMessage>('audio_package').at(-1)!.tracks[1]!.label, 'English (UK)');
		assert.equal(t.read().audioPackage!.master, 'master_a1.m3u8', 'the ready master keeps playing while the new one builds');
		await assert.rejects(deleteTrack(t.asEnv, undefined, t.read(), 'orig', NOW), (e: AudioTrackError) => e.code === 'cannot_delete_original');
		await deleteTrack(t.asEnv, undefined, t.read(), track.id, NOW);
		const v = t.read();
		assert.deepEqual(v.audioTracks, []);
		assert.equal(v.audioPackage, undefined);
		assert.equal(t.env.MEDIA.store.has('pub/v1/r1/master_a1.m3u8'), false);
		assert.equal(t.env.MEDIA.store.has(`pub/v1/r1/a/${track.id}/index.m3u8`), false);
		assert.equal(t.env.MEDIA.store.has('pub/v1/r1/master.m3u8'), true, 'the rendition itself stays');
		assert.equal([...t.env.MEDIA_ORIGINALS.objects.keys()].some((k) => k.includes(track.id)), false, 'the uploaded file is deleted');
	});

	it('Studio sees every track with its state and the allowance', async () => {
		const t = await setup();
		await uploadedTrack(t);
		const view = await studioView(t.asEnv, t.read() as never, 'alice');
		assert.deepEqual(view.tracks.map((x) => x.state), ['ready', 'processing']);
		assert.deepEqual(view.limit, { allowed: 2, used: 1, unlimited: false });
		assert.equal(view.ready, true);
	});
});

describe('review of a track (MA8)', () => {
	it('with review on, a prepared track is checked first, its review audio extracted, and it is not heard until cleared', async () => {
		const t = await setup({ review: 'enforce' });
		const track = await uploadedTrack(t);
		const job = t.sent<AudioTrackJobMessage>('audio_track')[0]!;
		assert.equal(job.reviewPrefix, `review/v1/audio-${track.id}-${job.jobId.slice(0, 8)}/`);
		await prepared(t, track.id);
		const stored = t.read().audioTracks![1]!;
		assert.equal(stored.status, 'ready');
		assert.ok(stored.review?.reviewId);
		const scan = t.env.MODERATION_QUEUE.sent[0] as { payload: { subject: string; trackId: string; manifestKey: string } };
		assert.equal(scan.payload.subject, 'audio_track');
		assert.equal(scan.payload.trackId, track.id);
		assert.equal(scan.payload.manifestKey, `${job.reviewPrefix}manifest.json`);
		assert.equal(t.sent('audio_package').length, 0, 'nothing to package while the track is checked');
		// A person approves it: it becomes audible and is packaged
		await applyAudioTrackOutcome(t.asEnv as never, 'v1', track.id, { reviewId: stored.review!.reviewId, mode: 'enforce', routing: { route: 'hold', reasons: [] } } as never);
		const decided = await applyAudioTrackDecision(t.asEnv as never, 'v1', track.id, { reviewId: stored.review!.reviewId, decision: 'approve', reviewerId: 'rev-1', decidedAt: new Date().toISOString() } as never);
		assert.ok(decided.applied, JSON.stringify(decided));
		assert.equal(t.sent<AudioPackageJobMessage>('audio_package').length, 1);
	});

	it('a track of a video under a takedown refuses every decision', async () => {
		const t = await setup({ review: 'enforce' });
		const track = await uploadedTrack(t, {});
		await prepared(t, track.id);
		const reviewId = t.read().audioTracks![1]!.review!.reviewId;
		await applyAudioTrackOutcome(t.asEnv as never, 'v1', track.id, { reviewId, mode: 'enforce', routing: { route: 'hold', reasons: [] } } as never);
		t.env.videos.store.set('v1', JSON.stringify({ ...t.read(), csamTakedown: { caseId: 'c1', at: 'x' } }));
		const was = t.read();
		for (const body of [{ decision: 'approve' }, { decision: 'reject', reasonCode: 'hate' }]) {
			const r = await applyAudioTrackDecision(t.asEnv as never, 'v1', track.id, { reviewId, reviewerId: 'rev-1', decidedAt: new Date().toISOString(), ...body } as never);
			assert.deepEqual(r, { applied: false, status: 409, why: 'not the current review' });
		}
		assert.deepEqual(t.read(), was);
		assert.equal(t.sent('audio_package').length, 0);
	});

	it('a rejected track leaves the package and gives the default back to the original', async () => {
		const t = await setup({ review: 'enforce' });
		const track = await uploadedTrack(t, { isDefault: true });
		await prepared(t, track.id);
		const reviewId = t.read().audioTracks![1]!.review!.reviewId;
		await applyAudioTrackOutcome(t.asEnv as never, 'v1', track.id, { reviewId, mode: 'enforce', routing: { route: 'hold', reasons: [] } } as never);
		await applyAudioTrackDecision(t.asEnv as never, 'v1', track.id, { reviewId, decision: 'approve', reviewerId: 'rev-1', decidedAt: new Date().toISOString() } as never);
		assert.equal(t.read().audioTracks![1]!.isDefault, true);
		await packaged(t);
		await applyAudioTrackDecision(t.asEnv as never, 'v1', track.id, { reviewId, decision: 'undo', reviewerId: 'rev-1', decidedAt: new Date().toISOString() } as never);
		const rejected = await applyAudioTrackDecision(t.asEnv as never, 'v1', track.id, { reviewId, decision: 'reject', reasonCode: 'hate', reviewerId: 'rev-1', decidedAt: new Date().toISOString() } as never);
		assert.ok(rejected.applied, JSON.stringify(rejected));
		const v = t.read();
		assert.equal(v.audioTracks![1]!.isDefault, false);
		assert.equal(v.audioTracks![0]!.isDefault, true);
		assert.equal(v.audioPackage, undefined, 'no extra track can be heard: the package is dropped');
		assert.deepEqual(audibleAudioTracks(v as never), []);
	});

	it('a track pulled out of a ready package stops playing at once, before the rebuild lands', async () => {
		const t = await setup({ review: 'enforce' });
		const approve = async (id: string) => {
			await prepared(t, id);
			const reviewId = t.read().audioTracks!.find((x) => x.id === id)!.review!.reviewId;
			await applyAudioTrackOutcome(t.asEnv as never, 'v1', id, { reviewId, mode: 'enforce', routing: { route: 'hold', reasons: [] } } as never);
			await applyAudioTrackDecision(t.asEnv as never, 'v1', id, { reviewId, decision: 'approve', reviewerId: 'rev-1', decidedAt: new Date().toISOString() } as never);
			return reviewId;
		};
		const en = await uploadedTrack(t);
		const ur = await uploadedTrack(t, { language: 'ur' });
		const enReview = await approve(en.id);
		await approve(ur.id);
		await packaged(t);
		const master = t.read().audioPackage!.master!;
		assert.equal(audioPackageMaster(t.read() as never), master);
		for (const id of [en.id, ur.id]) t.env.MEDIA.store.set(`pub/v1/r1/a/${id}/seg_00000.m4s`, 'x');
		await applyAudioTrackDecision(t.asEnv as never, 'v1', en.id, { reviewId: enReview, decision: 'undo', reviewerId: 'rev-1', decidedAt: new Date().toISOString() } as never);
		await applyAudioTrackDecision(t.asEnv as never, 'v1', en.id, { reviewId: enReview, decision: 'reject', reasonCode: 'hate', reviewerId: 'rev-1', decidedAt: new Date().toISOString() } as never);
		const v = t.read();
		assert.equal(v.audioPackage!.master, master, 'the old master is still recorded while the rebuild runs');
		assert.equal(audioPackageMaster(v as never), null, 'but it is no longer handed out');
		assert.deepEqual(audibleAudioTracks(v as never), []);
		assert.equal(t.env.MEDIA.store.has(`pub/v1/r1/a/${en.id}/seg_00000.m4s`), false, 'the rejected track’s files are gone');
		assert.equal(t.env.MEDIA.store.has(`pub/v1/r1/a/${ur.id}/seg_00000.m4s`), true);
		// The rebuild without it plays again
		await packaged(t);
		assert.deepEqual(audibleAudioTracks(t.read() as never).map((x) => x.id), ['orig', ur.id]);
	});

	it('a new name on a cleared track is checked again as text', async () => {
		const t = await setup({ review: 'enforce' });
		const track = await uploadedTrack(t);
		await prepared(t, track.id);
		const reviewId = t.read().audioTracks![1]!.review!.reviewId;
		// Renamed while the first check runs: no text-only result may finish that check, so the new
		// name is checked once the check has ended (and then it can only pull the track back)
		const queued = t.env.MODERATION_QUEUE.sent.length;
		await updateTrack(t.asEnv, undefined, t.read() as never, track.id, { label: 'While checking' }, NOW);
		assert.equal(t.env.MODERATION_QUEUE.sent.length, queued, 'nothing queued while the check runs');
		await applyAudioTrackOutcome(t.asEnv as never, 'v1', track.id, { reviewId, mode: 'enforce', routing: { route: 'approve', reasons: [] } } as never);
		assert.equal(t.read().audioTracks![1]!.review!.status, 'approved');
		assert.equal(t.env.MODERATION_QUEUE.sent.length, queued + 1, 'the name is checked once the check ended');
		const late = t.env.MODERATION_QUEUE.sent.at(-1) as { payload: { metadataText: string; trigger: string } };
		assert.equal(late.payload.trigger, 'metadata_edit');
		assert.match(late.payload.metadataText, /While checking/);
		assert.equal((t.read().audioTracks![1] as { labelCheckPending?: boolean }).labelCheckPending, undefined);
		const before = t.env.MODERATION_QUEUE.sent.length;
		await updateTrack(t.asEnv, undefined, t.read() as never, track.id, { kind: 'commentary' }, NOW);
		assert.equal(t.env.MODERATION_QUEUE.sent.length, before, 'no text changed: no new check');
		await updateTrack(t.asEnv, undefined, t.read() as never, track.id, { label: 'Another name' }, NOW);
		const scan = t.env.MODERATION_QUEUE.sent.at(-1) as { payload: { trigger: string; reviewId: string; metadataText: string; manifestKey?: string } };
		assert.equal(t.env.MODERATION_QUEUE.sent.length, before + 1);
		assert.equal(scan.payload.trigger, 'metadata_edit');
		assert.equal(scan.payload.reviewId, reviewId);
		assert.match(scan.payload.metadataText, /Another name/);
		assert.equal(scan.payload.manifestKey, undefined, 'text only');
		// A hit pulls it back to a person: it leaves the package
		await applyAudioTrackOutcome(t.asEnv as never, 'v1', track.id, { reviewId, mode: 'enforce', routing: { route: 'hold', escalate: true, reasons: [] } } as never);
		assert.equal(t.read().audioTracks![1]!.review!.status, 'in_review');
	});
});
