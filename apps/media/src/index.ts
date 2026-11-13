/**
 * al-ummah-now-media[-env]: R2 video delivery beside Bunny (epic #687,
 * docs/media-delivery/R2-DELIVERY-PLAN.md).
 *
 * - queue  al-ummah-now-transcode[-env]: one FFmpeg container per video (Transcoder); also
 *          remux-only jobs (kind 'mp4', the public MP4 backfill #1182)
 * - fetch  media.<env>.alummahnow.net/priv/*: token-checked private renditions (edge.ts)
 * - fetch  /internal/jobs/:videoId (X-API-Key): the job as the container sees it (admin)
 */
import type { Mp4JobMessage, TranscodeJobMessage } from '@al-ummah/shared-types';
import { isMediaRev, isMediaVideoId, isMp4JobMessage } from '@al-ummah/shared-types';
import { mp4QueueAction } from './jobs';
import { reportMp4Event } from './videos-api';
import { handlePrivate } from './edge';
import { errorText, log, secret, type Env } from './env';
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
		(b.access === 'pub' || b.access === 'priv')
	);
}

async function handleFetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
	const url = new URL(request.url);
	if (url.pathname.startsWith('/priv/')) return handlePrivate(request, env, ctx);
	if (url.pathname === '/health') return Response.json({ ok: true });
	const m = /^\/internal\/jobs\/([^/]+)$/.exec(url.pathname);
	if (m && request.method === 'GET') {
		const expected = await secret(env.INTERNAL_API_KEY, 'INTERNAL_API_KEY');
		if (request.headers.get('X-API-Key') !== expected) return new Response('Unauthorized', { status: 401 });
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

export default {
	// Private media and internal routes are never for search engines (crawlers.ts)
	async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
		return withNoIndex(await handleFetch(request, env, ctx));
	},

	async queue(batch: MessageBatch<unknown>, env: Env): Promise<void> {
		for (const msg of batch.messages) {
			if (isMp4JobMessage(msg.body)) {
				await handleMp4Job(msg as Message<Mp4JobMessage>, env);
				continue;
			}
			if (!isJob(msg.body)) {
				log.error('[MediaQueue] Malformed message dropped', { body: msg.body as Record<string, unknown> });
				msg.ack();
				continue;
			}
			const job = msg.body;
			try {
				await env.TRANSCODER.get(env.TRANSCODER.idFromName(job.videoId)).startJob(job);
				msg.ack();
			} catch (error) {
				// Container capacity (max_instances) or a start failure: try again later
				const delaySeconds = Math.min(900, 60 * 2 ** Math.max(0, msg.attempts - 1));
				log.warn('[MediaQueue] Could not start job; retrying', { videoId: job.videoId, attempts: msg.attempts, delaySeconds, error: errorText(error) });
				msg.retry({ delaySeconds });
			}
		}
	},
} satisfies ExportedHandler<Env>;
