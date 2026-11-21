/**
 * D10: desktop Studio's on-device transcript becomes a caption draft through the same queued
 * Quran-matcher job as the review transcript. No AI runs here and no caption minutes are used.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { MessageType, ON_DEVICE_TRANSCRIPT_LIMITS, captionClaimKey, captionDraftKey, onDeviceTranscriptKey, validateOnDeviceTranscript } from '@al-ummah/shared-types';
import { OnDeviceTranscriptSubmit } from '../src/endpoints/captions/captionDrafts';
import { MemoryBucket, MemoryQueue, buildApp, videoFixture } from './helpers';

function env(opts: { draft?: boolean } = {}) {
	const subtitles = new MemoryBucket();
	if (opts.draft) subtitles.store.set(captionDraftKey('v1', 'ar'), JSON.stringify({ v: 1, videoId: 'v1', language: 'ar', version: 2, cues: [] }));
	return { MEDIA_PRIVATE: new MemoryBucket(), subtitles, videos: new MemoryBucket({ v1: videoFixture({}) }), queue: new MemoryQueue() };
}

const app = (userId = 'owner') => buildApp((r) => r.post('/api/videos/:videoId/captions/drafts/:language/transcript', OnDeviceTranscriptSubmit), { userId });
const submit = (e: ReturnType<typeof env>, body: unknown, opts: { userId?: string; language?: string } = {}) =>
	app(opts.userId).request(
		`/api/videos/v1/captions/drafts/${opts.language ?? 'ar'}/transcript`,
		{ method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) },
		e as never,
	);

const SEGMENTS = [
	{ startMs: 0, endMs: 2400.4, text: '  بسم الله   الرحمن الرحيم ' },
	{ startMs: 2400, endMs: 5000, text: 'الحمد لله رب العالمين' },
];
const ENGINE = { provider: 'whisper.cpp', model: 'large-v3-turbo-q5_0' };

describe('on-device transcript → caption draft', () => {
	it('stores the normalised transcript beside the video and queues the claim job', async () => {
		const e = env();
		const res = await submit(e, { segments: SEGMENTS, engine: ENGINE });
		assert.equal(res.status, 202);
		assert.deepEqual(((await res.json()) as any).data, { status: 'queued', segments: 2 });
		const stored = e.subtitles.read(onDeviceTranscriptKey('v1', 'ar'));
		assert.deepEqual(stored.segments[0], { startMs: 0, endMs: 2400, text: 'بسم الله الرحمن الرحيم' });
		assert.equal(e.queue.messages.length, 1);
		const msg = e.queue.messages[0];
		assert.equal(msg.type, MessageType.CaptionClaimTranscript);
		assert.deepEqual(
			{ ...msg.payload, requestedAt: 'x' },
			{ videoId: 'v1', language: 'ar', transcriptKey: 'v1/on-device/ar.json', source: 'on_device', engine: ENGINE, requestedBy: 'owner', requestedAt: 'x' },
		);
		assert.equal(e.subtitles.read(captionClaimKey('v1', 'ar')).status, 'queued');

		const again = await submit(e, { segments: SEGMENTS, engine: ENGINE });
		assert.deepEqual([again.status, ((await again.json()) as any).error], [409, 'claim_pending']);
	});

	it('keeps an existing draft unless replace is set', async () => {
		const kept = await submit(env({ draft: true }), { segments: SEGMENTS, engine: ENGINE });
		assert.deepEqual([kept.status, ((await kept.json()) as any).error], [409, 'draft_exists']);
		const e = env({ draft: true });
		assert.equal((await submit(e, { segments: SEGMENTS, engine: ENGINE, replace: true })).status, 202);
		assert.equal(e.queue.messages[0].payload.replace, true);
	});

	it('owner or channel editor only; supported language; sane engine names', async () => {
		assert.equal((await submit(env(), { segments: SEGMENTS, engine: ENGINE }, { userId: 'stranger' })).status, 403);
		assert.equal((await submit(env(), { segments: SEGMENTS, engine: ENGINE }, { language: 'xx' })).status, 400);
		const bad = await submit(env(), { segments: SEGMENTS, engine: { provider: '../evil' } });
		assert.deepEqual([bad.status, ((await bad.json()) as any).reason], [400, 'engine']);
	});

	it('refuses broken transcripts and says which segment', async () => {
		const cases: Array<[unknown, string, number | undefined]> = [
			[[], 'empty', undefined],
			[[{ startMs: 1000, endMs: 900, text: 'a' }], 'invalid_segment', 0],
			[[{ startMs: 0, endMs: 900, text: 'a' }, { startMs: -5, endMs: 10, text: 'b' }], 'invalid_segment', 1],
			[[{ startMs: 500, endMs: 900, text: 'a' }, { startMs: 100, endMs: 1000, text: 'b' }], 'invalid_segment', 1],
			[[{ startMs: 0, endMs: 10, text: '   ' }], 'empty', undefined],
		];
		for (const [segments, reason, segment] of cases) {
			const e = env();
			const res = await submit(e, { segments, engine: ENGINE });
			const body = (await res.json()) as any;
			assert.equal(res.status, 400, JSON.stringify(segments));
			assert.equal(body.reason, reason);
			assert.equal(body.segment, segment);
			assert.equal(e.queue.messages.length, 0);
		}
	});

	it('limits: segment count, segment length, total length, 24 hours', () => {
		const L = ON_DEVICE_TRANSCRIPT_LIMITS;
		const many = Array.from({ length: L.maxSegments + 1 }, (_, i) => ({ startMs: i, endMs: i + 1, text: 'a' }));
		assert.deepEqual(validateOnDeviceTranscript(many), { ok: false, error: 'too_many_segments' });
		assert.equal((validateOnDeviceTranscript([{ startMs: 0, endMs: 1, text: 'x'.repeat(L.maxSegmentChars + 1) }]) as any).error, 'invalid_segment');
		assert.equal((validateOnDeviceTranscript([{ startMs: 0, endMs: L.maxEndMs + 1, text: 'a' }]) as any).error, 'invalid_segment');
		const long = Array.from({ length: 1001 }, (_, i) => ({ startMs: i * 10, endMs: i * 10 + 5, text: 'x'.repeat(L.maxSegmentChars) }));
		assert.deepEqual(validateOnDeviceTranscript(long), { ok: false, error: 'too_long' });
	});

	it('a span matched on the device is a reference with no words (QF terms)', () => {
		const ok = validateOnDeviceTranscript([
			{ startMs: 0, endMs: 1000, text: 'قال الشيخ' },
			{ startMs: 1000, endMs: 4000, quran: { range: '112:1:1-112:4:5', status: 'confirmed', alternatives: ['112:1:1-112:4:5', '2:255:1-2:255:3'] } },
			{ startMs: 4000, endMs: 5000, quran: { range: '1:1:1-1:1:4' } },
		]) as any;
		assert.equal(ok.ok, true);
		assert.deepEqual(ok.segments[1], { startMs: 1000, endMs: 4000, text: '', quran: { range: '112:1:1-112:4:5', status: 'confirmed', alternatives: ['2:255:1-2:255:3'] } });
		assert.deepEqual(ok.segments[2].quran, { range: '1:1:1-1:1:4', status: 'review' });
		// The words of a span never come with it, a bad reference or a creator's "accepted" is refused
		const bad = (quran: unknown, text?: string) => (validateOnDeviceTranscript([{ startMs: 0, endMs: 1000, quran, ...(text === undefined ? {} : { text }) }]) as any).error;
		assert.equal(bad({ range: '112:1:1-112:4:5' }, 'قل هو الله احد'), 'invalid_segment');
		assert.equal(bad({ range: 'not-a-range' }), 'invalid_segment');
		assert.equal(bad({ range: '112:1:1-112:4:5', status: 'accepted' }), 'invalid_segment');
		assert.equal(bad({ range: '112:1:1-112:4:5', alternatives: ['x'] }), 'invalid_segment');
	});
});
