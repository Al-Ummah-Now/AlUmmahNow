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

describe('api-videos audio-only extraction (E14-S2)', () => {
	const videoId = '0b3c2a1e-1111-2222-3333-444455556666';
	const rev = 'abcdefgh12345678';

	it('queues audio_extract for a ready R2 video missing audio.m4a and skips silent or existing audio', async () => {
		const sent: unknown[] = [];
		const queue = { async send(msg: unknown) { sent.push(msg); } } as unknown as Queue;

		const readyVideo = {
			id: videoId,
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

		const queued = await enqueueAudioExtract({ TRANSCODE_QUEUE: queue }, readyVideo);
		assert.equal(queued.queued, true);
		assert.equal(sent.length, 1);
		assert.equal((sent[0] as { kind: string }).kind, 'audio_extract');

		const silent = await enqueueAudioExtract({ TRANSCODE_QUEUE: queue }, {
			...readyVideo,
			r2: { ...readyVideo.r2, result: { ...readyVideo.r2.result, source: { ...readyVideo.r2.result.source, hasAudio: false } } },
		});
		assert.equal(silent.queued, false);
		assert.equal(silent.why, 'no audio stream');

		const already = await enqueueAudioExtract({ TRANSCODE_QUEUE: queue }, {
			...readyVideo,
			r2: { ...readyVideo.r2, result: { ...readyVideo.r2.result, audio: { file: 'audio.m4a', rung: '480p', bytes: 1_900_000 } } },
		});
		assert.equal(already.queued, false);
		assert.equal(already.why, 'already has audio');
	});

	it('applies audio-extract ready events only for matching rev/access and never overwrites', async () => {
		const { bucket, store } = mockVideosBucket({
			[videoId]: {
				id: videoId,
				isPublic: true,
				r2: {
					status: 'ready',
					jobId: 'j1',
					rev,
					access: 'pub',
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
			},
		});

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
