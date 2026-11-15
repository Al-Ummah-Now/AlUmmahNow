import { isMediaRev, isMediaVideoId } from '@al-ummah/shared-types';
import { hasInternalKey, type Env } from './env';

/**
 * Internal job routes (X-API-Key), for api-videos over its MEDIA_WORKER binding (the admin's
 * troubleshooting panel, docs/media-delivery/RUNBOOK.md):
 *   GET  /internal/jobs/:videoId            { job (stored), view, startFailure, durableObjectId }
 *   POST /internal/jobs/:videoId/cancel     { jobId, rev, access, queuedAt } → { outcome }
 *   POST /internal/jobs/:videoId/retry-now  { jobId } → { outcome }: a scheduled retry runs at once
 */
export async function handleInternalJob(request: Request, env: Env, videoId: string, action?: 'cancel' | 'retry-now'): Promise<Response> {
	if (!(await hasInternalKey(request, env.INTERNAL_API_KEY))) return new Response('Unauthorized', { status: 401 });
	if (!isMediaVideoId(videoId)) return new Response('Bad id', { status: 400 });
	const stub = env.TRANSCODER.get(env.TRANSCODER.idFromName(videoId));
	if (!action) {
		if (request.method !== 'GET') return new Response('Method not allowed', { status: 405 });
		const [job, state] = await Promise.all([stub.jobState(), stub.troubleshootState()]);
		return Response.json({ job, view: state.job, startFailure: state.startFailure, durableObjectId: state.durableObjectId });
	}
	if (request.method !== 'POST') return new Response('Method not allowed', { status: 405 });
	const body = (await request.json().catch(() => null)) as { jobId?: unknown; rev?: unknown; access?: unknown; queuedAt?: unknown } | null;
	if (typeof body?.jobId !== 'string' || !/^[A-Za-z0-9-]{8,64}$/.test(body.jobId)) return new Response('Bad job id', { status: 400 });
	if (action === 'retry-now') return Response.json({ outcome: await stub.retryNow(body.jobId) });
	if (typeof body.rev !== 'string' || !isMediaRev(body.rev) || (body.access !== 'pub' && body.access !== 'priv') || typeof body.queuedAt !== 'string') {
		return new Response('Bad job', { status: 400 });
	}
	const outcome = await stub.cancelJob({ videoId, jobId: body.jobId, rev: body.rev, access: body.access, queuedAt: body.queuedAt });
	return Response.json({ outcome });
}
