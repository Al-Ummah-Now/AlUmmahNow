import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { applyAudioExtractEvent, enqueueAudioExtract, publicAudioUrl } from '../src/lib/media/r2-delivery';

function mockVideosBucket(initial: Record<string, unknown>) {
	const store = new Map<string, { raw: string; etag: string }>(
		Object.entries(initial).map(([k, v]) => [k, { raw: JSON.stringify(v), etag: 'etag-1' }]),
	);
	let seq = 1;
	return {
		store,
		bucket: {
			async get(key: string) {
				const entry = store.get(key);
				if (!entry) return null;
				return {
					etag: entry.etag,
					httpEtag: `"${entry.etag}"`,
					async text() {
						return entry.raw;
					},
					async json() {
						return JSON.parse(entry.raw);
					},
				};
			},
			async put(key: string, value: string, opts?: { onlyIf?: { etagMatches?: string } }) {
				const cur = store.get(key);
				if (opts?.onlyIf?.etagMatches && cur?.etag !== opts.onlyIf.etagMatches) return null;
				seq += 1;
				const etag = `etag-${seq}`;
				const raw = typeof value === 'string' ? value : String(value);
				store.set(key, { raw, etag });
				return { key, etag, httpEtag: `"${etag}"` };
			},
		} as unknown as R2Bucket,
	};
}

function makeReadyVideo(videoId: string, rev: string) {
	return {
		id: videoId,
		isPublic: true,
		r2: {
			status: 'ready' as const,
			jobId: 'j1',
			rev,
			access: 'pub' as const,
			attempts: 1,
			queuedAt: '2026-11-23T00:00:00.000Z',
			result: {
				rungs: [{ name: '480p', width: 854, height: 480, maxrate: 1_400_000 }],
				objects: 10,
				bytes: 5_000_000,
				durationSeconds: 120,
				source: { width: 1280, height: 720, durationSeconds: 120, bytes: 10_000_000, hasAudio: true },
				timings: { downloadMs: 10, transcodeMs: 20, uploadMs: 10, totalMs: 40 },
				thumbnail: 'thumb.jpg',
			},
		},
	};
}

describe('api-videos audio-only extraction (E14-S2)', () => {
	const videoId = '0b3c2a1e-1111-2222-3333-444455556666';
	const silentId = '0b3c2a1e-1111-2222-3333-444455557777';
	const existingId = '0b3c2a1e-1111-2222-3333-444455558888';
	const rev = 'abcdefgh12345678';

	it('queues audio_extract idempotently with an in-flight TTL guard and skips silent or existing audio', async () => {
		const sent: unknown[] = [];
		const queue = { async send(msg: unknown) { sent.push(msg); } } as unknown as Queue;
		const readyVideo = makeReadyVideo(videoId, rev);
		const silentVideo = {
			...makeReadyVideo(silentId, rev),
			r2: { ...readyVideo.r2, result: { ...readyVideo.r2.result, source: { ...readyVideo.r2.result.source, hasAudio: false } } },
		};
		const withAudioVideo = {
			...makeReadyVideo(existingId, rev),
			r2: { ...readyVideo.r2, result: { ...readyVideo.r2.result, audio: { file: 'audio.m4a', rung: '480p', bytes: 1_900_000 } } },
		};
		const { bucket, store } = mockVideosBucket({
			[videoId]: readyVideo,
			[silentId]: silentVideo,
			[existingId]: withAudioVideo,
		});

		const t0 = new Date('2026-11-23T12:00:00.000Z');
		const queued = await enqueueAudioExtract({ TRANSCODE_QUEUE: queue, videos: bucket }, readyVideo, { now: t0 });
		assert.equal(queued.queued, true);
		assert.equal(sent.length, 1);
		assert.equal((sent[0] as { kind: string }).kind, 'audio_extract');
		const storedAfterQueue = JSON.parse(store.get(videoId)!.raw);
		assert.equal(storedAfterQueue.r2.audioExtract.status, 'queued');
		assert.equal(storedAfterQueue.r2.audioExtract.jobId, queued.jobId);

		// Immediate second call while in-flight TTL is fresh must NOT queue a duplicate container job.
		const dup = await enqueueAudioExtract({ TRANSCODE_QUEUE: queue, videos: bucket }, readyVideo, {
			now: new Date(t0.getTime() + 5 * 60_000),
		});
		assert.equal(dup.queued, false);
		assert.equal(dup.why, 'already queued');
		assert.equal(sent.length, 1);

		// Once TTL expires (31 min later), a stale queued marker allows re-enqueue.
		const requeued = await enqueueAudioExtract({ TRANSCODE_QUEUE: queue, videos: bucket }, readyVideo, {
			now: new Date(t0.getTime() + 31 * 60_000),
		});
		assert.equal(requeued.queued, true);
		assert.equal(sent.length, 2);

		const silent = await enqueueAudioExtract({ TRANSCODE_QUEUE: queue, videos: bucket }, silentVideo, { now: t0 });
		assert.equal(silent.queued, false);
		assert.equal(silent.why, 'no audio stream');

		const already = await enqueueAudioExtract({ TRANSCODE_QUEUE: queue, videos: bucket }, withAudioVideo, { now: t0 });
		assert.equal(already.queued, false);
		assert.equal(already.why, 'already has audio');
	});

	it('reports permanent audio-extract failures to Admin Errors (O26), backs off retries, and resolves on success', async () => {
		const sent: unknown[] = [];
		const queue = { async send(msg: unknown) { sent.push(msg); } } as unknown as Queue;
		const readyVideo = makeReadyVideo(videoId, rev);
		const { bucket, store } = mockVideosBucket({ [videoId]: readyVideo });

		const errorCalls: Array<{ url: string; body: unknown }> = [];
		const origFetch = globalThis.fetch;
		globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
			const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
			const body = init?.body ? JSON.parse(String(init.body)) : null;
			errorCalls.push({ url, body });
			return new Response(JSON.stringify({ ok: true }), { status: 200 });
		}) as typeof fetch;
		const pending: Promise<unknown>[] = [];
		const ctx = {
			waitUntil(p: Promise<unknown>) {
				pending.push(p);
			},
		};
		const errorEnv = {
			videos: bucket,
			ERRORS_INGEST_URL: 'https://admin.api.test/internal/errors',
			INTERNAL_API_KEY: 'test-secret',
		};

		try {
			const failed = await applyAudioExtractEvent(
				errorEnv,
				{
					videoId,
					jobId: 'j-fail',
					rev,
					access: 'pub',
					type: 'failed',
					at: '2026-11-23T12:10:00.000Z',
					error: 'ffmpeg exited 1',
				},
				ctx,
			);
			await Promise.all(pending);
			assert.equal(failed.applied, false);
			assert.equal(failed.why, 'failed');
			assert.equal(errorCalls.length, 1);
			assert.match(errorCalls[0]!.url, /errors/);
			const firstEvent = (errorCalls[0]!.body as { events?: Array<{ action?: { key?: string } }> }).events?.[0];
			assert.equal(firstEvent?.action?.key, `media:audio-extract:${videoId}`);

			// Failed marker backs off automatic re-enqueue while fresh.
			const backedOff = await enqueueAudioExtract({ TRANSCODE_QUEUE: queue, videos: bucket }, readyVideo, {
				now: new Date('2026-11-23T12:20:00.000Z'),
			});
			assert.equal(backedOff.queued, false);
			assert.equal(backedOff.why, 'recently failed');
			assert.equal(sent.length, 0);

			// Explicit admin retry (`force: true`) bypasses backoff.
			const forced = await enqueueAudioExtract({ TRANSCODE_QUEUE: queue, videos: bucket }, readyVideo, {
				now: new Date('2026-11-23T12:20:00.000Z'),
				force: true,
			});
			assert.equal(forced.queued, true);
			assert.equal(sent.length, 1);

			// Ready event clears audioExtract marker, stores audio, and resolves the Errors page item.
			pending.length = 0;
			const ok = await applyAudioExtractEvent(
				errorEnv,
				{
					videoId,
					jobId: forced.jobId!,
					rev,
					access: 'pub',
					type: 'ready',
					at: '2026-11-23T12:25:00.000Z',
					audio: { file: 'audio.m4a', rung: '480p', bytes: 1_900_000, bitrate: 128_000 },
				},
				ctx,
			);
			await Promise.all(pending);
			assert.equal(ok.applied, true);
			const stored = JSON.parse(store.get(videoId)!.raw);
			assert.equal(stored.r2.audioExtract, undefined);
			assert.deepEqual(stored.r2.result.audio, { file: 'audio.m4a', rung: '480p', bytes: 1_900_000, bitrate: 128_000 });
			assert.equal(errorCalls.length, 2);
		} finally {
			globalThis.fetch = origFetch;
		}
	});

	it('applies audio-extract ready events only for matching rev/access and never overwrites', async () => {
		const { bucket, store } = mockVideosBucket({ [videoId]: makeReadyVideo(videoId, rev) });

		const stale = await applyAudioExtractEvent({ videos: bucket }, {
			videoId,
			jobId: 'j-audio',
			rev: '0000000000000000',
			access: 'pub',
			type: 'ready',
			at: '2026-11-23T00:01:00.000Z',
			audio: { file: 'audio.m4a', rung: '480p', bytes: 1_900_000, bitrate: 128_000 },
		});
		assert.equal(stale.applied, false);
		assert.equal(stale.why, 'stale rendition');

		const ok = await applyAudioExtractEvent({ videos: bucket }, {
			videoId,
			jobId: 'j-audio',
			rev,
			access: 'pub',
			type: 'ready',
			at: '2026-11-23T00:01:00.000Z',
			audio: { file: 'audio.m4a', rung: '480p', bytes: 1_900_000, bitrate: 128_000 },
		});
		assert.equal(ok.applied, true);

		const stored = JSON.parse(store.get(videoId)!.raw);
		assert.deepEqual(stored.r2.result.audio, { file: 'audio.m4a', rung: '480p', bytes: 1_900_000, bitrate: 128_000 });
		assert.equal(publicAudioUrl({ MEDIA_PUBLIC_HOST: 'media.alummahnow.net' }, stored), `https://media.alummahnow.net/pub/${videoId}/${rev}/audio.m4a`);

		const dup = await applyAudioExtractEvent({ videos: bucket }, {
			videoId,
			jobId: 'j-audio-2',
			rev,
			access: 'pub',
			type: 'ready',
			at: '2026-11-23T00:02:00.000Z',
			audio: { file: 'audio.m4a', rung: '360p', bytes: 1_200_000 },
		});
		assert.equal(dup.applied, false);
		assert.equal(dup.why, 'already has audio');
	});
});
