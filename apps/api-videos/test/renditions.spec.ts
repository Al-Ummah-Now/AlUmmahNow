/**
 * D11: renditions pre-encoded in desktop Studio. Staged in MEDIA_PRIVATE, handed to the first
 * transcode as `prebuilt`, verified there (apps/media), and cleaned up whatever happens.
 */
import { beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { PREBUILT_LIMITS, prebuiltStagingPrefix, type TranscodeJobMessage, type TranscodeResult } from '@al-ummah/shared-types';
import { RenditionFilePut, RenditionsCancel, RenditionsComplete, RenditionsCreate } from '../src/endpoints/video/renditions';
import { checkPlan, manifestKey, sweepStaging } from '../src/lib/media/prebuilt';
import { applyJobEvent, clearDeliverySettingsCache, enqueueTranscode, withPrebuiltOutcome } from '../src/lib/media/r2-delivery';
import { MemoryBucket, MemoryQueue, buildApp, videoFixture } from './helpers';

const ID = '912859ed-e618-4d04-8438-874a74a251dd';

/** MEDIA_PRIVATE fake: any body, sizes in listings like R2. */
class StagingBucket {
	store = new Map<string, { body: unknown; size: number; uploaded: Date }>();
	async get(key: string) {
		const v = this.store.get(key);
		return v ? { key, size: v.size, body: v.body, json: async () => JSON.parse(String(v.body)) } : null;
	}
	async put(key: string, value: unknown) {
		const size = typeof value === 'string' ? value.length : (value as ArrayBuffer).byteLength;
		this.store.set(key, { body: value, size, uploaded: new Date() });
		return { key };
	}
	async delete(keys: string | string[]) {
		for (const k of Array.isArray(keys) ? keys : [keys]) this.store.delete(k);
	}
	async list(opts: { prefix?: string; cursor?: string; limit?: number } = {}) {
		const keys = [...this.store.keys()].filter((k) => !opts.prefix || k.startsWith(opts.prefix)).sort().filter((k) => !opts.cursor || k > opts.cursor);
		const limit = opts.limit ?? 1000;
		const page = keys.slice(0, limit);
		return { objects: page.map((key) => ({ key, size: this.store.get(key)!.size, uploaded: this.store.get(key)!.uploaded })), truncated: keys.length > limit, cursor: keys.length > limit ? page[page.length - 1] : undefined };
	}
}

function env(video: Record<string, unknown> = {}) {
	clearDeliverySettingsCache();
	return {
		videos: new MemoryBucket({ [ID]: videoFixture({ id: ID, uploadStatus: 'uploading', ...video }) }),
		global_settings: new MemoryBucket(),
		MEDIA: new StagingBucket(),
		MEDIA_PRIVATE: new StagingBucket(),
		TRANSCODE_QUEUE: new MemoryQueue(),
		PROCESSING_CHECK_QUEUE: new MemoryQueue(),
		MEDIA_SIGN_KEY: 'k',
		MEDIA_PUBLIC_HOST: 'media.qa.alummahnow.net',
	};
}

const app = (userId = 'owner') =>
	buildApp((r) => {
		r.post('/api/videos/:videoId/renditions', RenditionsCreate);
		r.put('/api/videos/:videoId/renditions/:stagingId/files/:rung/:file', RenditionFilePut);
		r.post('/api/videos/:videoId/renditions/:stagingId/complete', RenditionsComplete);
		r.delete('/api/videos/:videoId/renditions/:stagingId', RenditionsCancel);
	}, { userId });
const json = (body: unknown) => ({ method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

const FILES = [
	{ path: '360p/index.m3u8', bytes: 4 },
	{ path: '360p/init.mp4', bytes: 3 },
	{ path: '360p/seg_00001.m4s', bytes: 5 },
];
const PLAN = { rungs: ['360p'], files: FILES, encoder: 'Media Foundation (NVENC)' };

async function stage(e: ReturnType<typeof env>, user = 'owner') {
	const res = await app(user).request(`/api/videos/${ID}/renditions`, json(PLAN), e as never);
	return { res, body: (await res.json()) as any };
}
const put = (e: ReturnType<typeof env>, id: string, path: string, bytes: number) =>
	app().request(`/api/videos/${ID}/renditions/${id}/files/${path}`, { method: 'PUT', body: new Uint8Array(bytes) }, e as never);

describe('staging pre-encoded renditions', () => {
	beforeEach(() => clearDeliverySettingsCache());

	it('stages, takes each declared file at its size, completes, and the first transcode carries it', async () => {
		const e = env();
		const { res, body } = await stage(e);
		assert.equal(res.status, 201);
		const id = body.data.stagingId;
		assert.match(id, /^[a-f0-9]{16}$/);
		assert.deepEqual({ ...body.data, stagingId: 'x', createdAt: 'x' }, { stagingId: 'x', status: 'uploading', rungs: ['360p'], files: 3, bytes: 12, createdAt: 'x', encoder: 'Media Foundation (NVENC)', maxFileBytes: PREBUILT_LIMITS.maxFileBytes });
		assert.ok(e.MEDIA_PRIVATE.store.has(manifestKey(ID, id)));

		// Not yet complete
		const early = await app().request(`/api/videos/${ID}/renditions/${id}/complete`, { method: 'POST' }, e as never);
		assert.equal(early.status, 409);
		assert.deepEqual(((await early.json()) as any).missing, FILES.map((f) => f.path));

		assert.equal((await put(e, id, '360p/index.m3u8', 3)).status, 400); // wrong size
		assert.equal((await put(e, id, '360p/other.m4s', 3)).status, 400); // not declared
		for (const f of FILES) assert.equal((await put(e, id, f.path, f.bytes)).status, 204);
		assert.ok(e.MEDIA_PRIVATE.store.has(`${prebuiltStagingPrefix(ID, id)}360p/seg_00001.m4s`));

		const done = await app().request(`/api/videos/${ID}/renditions/${id}/complete`, { method: 'POST' }, e as never);
		assert.equal(done.status, 200);
		assert.equal(e.videos.read(ID).prebuilt.status, 'ready');
		assert.equal((await put(e, id, '360p/init.mp4', 3)).status, 409);

		assert.equal((await enqueueTranscode(e as never, ID, 'upload')).queued, true);
		const job = e.TRANSCODE_QUEUE.messages[0] as TranscodeJobMessage;
		assert.deepEqual(job.prebuilt, { stagingId: id, rungs: ['360p'] });
		assert.equal(e.videos.read(ID).prebuilt.status, 'queued');

		// Too late for another one now
		assert.equal((await stage(e)).res.status, 409);

		// The job ends: the video forgets the staging; the outcome is on the result
		const result: TranscodeResult = {
			rungs: [{ name: '360p', width: 640, height: 360, maxrate: 800000, bytes: 10, segments: 1 }],
			objects: 4,
			bytes: 10,
			durationSeconds: 6,
			source: { width: 640, height: 360, durationSeconds: 6, bytes: 100, hasAudio: true },
			timings: { downloadMs: 1, transcodeMs: 0, uploadMs: 1, totalMs: 2 },
			thumbnail: 'thumb.jpg',
			prebuilt: { used: true },
		};
		await applyJobEvent(e as never, undefined, { videoId: ID, jobId: job.jobId, type: 'ready', at: new Date().toISOString(), attempt: 1, result });
		const after = e.videos.read(ID);
		assert.equal(after.prebuilt, undefined);
		assert.deepEqual(after.r2.result.prebuilt, { used: true });
	});

	it('a retry or admin re-transcode never carries staged renditions', async () => {
		const e = env({ prebuilt: { stagingId: '0123456789abcdef', status: 'ready', rungs: ['360p'], files: 3, bytes: 12, createdAt: new Date().toISOString() } });
		await enqueueTranscode(e as never, ID, 'retry');
		assert.equal((e.TRANSCODE_QUEUE.messages[0] as TranscodeJobMessage)?.prebuilt, undefined);
	});

	it('an unfinished or stale staging is not handed over', async () => {
		for (const prebuilt of [
			{ stagingId: '0123456789abcdef', status: 'uploading', rungs: ['360p'], files: 3, bytes: 12, createdAt: new Date().toISOString() },
			{ stagingId: '0123456789abcdef', status: 'ready', rungs: ['360p'], files: 3, bytes: 12, createdAt: new Date(Date.now() - PREBUILT_LIMITS.staleAfterMs - 1000).toISOString() },
		]) {
			const e = env({ prebuilt });
			await enqueueTranscode(e as never, ID, 'upload');
			assert.equal((e.TRANSCODE_QUEUE.messages[0] as TranscodeJobMessage)?.prebuilt, undefined);
		}
	});

	it('only the owner or an uploader; never once the server transcode started', async () => {
		assert.equal((await stage(env(), 'stranger')).res.status, 403);
		assert.equal((await stage(env({ r2: { status: 'transcoding', jobId: 'j', rev: 'abcdefgh12345678', access: 'priv', attempts: 1, queuedAt: 'x' } }))).res.status, 409);
	});

	it('a new staging replaces an unfinished one; cancel deletes the files', async () => {
		const e = env();
		const first = (await stage(e)).body.data.stagingId;
		await put(e, first, '360p/init.mp4', 3);
		const second = (await stage(e)).body.data.stagingId;
		assert.notEqual(first, second);
		assert.equal([...e.MEDIA_PRIVATE.store.keys()].some((k) => k.includes(first)), false);
		assert.equal((await put(e, first, '360p/init.mp4', 3)).status, 404);
		const del = await app().request(`/api/videos/${ID}/renditions/${second}`, { method: 'DELETE' }, e as never);
		assert.equal(del.status, 200);
		assert.equal(e.videos.read(ID).prebuilt, undefined);
		assert.equal(e.MEDIA_PRIVATE.store.size, 0);
	});
});

describe('plan checks', () => {
	it('known rungs, a playlist per rung, safe paths, sizes within limits', () => {
		assert.equal(checkPlan(PLAN).ok, true);
		assert.equal((checkPlan({ ...PLAN, rungs: ['4k'] }) as any).error, 'invalid_rungs');
		assert.equal((checkPlan({ ...PLAN, rungs: ['360p', '360p'] }) as any).error, 'invalid_rungs');
		assert.equal((checkPlan({ ...PLAN, files: FILES.slice(1) }) as any).detail, '360p/index.m3u8');
		assert.equal((checkPlan({ ...PLAN, files: [...FILES, { path: '360p/../x', bytes: 1 }] }) as any).error, 'invalid_files');
		assert.equal((checkPlan({ ...PLAN, files: [...FILES, { path: '720p/init.mp4', bytes: 1 }] }) as any).error, 'invalid_files');
		assert.equal((checkPlan({ ...PLAN, files: [...FILES, { path: '360p/big.m4s', bytes: PREBUILT_LIMITS.maxFileBytes + 1 }] }) as any).error, 'invalid_files');
		assert.equal((checkPlan({ ...PLAN, encoder: '<script>' }) as any).error, 'invalid_encoder');
	});

	it('the result keeps only a known rejection reason', () => {
		const base = { rungs: [], objects: 0, bytes: 0, durationSeconds: 0, source: { width: 1, height: 1, durationSeconds: 0, bytes: 0, hasAudio: false }, timings: { downloadMs: 0, transcodeMs: 0, uploadMs: 0, totalMs: 0 }, thumbnail: 't' };
		assert.deepEqual(withPrebuiltOutcome({ ...base, prebuilt: { used: false, reason: 'size', rung: '720p' } } as never).prebuilt, { used: false, reason: 'size', rung: '720p' });
		assert.deepEqual(withPrebuiltOutcome({ ...base, prebuilt: { used: false, reason: 'rm -rf' } } as never).prebuilt, { used: false, reason: 'error' });
		assert.equal(withPrebuiltOutcome(base as never).prebuilt, undefined);
	});
});

describe('staging sweep', () => {
	it('deletes old staged uploads nobody uses, keeps current ones and queued ones for a week', async () => {
		const e = env();
		const old = new Date(Date.now() - PREBUILT_LIMITS.staleAfterMs - 60_000);
		const add = async (id: string) => {
			await e.MEDIA_PRIVATE.put(manifestKey(ID, id), '{}');
			await e.MEDIA_PRIVATE.put(`${prebuiltStagingPrefix(ID, id)}360p/init.mp4`, 'abc');
			for (const k of e.MEDIA_PRIVATE.store.keys()) if (k.includes(id)) e.MEDIA_PRIVATE.store.get(k)!.uploaded = old;
		};
		await add('aaaaaaaaaaaaaaaa'); // orphan: the video points elsewhere
		await add('bbbbbbbbbbbbbbbb'); // queued to a job 2 days ago: kept
		const v = e.videos.read(ID);
		v.prebuilt = { stagingId: 'bbbbbbbbbbbbbbbb', status: 'queued', rungs: ['360p'], files: 1, bytes: 3, createdAt: old.toISOString() };
		await e.videos.put(ID, JSON.stringify(v));
		const r = await sweepStaging(e as never);
		assert.equal(r.deleted, 2);
		assert.equal([...e.MEDIA_PRIVATE.store.keys()].some((k) => k.includes('aaaa')), false);
		assert.equal([...e.MEDIA_PRIVATE.store.keys()].some((k) => k.includes('bbbb')), true);
		// Past a week the queued one goes too, and the video forgets it
		const r2 = await sweepStaging(e as never, Date.now() + 8 * 24 * 3600 * 1000);
		assert.equal(r2.deleted, 2);
		assert.equal(e.videos.read(ID).prebuilt, undefined);
	});
});
