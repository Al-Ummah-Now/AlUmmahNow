/**
 * al-ummah-now-media[-env]: R2 video delivery beside Bunny (epic #687,
 * docs/media-delivery/R2-DELIVERY-PLAN.md).
 *
 * - queue  al-ummah-now-transcode[-env]: one FFmpeg container per video (Transcoder)
 * - fetch  media.<env>.alummahnow.net/priv/*: token-checked private renditions (edge.ts)
 * - fetch  /internal/jobs/:videoId (X-API-Key): the job as the container sees it (admin)
 */
import type { TranscodeJobMessage } from '@al-ummah/shared-types';
import { isMediaRev, isMediaVideoId } from '@al-ummah/shared-types';
import { handlePrivate } from './edge';
import { errorText, log, secret, type Env } from './env';
import { withNoIndex } from './crawlers';

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

export default {
	// Private media and internal routes are never for search engines (crawlers.ts)
	async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
		return withNoIndex(await handleFetch(request, env, ctx));
	},

	async queue(batch: MessageBatch<unknown>, env: Env): Promise<void> {
		for (const msg of batch.messages) {
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
