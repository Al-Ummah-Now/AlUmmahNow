/**
 * al-ummah-now-media[-env]: R2 video delivery beside Bunny (epic #687,
 * docs/media-delivery/R2-DELIVERY-PLAN.md).
 *
 * - queue  al-ummah-now-transcode[-env]: one FFmpeg container per video (Transcoder); also
 *          remux-only jobs (kind 'mp4', the public MP4 backfill #1182)
 * - fetch  media.<env>.alummahnow.net/priv/*: token-checked private renditions (edge.ts)
 * - fetch  /internal/jobs/:videoId (X-API-Key): the job as the container sees it (admin)
 */
import type { CaptionAudioJobMessage, LiveReviewJobMessage, Mp4JobMessage, TranscodeJobMessage } from '@al-ummah/shared-types';
import { isCaptionAudioJobMessage, isLiveReviewJobMessage, isMediaRev, isMediaVideoId, isMp4JobMessage, isPrebuiltRef } from '@al-ummah/shared-types';
import { liveReviewQueueAction, mp4QueueAction, startFailureReason, startRetry } from './jobs';
import { reportCaptionAudio, reportEvent, reportLiveReviewMedia, reportMp4Event } from './videos-api';
import { handlePrivate } from './edge';
import { errorText, hasInternalKey, log, type Env } from './env';
import { withNoIndex } from './crawlers';
import type { Mp4Outcome } from './transcoder';

export { ContainerProxy } from '@cloudflare/containers';
export { Transcoder } from './transcoder';

function isJob(body: unknown): body is TranscodeJobMessage {
	const b = body as Partial<TranscodeJobMessage> | null;
	return (
		!!b &&
		b.kind === 'transcode' &&
		typeof b.videoId === 'string' &&
		isMediaVideoId(b.videoId) &&
		typeof b.rev === 'string' &&
		isMediaRev(b.rev) &&
		typeof b.jobId === 'string' &&
		(b.access === 'pub' || b.access === 'priv') &&
		(b.prebuilt === undefined || isPrebuiltRef(b.prebuilt))
	);
}

/** Under /priv/ because that is the only path routed to this Worker; it is not a rendition. */
export const SELFTEST_PATH = '/priv/_selftest';

async function handleSelfTest(env: Env): Promise<Response> {
	// Real starts are limited per deployed Worker version (selfTestDue), so callers cannot force a stream of them
	const version = env.CF_VERSION_METADATA?.id;
	try {
		const result = await env.TRANSCODER.get(env.TRANSCODER.idFromName('selftest')).selfTest(version);
		return Response.json(result, { status: result.ok ? 200 : 503, headers: { 'cache-control': 'no-store' } });
	} catch (error) {
		log.error('[MediaSelfTest] Self-test failed', { error: errorText(error) });
		return Response.json({ ok: false, startMs: 0, at: new Date().toISOString(), error: 'self-test unavailable' }, { status: 503, headers: { 'cache-control': 'no-store' } });
	}
}

async function handleFetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
	const url = new URL(request.url);
	// Release smoke: one real container start (limited per version in the DO; the answer is ok, timing and a plain reason)
	if (url.pathname === SELFTEST_PATH && request.method === 'GET') return handleSelfTest(env);
	if (url.pathname.startsWith('/priv/')) return handlePrivate(request, env, ctx);
	if (url.pathname === '/health') return Response.json({ ok: true });
	const m = /^\/internal\/jobs\/([^/]+)$/.exec(url.pathname);
	if (m && request.method === 'GET') {
		if (!(await hasInternalKey(request, env.INTERNAL_API_KEY))) return new Response('Unauthorized', { status: 401 });
		const videoId = decodeURIComponent(m[1]!);
		if (!isMediaVideoId(videoId)) return new Response('Bad id', { status: 400 });
		const state = await env.TRANSCODER.get(env.TRANSCODER.idFromName(videoId)).jobState();
		return Response.json({ job: state });
	}
	return new Response('Not found', { status: 404 });
}

/** A remux-only job: the progressive MP4 of a ready rendition (Transcoder.remuxMp4). */
async function handleMp4Job(msg: Message<Mp4JobMessage>, env: Env): Promise<void> {
	const job = msg.body;
	let result: Mp4Outcome;
	try {
		result = await env.TRANSCODER.get(env.TRANSCODER.idFromName(job.videoId)).remuxMp4(job);
	} catch (error) {
		result = { outcome: 'failed', error: errorText(error).slice(0, 300), fatal: false };
	}
	const action = mp4QueueAction(result, msg.attempts);
	if (!action.ack) {
		if (result.outcome === 'failed') log.warn('[MediaQueue] MP4 remux failed; retrying', { videoId: job.videoId, jobId: job.jobId, attempts: msg.attempts, error: result.error });
		msg.retry({ delaySeconds: action.delaySeconds });
		return;
	}
	if (action.giveUp && result.outcome === 'failed') {
		log.error('[MediaQueue] MP4 remux gave up', { videoId: job.videoId, jobId: job.jobId, attempts: msg.attempts, error: result.error });
		await reportMp4Event(env, { videoId: job.videoId, jobId: job.jobId, rev: job.rev, access: job.access, type: 'failed', at: new Date().toISOString(), error: result.error }).catch((error) =>
			log.warn('[MediaQueue] Could not report the MP4 failure', { videoId: job.videoId, error: errorText(error) }),
		);
	}
	msg.ack();
}

/**
 * A caption job's audio (AUN-CAPTIONS §5.2): Transcoder.extractCaptionAudio on the DO
 * `captions:<videoId>`. When it gives up, api-videos fails the job (minutes refunded, admin flagged).
 */
async function handleCaptionAudioJob(msg: Message<CaptionAudioJobMessage>, env: Env): Promise<void> {
	const job = msg.body;
	let result: Mp4Outcome;
	try {
		result = await env.TRANSCODER.get(env.TRANSCODER.idFromName(`captions:${job.videoId}`)).extractCaptionAudio(job);
	} catch (error) {
		result = { outcome: 'failed', error: errorText(error).slice(0, 300), fatal: false };
	}
	const action = liveReviewQueueAction(result, msg.attempts);
	if (!action.ack) {
		if (result.outcome === 'failed') log.warn('[MediaQueue] Caption audio failed; retrying', { jobId: job.jobId, videoId: job.videoId, attempts: msg.attempts, error: result.error });
		msg.retry({ delaySeconds: action.delaySeconds });
		return;
	}
	if (action.giveUp && result.outcome === 'failed') {
		log.error('[MediaQueue] Caption audio gave up', { jobId: job.jobId, videoId: job.videoId, attempts: msg.attempts, error: result.error });
		try {
			await reportCaptionAudio(env, job.jobId, { ok: false, error: result.error ?? 'extraction failed', retryable: !result.fatal });
		} catch (error) {
			// api-videos unreachable: keep the message so the job does not hang
			log.warn('[MediaQueue] Could not report the caption audio failure; retrying', { jobId: job.jobId, error: errorText(error) });
			msg.retry({ delaySeconds: 300 });
			return;
		}
	}
	msg.ack();
}

/**
 * A live recording's review media (VR9): Transcoder.extractLiveReview on the DO `live:<streamId>`.
 * When it gives up, api-videos is told so the check still runs on the title and thumbnail.
 */
async function handleLiveReviewJob(msg: Message<LiveReviewJobMessage>, env: Env): Promise<void> {
	const job = msg.body;
	let result: Mp4Outcome;
	try {
		result = await env.TRANSCODER.get(env.TRANSCODER.idFromName(`live:${job.streamId}`)).extractLiveReview(job);
	} catch (error) {
		result = { outcome: 'failed', error: errorText(error).slice(0, 300), fatal: false };
	}
	const action = liveReviewQueueAction(result, msg.attempts);
	if (!action.ack) {
		if (result.outcome === 'failed') log.warn('[MediaQueue] Live review extraction failed; retrying', { streamId: job.streamId, attempts: msg.attempts, error: result.error });
		msg.retry({ delaySeconds: action.delaySeconds });
		return;
	}
	if (action.giveUp && result.outcome === 'failed') {
		log.error('[MediaQueue] Live review extraction gave up; checking without frames', { streamId: job.streamId, attempts: msg.attempts, error: result.error });
		try {
			await reportLiveReviewMedia(env, job.streamId, { reviewId: job.reviewId, error: result.error ?? 'extraction failed' });
		} catch (error) {
			// api-videos unreachable: keep the message so the partial check is not lost
			log.warn('[MediaQueue] Could not report the live review failure; retrying', { streamId: job.streamId, error: errorText(error) });
			msg.retry({ delaySeconds: 300 });
			return;
		}
	}
	msg.ack();
}

/**
 * A transcode job: start it on its video's Transcoder. A start that fails (container start failed,
 * capacity full) comes back after a short delay (startRetry); the last delivery reports the job
 * failed to api-videos, which marks it and raises the Errors page item (Transcode again), instead
 * of the message falling silently into the DLQ.
 */
export async function handleTranscodeStart(msg: Message<TranscodeJobMessage>, env: Env): Promise<void> {
	const job = msg.body;
	try {
		await env.TRANSCODER.get(env.TRANSCODER.idFromName(job.videoId)).startJob(job);
		msg.ack();
		return;
	} catch (error) {
		const text = errorText(error).slice(0, 300);
		const reason = startFailureReason(text);
		const next = startRetry(msg.attempts);
		if (!next.giveUp) {
			log.warn('[MediaQueue] Could not start job; retrying', { videoId: job.videoId, jobId: job.jobId, attempts: msg.attempts, delaySeconds: next.delaySeconds, reason, error: text });
			msg.retry({ delaySeconds: next.delaySeconds });
			return;
		}
		log.error('[MediaQueue] Job never started; giving up', { videoId: job.videoId, jobId: job.jobId, attempts: msg.attempts, reason, error: text });
		const at = new Date().toISOString();
		try {
			await reportEvent(env, {
				videoId: job.videoId,
				jobId: job.jobId,
				type: 'failed',
				at,
				attempt: 0,
				final: true,
				error: `${reason}: ${text}`,
				instanceType: env.TRANSCODER_INSTANCE ?? 'standard-4',
				failure: { stage: 'start', error: `${reason}: ${text}`, attempt: 0, elapsedMs: 0, at, stopReason: `never started after ${msg.attempts} deliveries` },
			});
		} catch (reportError) {
			// api-videos unreachable: let the queue keep it (DLQ after max_retries); the sweep re-queues it
			log.warn('[MediaQueue] Could not report the job that never started', { videoId: job.videoId, error: errorText(reportError) });
			msg.retry({ delaySeconds: 300 });
			return;
		}
		msg.ack();
	}
}

export default {
	// Private media and internal routes are never for search engines (crawlers.ts)
	async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
		return withNoIndex(await handleFetch(request, env, ctx));
	},

	async queue(batch: MessageBatch<unknown>, env: Env): Promise<void> {
		for (const msg of batch.messages) {
			if (isCaptionAudioJobMessage(msg.body)) {
				await handleCaptionAudioJob(msg as Message<CaptionAudioJobMessage>, env);
				continue;
			}
			if (isLiveReviewJobMessage(msg.body)) {
				await handleLiveReviewJob(msg as Message<LiveReviewJobMessage>, env);
				continue;
			}
			if (isMp4JobMessage(msg.body)) {
				await handleMp4Job(msg as Message<Mp4JobMessage>, env);
				continue;
			}
			if (!isJob(msg.body)) {
				log.error('[MediaQueue] Malformed message dropped', { body: msg.body as Record<string, unknown> });
				msg.ack();
				continue;
			}
			await handleTranscodeStart(msg as Message<TranscodeJobMessage>, env);
		}
	},
} satisfies ExportedHandler<Env>;
