/**
 * Post-hoc review of a live stream's recording (VR9, AlUmmahNow#1295): the review starts when the
 * recording is ready, the media worker's extraction queues the processor's scan (subject
 * `livestream`), the outcome only pulls the recording back on NSFW or an escalation, a reviewer
 * decides, and a held or rejected recording reaches its owner only. No AI, no provider: the
 * queues are inspected and the stream records live in memory.
 */
import { beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { MessageType, VIDEO_REVIEW_SETTINGS_KEY, clearVideoReviewSettingsCache, isLiveReviewJobMessage, type VideoReviewMode } from '@al-ummah/shared-types';
import { applyLiveReviewDecision, applyLiveReviewOutcome, startLiveVodReview } from '../src/lib/review/live';
import { createReviewInternalRouter } from '../src/endpoints/review/reviewInternal';
import { LiveStreamGet, liveRecordingWithheld, publicStream } from '../src/endpoints/live/liveSession';
import { LiveStreamsList } from '../src/endpoints/live/liveStreamsList';
import { markStreamLive, registerLiveStreamHooks } from '../src/lib/live/streams';
import { vodReady, setOnVodReady } from '../src/lib/live/vod-ready';
import { signLiveVodUrl } from '../src/lib/live/vod-sign';
import { MemoryBucket, MemoryQueue, buildApp } from './helpers';

const OWNER = 'usr_owner';
const SID = '11111111-2222-4333-8444-555555555555';
const VOD = 'https://live.qa.alummahnow.net/hls/sess-1/vod.m3u8';
const SESSION = { id: 'sess-1', vod_url: VOD };

beforeEach(() => clearVideoReviewSettingsCache());

function env(stream: Record<string, unknown> = {}, mode: VideoReviewMode = 'enforce', allowed = 'true') {
	const global_settings = new MemoryBucket();
	global_settings.store.set(VIDEO_REVIEW_SETTINGS_KEY, JSON.stringify({ mode }));
	return {
		videos: new MemoryBucket({
			[`livestream:${SID}`]: { id: SID, title: 'Friday khutbah live', description: 'From the masjid', userId: OWNER, channelId: 'ch1', status: 'ended', dateCreated: '2026-11-13T10:00:00.000Z', ...stream },
		}),
		global_settings,
		MODERATION_QUEUE: new MemoryQueue(),
		TRANSCODE_QUEUE: new MemoryQueue(),
		queue: new MemoryQueue(),
		VIDEO_REVIEW_ALLOWED: allowed,
	};
}
type Env = ReturnType<typeof env>;
const record = (e: Env) => e.videos.read(`livestream:${SID}`);
const held = (status: string, extra: Record<string, unknown> = {}) => ({ review: { status, reviewId: 'r1', timing: 'post', since: '2026-11-13T12:00:00.000Z', ...extra } });
const outcome = (route: 'approve' | 'hold', extra: Record<string, unknown> = {}) => ({ reviewId: 'r1', mode: 'enforce' as const, timing: 'post' as const, routing: { route, risk: 0.9, nsfw: false, escalate: false, ...extra }, findingsCount: 1, checkedAt: 'x' });
const post = (e: Env, path: string, body: unknown) =>
	createReviewInternalRouter().request(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }, e as never);

describe('starting the review when the recording is ready', () => {
	it('enforce: the recording stays public (post_review) and its frames and audio are extracted once', async () => {
		const e = env();
		assert.deepEqual(await startLiveVodReview(e as never, SID, SESSION), { started: true });
		const s = record(e);
		assert.equal(s.review.status, 'post_review');
		assert.equal(s.review.timing, 'post');
		assert.equal(s.reviewSessionId, 'sess-1');
		assert.equal(e.TRANSCODE_QUEUE.messages.length, 1);
		const job = e.TRANSCODE_QUEUE.messages[0];
		assert.ok(isLiveReviewJobMessage(job), 'a valid media job');
		assert.equal(job.streamId, SID);
		assert.equal(job.reviewId, s.review.reviewId);
		assert.equal(job.vodUrl, VOD);
		assert.ok(job.review.maxFrames > 0);
		assert.equal(liveRecordingWithheld(s), false, 'still plays');
		assert.equal((await startLiveVodReview(e as never, SID, SESSION)).why, 'already started');
		assert.equal(e.TRANSCODE_QUEUE.messages.length, 1);
	});

	it('a new session\'s recording starts a new review', async () => {
		const e = env({ ...held('approved'), reviewSessionId: 'sess-0' });
		await startLiveVodReview(e as never, SID, SESSION);
		assert.equal(record(e).review.status, 'post_review');
		assert.notEqual(record(e).review.reviewId, 'r1');
	});

	it('without the media worker the check runs on the title and thumbnail (partial)', async () => {
		const e = env({ thumbnailUrl: 'https://img.example/t.jpg' });
		delete (e as Partial<Env>).TRANSCODE_QUEUE;
		await startLiveVodReview(e as never, SID, SESSION);
		const msg = e.MODERATION_QUEUE.messages[0];
		assert.equal(msg.type, MessageType.VideoReviewScan);
		assert.equal(msg.payload.subject, 'livestream');
		assert.equal(msg.payload.trigger, 'live_vod');
		assert.equal(msg.payload.videoId, SID);
		assert.equal(msg.payload.timing, 'post');
		assert.equal(msg.payload.mode, 'enforce');
		assert.equal(msg.payload.manifestKey, undefined);
		assert.match(msg.payload.metadataText, /Friday khutbah live/);
		assert.deepEqual(msg.payload.thumbnail, { url: 'https://img.example/t.jpg' });
	});

	it('shadow: a marker only, the record\'s review is never written', async () => {
		const e = env({}, 'shadow');
		await startLiveVodReview(e as never, SID, SESSION);
		assert.equal(record(e).review, undefined);
		const marker = record(e).reviewShadow;
		assert.ok(marker.reviewId);
		const res = await post(e, `/livestream/${SID}/media`, { reviewId: marker.reviewId, manifestKey: `review/${SID}/abc/manifest.json` });
		assert.equal(res.status, 200);
		assert.equal(e.MODERATION_QUEUE.messages[0].payload.mode, 'shadow');
	});

	it('nothing with review off or outside production', async () => {
		const off = env({}, 'off');
		assert.equal((await startLiveVodReview(off as never, SID, SESSION)).started, false);
		clearVideoReviewSettingsCache();
		const qa = env({}, 'enforce', 'false');
		assert.equal((await startLiveVodReview(qa as never, SID, SESSION)).started, false);
		assert.equal(record(qa).review, undefined);
		assert.equal(qa.TRANSCODE_QUEUE.messages.length + qa.MODERATION_QUEUE.messages.length, 0);
	});

	it('the recording-ready hook (self-hosted finalize, Bunny poll) starts it; a failing listener never throws', async () => {
		const e = env();
		registerLiveStreamHooks();
		await vodReady(e as never, { ...SESSION, stream_id: SID } as never);
		assert.equal(record(e).review.status, 'post_review');
		setOnVodReady(async () => { throw new Error('boom'); });
		await vodReady(e as never, { ...SESSION, stream_id: SID } as never);
		setOnVodReady(null);
	});
});

describe('the media worker, the processor and a reviewer', () => {
	it('media ready: the scan is queued with the manifest; a stale review is refused', async () => {
		const e = env(held('post_review'));
		const res = await post(e, `/livestream/${SID}/media`, { reviewId: 'r1', manifestKey: `review/${SID}/abc/manifest.json` });
		assert.equal(res.status, 200);
		assert.equal(e.MODERATION_QUEUE.messages[0].payload.manifestKey, `review/${SID}/abc/manifest.json`);
		assert.equal(record(e).review.manifestKey, `review/${SID}/abc/manifest.json`);
		assert.equal((await post(e, `/livestream/${SID}/media`, { reviewId: 'old' })).status, 409);
		assert.equal((await post(e, `/livestream/${SID}/media`, { manifestKey: 1 })).status, 400);
	});

	it('extraction failed: a partial scan, never a manifest', async () => {
		const e = env(held('post_review'));
		await post(e, `/livestream/${SID}/media`, { reviewId: 'r1', manifestKey: 'x', error: 'ffmpeg exited 1' });
		assert.equal(e.MODERATION_QUEUE.messages[0].payload.manifestKey, undefined);
	});

	it('a risky but not NSFW result keeps the recording public; NSFW or an escalation pulls it back', async () => {
		const e = env(held('post_review'));
		await applyLiveReviewOutcome(e as never, SID, outcome('hold'));
		assert.equal(record(e).review.status, 'post_review');
		const res = await post(e, `/livestream/${SID}/outcome`, outcome('hold', { nsfw: true, holdCause: 'risk' }));
		assert.equal(res.status, 200);
		assert.equal(record(e).review.status, 'in_review');
		assert.equal(liveRecordingWithheld(record(e)), true);
		const esc = env(held('post_review'));
		await applyLiveReviewOutcome(esc as never, SID, outcome('hold', { escalate: true }));
		assert.equal(record(esc).review.status, 'in_review');
		assert.equal((await applyLiveReviewOutcome(esc as never, SID, { ...outcome('approve'), mode: 'shadow' } as never)).applied, false, 'shadow is recorded only');
		assert.equal((await applyLiveReviewOutcome(esc as never, SID, { ...outcome('approve'), reviewId: 'old' })).applied, false);
	});

	it('a reviewer rejects with a reason (the owner is told), can undo, and approves', async () => {
		const e = env(held('in_review'));
		assert.equal((await applyLiveReviewDecision(e as never, SID, { reviewId: 'r1', reviewerId: 'rev1', decision: 'reject' } as never)).applied, false, 'a reason is required');
		const res = await post(e, `/livestream/${SID}/decision`, { reviewId: 'r1', reviewerId: 'rev1', decision: 'reject', reasonCode: 'hate' });
		assert.equal(res.status, 200);
		assert.equal(record(e).review.status, 'rejected');
		assert.equal(liveRecordingWithheld(record(e)), true);
		const notice = e.queue.messages.find((m) => m.type === MessageType.NotificationCreate)!.payload;
		assert.equal(notice.notificationKey, 'reviewRejected');
		assert.equal(notice.recipientUserId, OWNER);
		assert.equal(notice.actionUrl, `/studio/ch1/content/live/${SID}`);
		assert.equal(notice.params.reason, 'hate');
		await applyLiveReviewDecision(e as never, SID, { reviewId: 'r1', reviewerId: 'rev1', decision: 'undo' });
		assert.equal(record(e).review.status, 'in_review');
		await applyLiveReviewDecision(e as never, SID, { reviewId: 'r1', reviewerId: 'rev1', decision: 'approve' });
		assert.equal(record(e).review.status, 'approved');
		assert.equal(liveRecordingWithheld(record(e)), false);
		assert.equal((await post(e, `/livestream/${SID}/decision`, { reviewId: 'r1', reviewerId: 'rev1', decision: 'approve' })).status, 409, 'already approved');
	});

	it('routes "livestream" before a video id', async () => {
		const e = env(held('in_review'));
		const res = await post(e, `/livestream/${SID}/outcome`, { reviewId: 'r1' });
		assert.equal(res.status, 400);
		assert.match(((await res.json()) as { error: string }).error, /routing/);
	});
});

describe('who sees a held recording', () => {
	const app = (e: Env, userId: string | null) => {
		const a = buildApp((r) => {
			r.get('/api/live-streams', LiveStreamsList);
			r.get('/api/live-streams/:id', LiveStreamGet);
		}, userId ? { userId } : null);
		return (path: string) => a.request(path, {}, e as never);
	};

	it('held or rejected: owner only (page and lists); approved or post_review: everyone', async () => {
		for (const status of ['in_review', 'rejected']) {
			const e = env(held(status));
			assert.equal((await app(e, null)(`/api/live-streams/${SID}`)).status, 404, status);
			assert.equal((await app(e, 'someone')(`/api/live-streams/${SID}`)).status, 404, status);
			const mine = await app(e, OWNER)(`/api/live-streams/${SID}`);
			assert.equal(mine.status, 200);
			assert.equal(((await mine.json()) as any).result.stream.review.status, status, 'Studio shows the owner the state');
			const list = (await (await app(e, null)('/api/live-streams')).json()) as any;
			assert.equal(list.result.data.length, 0);
			const ownList = (await (await app(e, OWNER)('/api/live-streams')).json()) as any;
			assert.equal(ownList.result.data.length, 1);
		}
		for (const status of ['post_review', 'approved']) {
			const e = env(held(status));
			const res = await app(e, null)(`/api/live-streams/${SID}`);
			assert.equal(res.status, 200, status);
			assert.equal(((await res.json()) as any).result.stream.review, undefined, 'the review never reaches other viewers');
		}
	});

	it('tied to a session really going live, never to `status` or a provisioned session', () => {
		const heldRec = { review: { status: 'in_review' }, reviewSessionId: 's1' };
		assert.equal(liveRecordingWithheld({ ...heldRec, sessionId: 's2', liveAgainSessionId: 's2' }), false, 'the new session really went live');
		assert.equal(liveRecordingWithheld({ ...heldRec, sessionId: 's2' }), true, 'a new session only provisioned (ingest) is not enough');
		assert.equal(liveRecordingWithheld({ ...heldRec, sessionId: 's1' }), true, 'same recording, whatever status says');
		assert.equal(liveRecordingWithheld({ sessionId: 's1' }), false, 'no review');
	});

	it('markStreamLive ends the hold for that session only', async () => {
		const e = env({ ...held('rejected'), status: 'ended', sessionId: 'sess-2', reviewSessionId: 'sess-1' });
		await markStreamLive(e as never, SID);
		assert.equal(record(e).liveAgainSessionId, 'sess-2');
		assert.equal(liveRecordingWithheld(record(e)), false);
		const clean = env({ ...held('approved'), status: 'ended', sessionId: 'sess-2' });
		await markStreamLive(clean as never, SID);
		assert.equal(record(clean).liveAgainSessionId, undefined);
	});

	it('the live-again session\'s own recording gets its own hold (the exemption ends with the new review)', async () => {
		const e = env({ ...held('rejected'), status: 'ended', sessionId: 'sess-2', reviewSessionId: 'sess-1' });
		await markStreamLive(e as never, SID);
		assert.equal(liveRecordingWithheld(record(e)), false, 'sess-2 is live again');
		await startLiveVodReview(e as never, SID, { id: 'sess-2', vod_url: VOD });
		assert.equal(record(e).liveAgainSessionId, undefined, 'the marker belonged to the old review');
		const reviewId = record(e).review.reviewId;
		await post(e, `/livestream/${SID}/decision`, { reviewId, reviewerId: 'rev1', decision: 'reject', reasonCode: 'hate' });
		assert.equal(record(e).review.status, 'rejected');
		assert.equal(liveRecordingWithheld(record(e)), true, 'sess-2\'s rejected recording is withheld');
	});

	it('the owner setting the status (scheduled, live) never reopens a held stream or its recording', async () => {
		for (const status of ['scheduled', 'live', 'cancelled']) {
			const e = env({ ...held('rejected', { reasonCode: 'hate' }), status, sessionId: 'sess-1', reviewSessionId: 'sess-1', vodUrl: VOD });
			assert.equal((await app(e, null)(`/api/live-streams/${SID}`)).status, 404, status);
			const list = (await (await app(e, 'someone')('/api/live-streams')).json()) as any;
			assert.equal(list.result.data.length, 0, status);
		}
	});

	it('really live again: the stream shows, the held recording\'s URL and the review never do', async () => {
		const e = env({ ...held('in_review'), status: 'live', sessionId: 'sess-2', reviewSessionId: 'sess-1', liveAgainSessionId: 'sess-2', vodUrl: VOD, reviewShadow: { reviewId: 'x', queuedAt: 'y' } });
		const page = (await (await app(e, null)(`/api/live-streams/${SID}`)).json()) as any;
		assert.equal(page.result.stream.vodUrl, null);
		assert.equal(page.result.stream.review, undefined);
		const list = (await (await app(e, 'someone')('/api/live-streams')).json()) as any;
		assert.equal(list.result.data.length, 1);
		const item = list.result.data[0];
		assert.equal(item.vodUrl, null);
		for (const k of ['review', 'reviewShadow', 'reviewSessionId', 'liveAgainSessionId']) assert.equal(item[k], undefined, k);
		const own = (await (await app(e, OWNER)('/api/live-streams')).json()) as any;
		assert.equal(own.result.data[0].vodUrl, VOD);
		assert.equal(own.result.data[0].review.status, 'in_review');
	});

	it('publicStream drops the shadow marker and the session for everyone', () => {
		const v = publicStream({ id: SID, title: 't', userId: OWNER, status: 'ended', reviewShadow: { reviewId: 'x', queuedAt: 'y' }, reviewSessionId: 's' } as never, true) as Record<string, unknown>;
		assert.equal(v.reviewShadow, undefined);
		assert.equal(v.reviewSessionId, undefined);
	});
});

describe('signing a Bunny recording for the media worker', () => {
	it('signs a Bunny playlist on a token-auth library; leaves self-hosted URLs alone', async () => {
		const sign = { BUNNY_SIGN_URLS: 'true', bunny_hostname: 'vz-test.b-cdn.net', BUNNY_TOKEN_KEY: 'k' };
		const bunny = 'https://vz-test.b-cdn.net/aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee/playlist.m3u8';
		const signed = await signLiveVodUrl(sign, bunny);
		assert.match(signed!, /^https:\/\/vz-test\.b-cdn\.net\/bcdn_token=[^&]+&expires=\d+&token_path=%2Faaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee%2F\/aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee\/playlist\.m3u8$/);
		assert.ok(isLiveReviewJobMessage({ kind: 'live_review', streamId: SID, reviewId: 'r', rev: 'abcdef0123456789', vodUrl: signed, review: {}, queuedAt: 'x' }), 'a signed URL passes the job guard');
		assert.equal(await signLiveVodUrl(sign, VOD), VOD);
		assert.equal(await signLiveVodUrl({}, bunny), bunny);
	});
});
