/**
 * Claiming the review transcript as a caption draft (VR11, #1296): opt-in, owner or video.edit,
 * queued for the processor (which builds the draft with the Quran matcher). No AI, no QF.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { MessageType, captionClaimKey, captionDraftKey } from '@al-ummah/shared-types';
import { CaptionDraftsList, ReviewTranscriptClaim } from '../src/endpoints/captions/captionDrafts';
import { MemoryBucket, MemoryQueue, buildApp, videoFixture } from './helpers';

const MANIFEST = 'review/v1/r1/manifest.json';
const TRANSCRIPT = 'review/v1/r1/transcript.json';

function env(opts: { transcript?: boolean; draft?: boolean; review?: boolean } = {}) {
	const MEDIA_PRIVATE = new MemoryBucket();
	if (opts.transcript !== false) MEDIA_PRIVATE.store.set(TRANSCRIPT, JSON.stringify({ videoId: 'v1', segments: [{ startMs: 0, endMs: 1000, text: 'x' }] }));
	const subtitles = new MemoryBucket();
	if (opts.draft) subtitles.store.set(captionDraftKey('v1', 'ar'), JSON.stringify({ v: 1, videoId: 'v1', language: 'ar', version: 2, cues: [] }));
	const video = videoFixture(opts.review === false ? {} : { review: { status: 'approved', reviewId: 'r1', timing: 'pre', since: 'x', manifestKey: MANIFEST } });
	return { MEDIA_PRIVATE, subtitles, videos: new MemoryBucket({ v1: video }), queue: new MemoryQueue() };
}

const app = (userId = 'owner') =>
	buildApp((r) => {
		r.get('/api/videos/:videoId/captions/drafts', CaptionDraftsList);
		r.post('/api/videos/:videoId/review/transcript/claim', ReviewTranscriptClaim);
	}, { userId });
const claim = (e: ReturnType<typeof env>, body: unknown, userId?: string) =>
	app(userId).request('/api/videos/v1/review/transcript/claim', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }, e as never);

describe('claim the review transcript', () => {
	it('queues the job with the transcript of this video and records the claim', async () => {
		const e = env();
		const res = await claim(e, { language: 'ar' });
		assert.equal(res.status, 202);
		assert.equal(e.queue.messages.length, 1);
		const msg = e.queue.messages[0];
		assert.equal(msg.type, MessageType.CaptionClaimTranscript);
		assert.deepEqual({ ...msg.payload, requestedAt: 'x' }, { videoId: 'v1', language: 'ar', transcriptKey: TRANSCRIPT, requestedBy: 'owner', requestedAt: 'x' });
		assert.equal(e.subtitles.read(captionClaimKey('v1', 'ar')).status, 'queued');

		const list = (await (await app().request('/api/videos/v1/captions/drafts', {}, e as never)).json()) as any;
		assert.equal(list.data.transcriptAvailable, true);
		assert.deepEqual(list.data.claims.map((c: any) => [c.language, c.status]), [['ar', 'queued']]);

		const again = await claim(e, { language: 'ar' });
		assert.deepEqual([again.status, ((await again.json()) as any).error], [409, 'claim_pending']);
		assert.equal(e.queue.messages.length, 1);
	});

	it('only the owner or a channel editor; only a supported language', async () => {
		assert.equal((await claim(env(), { language: 'ar' }, 'stranger')).status, 403);
		assert.equal((await claim(env(), { language: 'xx' })).status, 400);
	});

	it('no transcript (purged, or never reviewed) is 404 and the list says so', async () => {
		for (const e of [env({ transcript: false }), env({ review: false })]) {
			const res = await claim(e, { language: 'ar' });
			assert.deepEqual([res.status, ((await res.json()) as any).error], [404, 'transcript_not_found']);
			const list = (await (await app().request('/api/videos/v1/captions/drafts', {}, e as never)).json()) as any;
			assert.equal(list.data.transcriptAvailable, false);
		}
	});

	it('an existing draft is replaced only when asked', async () => {
		const e = env({ draft: true });
		const res = await claim(e, { language: 'ar' });
		assert.deepEqual([res.status, ((await res.json()) as any).error], [409, 'draft_exists']);
		assert.equal((await claim(e, { language: 'ar', replace: true })).status, 202);
		assert.equal(e.queue.messages[0].payload.replace, true);
	});

	it('a queue failure is 503 and leaves no claim behind', async () => {
		const e = env();
		e.queue.send = async () => {
			throw new Error('queue down');
		};
		assert.equal((await claim(e, { language: 'ar' })).status, 503);
		assert.equal(e.subtitles.read(captionClaimKey('v1', 'ar')), null);
	});
});

it('the transcript key comes from the review state, else from the transcoder result', async () => {
	const { reviewTranscriptKey } = await import('../src/lib/captions/claim');
	assert.equal(reviewTranscriptKey({ review: { manifestKey: 'review/v1/r1/manifest.json' } }), 'review/v1/r1/transcript.json');
	assert.equal(reviewTranscriptKey({ r2: { result: { review: { manifestKey: 'review/v1/r2/manifest.json' } } } }), 'review/v1/r2/transcript.json');
	assert.equal(reviewTranscriptKey({ r2: { result: { review: { manifestKey: 'quran/x.json' } } } }), null);
	assert.equal(reviewTranscriptKey({}), null);
});
