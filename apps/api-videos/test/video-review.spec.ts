/**
 * Pre-publication video review foundation (wiki AUN-VIDEO-REVIEW, docs/specs/VIDEO-REVIEW.md):
 * settings, the production-only env gate, routing (owner decisions VR1, VR2, VR5) and the upload
 * gate. No AI anywhere: routing is pure and the processor's provider is not involved here.
 */
import { beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
	DEFAULT_VIDEO_REVIEW_SETTINGS,
	clearVideoReviewSettingsCache,
	effectiveReviewMode,
	initialReviewState,
	normaliseVideoReviewSettings,
	readVideoReviewSettings,
	routeReview,
	writeVideoReviewSettings,
	VIDEO_REVIEW_SETTINGS_KEY,
	type ReviewFinding,
	type VideoReviewMode,
} from '@al-ummah/shared-types';
import { markUploadComplete } from '../src/lib/uploads/lifecycle';
import { MemoryBucket, MemoryQueue } from './helpers';

const NOW = new Date('2026-11-13T12:00:00.000Z');
const f = (category: string, score: number, extra: Partial<ReviewFinding> = {}): ReviewFinding => ({ source: 'frame', category, score, model: 'm', ...extra });
const settings = DEFAULT_VIDEO_REVIEW_SETTINGS;

beforeEach(() => clearVideoReviewSettingsCache());

describe('settings', () => {
	it('defaults to off with the owner-approved seeds (VR4, VR5, VR6, VR12)', () => {
		const s = normaliseVideoReviewSettings(undefined);
		assert.equal(s.mode, 'off');
		assert.equal(s.etaMinutes, 5);
		assert.equal(s.frameIntervalSeconds, 2);
		assert.equal(s.maxFrames, 1200);
		assert.equal(s.mediaRetentionDays, 30);
		assert.deepEqual(s.thresholds, { autoApproveRisk: 0.15, nsfwClear: 0.1, nsfwScreen: 0.2, nsfwHit: 0.5, escalate: 0.3, textFlag: 0.5 });
		assert.equal(s.models.frames, '@cf/cloudflare/clef-flash');
	});

	it('clamps out-of-range values, drops unknown modes and refuses non-Workers-AI model ids', () => {
		const s = normaliseVideoReviewSettings({ mode: 'yolo', thresholds: { nsfwHit: 7, escalate: -1 }, etaMinutes: 0, maxFrames: 1e9, models: { frames: 'https://api.example.com/model' } });
		assert.equal(s.mode, 'off');
		assert.equal(s.thresholds.nsfwHit, 1);
		assert.equal(s.thresholds.escalate, 0);
		assert.equal(s.etaMinutes, 1);
		assert.equal(s.maxFrames, 5000);
		assert.equal(s.models.frames, '@cf/cloudflare/clef-flash');
	});

	it('is read from global_settings, cached, and a write merges thresholds', async () => {
		const bucket = new MemoryBucket();
		assert.equal((await readVideoReviewSettings(bucket as never)).mode, 'off', 'nothing stored: off');
		const written = await writeVideoReviewSettings(bucket as never, { mode: 'shadow', thresholds: { nsfwHit: 0.6 } }, 'admin-1', NOW);
		assert.equal(written.mode, 'shadow');
		assert.equal(written.thresholds.nsfwHit, 0.6);
		assert.equal(written.thresholds.autoApproveRisk, 0.15, 'other thresholds kept');
		assert.equal(written.updatedBy, 'admin-1');
		assert.ok(bucket.store.has(VIDEO_REVIEW_SETTINGS_KEY));
		assert.equal((await readVideoReviewSettings(bucket as never)).mode, 'shadow');
	});

	it('an unreadable settings object never turns review on', async () => {
		const bucket = new MemoryBucket();
		bucket.store.set(VIDEO_REVIEW_SETTINGS_KEY, '{not json');
		assert.equal((await readVideoReviewSettings(bucket as never, true)).mode, 'off');
	});

	it('only production may run it: VIDEO_REVIEW_ALLOWED must be exactly "true"', () => {
		for (const mode of ['shadow', 'enforce', 'enforce_nsfw'] as VideoReviewMode[]) {
			assert.equal(effectiveReviewMode({ mode }, 'true'), mode);
			assert.equal(effectiveReviewMode({ mode }, undefined), 'off', 'QA / stage / local');
			assert.equal(effectiveReviewMode({ mode }, 'false'), 'off');
			assert.equal(effectiveReviewMode({ mode }, 'TRUE'), 'off');
		}
	});
});

describe('routing', () => {
	const route = (findings: ReviewFinding[], mode: VideoReviewMode = 'enforce', extra: { checkFailed?: boolean; budgetStopped?: boolean } = {}) => routeReview(findings, settings, { mode, ...extra });

	it('a clean video is approved automatically (VR1: a person only when flagged)', () => {
		const r = route([f('sexual', 0.01), f('hate', 0.05, { source: 'transcript' })]);
		assert.equal(r.route, 'approve');
		assert.equal(r.nsfw, false);
	});

	it('an NSFW hit always holds, in both enforce modes (VR2)', () => {
		for (const mode of ['enforce', 'enforce_nsfw'] as VideoReviewMode[]) {
			const r = route([f('sexual', 0.92, { atMs: 42_000 })], mode);
			assert.equal(r.route, 'hold', mode);
			assert.equal(r.nsfw, true);
			assert.equal(r.holdCause, 'nsfw');
			assert.equal(r.reasons[0].atMs, 42_000, 'the flagged timestamp is the first reason');
		}
		assert.equal(route([f('gore', 0.7)]).holdCause, 'nsfw');
		assert.equal(route([f('sexual_explicit_language', 0.8, { source: 'transcript' })]).holdCause, 'nsfw', 'explicit language counts');
	});

	it('enforce: an NSFW score between clear and hit still goes to a person; enforce_nsfw approves it', () => {
		assert.equal(route([f('sexual', 0.3)]).route, 'hold');
		assert.equal(route([f('sexual', 0.3)], 'enforce_nsfw').route, 'approve');
	});

	it('enforce: risk at or above the auto-approve threshold holds; enforce_nsfw approves non-NSFW risk', () => {
		const r = route([f('harassment', 0.6, { source: 'transcript' })]);
		assert.equal(r.route, 'hold');
		assert.equal(r.holdCause, 'risk');
		assert.equal(route([f('harassment', 0.6, { source: 'transcript' })], 'enforce_nsfw').route, 'approve');
	});

	it('a minor with a sexual score, or violent extremism, escalates to the senior role', () => {
		const minor = route([f('minor_present', 0.9), f('sexual', 0.35)]);
		assert.equal(minor.escalate, true);
		assert.equal(minor.route, 'hold');
		const ext = route([f('violent_extremism', 0.4, { source: 'transcript' })], 'enforce_nsfw');
		assert.equal(ext.escalate, true);
		assert.equal(ext.route, 'hold', 'escalations hold even in enforce_nsfw');
		assert.equal(route([f('minor_present', 0.9), f('sexual', 0.01)]).escalate, false, 'a child in a clean video is not an escalation');
	});

	it('a Quran span never counts for violence or hate', () => {
		const r = route([f('violent_extremism', 0.9, { source: 'transcript', quranRef: '2:191' })]);
		assert.equal(r.escalate, false);
		assert.equal(r.route, 'approve');
	});

	it('fail safe: a failed check or a budget stop never approves (VR14)', () => {
		assert.equal(route([], 'enforce', { checkFailed: true }).holdCause, 'check_failed');
		assert.equal(route([], 'enforce_nsfw', { budgetStopped: true }).holdCause, 'budget');
	});

	it('every threshold is configurable (VR5)', () => {
		const strict = normaliseVideoReviewSettings({ thresholds: { nsfwHit: 0.95 } });
		assert.equal(routeReview([f('sexual', 0.9)], strict, { mode: 'enforce_nsfw' }).route, 'approve');
	});
});

describe('initial state', () => {
	const opts = (trusted = false) => ({ trusted, reviewId: 'r1', now: NOW, settings });
	it('off and shadow never gate', () => {
		assert.equal(initialReviewState('off', opts()), null);
		assert.equal(initialReviewState('shadow', opts()), null);
	});
	it('enforce: every channel starts checking with a 5-minute ETA (VR1, VR6)', () => {
		assert.deepEqual(initialReviewState('enforce', opts()), { status: 'checking', reviewId: 'r1', timing: 'pre', since: NOW.toISOString(), etaAt: '2026-11-13T12:05:00.000Z' });
		assert.equal(initialReviewState('enforce_nsfw', opts())?.status, 'checking');
	});
	it('a trusted channel is post-hoc', () => {
		assert.deepEqual(initialReviewState('enforce', opts(true)), { status: 'post_review', reviewId: 'r1', timing: 'post', since: NOW.toISOString() });
	});
});

describe('the upload gate (markUploadComplete)', () => {
	function env(opts: { mode?: VideoReviewMode; allowed?: string; trusted?: boolean } = {}) {
		const global_settings = new MemoryBucket();
		if (opts.mode) global_settings.store.set(VIDEO_REVIEW_SETTINGS_KEY, JSON.stringify({ mode: opts.mode }));
		return {
			videos: new MemoryBucket({ vid: { id: 'vid', title: 'T', userId: 'alice', channelId: 'ch1', isPublic: true, uploadStatus: 'uploading' } }),
			channels: new MemoryBucket({ ch1: { id: 'ch1', name: 'C', ...(opts.trusted ? { reviewTrusted: true } : {}) } }),
			global_settings,
			queue: new MemoryQueue(),
			'bunny-stream-key': 'k',
			bunny_stream_library_id: '123',
			...(opts.allowed !== undefined ? { VIDEO_REVIEW_ALLOWED: opts.allowed } : {}),
		};
	}
	const complete = async (e: ReturnType<typeof env>) => {
		await markUploadComplete(e as never, { videoId: 'vid', userId: 'alice', fileSize: 10 });
		return e.videos.read('vid');
	};

	it('mode off (the default): no review field, nothing changes', async () => {
		const v = await complete(env({ allowed: 'true' }));
		assert.equal(v.uploadStatus, 'processing');
		assert.equal(v.review, undefined);
	});

	it('QA / stage (no VIDEO_REVIEW_ALLOWED): never gated, whatever the stored mode says', async () => {
		assert.equal((await complete(env({ mode: 'enforce' }))).review, undefined);
		assert.equal((await complete(env({ mode: 'enforce', allowed: 'false' }))).review, undefined);
	});

	it('shadow: not gated (the scan only records)', async () => {
		assert.equal((await complete(env({ mode: 'shadow', allowed: 'true' }))).review, undefined);
	});

	it('enforce in production: the upload starts checking before it can turn ready', async () => {
		const v = await complete(env({ mode: 'enforce', allowed: 'true' }));
		assert.equal(v.review.status, 'checking');
		assert.equal(v.review.timing, 'pre');
		assert.ok(v.review.reviewId);
		assert.ok(v.review.etaAt);
	});

	it('enforce on a trusted channel: post-hoc', async () => {
		const v = await complete(env({ mode: 'enforce', allowed: 'true', trusted: true }));
		assert.equal(v.review.status, 'post_review');
	});
});
