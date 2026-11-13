/**
 * Pre-publication review in api-videos (docs/specs/VIDEO-REVIEW.md §3): queueing the scan,
 * applying the processor's outcome and a reviewer's decision, the creator's appeal and resubmit,
 * and the internal router. No AI: the processor is not involved; messages are inspected.
 */
import { beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Hono } from 'hono';
import { MessageType, VIDEO_REVIEW_SETTINGS_KEY, clearVideoReviewSettingsCache, type VideoReviewMode } from '@al-ummah/shared-types';
import { queueReviewScan } from '../src/lib/review/scan';
import { appealReview, applyReviewDecision, applyReviewOutcome, resubmitReview } from '../src/lib/review/apply';
import { createReviewInternalRouter } from '../src/endpoints/review/reviewInternal';
import { VideoReviewAppeal, VideoReviewResubmit } from '../src/endpoints/review/reviewOwner';
import { transformVideoToView } from '../src/lib/transformations';
import { MemoryBucket, MemoryQueue, buildApp } from './helpers';

const OWNER = 'usr_owner';

beforeEach(() => clearVideoReviewSettingsCache());

function env(video: Record<string, unknown>, mode: VideoReviewMode = 'enforce', allowed = 'true') {
	const global_settings = new MemoryBucket();
	global_settings.store.set(VIDEO_REVIEW_SETTINGS_KEY, JSON.stringify({ mode }));
	return {
		videos: new MemoryBucket({ v1: { id: 'v1', title: 'Talk', userId: OWNER, channelId: 'ch1', isPublic: true, uploadStatus: 'ready', ...video } }),
		channels: new MemoryBucket({ ch1: { id: 'ch1', userId: OWNER, name: 'Channel' } }),
		global_settings,
		MODERATION_QUEUE: new MemoryQueue(),
		queue: new MemoryQueue(),
		VIDEO_REVIEW_ALLOWED: allowed,
	};
}
type Env = ReturnType<typeof env>;
const checking = (extra: Record<string, unknown> = {}) => ({ review: { status: 'checking', reviewId: 'r1', timing: 'pre', since: '2026-11-13T12:00:00.000Z', etaAt: '2026-11-13T12:05:00.000Z', ...extra } });
const fanouts = (e: Env) => e.queue.messages.filter((m) => m.type === MessageType.NotificationFanout);
const notices = (e: Env) => e.queue.messages.filter((m) => m.type === MessageType.NotificationCreate).map((m) => m.payload.notificationKey);
const outcome = (route: 'approve' | 'hold', extra: Record<string, unknown> = {}) => ({ reviewId: 'r1', mode: 'enforce' as const, timing: 'pre' as const, routing: { route, risk: 0.1, nsfw: false, escalate: false, ...extra }, findingsCount: 0, checkedAt: 'x' });

describe('queueing the scan', () => {
	it('sends one VideoReviewScan per review, with the settings snapshot and the manifest', async () => {
		const e = env(checking());
		assert.deepEqual(await queueReviewScan(e as never, 'v1', { trigger: 'upload', manifestKey: 'review/v1/rev/manifest.json' }), { queued: true });
		assert.equal((await queueReviewScan(e as never, 'v1', { trigger: 'upload' })).why, 'already queued');
		assert.equal(e.MODERATION_QUEUE.messages.length, 1);
		const msg = e.MODERATION_QUEUE.messages[0];
		assert.equal(msg.type, MessageType.VideoReviewScan);
		assert.equal(msg.payload.reviewId, 'r1');
		assert.equal(msg.payload.manifestKey, 'review/v1/rev/manifest.json');
		assert.equal(msg.payload.metadataText.includes('Talk'), true);
		assert.equal(msg.payload.settings.etaMinutes, 5);
		assert.equal(e.videos.read('v1').review.manifestKey, 'review/v1/rev/manifest.json');
	});

	it('never outside production, and never with mode off', async () => {
		assert.equal((await queueReviewScan(env(checking(), 'enforce', 'false') as never, 'v1', { trigger: 'upload' })).queued, false);
		clearVideoReviewSettingsCache();
		assert.equal((await queueReviewScan(env(checking(), 'off') as never, 'v1', { trigger: 'upload' })).queued, false);
	});

	it('shadow: queues a recorded-only scan once, and never writes `review`', async () => {
		const e = env({}, 'shadow');
		assert.equal((await queueReviewScan(e as never, 'v1', { trigger: 'upload' })).queued, true);
		assert.equal((await queueReviewScan(e as never, 'v1', { trigger: 'upload' })).queued, false, 'once');
		const v = e.videos.read('v1');
		assert.equal(v.review, undefined);
		assert.ok(v.reviewShadow.reviewId);
		assert.equal(e.MODERATION_QUEUE.messages[0].payload.mode, 'shadow');
	});
});

describe('the automated outcome', () => {
	it('approve: the checking video becomes visible, gets publishedAt and is announced', async () => {
		const e = env(checking());
		const r = await applyReviewOutcome(e as never, 'v1', outcome('approve'));
		assert.equal(r.applied, true);
		const v = e.videos.read('v1');
		assert.equal(v.review.status, 'approved');
		assert.equal(v.review.etaAt, undefined);
		assert.ok(v.publishedAt, 'publishedAt set when it became visible');
		assert.equal(fanouts(e).length, 1, 'subscribers told');
	});

	it('approve of a scheduled video (VR8): visible only once released; no announcement before', async () => {
		const e = env({ ...checking(), isPublic: false, scheduledPublishStatus: 'scheduled' });
		await applyReviewOutcome(e as never, 'v1', outcome('approve'));
		assert.equal(e.videos.read('v1').review.status, 'approved');
		assert.equal(fanouts(e).length, 0, 'the scheduler announces it at the scheduled time');
	});

	it('hold: in review with the cause; not visible, not announced', async () => {
		const e = env(checking());
		await applyReviewOutcome(e as never, 'v1', outcome('hold', { nsfw: true, holdCause: 'nsfw' }));
		const v = e.videos.read('v1');
		assert.equal(v.review.status, 'in_review');
		assert.equal(v.review.holdCause, 'nsfw');
		assert.equal(v.publishedAt, undefined);
		assert.equal(fanouts(e).length, 0);
	});

	it('trusted channel: an NSFW hit pulls it back (VR2); other risk keeps it public', async () => {
		const trusted = { review: { status: 'post_review', reviewId: 'r1', timing: 'post', since: 'x' } };
		const a = env(trusted);
		await applyReviewOutcome(a as never, 'v1', outcome('hold', { holdCause: 'risk' }));
		assert.equal(a.videos.read('v1').review.status, 'post_review');
		const b = env(trusted);
		await applyReviewOutcome(b as never, 'v1', outcome('hold', { nsfw: true, holdCause: 'nsfw' }));
		assert.equal(b.videos.read('v1').review.status, 'in_review');
	});

	it('a stale review id is refused (409) and shadow outcomes never touch the video', async () => {
		const e = env(checking());
		const stale = await applyReviewOutcome(e as never, 'v1', { ...outcome('approve'), reviewId: 'old' });
		assert.equal('why' in stale && stale.status, 409);
		const shadow = await applyReviewOutcome(e as never, 'v1', { ...outcome('approve'), mode: 'shadow' });
		assert.equal('why' in shadow && shadow.status, 400);
		assert.equal(e.videos.read('v1').review.status, 'checking');
	});
});

describe("a reviewer's decision", () => {
	const decision = (d: 'approve' | 'reject' | 'undo', extra: Record<string, unknown> = {}) => ({ reviewId: 'r1', decision: d, reviewerId: 'rev1', decidedAt: new Date().toISOString(), ...extra });
	const held = () => checking({ status: 'in_review', holdCause: 'risk' });

	it('approve: published, announced, and the creator is told', async () => {
		const e = env(held());
		await applyReviewDecision(e as never, 'v1', decision('approve') as never);
		assert.equal(e.videos.read('v1').review.status, 'approved');
		assert.equal(fanouts(e).length, 1);
		assert.deepEqual(notices(e), ['reviewApproved']);
	});

	it('reject needs a reason, stays private, and the creator is told the reason', async () => {
		const e = env(held());
		const missing = await applyReviewDecision(e as never, 'v1', decision('reject') as never);
		assert.equal('why' in missing && missing.status, 400);
		await applyReviewDecision(e as never, 'v1', decision('reject', { reasonCode: 'sexual' }) as never);
		const v = e.videos.read('v1');
		assert.equal(v.review.status, 'rejected');
		assert.equal(v.review.reasonCode, 'sexual');
		assert.equal(v.review.holdCause, undefined);
		assert.deepEqual(notices(e), ['reviewRejected']);
		assert.equal(e.queue.messages.find((m) => m.type === MessageType.NotificationCreate).payload.params.reason, 'sexual');
	});

	it('undo within 10 minutes restores the previous state', async () => {
		const e = env(held());
		await applyReviewDecision(e as never, 'v1', decision('reject', { reasonCode: 'spam_scam' }) as never);
		await applyReviewDecision(e as never, 'v1', decision('undo') as never);
		const v = e.videos.read('v1');
		assert.equal(v.review.status, 'in_review');
		assert.equal(v.review.reasonCode, undefined);
		const again = await applyReviewDecision(e as never, 'v1', decision('undo') as never);
		assert.equal('why' in again && again.why, 'nothing to undo');
	});

	it('undo after the window is refused', async () => {
		const e = env({ review: { status: 'rejected', reviewId: 'r1', timing: 'pre', since: 'x', previousStatus: 'in_review', decidedAt: new Date(Date.now() - 11 * 60_000).toISOString(), reasonCode: 'hate' } });
		const r = await applyReviewDecision(e as never, 'v1', decision('undo') as never);
		assert.equal('why' in r && r.why, 'the undo window has passed');
	});
});

describe('appeal and resubmit (VR10)', () => {
	const rejected = () => ({ review: { status: 'rejected', reviewId: 'r1', timing: 'pre', since: 'x', reasonCode: 'hate', manifestKey: 'review/v1/rev/manifest.json' } });

	it('one appeal per rejection; the processor gets the appeal with a new review id', async () => {
		const e = env(rejected());
		const r = await appealReview(e as never, 'v1', '  This is a Quran recitation about history  ');
		assert.equal(r.applied, true);
		const v = e.videos.read('v1');
		assert.equal(v.review.status, 'appealed');
		assert.equal(v.review.appealUsed, true);
		assert.notEqual(v.review.reviewId, 'r1');
		const msg = e.MODERATION_QUEUE.messages.find((m) => m.type === MessageType.VideoReviewAppeal);
		assert.equal(msg.payload.reviewId, 'r1');
		assert.equal(msg.payload.appealReviewId, v.review.reviewId);
		assert.equal(msg.payload.message, 'This is a Quran recitation about history');
	});

	it('a second appeal after the appeal was rejected is refused', async () => {
		const e = env({ review: { ...rejected().review, appealUsed: true } });
		const r = await appealReview(e as never, 'v1', 'again');
		assert.equal('why' in r && r.why, 'this decision was already appealed');
	});

	it('resubmit after an edit: a new review, checked again with the same media', async () => {
		const e = env(rejected());
		await resubmitReview(e as never, 'v1');
		const v = e.videos.read('v1');
		assert.equal(v.review.status, 'checking');
		assert.notEqual(v.review.reviewId, 'r1');
		const scan = e.MODERATION_QUEUE.messages.find((m) => m.type === MessageType.VideoReviewScan);
		assert.equal(scan.payload.trigger, 'resubmit');
		assert.equal(scan.payload.manifestKey, 'review/v1/rev/manifest.json');
	});

	it('the owner endpoints: allowed for the owner, 404 for anyone else', async () => {
		const e = env(rejected());
		const as = (userId: string) => buildApp((r) => { r.post('/api/videos/:id/review/appeal', VideoReviewAppeal); r.post('/api/videos/:id/review/resubmit', VideoReviewResubmit); }, { userId });
		const post = (userId: string, path: string, body?: unknown) => as(userId).request(path, { method: 'POST', headers: { 'content-type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) }, e as never);
		assert.equal((await post('usr_other', '/api/videos/v1/review/appeal', { message: 'x' })).status, 404);
		assert.equal((await post(OWNER, '/api/videos/v1/review/appeal', { message: 'please look again' })).status, 200);
		assert.equal((await post(OWNER, '/api/videos/v1/review/resubmit')).status, 409, 'an appealed video is not resubmitted');
	});
});

describe('internal router', () => {
	const app = () => {
		const a = new Hono();
		a.route('/internal/review', createReviewInternalRouter() as never);
		return a;
	};
	const post = (e: Env, path: string, body: unknown) => app().request(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }, e as never);

	it('outcome and decision validate their bodies and apply', async () => {
		const e = env(checking());
		assert.equal((await post(e, '/internal/review/v1/outcome', { reviewId: 'r1' })).status, 400);
		assert.equal((await post(e, '/internal/review/v1/outcome', outcome('hold', { holdCause: 'risk' }))).status, 200);
		assert.equal((await post(e, '/internal/review/v1/decision', { reviewId: 'r1', decision: 'approve' })).status, 400, 'reviewerId required');
		assert.equal((await post(e, '/internal/review/v1/decision', { reviewId: 'r1', decision: 'approve', reviewerId: 'rev1', decidedAt: new Date().toISOString() })).status, 200);
		assert.equal(e.videos.read('v1').review.status, 'approved');
	});
});

describe('API views never carry review internals', () => {
	it('status, ETA and reason only; no hold cause, ids or shadow marker', () => {
		const view = transformVideoToView({ id: 'v1', title: 'T', userId: OWNER, review: { status: 'in_review', reviewId: 'r1', timing: 'pre', since: 's', holdCause: 'nsfw', manifestKey: 'k', previousStatus: 'checking' }, reviewShadow: { reviewId: 'x', queuedAt: 'y' } } as never) as Record<string, any>;
		assert.deepEqual(view.review, { status: 'in_review', since: 's' });
		assert.equal(view.reviewShadow, undefined);
	});
});
